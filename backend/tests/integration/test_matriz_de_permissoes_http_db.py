"""Matriz de permissoes pela rota: uma linha por acao, um esperado por papel.

Pela rota porque parte da autorizacao mora no servico; o que se promete e a
resposta HTTP. O contexto e montado com `permissions_for_actor`, como em
`get_tenant_context` (com `frozenset` a checagem por time vira a ampla).

Mundo com dois times raiz, senao as linhas de alvo cruzado nao distinguem nada:

    Marketing > SEO, Design, Vazio-MKT
    Comercial > Vendas, Suporte, Vazio-COM

    atores   ADMIN e GESTOR de organizacao, sem vinculo
             MANAGER do Marketing, SUPERVISOR do SEO, OPERATOR do SEO
             DUAS_ARVORES: MANAGER do Marketing e OPERATOR do Comercial
                           (onde "enxergo o item" e "tenho o verbo" divergem)

`esperado`: `OK` e qualquer 2xx, `NEGADO` e 403, `OCULTO` e 404 (403
confirmaria que existe); outro numero e uma regra de negocio respondendo antes.
`diverge`/`defeito` marcam linha que difere do comportamento desejado; `meta`
guarda o alvo enquanto a linha nao chegou nele.

Rota nova sem linha aqui derruba `tests/test_rotas_na_matriz.py`.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.tenant import Membership, TenantContext
from app.db.models import BaseTable, Solicitation, User
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from tests.integration import factories as f
from tests.integration.conftest import acting_as, cliente, mship, node

pytestmark = pytest.mark.integration

PAPEIS = ("ADMIN", "GESTOR", "MANAGER", "SUPERVISOR", "OPERATOR", "DUAS_ARVORES")

OK = "ok"
NEGADO = 403
OCULTO = 404


# ---------------------------------------------------------------- o mundo


async def _quadro_padrao(db, team_id: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(
            select(Board.id).where(Board.team_id == team_id, Board.is_default)
        )
    ).scalar_one()


async def _solicitacao(db, ws: uuid.UUID, form_id: uuid.UUID | None) -> uuid.UUID:
    s = Solicitation(
        workspace_id=ws,
        requester_name="Fulana",
        requester_email="fulana@x.com",
        batch_id=uuid.uuid4(),
        category="arte",
        summary="Preciso de uma arte",
        answers=[{"label": "O que precisa?", "value": "um banner"}],
        form_id=form_id,
    )
    db.add(s)
    await db.flush()
    return s.id


async def _operador(db, ws: uuid.UUID, *times: uuid.UUID) -> uuid.UUID:
    """Uma pessoa OPERATOR em cada um dos `times`."""
    uid = await f.make_user(db, workspace_id=ws)
    for t in times:
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=t, role="OPERATOR")
    return uid


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db, name="WS Matriz")
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    design = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="design")
    vazio_mkt = await f.make_team(
        db, workspace_id=ws, parent_team_id=mkt, slug="vazio-mkt"
    )
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    vendas = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vendas"
    )
    suporte = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="suporte"
    )
    vazio_com = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vazio-com"
    )
    arvore = (
        node(mkt), node(seo, mkt), node(design, mkt), node(vazio_mkt, mkt),
        node(com), node(vendas, com), node(suporte, com), node(vazio_com, com),
    )

    # --- os cinco atores
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    gestor = await f.make_user(db, workspace_id=ws, org_role="GESTOR")
    # Alvos do teto: rebaixar admin2 nao esbarra no ultimo admin; tirar gestor2
    # nao e o GESTOR tirando a si mesmo.
    admin2 = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    gestor2 = await f.make_user(db, workspace_id=ws, org_role="GESTOR")
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=mkt, role="MANAGER")
    # Par do MANAGER: MANAGER so atua sobre SUPERVISOR e OPERATOR.
    manager2 = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager2, team_id=mkt, role="MANAGER")
    supervisor = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=supervisor, team_id=seo, role="SUPERVISOR"
    )
    operator = await _operador(db, ws, seo)
    # Lente inclui o Comercial (onde e OPERATOR); verbos de comando, nao.
    duas_arvores = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=duas_arvores, team_id=mkt, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=duas_arvores, team_id=com, role="OPERATOR"
    )

    # --- pessoas-alvo
    # `alvo_*` tem dois vinculos, ambos em subtime, para remover um nao ser "o
    # ultimo vinculo" e promover no subtime nao esbarrar no papel da raiz (409).
    alvo_mkt = await _operador(db, ws, seo, design)
    alvo_com = await _operador(db, ws, vendas, suporte)
    # `livre_*` so tem a raiz, para ser vinculado ao subtime sem "ja esta la".
    livre_mkt = await _operador(db, ws, mkt)
    livre_com = await _operador(db, ws, com)
    # `misto` esta nas duas arvores: a conta e de quem alcanca as duas.
    misto = await _operador(db, ws, seo, vendas)
    # Par do supervisor: outro SUPERVISOR no SEO, com segundo vinculo no Design.
    sup_par = await _operador(db, ws, design)
    await f.add_member(db, workspace_id=ws, user_id=sup_par, team_id=seo, role="SUPERVISOR")
    # `livre_design` so esta num subtime, e nao na raiz: vira SUPERVISOR no SEO
    # sem esbarrar em "o papel no time principal nao pode ser menor" (409).
    livre_design = await _operador(db, ws, design)
    # Ja esta em duas arvores: ganha vinculo novo numa delas.
    misto_design = await _operador(db, ws, design, vendas)
    # Conta desativada.
    desativado = await _operador(db, ws, design)
    (await db.get(User, desativado)).is_active = False
    # Desativada no Comercial, para reativar provar o alcance.
    desativado_com = await _operador(db, ws, vendas)
    (await db.get(User, desativado_com)).is_active = False

    # --- quadros e colunas
    geral_mkt = await _quadro_padrao(db, mkt)
    geral_com = await _quadro_padrao(db, com)
    quadro_seo = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Do SEO", colunas=COLUNAS_BASE
    )
    quadro_vendas = await f.make_board(
        db, workspace_id=ws, team_id=vendas, name="De Vendas", colunas=COLUNAS_BASE
    )
    # Irmao do SEO: o SUPERVISOR do SEO nao administra.
    quadro_design = await f.make_board(
        db, workspace_id=ws, team_id=design, name="Do Design", colunas=COLUNAS_BASE
    )
    # Quadro secundario na raiz: nem o geral (que nao se apaga) nem de subtime.
    secundario_mkt = await f.make_board(
        db, workspace_id=ws, team_id=mkt, name="Secundario", colunas=COLUNAS_BASE
    )
    cancelado_secundario = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == secundario_mkt.id,
                BoardColumn.legacy_status == TaskStatus.CANCELLED,
            )
        )
    ).scalar_one()
    cancelado_seo = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == quadro_seo.id,
                BoardColumn.legacy_status == TaskStatus.CANCELLED,
            )
        )
    ).scalar_one()

    # --- tarefas (quadro explicito: com dois times raiz o da factory e ambiguo)
    # e projetos
    tarefa_mkt = await f.make_task(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt, board_id=geral_mkt
    )
    tarefa_com = await f.make_task(
        db, workspace_id=ws, created_by=alvo_com, team_id=com, board_id=geral_com
    )
    projeto_mkt = await f.make_project(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt
    )
    projeto_com = await f.make_project(
        db, workspace_id=ws, created_by=alvo_com, team_id=com
    )

    # --- formularios pelo servico, e uma solicitacao cada
    with acting_as(workspace_id=ws, user_id=admin, team_tree=arvore, org_role="ADMIN"):
        forms = SolicitationFormService(db)
        form_mkt = await forms.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        form_com = await forms.criar_formulario(team_id=com, slug="metas", title="Metas")
    sol_mkt = await _solicitacao(db, ws, form_mkt.id)
    sol_com = await _solicitacao(db, ws, form_com.id)
    # Orfa (sem formulario): so a organizacao a ve.
    sol_orfa = await _solicitacao(db, ws, None)
    # Aprovada, para marcar tarefa.
    sol_aprovada_mkt = await _solicitacao(db, ws, form_mkt.id)
    (await db.get(Solicitation, sol_aprovada_mkt)).status = "APPROVED"

    # --- um comentario de OUTRA pessoa, para a linha de moderacao
    with acting_as(
        workspace_id=ws,
        user_id=alvo_mkt,
        memberships=(mship(seo, "OPERATOR"), mship(design, "OPERATOR")),
        team_tree=arvore,
    ):
        comentario = await CommentService(db).create_comment(
            task_id=tarefa_mkt.id, content="de outra pessoa"
        )
    # O mesmo no Comercial, onde DUAS_ARVORES e OPERATOR.
    with acting_as(
        workspace_id=ws,
        user_id=alvo_com,
        memberships=(mship(vendas, "OPERATOR"), mship(suporte, "OPERATOR")),
        team_tree=arvore,
    ):
        comentario_com = await CommentService(db).create_comment(
            task_id=tarefa_com.id, content="de outra pessoa"
        )
    # O quadro do SEO tem tarefa: a linha de apagar quadro mede o caso com tarefas.
    await f.make_task(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=seo, board_id=quadro_seo.id
    )

    await db.commit()

    # --- bases: uma em cada raiz, e uma excluida no Marketing
    b_mkt = await f.make_base(db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt)
    b_com = await f.make_base(db, workspace_id=ws, created_by=alvo_com, team_id=com)
    b_excl = await f.make_base(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt, deleted=True
    )
    base = {
        "base_mkt": b_mkt["base"],
        "base_com": b_com["base"],
        "base_mkt_excluida": b_excl["base"],
        "coluna_mkt": b_mkt["coluna"],
        "coluna_com": b_com["coluna"],
        "titulo_mkt": b_mkt["titulo"],
        "titulo_com": b_com["titulo"],
        "opcao_mkt": b_mkt["opcao"],
        "linha_mkt": b_mkt["linha"],
        "linha_com": b_com["linha"],
        "visao_mkt": b_mkt["visao"],
        "visao_padrao_mkt": b_mkt["visao_padrao"],
    }

    return {
        "ws": ws,
        "arvore": arvore,
        "atores": {
            "ADMIN": (admin, (), "ADMIN"),
            "GESTOR": (gestor, (), "GESTOR"),
            "MANAGER": (manager, (Membership(team_id=mkt, role="MANAGER"),), None),
            "SUPERVISOR": (
                supervisor, (Membership(team_id=seo, role="SUPERVISOR"),), None
            ),
            "OPERATOR": (
                operator, (Membership(team_id=seo, role="OPERATOR"),), None
            ),
            "DUAS_ARVORES": (
                duas_arvores,
                (
                    Membership(team_id=mkt, role="MANAGER"),
                    Membership(team_id=com, role="OPERATOR"),
                ),
                None,
            ),
        },
        # tudo o que um caminho ou corpo pode citar, como string
        "ids": {
            k: str(v)
            for k, v in {
                "mkt": mkt, "seo": seo, "design": design, "vazio_mkt": vazio_mkt,
                "com": com, "vendas": vendas, "suporte": suporte,
                "vazio_com": vazio_com,
                "alvo_mkt": alvo_mkt, "alvo_com": alvo_com,
                "livre_mkt": livre_mkt, "livre_com": livre_com, "misto": misto,
                "sup_par": sup_par, "livre_design": livre_design,
                "admin2": admin2, "gestor2": gestor2, "manager2": manager2,
                "geral_mkt": geral_mkt, "geral_com": geral_com,
                "quadro_seo": quadro_seo.id, "quadro_vendas": quadro_vendas.id,
                "quadro_design": quadro_design.id,
                "cancelado_seo": cancelado_seo,
                "secundario_mkt": secundario_mkt.id,
                "cancelado_secundario": cancelado_secundario,
                "tarefa_mkt": tarefa_mkt.id, "tarefa_com": tarefa_com.id,
                "projeto_mkt": projeto_mkt, "projeto_com": projeto_com,
                "form_mkt": form_mkt.id, "form_com": form_com.id,
                "sol_mkt": sol_mkt, "sol_com": sol_com,
                "comentario": comentario.id,
                "comentario_com": comentario_com.id,
                "misto_design": misto_design, "desativado": desativado,
                "desativado_com": desativado_com,
                "sol_orfa": sol_orfa, "sol_aprovada_mkt": sol_aprovada_mkt,
                **base,
            }.items()
        },
    }


# ---------------------------------------------------------------- o mundo

# O mundo e montado uma vez por modulo, numa transacao externa; cada teste roda
# num SAVEPOINT desfeito no fim, entao o que um teste grava o proximo nao ve.
pytestmark = pytest.mark.asyncio(loop_scope="module")


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def _conexao_com_mundo(_bootstrapped_db_url: str):
    eng = create_async_engine(_bootstrapped_db_url, future=True)
    try:
        async with eng.connect() as conn:
            trans = await conn.begin()
            try:
                async with AsyncSession(
                    bind=conn,
                    join_transaction_mode="create_savepoint",
                    expire_on_commit=False,
                ) as s:
                    m = await _mundo(s)
                    # Fechar a sessao desfaz o savepoint aberto: o commit o fixa
                    # (vira RELEASE SAVEPOINT; a transacao externa segue aberta).
                    await s.commit()
                yield conn, m
            finally:
                await trans.rollback()
    finally:
        await eng.dispose()


@pytest.fixture
def mundo(_conexao_com_mundo) -> dict:
    return _conexao_com_mundo[1]


@pytest_asyncio.fixture(loop_scope="module")
async def db(_conexao_com_mundo):
    conn, _ = _conexao_com_mundo
    ponto = await conn.begin_nested()
    try:
        async with AsyncSession(
            bind=conn,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        ) as s:
            yield s
    finally:
        if ponto.is_active:
            await ponto.rollback()


def _contexto(m: dict, papel: str) -> TenantContext:
    """O contexto do papel, montado como `get_tenant_context` monta."""
    user_id, memberships, org_role = m["atores"][papel]
    return TenantContext(
        workspace_id=m["ws"],
        user_id=user_id,
        roles=frozenset(x.role for x in memberships)
        | (frozenset({org_role}) if org_role else frozenset()),
        permissions=permissions_for_actor(
            memberships=memberships, tree=m["arvore"], org_role=org_role
        ),
        memberships=memberships,
        team_tree=m["arvore"],
        org_role=org_role,
    )


def _client(db, ctx: TenantContext) -> AsyncClient:
    return cliente(db, ctx)


# ---------------------------------------------------------------- a tabela


@dataclass(frozen=True)
class Linha:
    acao: str
    alvo: str
    metodo: str
    caminho: str
    corpo: dict | None
    #: um valor por papel, na ordem de PAPEIS
    esperado: tuple
    diverge: str = ""
    defeito: str = ""
    #: alvo por papel enquanto a linha nao chegou nele; vazio = `esperado` ja e o alvo
    meta: tuple = ()


T = "/api/v1"

#: Conteudo (ler, coluna, linha, visao) na base da PROPRIA raiz: todo papel.
_TODOS = (OK,) * 6
#: Estrutura (criar, editar, excluir, restaurar a base): todos menos o OPERATOR.
_QUEM_CRIA = (OK, OK, OK, OK, NEGADO, OK)
#: Conteudo na base do COMERCIAL: so quem tem `base.read` la -- a organizacao e
#: DUAS_ARVORES, que e OPERATOR no Comercial.
_COM_CONTEUDO = (OK, OK, OCULTO, OCULTO, OCULTO, OK)
#: Estrutura na base do COMERCIAL. O OPERATOR leva 403 no portao da rota (nao
#: tem o verbo em lugar nenhum), e DUAS_ARVORES le a base mas nao tem o verbo
#: la: 403, a celula em que lente e verbo divergem.
_COM_ESTRUTURA = (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)
#: Planilha minima ("Titulo" + uma linha), em base64.
_CSV_DE_UMA_LINHA = "VGl0dWxvClgK"

MATRIZ: tuple[Linha, ...] = (
    # ---------------------------------------------------------- organizacao
    # O GESTOR edita a organizacao e mexe em GESTOR; ADMIN como destino ou alvo e o
    # teto, que mora no servico.
    Linha("organization.update", "a organizacao", "patch", f"{T}/workspaces/current",
          {"name": "Outro nome"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.grant", "GESTOR a uma pessoa", "patch",
          f"{T}/members/{{alvo_mkt}}/organization-role", {"role": "GESTOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.grant", "ADMIN a uma pessoa (o teto)", "patch",
          f"{T}/members/{{alvo_mkt}}/organization-role", {"role": "ADMIN"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.revoke", "tirar o papel de outro GESTOR", "patch",
          f"{T}/members/{{gestor2}}/organization-role", {"role": None},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.revoke", "tirar o papel de outro ADMIN (o teto)", "patch",
          f"{T}/members/{{admin2}}/organization-role", {"role": None},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- time
    Linha("team.create", "raiz nova", "post", f"{T}/workspaces/current/teams",
          {"name": "Nova", "slug": "nova"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.create", "no Marketing", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.create", "no Comercial", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.update", "o Marketing (raiz)", "patch",
          f"{T}/workspaces/current/teams/{{mkt}}", {"name": "Outro"},
          (409, 409, 409, NEGADO, NEGADO, 409),
          diverge="item 04 (fora desta spec): renomear time raiz"),
    # O SUPERVISOR edita so o proprio subtime.
    Linha("subteam.update", "o SEO", "patch",
          f"{T}/workspaces/current/teams/{{seo}}", {"name": "Outro"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("subteam.update", "o Design (irmao do SEO)", "patch",
          f"{T}/workspaces/current/teams/{{design}}", {"name": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.update", "Vendas (Comercial)", "patch",
          f"{T}/workspaces/current/teams/{{vendas}}", {"name": "Outro"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.delete", "vazio do Marketing", "delete",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}", None,
          # O gerente apaga subtime da propria arvore; o gestor nao.
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.delete", "vazio do Comercial", "delete",
          f"{T}/workspaces/current/teams/{{vazio_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Mover time so dentro da propria arvore.
    Linha("team.move", "Vazio-MKT para dentro do SEO (mesma arvore)", "post",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}/move", {"new_parent_id": "{seo}"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.move", "Vazio-MKT para dentro do Comercial", "post",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}/move", {"new_parent_id": "{com}"},
          # Destino em outra arvore e recusado.
          (409, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.move", "o Comercial (raiz) para dentro do Marketing", "post",
          f"{T}/workspaces/current/teams/{{com}}/move", {"new_parent_id": "{mkt}"},
          # Time raiz ganhando pai e recusado.
          (409, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- pessoa
    Linha("person.create", "no Marketing", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{mkt}", "role": "OPERATOR"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    # Gestor e gerente cadastram gerente.
    Linha("person.create", "como MANAGER no Marketing", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{mkt}", "role": "MANAGER"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.create", "no Comercial", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{com}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.update", "senha de alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/reset-password", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.update", "senha de alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/reset-password", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/deactivate", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.deactivate", "alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # A conta e de todas as arvores da pessoa: com vinculo no SEO e em Vendas, so a
    # organizacao a desativa.
    Linha("person.deactivate", "alguem do Marketing E do Comercial", "post",
          f"{T}/members/{{misto}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # A conta respeita o papel do alvo: resetar senha devolve a provisoria a quem
    # clicou, entao seria tomar a conta.
    Linha("person.update", "senha de outro ADMIN", "post",
          f"{T}/members/{{admin2}}/reset-password", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.update", "senha de outro MANAGER do Marketing", "post",
          f"{T}/members/{{manager2}}/reset-password", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "outro ADMIN", "post",
          f"{T}/members/{{admin2}}/deactivate", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "outro MANAGER do Marketing", "post",
          f"{T}/members/{{manager2}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Reset de conta desativada e 409 (o login a trata como senha errada); o caminho
    # e reativar.
    Linha("person.update", "senha de conta DESATIVADA do Marketing", "post",
          f"{T}/members/{{desativado}}/reset-password", None,
          (409, 409, 409, NEGADO, NEGADO, 409)),
    Linha("person.reactivate", "conta desativada do Marketing", "post",
          f"{T}/members/{{desativado}}/reactivate", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.reactivate", "conta desativada do Comercial", "post",
          f"{T}/members/{{desativado_com}}/reactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- vinculo
    Linha("membership.create", "OPERATOR no SEO", "post",
          f"{T}/members/{{livre_mkt}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.create", "OPERATOR em Vendas", "post",
          f"{T}/members/{{livre_com}}/team", {"team_id": "{vendas}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # O SUPERVISOR cria, promove, rebaixa e tira outro supervisor so no proprio
    # subtime; as linhas fora do SEO provam o "proprio".
    Linha("membership.create", "SUPERVISOR no SEO", "post",
          f"{T}/members/{{livre_design}}/team", {"team_id": "{seo}", "role": "SUPERVISOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    # Quem nao e da organizacao so vincula quem ja esta naquela arvore.
    Linha("membership.create", "OPERATOR no SEO, de quem so esta no Comercial", "post",
          f"{T}/members/{{livre_com}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("membership.create", "OPERATOR no SEO, de quem esta no Design E em Vendas", "post",
          f"{T}/members/{{misto_design}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR no SEO", "patch",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", {"role": "SUPERVISOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "rebaixar outro SUPERVISOR no SEO", "patch",
          f"{T}/members/{{sup_par}}/teams/{{seo}}", {"role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR no Design (irmao do SEO)", "patch",
          f"{T}/members/{{alvo_mkt}}/teams/{{design}}", {"role": "SUPERVISOR"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR em Vendas", "patch",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", {"role": "SUPERVISOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Gestor e gerente promovem a gerente; rebaixar gerente e so do gestor e do admin.
    Linha("membership.update", "OPERATOR->MANAGER no Marketing", "patch",
          f"{T}/members/{{livre_mkt}}/teams/{{mkt}}", {"role": "MANAGER"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("membership.update", "rebaixar outro MANAGER do Marketing", "patch",
          f"{T}/members/{{manager2}}/teams/{{mkt}}", {"role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # O GESTOR nao tira ninguem de time.
    Linha("membership.delete", "OPERATOR do SEO", "delete",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("membership.delete", "outro SUPERVISOR do SEO", "delete",
          f"{T}/members/{{sup_par}}/teams/{{seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("membership.delete", "OPERATOR de Vendas", "delete",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Conta desativada: `_assert_alvo_ativo` responde antes.
    Linha("membership.update", "conta DESATIVADA, OPERATOR->SUPERVISOR no Design", "patch",
          f"{T}/members/{{desativado}}/teams/{{design}}", {"role": "SUPERVISOR"},
          (409, 409, 409, 409, NEGADO, 409)),
    # ---------------------------------------------------------- quadro
    Linha("board.create.root", "no Marketing", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("board.create.root", "no Comercial", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("board.create", "no SEO", "post", f"{T}/boards",
          {"name": "Pauta", "team_id": "{seo}"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("board.update.root", "quadro geral do Marketing", "patch",
          f"{T}/boards/{{geral_mkt}}", {"name": "Geral"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("board.update.root", "quadro geral do Comercial", "patch",
          f"{T}/boards/{{geral_com}}", {"name": "Geral"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("board.update", "quadro do Design (irmao do SEO)", "patch",
          f"{T}/boards/{{quadro_design}}", {"name": "Pecas"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("board.delete", "quadro do Design (irmao do SEO)", "delete",
          f"{T}/boards/{{quadro_design}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    # O GESTOR nao apaga quadro. O do SEO tem tarefa e apaga assim mesmo (o aviso
    # e da tela).
    Linha("board.delete", "quadro do SEO, com tarefa", "delete",
          f"{T}/boards/{{quadro_seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("board.delete", "quadro de Vendas", "delete",
          f"{T}/boards/{{quadro_vendas}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("board.delete.root", "quadro secundario do Marketing", "delete",
          f"{T}/boards/{{secundario_mkt}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    # Ler quadro pelo id respeita a lente.
    Linha("board.read", "quadro de Vendas, pelo id", "get",
          f"{T}/boards/{{quadro_vendas}}", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OCULTO)),
    # ---------------------------------------------------------- coluna
    # Escrita de coluna e so pelo lote, que cobra o verbo de cada operacao.
    Linha("column.create", "no geral do Marketing", "put",
          f"{T}/boards/{{geral_mkt}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("column.create", "no geral do Comercial", "put",
          f"{T}/boards/{{geral_com}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("column.create", "no quadro do SEO", "put",
          f"{T}/boards/{{quadro_seo}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("column.delete", "coluna vazia do SEO", "put",
          f"{T}/boards/{{quadro_seo}}/columns", {"apagar": [{"id": "{cancelado_seo}"}]},
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    # Coluna de quadro da raiz: o GESTOR renomeia e nao apaga.
    Linha("column.update", "renomear coluna do secundario do Marketing", "put",
          f"{T}/boards/{{secundario_mkt}}/columns",
          {"renomear": [{"id": "{cancelado_secundario}", "name": "Outro nome"}]},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("column.delete", "coluna do secundario do Marketing", "put",
          f"{T}/boards/{{secundario_mkt}}/columns",
          {"apagar": [{"id": "{cancelado_secundario}"}]},
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    # ---------------------------------------------------------- tarefa
    Linha("task.create", "no Marketing", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{mkt}", "board_id": "{geral_mkt}",
           "assignee_ids": ["{alvo_mkt}"]},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.create", "no Comercial", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{com}", "board_id": "{geral_com}",
           "assignee_ids": ["{alvo_com}"]},
          (OK, OK, 422, 422, 422, OK)),
    Linha("task.update", "do Marketing", "patch", f"{T}/tasks/{{tarefa_mkt}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.update", "do Comercial", "patch", f"{T}/tasks/{{tarefa_com}}",
          {"title": "Outro"},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    # Mover pede editar a origem e criar no destino. `dry_run` para nao mudar o mundo.
    Linha("task.update", "mover a do Marketing para o Comercial", "post",
          f"{T}/tasks/{{tarefa_mkt}}/relocate",
          {"board_id": "{geral_com}", "dry_run": True},
          (OK, OK, 422, 422, 422, OK)),
    Linha("task.update", "mover a do Marketing para o secundario dele", "post",
          f"{T}/tasks/{{tarefa_mkt}}/relocate",
          {"board_id": "{secundario_mkt}", "dry_run": True},
          (OK, OK, OK, OK, OK, OK)),
    # `detach_project` numa tarefa sem projeto: passa pelas travas e nao muda nada.
    # Sem campo nenhum o `move` volta antes de conferir a edicao.
    Linha("task.update", "mover (move) a do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/move", {"detach_project": True},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.update", "mover (move) a do Comercial", "post",
          f"{T}/tasks/{{tarefa_com}}/move", {"detach_project": True},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    # Duplicar e criar no quadro da origem; origem que nao se ve e 404.
    Linha("task.create", "duplicar a do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/duplicate",
          {"title": "Copia", "assignee_ids": ["{alvo_mkt}"]},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.create", "duplicar a do Comercial", "post",
          f"{T}/tasks/{{tarefa_com}}/duplicate",
          {"title": "Copia", "assignee_ids": ["{alvo_com}"]},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("task.archive", "do Marketing", "post", f"{T}/tasks/{{tarefa_mkt}}/archive",
          None,
          (OK, OK, OK, OK, OK, OK)),
    # Desarquivar tarefa ativa e idempotente, mas confere as travas antes.
    Linha("task.archive", "desarquivar a do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/unarchive", None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.archive", "desarquivar a do Comercial", "post",
          f"{T}/tasks/{{tarefa_com}}/unarchive", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("task.delete", "do Marketing", "delete", f"{T}/tasks/{{tarefa_mkt}}", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    # DUAS_ARVORES enxerga a tarefa do Comercial mas so tem `task.delete` no
    # Marketing: o verbo e conferido no time do item.
    Linha("task.delete", "do Comercial", "delete", f"{T}/tasks/{{tarefa_com}}", None,
          (OK, OK, OCULTO, NEGADO, NEGADO, NEGADO)),
    Linha("task.assign", "responsavel na do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/assignees", {"user_id": "{alvo_mkt}"},
          (OK, OK, OK, OK, OK, OK)),
    Linha("comment.moderate", "apagar comentario alheio", "delete",
          f"{T}/tasks/{{tarefa_mkt}}/comments/{{comentario}}", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("comment.moderate", "apagar comentario alheio do Comercial", "delete",
          f"{T}/tasks/{{tarefa_com}}/comments/{{comentario_com}}", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, NEGADO)),
    # ---------------------------------------------------------- projeto
    Linha("project.create", "no Marketing", "post", f"{T}/projects",
          {"title": "P", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("project.create", "no Comercial", "post", f"{T}/projects",
          {"title": "P", "team_id": "{com}"},
          (OK, OK, 422, NEGADO, NEGADO, NEGADO)),
    Linha("project.update", "do Marketing", "patch", f"{T}/projects/{{projeto_mkt}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("project.update", "do Comercial", "patch", f"{T}/projects/{{projeto_com}}",
          {"title": "Outro"},
          (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)),
    Linha("project.delete", "do Marketing", "delete", f"{T}/projects/{{projeto_mkt}}",
          None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("project.delete", "do Comercial", "delete", f"{T}/projects/{{projeto_com}}",
          None,
          (OK, NEGADO, OCULTO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- links
    # Sem verbo proprio: tem de bater com `task.update`/`project.update` acima.
    Linha("task.links", "ler os da do Marketing", "get",
          f"{T}/tasks/{{tarefa_mkt}}/links", None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.links", "substituir os da do Marketing", "put",
          f"{T}/tasks/{{tarefa_mkt}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.links", "ler os da do Comercial", "get",
          f"{T}/tasks/{{tarefa_com}}/links", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("task.links", "substituir os da do Comercial", "put",
          f"{T}/tasks/{{tarefa_com}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("project.links", "ler os do Marketing", "get",
          f"{T}/projects/{{projeto_mkt}}/links", None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("project.links", "substituir os do Marketing", "put",
          f"{T}/projects/{{projeto_mkt}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("project.links", "ler os do Comercial", "get",
          f"{T}/projects/{{projeto_com}}/links", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("project.links", "substituir os do Comercial", "put",
          f"{T}/projects/{{projeto_com}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- formulario
    Linha("form.create", "no Marketing", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{mkt}", "slug": "novo", "title": "Novo"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.create", "no Comercial", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{com}", "slug": "novo", "title": "Novo"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Abrir formulario pelo id sem `form.read` no time e 404.
    Linha("form.read", "do Comercial, pelo id", "get",
          f"{T}/solicitacoes/formularios/{{form_com}}", None,
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),
    Linha("form.update", "do Marketing", "patch",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", {"title": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.update", "do Comercial", "patch",
          f"{T}/solicitacoes/formularios/{{form_com}}", {"title": "Outro"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Despublicar: publicar sem perguntas e 422 e a linha mediria a regra. O portao
    # e o mesmo.
    Linha("form.publish", "despublicar do Marketing", "post",
          f"{T}/solicitacoes/formularios/{{form_mkt}}/publicar", {"publicado": False},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.delete", "do Marketing", "delete",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("form.delete", "do Comercial", "delete",
          f"{T}/solicitacoes/formularios/{{form_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- solicitacao
    Linha("solicitation.review", "aprovar do Marketing", "post",
          f"{T}/solicitacoes/{{sol_mkt}}/aprovar", {},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("solicitation.review", "aprovar do Comercial", "post",
          f"{T}/solicitacoes/{{sol_com}}/aprovar", {},
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),
    Linha("solicitation.review", "aprovar a orfa (sem formulario)", "post",
          f"{T}/solicitacoes/{{sol_orfa}}/aprovar", {},
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),
    # Marcar tarefa fora da lente e 404 (senao a fila mostraria o titulo dela).
    Linha("solicitation.review", "marcar tarefa do Comercial na do Marketing", "post",
          f"{T}/solicitacoes/{{sol_aprovada_mkt}}/tarefa", {"task_id": "{tarefa_com}"},
          (OK, OK, OCULTO, NEGADO, NEGADO, OK)),
    # ---------------------------------------------------------- base
    Linha("base.create", "no Marketing", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{mkt}"},
          _QUEM_CRIA),
    # Sem o verbo NAQUELE time e 403, e nao 404: o time nao e segredo.
    Linha("base.create", "no Comercial", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Base so em time raiz; quem tem o verbo em algum lugar chega na regra (422).
    Linha("base.create", "no SEO (subtime)", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{seo}"},
          (422, 422, 422, 422, NEGADO, 422)),
    Linha("base.read", "do Marketing", "get", f"{T}/bases/{{base_mkt}}", None,
          _TODOS),
    Linha("base.read", "do Comercial", "get", f"{T}/bases/{{base_com}}", None,
          _COM_CONTEUDO),
    # Excluida e 404 para todos, como inexistente.
    Linha("base.read", "excluida do Marketing", "get",
          f"{T}/bases/{{base_mkt_excluida}}", None,
          (OCULTO,) * 6),
    # Quem cria edita todas as bases da arvore.
    Linha("base.update", "do Marketing", "patch", f"{T}/bases/{{base_mkt}}",
          {"name": "Outro"},
          _QUEM_CRIA),
    Linha("base.update", "do Comercial", "patch", f"{T}/bases/{{base_com}}",
          {"name": "Outro"},
          _COM_ESTRUTURA),
    # O GESTOR exclui base.
    Linha("base.delete", "do Marketing", "delete", f"{T}/bases/{{base_mkt}}", None,
          _QUEM_CRIA),
    Linha("base.delete", "do Comercial", "delete", f"{T}/bases/{{base_com}}", None,
          _COM_ESTRUTURA),
    Linha("base.restore", "excluida do Marketing", "post",
          f"{T}/bases/{{base_mkt_excluida}}/restore", None,
          _QUEM_CRIA),
    # Trocar o tipo e editar coluna: qualquer um da arvore.
    Linha("base_column.create", "na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/columns", {"name": "Plataforma", "type": "select"},
          _TODOS),
    Linha("base_column.create", "na do Comercial", "post",
          f"{T}/bases/{{base_com}}/columns", {"name": "Plataforma", "type": "select"},
          _COM_CONTEUDO),
    # Duplicar e criar coluna.
    Linha("base_column.create", "duplicar, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}/duplicate", None,
          _TODOS),
    Linha("base_column.create", "duplicar, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/columns/{{coluna_com}}/duplicate", None,
          _COM_CONTEUDO),
    Linha("base_column.update", "trocar o tipo, na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}", {"type": "text"},
          _TODOS),
    # Trocar a coluna principal e editar coluna; na propria coluna de titulo nao
    # muda nada.
    Linha("base_column.update", "coluna principal, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/columns/{{titulo_mkt}}/make-title", None,
          _TODOS),
    Linha("base_column.update", "coluna principal, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/columns/{{titulo_com}}/make-title", None,
          _COM_CONTEUDO),
    Linha("base_column.delete", "apagar opcao, na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}/options/{{opcao_mkt}}", None,
          _TODOS),
    Linha("base_column.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}", None,
          _TODOS),
    Linha("base_row.create", "na do Marketing", "post", f"{T}/bases/{{base_mkt}}/rows",
          {"values": {}},
          _TODOS),
    Linha("base_row.update", "na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/rows/{{linha_mkt}}", {"values": {}},
          _TODOS),
    Linha("base_row.update", "na do Comercial", "patch",
          f"{T}/bases/{{base_com}}/rows/{{linha_com}}", {"values": {}},
          _COM_CONTEUDO),
    # O lote cobra o mesmo verbo da celula unica.
    Linha("base_row.update", "lote de celulas, na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/cells",
          {"cells": [{"row_id": "{linha_mkt}", "column_id": "{coluna_mkt}", "value": None}]},
          _TODOS),
    Linha("base_row.update", "lote de celulas, na do Comercial", "patch",
          f"{T}/bases/{{base_com}}/cells",
          {"cells": [{"row_id": "{linha_com}", "column_id": "{coluna_com}", "value": None}]},
          _COM_CONTEUDO),
    # Exportar e ler; colar alem da ultima linha e criar linha; importacao em
    # `dry_run` nao grava.
    Linha("base.read", "exportar, a do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/export", {"format": "csv"},
          _TODOS),
    Linha("base.read", "exportar, a do Comercial", "post",
          f"{T}/bases/{{base_com}}/export", {"format": "csv"},
          _COM_CONTEUDO),
    Linha("base_row.create", "colar linhas novas, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/rows/batch", {"rows": [{"values": {}}]},
          _TODOS),
    Linha("base_row.create", "colar linhas novas, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/rows/batch", {"rows": [{"values": {}}]},
          _COM_CONTEUDO),
    Linha("base_row.create", "previa da importacao", "post",
          f"{T}/bases/import/preview",
          {"filename": "a.csv", "content_base64": _CSV_DE_UMA_LINHA},
          _TODOS),
    Linha("base_row.create", "validar importacao, na do Marketing", "post",
          f"{T}/bases/import",
          {"filename": "a.csv", "content_base64": _CSV_DE_UMA_LINHA, "base_id": "{base_mkt}",
           "columns": [{"index": 0, "action": "title"}], "dry_run": True},
          _TODOS),
    Linha("base_row.create", "validar importacao, na do Comercial", "post",
          f"{T}/bases/import",
          {"filename": "a.csv", "content_base64": _CSV_DE_UMA_LINHA, "base_id": "{base_com}",
           "columns": [{"index": 0, "action": "title"}], "dry_run": True},
          _COM_CONTEUDO),
    # Canal ao vivo e desfazer com a pilha vazia: quem le a base; a de outra arvore
    # continua 404.
    Linha("base.events", "canal ao vivo, na do Marketing", "get",
          f"{T}/bases/{{base_mkt}}/events", None,
          _TODOS),
    Linha("base.events", "canal ao vivo, na do Comercial", "get",
          f"{T}/bases/{{base_com}}/events", None,
          _COM_CONTEUDO),
    Linha("base.undo", "pilha vazia, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/undo", None,
          _TODOS),
    Linha("base.undo", "pilha vazia, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/undo", None,
          _COM_CONTEUDO),
    Linha("base_row.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/rows/{{linha_mkt}}", None,
          _TODOS),
    Linha("base_view.create", "na do Marketing", "post", f"{T}/bases/{{base_mkt}}/views",
          {"name": "Por status", "layout": "board"},
          _TODOS),
    Linha("base_view.update", "na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/views/{{visao_mkt}}", {"name": "Outro"},
          _TODOS),
    Linha("base_view.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/views/{{visao_mkt}}", None,
          _TODOS),
    # A visao padrao nao se apaga: regra, para todos.
    Linha("base_view.delete", "a padrao, na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/views/{{visao_padrao_mkt}}", None,
          (409,) * 6),
)


def _preencher(valor, ids: dict):
    if isinstance(valor, str):
        return valor.format(**ids)
    if isinstance(valor, list):
        return [_preencher(v, ids) for v in valor]
    if isinstance(valor, dict):
        return {k: _preencher(v, ids) for k, v in valor.items()}
    return valor


def _resultado(status: int):
    return OK if 200 <= status < 300 else status


def _casos():
    for linha in MATRIZ:
        assert len(linha.esperado) == len(PAPEIS), linha.acao
        for papel, esperado in zip(PAPEIS, linha.esperado, strict=True):
            yield pytest.param(
                linha, papel, esperado, id=f"{linha.acao}[{linha.alvo}]-{papel}"
            )


class _HubDeMentira:
    """`LiveHub` sem banco: aqui so importa quem abre o canal."""

    async def subscribe(self, _base_id):
        return asyncio.Queue()

    def unsubscribe(self, _base_id, _fila) -> None:
        return None


@pytest.fixture(autouse=True)
def _canal_ao_vivo_curto(monkeypatch):
    """O canal ao vivo fecha na hora, senao cada linha permitida esperaria 60 s."""
    from app.modules.bases.api import router as rotas_da_base
    from app.modules.bases.infrastructure import live

    monkeypatch.setattr(rotas_da_base, "CANAL_SEGUNDOS", 0.0)
    monkeypatch.setattr(live, "hub", _HubDeMentira())


@pytest.mark.parametrize(("linha", "papel", "esperado"), list(_casos()))
async def test_matriz(db, mundo, linha: Linha, papel: str, esperado) -> None:
    m = mundo
    url = _preencher(linha.caminho, m["ids"])
    corpo = _preencher(linha.corpo, m["ids"])

    async with _client(db, _contexto(m, papel)) as cli:
        if linha.metodo in ("get", "delete"):
            r = await getattr(cli, linha.metodo)(url)
        else:
            r = await getattr(cli, linha.metodo)(url, json=corpo)

    obtido = _resultado(r.status_code)
    assert obtido == esperado, (
        f"{papel} em {linha.acao} ({linha.alvo}): esperado {esperado}, "
        f"obtido {r.status_code} -- {r.text[:300]}"
        + (f"\n  (linha marcada: DIVERGE DO ALVO, {linha.diverge})" if linha.diverge else "")
        + (f"\n  (linha marcada: DEFEITO, {linha.defeito})" if linha.defeito else "")
    )


async def test_linha_com_meta_ainda_nao_chegou_la() -> None:
    """Linha com `meta` igual ao `esperado` ja chegou no alvo: apague a marca."""
    for linha in MATRIZ:
        if not linha.meta:
            continue
        nome = f"{linha.acao} ({linha.alvo})"
        assert len(linha.meta) == len(PAPEIS), nome
        assert linha.diverge, f"{nome}: meta sem dizer por que ainda diverge"
        assert linha.meta != linha.esperado, (
            f"{nome}: ja chegou no alvo -- apague `meta` e `diverge`"
        )


# ---------------------------------------------------------------- o cadeado


def _linha(acao: str, alvo: str) -> Linha:
    (achada,) = [x for x in MATRIZ if x.acao == acao and x.alvo == alvo]
    return achada


#: (leitura, campo, linha da MATRIZ que o campo espelha). Campo aberto com linha
#: NEGADO e botao que da 403; o contrario, acao permitida escondida.
CADEADOS_DE_ITEM = (
    ("/tasks/{tarefa_mkt}", "can_delete", ("task.delete", "do Marketing")),
    ("/tasks/{tarefa_com}", "can_delete", ("task.delete", "do Comercial")),
    ("/projects/{projeto_mkt}", "can_update", ("project.update", "do Marketing")),
    ("/projects/{projeto_com}", "can_update", ("project.update", "do Comercial")),
    ("/projects/{projeto_mkt}", "can_delete", ("project.delete", "do Marketing")),
    ("/projects/{projeto_com}", "can_delete", ("project.delete", "do Comercial")),
    ("/bases/{base_mkt}", "can_update", ("base.update", "do Marketing")),
    ("/bases/{base_com}", "can_update", ("base.update", "do Comercial")),
    ("/bases/{base_mkt}", "can_create_column", ("base_column.create", "na do Marketing")),
    ("/bases/{base_com}", "can_create_column", ("base_column.create", "na do Comercial")),
    ("/bases/{base_mkt}", "can_update_row", ("base_row.update", "na do Marketing")),
    ("/bases/{base_com}", "can_update_row", ("base_row.update", "na do Comercial")),
    ("/bases/{base_mkt}", "can_delete_view", ("base_view.delete", "na do Marketing")),
    ("/bases/{base_mkt}", "can_delete", ("base.delete", "do Marketing")),
    ("/bases/{base_com}", "can_delete", ("base.delete", "do Comercial")),
)


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_do_item_concorda_com_a_matriz(db, mundo, papel: str) -> None:
    """O botao do item vem do servidor e bate com a matriz.

    Item fora da lente da 404 na leitura e nao tem botao; a linha diz OCULTO ou
    NEGADO.
    """
    m = mundo
    idx = PAPEIS.index(papel)
    async with _client(db, _contexto(m, papel)) as cli:
        for caminho, campo, (acao, alvo) in CADEADOS_DE_ITEM:
            r = await cli.get(T + _preencher(caminho, m["ids"]))
            esperado = _linha(acao, alvo).esperado[idx]
            if r.status_code == 404:
                assert esperado != OK, f"{papel}: {caminho} oculto, linha OK"
                continue
            assert r.status_code == 200, r.text
            assert r.json()[campo] is (esperado == OK), (
                f"{papel} em {acao} ({alvo}): {campo}={r.json()[campo]}, linha {esperado}"
            )


#: (pessoa, linha de resetar senha, de desativar, de reativar). `None` = sem
#: linha; `False` = botao fechado para todo papel.
CONTAS = (
    ("alvo_mkt", ("person.update", "senha de alguem do Marketing"),
     ("person.deactivate", "alguem do Marketing"), False),
    ("alvo_com", ("person.update", "senha de alguem do Comercial"),
     ("person.deactivate", "alguem do Comercial"), False),
    ("misto", None, ("person.deactivate", "alguem do Marketing E do Comercial"), False),
    ("admin2", ("person.update", "senha de outro ADMIN"),
     ("person.deactivate", "outro ADMIN"), False),
    ("manager2", ("person.update", "senha de outro MANAGER do Marketing"),
     ("person.deactivate", "outro MANAGER do Marketing"), False),
    # Desativadas: resetar e desativar fechados; reativar segue a matriz.
    ("desativado", ("person.update", "senha de conta DESATIVADA do Marketing"), False,
     ("person.reactivate", "conta desativada do Marketing")),
    ("desativado_com", None, False,
     ("person.reactivate", "conta desativada do Comercial")),
)


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_da_conta_concorda_com_a_matriz(db, mundo, papel: str) -> None:
    """Os botoes de resetar senha, desativar e reativar batem com a matriz."""
    m = mundo
    idx = PAPEIS.index(papel)
    async with _client(db, _contexto(m, papel)) as cli:
        for pessoa, senha, desativar, reativar in CONTAS:
            r = await cli.get(T + _preencher(f"/members/{{{pessoa}}}/account-actions", m["ids"]))
            assert r.status_code == 200, r.text
            corpo = r.json()
            for campo, linha in (
                ("can_reset_password", senha),
                ("can_deactivate", desativar),
                ("can_reactivate", reativar),
            ):
                if linha is None:
                    continue
                if linha is False:
                    assert corpo[campo] is False, f"{papel} em {pessoa}: {campo} aberto"
                    continue
                esperado = _linha(*linha).esperado[idx]
                assert corpo[campo] is (esperado == OK), (
                    f"{papel} em {pessoa}: {campo}={corpo[campo]}, linha {esperado}"
                )


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_do_vinculo_de_gerente_concorda_com_a_matriz(db, mundo, papel: str) -> None:
    """`can_edit_role` no vinculo de um gerente bate com "rebaixar outro MANAGER"."""
    m = mundo
    idx = PAPEIS.index(papel)
    esperado = _linha("membership.update", "rebaixar outro MANAGER do Marketing").esperado[idx]
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(T + _preencher("/members/{manager2}/teams", m["ids"]))
    assert r.status_code == 200, r.text
    (vinculo,) = [v for v in r.json() if v["team_id"] == m["ids"]["mkt"]]
    assert vinculo["can_edit_role"] is (esperado == OK), (
        f"{papel}: can_edit_role={vinculo['can_edit_role']}, linha {esperado}"
    )


#: O que cada papel ve na fila e nos formularios. `None` = a rota recusa (403).
FILA = {
    "ADMIN": {"sol_mkt", "sol_com", "sol_orfa", "sol_aprovada_mkt"},
    "GESTOR": {"sol_mkt", "sol_com", "sol_orfa", "sol_aprovada_mkt"},
    "MANAGER": {"sol_mkt", "sol_aprovada_mkt"},
    "SUPERVISOR": None,
    "OPERATOR": None,
    # OPERATOR no Comercial: a lente o inclui, a fila nao.
    "DUAS_ARVORES": {"sol_mkt", "sol_aprovada_mkt"},
}
FORMULARIOS = {
    "ADMIN": {"form_mkt", "form_com"},
    "GESTOR": {"form_mkt", "form_com"},
    "MANAGER": {"form_mkt"},
    "SUPERVISOR": None,
    "OPERATOR": None,
    "DUAS_ARVORES": {"form_mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_fila_e_formularios_pelo_verbo_e_nao_pela_lente(db, mundo, papel: str) -> None:
    """Fila e formularios pelo verbo. A orfa so aparece para a organizacao."""
    m = mundo
    nome_do_id = {v: k for k, v in m["ids"].items()}
    async with _client(db, _contexto(m, papel)) as cli:
        fila = await cli.get(f"{T}/solicitacoes", params={"size": 50})
        formularios = await cli.get(f"{T}/solicitacoes/formularios")

    if FILA[papel] is None:
        assert fila.status_code == 403, fila.text
    else:
        assert fila.status_code == 200, fila.text
        vistas = {
            nome_do_id[i["id"]] for lote in fila.json()["items"] for i in lote["items"]
        }
        assert vistas == FILA[papel], f"{papel} ve na fila {vistas}"

    if FORMULARIOS[papel] is None:
        assert formularios.status_code == 403, formularios.text
    else:
        assert formularios.status_code == 200, formularios.text
        vistos = {nome_do_id[f_["id"]] for f_ in formularios.json()}
        assert vistos == FORMULARIOS[papel], f"{papel} ve os formularios {vistos}"


#: Times raiz em que cada papel cria projeto (`can_create_project`).
CRIA_PROJETO = {
    "ADMIN": {"mkt", "com"},
    "GESTOR": {"mkt", "com"},
    "MANAGER": {"mkt"},
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    # Enxerga o Comercial e nao cria nele.
    "DUAS_ARVORES": {"mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_projeto(db, mundo, papel: str) -> None:
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    raizes = {
        nome_do_id[i["id"]]
        for i in r.json()["items"]
        if i["can_create_project"] and i["parent_team_id"] is None
    }
    assert raizes == CRIA_PROJETO[papel], f"{papel} cria em {raizes}"
    # As linhas `project.create` dizem o mesmo.
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("project.create", alvo).esperado[idx]
        assert (linha == OK) is (time in raizes), f"{papel} {alvo}: linha {linha}"


#: Raizes em que cada papel cria base (`can_create_base`); subtime nunca aparece.
CRIA_BASE = {
    "ADMIN": {"mkt", "com"},
    "GESTOR": {"mkt", "com"},
    "MANAGER": {"mkt"},
    "SUPERVISOR": {"mkt"},
    "OPERATOR": set(),
    "DUAS_ARVORES": {"mkt"},
}

#: Times em que cada papel cria formulario (`can_create_form`), subtimes inclusive.
_ARVORE_MKT = {"mkt", "seo", "design", "vazio_mkt"}
_ARVORE_COM = {"com", "vendas", "suporte", "vazio_com"}
CRIA_FORMULARIO = {
    "ADMIN": _ARVORE_MKT | _ARVORE_COM,
    "GESTOR": _ARVORE_MKT | _ARVORE_COM,
    "MANAGER": _ARVORE_MKT,
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    "DUAS_ARVORES": _ARVORE_MKT,
}

#: Bases que cada papel le em `GET /bases`. A excluida nao aparece.
LE_BASES = {
    "ADMIN": {"base_mkt", "base_com"},
    "GESTOR": {"base_mkt", "base_com"},
    "MANAGER": {"base_mkt"},
    "SUPERVISOR": {"base_mkt"},
    "OPERATOR": {"base_mkt"},
    "DUAS_ARVORES": {"base_mkt", "base_com"},
}


#: O que cada papel ve em `GET /bases/trash`. `None` = a rota recusa.
LIXEIRA = {
    "ADMIN": {"base_mkt_excluida"},
    "GESTOR": {"base_mkt_excluida"},
    "MANAGER": {"base_mkt_excluida"},
    "SUPERVISOR": {"base_mkt_excluida"},
    "OPERATOR": None,
    "DUAS_ARVORES": {"base_mkt_excluida"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_lixeira_de_bases_pelo_verbo(db, mundo, papel: str) -> None:
    """Quem pode criar base ve a lixeira; bate com `base.restore`."""
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/bases/trash")
    if LIXEIRA[papel] is None:
        assert r.status_code == 403, r.text
        return
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    vistas = {nome_do_id[b["id"]] for b in r.json()}
    assert vistas == LIXEIRA[papel], f"{papel} ve na lixeira {vistas}"
    assert all(b["can_restore"] for b in r.json())
    linha = _linha("base.restore", "excluida do Marketing").esperado[PAPEIS.index(papel)]
    assert linha == OK


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_base(db, mundo, papel: str) -> None:
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    cria = {nome_do_id[i["id"]] for i in r.json()["items"] if i["can_create_base"]}
    assert cria == CRIA_BASE[papel], f"{papel} cria base em {cria}"
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("base.create", alvo).esperado[idx]
        assert (linha == OK) is (time in cria), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_formulario(db, mundo, papel: str) -> None:
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    cria = {nome_do_id[i["id"]] for i in r.json()["items"] if i["can_create_form"]}
    assert cria == CRIA_FORMULARIO[papel], f"{papel} cria formulario em {cria}"
    # O cadeado bate com o POST.
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("form.create", alvo).esperado[idx]
        assert (linha == OK) is (time in cria), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_lista_de_bases_pelo_verbo(db, mundo, papel: str) -> None:
    """A lista usa `teams_with("base.read")`, nao a lente; bate com `base.read`."""
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/bases")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    vistas = {nome_do_id[b["id"]] for b in r.json()}
    assert vistas == LE_BASES[papel], f"{papel} ve {vistas}"
    idx = PAPEIS.index(papel)
    for alvo, base in (("do Marketing", "base_mkt"), ("do Comercial", "base_com")):
        linha = _linha("base.read", alvo).esperado[idx]
        assert (linha == OK) is (base in vistas), f"{papel} {alvo}: linha {linha}"


#: Subtimes que cada papel edita (`can_update`). Raiz nunca: renomear raiz e recusado.
EDITA = {
    "ADMIN": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "GESTOR": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "MANAGER": {"seo", "design", "vazio_mkt"},
    "SUPERVISOR": {"seo"},
    "OPERATOR": set(),
    "DUAS_ARVORES": {"seo", "design", "vazio_mkt"},
}

#: Subtimes que cada papel apaga (`can_delete`). O GESTOR nao apaga time.
APAGA = {
    "ADMIN": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "GESTOR": set(),
    "MANAGER": {"seo", "design", "vazio_mkt"},
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    "DUAS_ARVORES": {"seo", "design", "vazio_mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_o_que_cada_papel_apaga(db, mundo, papel: str) -> None:
    """`can_delete` de `GET /teams` bate com as linhas `subteam.delete`."""
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    apagaveis = {
        nome_do_id[item["id"]] for item in r.json()["items"] if item["can_delete"]
    }
    assert apagaveis == APAGA[papel], f"{papel} apaga {apagaveis}"
    idx = PAPEIS.index(papel)
    for alvo, time in (("vazio do Marketing", "vazio_mkt"), ("vazio do Comercial", "vazio_com")):
        linha = _linha("subteam.delete", alvo).esperado[idx]
        assert (linha == OK) is (time in apagaveis), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_o_que_cada_papel_edita(db, mundo, papel: str) -> None:
    """`can_update` de `GET /teams` bate com as linhas `subteam.update`."""
    m = mundo
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text

    nome_do_id = {v: k for k, v in m["ids"].items()}
    editaveis = {
        nome_do_id[item["id"]] for item in r.json()["items"] if item["can_update"]
    }
    assert editaveis == EDITA[papel], f"{papel} edita {editaveis}"


# O mundo e compartilhado: o que um teste grava nao pode chegar no seguinte.
# Os dois rodam nesta ordem (pytest segue a ordem do arquivo).
async def test_isolamento_um_teste_apaga_a_base(db, mundo) -> None:
    base = await db.get(BaseTable, uuid.UUID(mundo["ids"]["base_mkt"]))
    await db.delete(base)
    await db.commit()
    assert await db.get(BaseTable, base.id) is None


async def test_isolamento_o_seguinte_ainda_ve_a_base(db, mundo) -> None:
    assert await db.get(BaseTable, uuid.UUID(mundo["ids"]["base_mkt"])) is not None
