"""`board_id` e `column_id` na resposta de tarefa.

Os dois primeiros testes sao contrato (os campos saem no detalhe e na
listagem). O terceiro liga as duas superficies: todo `board_id` devolvido numa
task esta na lista de quadros que a mesma pessoa alcanca; cai tambem se o
contrato quebrar.

`semantic` e `notify_deadline` da coluna nao vem aqui: o front cruza
`column_id` com o catalogo do `GET /boards`.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership, TenantContext
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------- o mundo


async def _setup(db):
    """Raiz Marketing + subtime SEO, sem quadro proprio no SEO.

    `make_team` com `parent_team_id=None` ja cria o quadro padrao da raiz.
    """
    ws = await f.make_workspace(db, name="WS contrato do quadro")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )

    arvore = (node(raiz), node(seo, raiz))
    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "sup": sup,
        "arvore": arvore,
        "ctx_sup": ctx_sup,
    }


# ------------------------------------------------------ 1. contrato, detalhe


async def test_detalhe_carrega_board_id_e_column_id(db) -> None:
    """`GET /tasks/{id}` devolve os dois campos, e eles batem com o banco.

    Compara UUID com UUID: string compararia formatacao, nao conteudo.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/tasks/{t.id}")
    assert r.status_code == 200, r.text
    body = r.json()

    assert uuid.UUID(body["board_id"]) == t.board_id
    assert uuid.UUID(body["column_id"]) == t.column_id


# ------------------------------------------------------ 2. contrato, listagem


async def test_listagem_carrega_board_id_e_column_id(db) -> None:
    """`GET /tasks` idem. Separado do detalhe: `TaskListItem` herda de
    `TaskResponse`, e redeclara-lo sem herdar tiraria os campos so do card."""
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.get("/api/v1/tasks")
    assert r.status_code == 200, r.text
    itens = {uuid.UUID(i["id"]): i for i in r.json()["items"]}

    assert t.id in itens
    assert uuid.UUID(itens[t.id]["board_id"]) == t.board_id
    assert uuid.UUID(itens[t.id]["column_id"]) == t.column_id


# ----------------------- 3. o quadro devolvido esta no alcance


async def test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta(
    db,
) -> None:
    """O `board_id` da task sai no `GET /boards` de quem pergunta.

    Um SUPERVISOR do SEO alcanca o quadro geral porque a raiz esta na lente
    dele (proprio time + raiz).
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with cliente(db, c["ctx_sup"]) as cli:
        r_task = await cli.get(f"/api/v1/tasks/{t.id}")
        r_boards = await cli.get("/api/v1/boards")

    assert r_task.status_code == 200, r_task.text
    assert r_boards.status_code == 200, r_boards.text

    board_da_task = uuid.UUID(r_task.json()["board_id"])
    alcancaveis = {uuid.UUID(q["id"]) for q in r_boards.json()}

    assert alcancaveis, (
        "controle: a lista de quadros nao pode vir vazia, senao o assert de "
        "baixo passaria por ausencia de dado em vez de por acerto"
    )
    assert board_da_task in alcancaveis
