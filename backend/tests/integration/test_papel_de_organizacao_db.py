"""Spec 045, fatia B -- o papel de ORGANIZACAO, sem time.

⚠️⚠️ O ESTADO QUE ESTA FATIA TORNA NORMAL E O QUE ANTES ERA IMPOSSIVEL: uma
pessoa com autoridade total e **zero linhas em `user_team`**. Ate aqui, todo
papel exigia um time, e um admin sem vinculo nenhum entraria no sistema com
permissao VAZIA.

O que este arquivo prova:

    1. ADMIN de organizacao SEM time nenhum -> permissoes completas
    2. ... e lente `None` (ve tudo)
    3. GESTOR -> tudo do admin MENOS `workspace.manage`
    4. quem nao tem papel de organizacao nao ganha nada
    5. a fonte VELHA continua valendo (vinculo ADMIN em `user_team`)
    6. o job de arquivamento acha o admin pela fonte nova

⚠️ O ITEM 5 NAO E ZELO EXCESSIVO: e a razao de a migration `0022` ser aditiva.
Entre o `alembic upgrade` e o container novo subir, o codigo velho le
`user_team`; se a fatia tivesse removido os vinculos, essa janela deixaria o
workspace sem quem administre.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.enums import OrgRole
from app.modules.auth.domain import team_scope
from app.modules.auth.domain.permissions import (
    permissions_for_org_role,
    permissions_for_roles,
)
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _com_org_role(db, *, workspace_id, user_id, papel):
    """Grava o papel de organizacao direto na linha do usuario."""
    from app.db.models import User

    user = await db.get(User, user_id)
    user.org_role = papel
    await db.flush()
    return user


# ------------------------------------------------------------- o mapa novo


def test_admin_de_organizacao_tem_o_cartao_completo():
    """⭐ Ele recebe EXATAMENTE o que o ADMIN de time ja tinha.

    ⚠️ Nao e preguica de recorte: durante a transicao as duas fontes convivem,
    e um conjunto menor aqui faria a pessoa PERDER poderes no instante em que
    o vinculo dela saisse de `user_team`. Afinar "definir" x "operar" a
    organizacao e trabalho da Spec 047, com o cadastro ja limpo.
    """
    assert permissions_for_org_role("ADMIN") == permissions_for_roles(
        frozenset({"ADMIN"})
    )


def test_gestor_opera_mas_nao_desfaz_a_organizacao():
    gestor = permissions_for_org_role("GESTOR")
    admin = permissions_for_org_role("ADMIN")

    assert "organization.update" not in gestor
    assert "subteam.create" in gestor
    # A diferenca e EXATAMENTE o que era `workspace.manage` -- desde a Spec 049
    # (fatia A), os cinco verbos em que ele foi cortado. Se alguem acrescentar
    # outra sem decidir, este assert cai.
    assert admin - gestor == frozenset(
        {
            "organization.update",
            "org_role.grant",
            "org_role.revoke",
            "subteam.delete",
            "team.move",
        }
    )


def test_sem_papel_de_organizacao_nao_ganha_nada():
    assert permissions_for_org_role(None) == frozenset()
    # ⚠️ Papel desconhecido devolve VAZIO, e nao estoura: conceder por engano
    # e pior que conceder de menos.
    assert permissions_for_org_role("DONO_DA_EMPRESA") == frozenset()


# ------------------------------------------------------------- a lente


def test_admin_de_organizacao_ve_tudo_sem_ter_time():
    """⭐ O caso que esta fatia inventa: autoridade sem vinculo nenhum."""
    raiz = __import__("uuid").uuid4()
    arvore = (node(raiz),)

    assert team_scope.is_admin((), org_role="ADMIN") is True
    assert team_scope.visible_team_ids((), arvore, org_role="ADMIN") is None
    assert team_scope.editable_team_ids((), arvore, org_role="ADMIN") is None


def test_a_fonte_velha_continua_valendo():
    """⚠️ E o que torna a migration `0022` segura de rodar.

    Sabotagem: tirar o ramo `any(m.role == "ADMIN")` de `is_admin` faz este
    teste cair -- e e o cenario da janela de deploy, em que o cadastro ainda
    nao foi limpo.
    """
    from app.core.tenant import Membership

    raiz = __import__("uuid").uuid4()
    vinculo_admin = (Membership(team_id=raiz, role="ADMIN"),)

    assert team_scope.is_admin(vinculo_admin) is True
    assert team_scope.is_admin(vinculo_admin, org_role=None) is True


def test_gestor_ve_tudo_sem_ser_admin():
    """GESTOR ve tudo -- e continua NAO sendo ADMIN.

    ⚠️⚠️ ESTE TESTE AFIRMOU O CONTRARIO ATE 14/09, e o contrario nao era
    decisao. Ele se chamava `test_gestor_nao_ve_tudo`, esperava a lente VAZIA,
    e dizia que ver tudo "e decisao de produto e entra aqui de proposito". A
    decisao JA EXISTIA, escrita antes deste arquivo: `045/decisoes.md`, tabela
    da lente -- *"ADMIN / GESTOR | tudo"* -- e, na lista de premissas,
    *"Premissa em vigor: gestor ve tudo."*

    O que o teste protegia na pratica era um GESTOR que nao via tarefa
    nenhuma: 404 em toda tarefa, 403 em todo formulario. Achado pela matriz da
    Spec 049 (fatia 0) e consertado na fatia 0b.

    ⚠️ AS DUAS AFIRMACOES FICAM SEPARADAS de proposito: `is_admin` continua
    respondendo so por ADMIN (e a pergunta "quem DEFINE a organizacao"), e a
    lente e decidida pelo papel de organizacao, em `visible_team_ids`.
    """
    raiz = __import__("uuid").uuid4()
    assert team_scope.is_admin((), org_role="GESTOR") is False
    assert team_scope.visible_team_ids((), (node(raiz),), org_role="GESTOR") is None
    assert team_scope.editable_team_ids((), (node(raiz),), org_role="GESTOR") is None


# ------------------------------------------------------------- ponta a ponta


async def test_membership_carrega_o_papel_de_organizacao(db) -> None:
    """A leitura nao custa query nova -- a linha do User ja vinha."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _com_org_role(db, workspace_id=ws, user_id=dona, papel=OrgRole.ADMIN)

    membership = await MembershipRepository(db).get_membership(
        user_id=dona, workspace_id=ws
    )

    assert membership is not None
    assert membership.org_role == "ADMIN"
    # ⚠️ E ELA NAO ESTA EM TIME NENHUM -- o estado novo.
    assert membership.team_roles == ()
    assert membership.roles == frozenset()
    assert raiz is not None  # a raiz existe; ela so nao esta nela


async def test_o_job_de_arquivamento_acha_o_admin_pela_fonte_nova(db) -> None:
    """⚠️⚠️ O CONSUMIDOR MAIS PERIGOSO DA FATIA.

    O `stale_archival_service` procurava o admin SO em `user_team`. Com a
    Camila virando ADMIN de organizacao sem vinculo de time, aquela consulta
    voltaria VAZIA e o job pularia o workspace inteiro -- sem erro, sem log de
    falha, sem tela. O arquivamento pararia e ninguem descobriria.

    Sabotagem: remover o bloco da fonte nova em `_resolve_admin` faz este
    teste devolver `None`.
    """
    ws = await f.make_workspace(db)
    await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _com_org_role(db, workspace_id=ws, user_id=dona, papel=OrgRole.ADMIN)

    achado = await StaleArchivalService(db)._resolve_admin(ws)

    assert achado == dona
