"""Spec 048 -- `under_team_id` nas duas rotas de leitura de tarefa.

⚠️⚠️ A ARMADILHA DESTA FATIA E QUE O PARAMETRO JA EXISTIA. `GET /tasks` aceita
`team_id` desde a Entrega 3, e usa-lo para recortar por raiz PARECERIA pronto.
Ele casa `Task.team_id == team_id` -- igualdade crua no time da PROPRIA tarefa
-- e erraria de duas formas ao mesmo tempo:

  1. esconderia toda tarefa INTERNA de subtime (o time dela e o subtime);
  2. ignoraria o time do PROJETO, que e quem decide o alcance de uma tarefa de
     projeto.

Os dois testes `test_o_team_id_ANTIGO_...` existem para registrar isso com
numeros, e nao com argumento: eles chamam o parametro velho e mostram o que ele
devolve. Se alguem "simplificar" o recorte para usa-lo, eles nao caem -- eles
AFIRMAM o comportamento antigo, e os testes do `under_team_id` e que caem.

O MUNDO:

    Marketing (raiz)
      SEO (subtime)
    Comercial (raiz)

    tarefas:
      t_raiz     avulsa, team=Marketing
      t_interna  avulsa, team=SEO            <- a que a igualdade esconderia
      t_projeto  em projeto do Marketing, team=SEO
                                             <- time da TAREFA e SEO, do
                                                PROJETO e Marketing
      t_comercial avulsa, team=Comercial

SABOTAGENS (executadas, resultado colado em cada teste).
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
    # ⚠️ O caso que separa as duas escritas: time da TAREFA = SEO, do PROJETO =
    # Marketing. Quem decide o alcance e o do projeto.
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
        memberships=(mship(m["marketing"], "ADMIN"),),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


async def _titulos(db, *, under=None, team_id=None):
    page = await TaskService(db).list_page(
        PageParams(page=1, size=100),
        TaskFilters(under_team_id=under, team_id=team_id),
    )
    return {t.title for t in page.items}


# ------------------------------------------- 1. o recorte por arvore


async def test_recorte_pela_raiz_traz_raiz_subtime_e_projeto(db) -> None:
    """As tres do Marketing, e nenhuma do Comercial.

    SABOTAGEM: apagar o `if under_team_id is not None` do `list_page_with_filters`
    -> este teste cai ("Do Comercial" volta).
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, under=m["marketing"])

    assert titulos == {"Da raiz", "Interna do SEO", "Do projeto"}


async def test_recorte_pelo_subtime_nao_sobe_para_a_raiz(db) -> None:
    """Descendentes, e nao ancestrais.

    ⚠️ "Do projeto" NAO entra: o time EFETIVO dela e o do PROJETO (Marketing),
    e nao o da tarefa (SEO). E a mesma regra que decide quem a enxerga -- quem
    ve o projeto ve todas as tarefas dele.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, under=m["seo"])

    assert titulos == {"Interna do SEO"}


async def test_sem_recorte_vem_tudo(db) -> None:
    """`None` = sem recorte, e e resposta legitima (o "tudo" da §4.3)."""
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db)

    assert titulos == {
        "Da raiz",
        "Interna do SEO",
        "Do projeto",
        "Do Comercial",
    }


# ------------------------------- 2. o parametro velho, e por que nao serve


async def test_o_team_id_ANTIGO_esconde_a_tarefa_interna(db) -> None:
    """⚠️⚠️ O REGISTRO DA ARMADILHA, com numeros.

    `team_id=<Marketing>` casa `Task.team_id == Marketing` -- e devolve SO a
    avulsa da raiz. A interna do SEO e a do projeto ficam de fora, embora as
    duas sejam trabalho do Marketing.

    ⚠️ Este teste AFIRMA o comportamento antigo, de proposito. Ele nao cai se
    alguem trocar o recorte pelo parametro velho -- quem cai sao os tres de
    cima. Ele esta aqui para que a diferenca entre os dois parametros seja
    legivel sem ter de ler SQL.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, team_id=m["marketing"])

    assert titulos == {"Da raiz"}


