"""`under_team_id` nas rotas de leitura de tarefa: recorta pela arvore e pelo
time efetivo (o do projeto, quando houver).

O `team_id` antigo de `GET /tasks` e igualdade crua no time da tarefa: esconde
a tarefa interna de subtime e ignora o time do projeto. Os testes
`test_o_team_id_ANTIGO_...` registram essa diferenca.

    Marketing (raiz)
      SEO (subtime)
    Comercial (raiz)

    tarefas:
      t_raiz      avulsa, team=Marketing
      t_interna   avulsa, team=SEO
      t_projeto   em projeto do Marketing, team=SEO
      t_comercial avulsa, team=Comercial
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.modules.tasks.application.me_service import MeService
from app.modules.tasks.application.task_service import TaskFilters, TaskService
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


def mship(team_id: uuid.UUID, role: str) -> Membership:
    return Membership(team_id=team_id, role=role)


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Sob o Time")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()

    projeto = await f.make_project(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=marketing,
        title="Campanha Q3",
    )

    t_raiz = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=marketing, title="Da raiz"
    )
    t_interna = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=seo, title="Interna do SEO"
    )
    # Time da tarefa = SEO, do projeto = Marketing: decide o do projeto.
    t_projeto = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=seo,
        project_id=projeto,
        title="Do projeto",
    )
    t_comercial = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=comercial,
        title="Do Comercial",
    )

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "user": user,
        "arvore": (node(marketing), node(seo, marketing), node(comercial)),
        "titulos": {
            "raiz": t_raiz,
            "interna": t_interna,
            "projeto": t_projeto,
            "comercial": t_comercial,
        },
    }


def _como_admin(m):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


async def _titulos(db, *, under=None, team_id=None):
    page = await TaskService(db).list_page(
        PageParams(page=1, size=100),
        TaskFilters(under_team_id=under, team_id=team_id),
    )
    return {t.title for t in page.items}


# ------------------------------------------- o recorte por arvore


async def test_recorte_pela_raiz_traz_raiz_subtime_e_projeto(db) -> None:
    """As tres do Marketing, e nenhuma do Comercial."""
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, under=m["marketing"])

    assert titulos == {"Da raiz", "Interna do SEO", "Do projeto"}


async def test_recorte_pelo_subtime_nao_sobe_para_a_raiz(db) -> None:
    """Descendentes, e nao ancestrais. "Do projeto" nao entra: o time efetivo dela
    e o do projeto (Marketing).
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, under=m["seo"])

    assert titulos == {"Interna do SEO"}


async def test_sem_recorte_vem_tudo(db) -> None:
    """`None` = sem recorte."""
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db)

    assert titulos == {
        "Da raiz",
        "Interna do SEO",
        "Do projeto",
        "Do Comercial",
    }


# ------------------------------- o parametro antigo `team_id`


async def test_o_team_id_ANTIGO_esconde_a_tarefa_interna(db) -> None:
    """`team_id=<Marketing>` devolve so a avulsa da raiz. Afirma o comportamento
    antigo de proposito, para a diferenca ficar legivel.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, team_id=m["marketing"])

    assert titulos == {"Da raiz"}


async def test_o_team_id_ANTIGO_pega_a_do_projeto_pelo_time_errado(db) -> None:
    """`team_id=<SEO>` traz a do projeto do Marketing, pelo time da tarefa."""
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, team_id=m["seo"])

    assert titulos == {"Interna do SEO", "Do projeto"}


# ------------------------------------------- /me/assignments


async def _minhas(db, *, under):
    page = await MeService(db).list_assignments(
        PageParams(page=1, size=100),
        relations=frozenset({"assignee", "creator", "watcher"}),
        under_team_id=under,
    )
    return {linha.task.title for linha in page.items}


async def test_minhas_tarefas_recortam_pelo_time(db) -> None:
    """Minhas tarefas recortadas pelo time ativo. `under_team_id` de
    `list_my_relations` nao tem default: "todos" tem de ser explicito.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _minhas(db, under=m["marketing"])

    assert "Do Comercial" not in titulos
    assert "Interna do SEO" in titulos


async def test_minhas_tarefas_sem_recorte_atravessam_times(db) -> None:
    """Sem recorte, Minhas tarefas atravessa os times (a unica tela que faz isso)."""
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _minhas(db, under=None)

    assert "Do Comercial" in titulos
    assert "Da raiz" in titulos


# ------------------------------------------- a lente


async def test_a_LENTE_olha_o_time_do_PROJETO_e_nao_o_da_tarefa(db) -> None:
    """A lente decide pelo time do projeto, nao pelo da tarefa.

    MANAGER do SEO diante de tarefa de projeto do Marketing com `team_id` = SEO:
    nao ve. A forma ingenua (`Task.team_id.in_(times)` em `_time_efetivo_em`)
    mostraria.
    """
    m = await _mundo(db)
    with acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(mship(m["seo"], "MANAGER"),),
        team_tree=m["arvore"],
    ):
        titulos = await _titulos(db)

    assert "Do projeto" not in titulos
    # A interna do SEO continua visivel, senao uma lente que esconde tudo passaria.
    assert titulos == {"Interna do SEO"}
