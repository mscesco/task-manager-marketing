"""`list_batches(team_id)`: a fila de solicitacoes do time que a tela mostra.

Dois recortes combinados com AND:

    a lente / o verbo  responde "posso ver?" -- `None` para papel de organizacao
    o `team_id`        responde "estou olhando qual time?" -- vale para todos

Sem o segundo, quem administra a organizacao ve a fila do Comercial dentro da
tela do Marketing. Com so o segundo, um gerente pediria a fila alheia.

O mundo: duas raizes, e as duas sao o ponto.

    Marketing (raiz) + subtime SEO      formulario "arte" no SEO
    Comercial (raiz)                    formulario "metas" no Comercial
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.db.models import Solicitation
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.solicitations.application.service import SolicitationService
from app.modules.solicitations.infrastructure.repository import (
    SolicitationRepository,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


def mship(team_id: uuid.UUID, role: str) -> Membership:
    return Membership(team_id=team_id, role=role)


async def _solicitacao(db, ws, *, form_id, category="arte"):
    s = Solicitation(
        workspace_id=ws,
        requester_name="Fulana",
        requester_email="fulana@x.com",
        requester_phone="11999999999",
        requester_department="Vendas",
        requester_polo="Sede",
        batch_id=uuid.uuid4(),
        category=category,
        summary="Preciso de uma arte",
        answers=[{"label": "O que precisa?", "value": "um banner"}],
        form_id=form_id,
    )
    db.add(s)
    await db.flush()
    return s


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Fila do Time")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(marketing), node(seo, marketing), node(comercial))

    # Os formularios nascem por servico, para passar pelas mesmas regras da tela.
    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(),
        team_tree=arvore,
        org_role="ADMIN",
    ):
        svc = SolicitationFormService(db)
        # ⚠️ O formulario do Marketing vive no SUBTIME, de proposito: e o que
        # faz o teste dos descendentes valer algo.
        f_seo = await svc.criar_formulario(team_id=seo, slug="arte", title="Arte")
        f_com = await svc.criar_formulario(
            team_id=comercial, slug="metas", title="Metas"
        )

    await _solicitacao(db, ws, form_id=f_seo.id)
    await _solicitacao(db, ws, form_id=f_com.id, category="metas")

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "user": user,
        "arvore": arvore,
        "f_seo": f_seo,
        "f_com": f_com,
    }


def _como_admin(m):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


def _como_gerente_do_marketing(m):
    """Quem le a fila sem ser da organizacao: o MANAGER
    (`solicitation.read`). Os testes chamam o repositorio direto, entao um
    papel sem o verbo "veria" a fila que a rota nunca lhe mostra."""
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(mship(m["marketing"], "MANAGER"),),
        team_tree=m["arvore"],
    )


async def _forms_na_fila(db, *, team_id):
    linhas, _ = await SolicitationRepository(db).list_batches(
        params=PageParams(page=1, size=50), team_id=team_id
    )
    return [s.form_id for s in linhas]


# ------------------------------------------------- 1. o recorte da tela


async def test_recorte_pela_raiz_traz_o_formulario_do_SUBTIME(db) -> None:
    """⚠️ RAIZ + DESCENDENTES, e nao igualdade: o formulario "arte" e do SEO,
    e e na raiz que a triagem acontece. E o Comercial sai mesmo para o admin,
    que o alcanca: quem o tira e o recorte, nao a lente."""
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])

    assert set(forms) == {m["f_seo"].id}


async def test_sem_recorte_a_fila_e_da_organizacao(db) -> None:
    """`team_id=None` e resposta legitima, e por isso o parametro NAO tem
    default: "a fila da organizacao" nao pode sair de um valor omitido."""
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=None)

    assert set(forms) == {m["f_seo"].id, m["f_com"].id}


# ------------------------------------------------- 2. a lente segue de pe


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """O gerente do Marketing pede a fila do Comercial, e recebe vazio.

    Os dois predicados entram na mesma consulta com AND. O teste trava o
    contrato: aplicar o recorte em vez da lente apareceria aqui.
    """
    m = await _mundo(db)
    with _como_gerente_do_marketing(m):
        forms = await _forms_na_fila(db, team_id=m["comercial"])

    assert forms == []


async def test_gerente_ve_so_a_fila_do_seu_time(db) -> None:
    """Com ou sem recorte, o gerente do Marketing ve so o formulario do SEO."""
    m = await _mundo(db)
    with _como_gerente_do_marketing(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])
        sem_recorte = await _forms_na_fila(db, team_id=None)

    assert forms == [m["f_seo"].id]
    assert sem_recorte == [m["f_seo"].id]


# ------------------------------------------------- 3. os contadores


async def test_contadores_recebem_o_mesmo_recorte_da_lista(db) -> None:
    """Um contador que diverge da lista manda procurar um pedido que nao
    esta ali. Os badges recebem o MESMO `team_id` da listagem."""
    m = await _mundo(db)
    with _como_admin(m):
        svc = SolicitationService(db)
        # A fila do Marketing: a do SEO.
        do_marketing = (await svc.count_by_tab(m["marketing"]))["PENDING"]
        da_organizacao = (await svc.count_by_tab(None))["PENDING"]
        linhas_do_marketing = await _forms_na_fila(db, team_id=m["marketing"])

    assert do_marketing == len(linhas_do_marketing) == 1
    assert da_organizacao == 2


async def test_o_TOTAL_tambem_respeita_o_recorte(db) -> None:
    """⚠️ `list_batches` consulta em DOIS tempos: (1) escolhe os `batch_id` da
    pagina e conta o total; (2) traz as linhas desses lotes. O recorte entra
    nos dois. Sem o do tempo (1), as linhas continuam certas (o tempo 2 recorta
    de novo), e so o `total` e a paginacao quebram."""
    m = await _mundo(db)
    with _como_admin(m):
        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=m["marketing"]
        )

    # Cada solicitacao do mundo tem `batch_id` proprio: 1 lote por linha.
    assert total == 1
    assert len(linhas) == 1