async def test_o_team_id_ANTIGO_pega_a_do_projeto_pelo_time_errado(db) -> None:
    """E com o SUBTIME ele devolve a do projeto -- pelo time da TAREFA.

    `team_id=<SEO>` traz "Do projeto", que pertence a um projeto do Marketing.
    Um recorte de tela feito com este parametro poria no quadro do SEO uma
    tarefa que o Marketing considera dele.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _titulos(db, team_id=m["seo"])

    assert titulos == {"Interna do SEO", "Do projeto"}


# ------------------------------------------- 3. /me/assignments


async def _minhas(db, *, under):
    page = await MeService(db).list_assignments(
        PageParams(page=1, size=100),
        relations=frozenset({"assignee", "creator", "watcher"}),
        under_team_id=under,
    )
    return {linha.task.title for linha in page.items}


async def test_minhas_tarefas_recortam_pelo_time(db) -> None:
    """A lista de "minhas tarefas" pelo time ativo.

    ⚠️ O `under_team_id` do `list_my_relations` NAO TEM DEFAULT: esta lista e a
    tela inteira de Minhas tarefas, e a diferenca entre "de todos os times" e
    "de um time" nao pode sair de um valor omitido. Sem default, o `pytest`
    apontou os dois chamadores existentes.

    SABOTAGEM: apagar o `if under_team_id is not None` do `list_my_relations`
    -> este teste cai ("Do Comercial" volta).
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _minhas(db, under=m["marketing"])

    assert "Do Comercial" not in titulos
    assert "Interna do SEO" in titulos


async def test_minhas_tarefas_sem_recorte_atravessam_times(db) -> None:
    """⚠️ E O "TUDO" E MODO DE USO, nao esquecimento.

    Decisao dela, na §4.3: esta e a UNICA tela que atravessa times de
    proposito -- *"o time muda com a area; o que e meu, nao"*.
    """
    m = await _mundo(db)
    with _como_admin(m):
        titulos = await _minhas(db, under=None)

    assert "Do Comercial" in titulos
    assert "Da raiz" in titulos


# ------------------------------------------- 4. a lente, que virou codigo compartilhado


async def test_a_LENTE_olha_o_time_do_PROJETO_e_nao_o_da_tarefa(db) -> None:
    """⚠️⚠️ ESTE TESTE NASCEU DE UMA SABOTAGEM, e o achado nao era meu codigo.

    A Spec 048 extraiu `_time_efetivo_em` para que a LENTE ("posso ver?") e o
    RECORTE ("e do time que estou vendo?") nao pudessem divergir. Sabotei a
    funcao trocando-a por `Task.team_id.in_(times)` -- a forma ingenua -- e
    esperava ver os testes de visibilidade caírem junto com os meus.

    Caiu SO UM dos meus. `test_visibility_db.py` passou inteiro.

    Ou seja: o ramo da lente que olha `Project.team_id` -- a regra "quem ve o
    projeto ve todas as tarefas dele", de onde vem metade do alcance deste
    produto -- nao tinha teste que o distinguisse do ramo da tarefa. Agora que
    o predicado serve DOIS recursos, isso deixou de ser aceitavel.

    O caso: MANAGER do SEO (lente = {SEO}) diante de uma tarefa cujo PROJETO e
    do Marketing e cujo `task.team_id` e o SEO. A regra certa esconde (o time
    que decide e o do projeto, e Marketing nao esta na lente dele). A forma
    ingenua mostraria -- vazando para o subtime uma tarefa do projeto da raiz.

    SABOTAGEM: trocar o corpo de `_time_efetivo_em` por
    `Task.team_id.in_(times)` -> este teste cai.
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
    # E a interna do SEO continua visivel -- sem esta metade, uma lente que
    # esconde tudo passaria o teste.
    assert titulos == {"Interna do SEO"}
