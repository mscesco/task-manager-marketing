"""`list_members(reaches_task_id=...)` e `(reaches_team_id=...)`.

Prova que a lista devolvida pro seletor de responsaveis e EXATAMENTE o conjunto
que o `add_assignee` aceita -- nem pessoa a mais (422 ao salvar), nem a menos
(gestor sumindo do seletor de tarefa interna de subtime).
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.collaboration_service import CollaborationService
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import EntityNotFoundError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """Raiz R + subtimes A e B.

    manager  -- MANAGER da raiz  -> enxerga R + descendentes (A e B)
    op_a     -- OPERATOR de A    -> enxerga A + R
    sup_a    -- SUPERVISOR de A  -> enxerga A + R
    op_b     -- OPERATOR de B    -> enxerga B + R
    solto    -- sem time         -> nao enxerga subtime nenhum
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)

    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    sup_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=sup_a, team_id=a, role="SUPERVISOR")
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    solto = await f.make_user(db, workspace_id=ws)

    forest = (node(r), node(a, r), node(b, r))
    mgr_ctx = dict(
        workspace_id=ws,
        user_id=manager,
        memberships=(mship(r, "MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx


async def _ids(db, *, reaches_task_id=None, reaches_team_id=None):
    membros = await MemberService(db).list_members(
        reaches_task_id=reaches_task_id, reaches_team_id=reaches_team_id
    )
    return {m.user.id for m in membros}


# ----------------------------------------------------------
# Sem parametro
# ----------------------------------------------------------
async def test_sem_parametro_lista_igual_a_hoje(db) -> None:
    """Seis telas consomem esta rota sem parametro. Se o padrao mudar,
    quebram as seis de uma vez."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        todos = await _ids(db)
    assert {manager, op_a, sup_a, op_b, solto} <= todos


# ----------------------------------------------------------
# O filtro por tarefa
# ----------------------------------------------------------
async def test_tarefa_da_raiz_todo_mundo(db) -> None:
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=r)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    # Tarefa da raiz: SUPERVISOR/OPERATOR de qualquer subtime enxergam a raiz.
    assert {manager, op_a, sup_a, op_b} <= alcancam


async def test_tarefa_interna_alcance_exato(db) -> None:
    """Tarefa interna de A: o MANAGER da raiz (enxerga descendentes) e quem e
    de A. Fora: o OPERATOR do subtime irmao e quem nao tem time."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    assert alcancam == {manager, op_a, sup_a}


# ----------------------------------------------------------
# Inativo
# ----------------------------------------------------------
async def test_inativo_nao_alcanca(db) -> None:
    from sqlalchemy import text

    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    await db.execute(
        text("UPDATE users SET is_active = false WHERE id = :i"), {"i": op_a}
    )
    await db.flush()
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    assert op_a not in alcancam


# ----------------------------------------------------------
# Task inexistente / invisivel
# ----------------------------------------------------------
async def test_task_inexistente_404(db) -> None:
    import uuid as _uuid

    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx), pytest.raises(EntityNotFoundError):
        await _ids(db, reaches_task_id=_uuid.uuid4())


async def test_task_invisivel_para_quem_pergunta_404(db) -> None:
    """op_b pergunta por tarefa interna de A. Nao confirma existencia fora
    do escopo -- 404, nao lista vazia."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    ctx_b = dict(
        workspace_id=ws,
        user_id=op_b,
        memberships=(mship(b, "OPERATOR"),),
        team_tree=forest,
    )
    with acting_as(**ctx_b), pytest.raises(EntityNotFoundError):
        await _ids(db, reaches_task_id=task.id)


# ----------------------------------------------------------
# A lista e o salvar usam a mesma regra
# ----------------------------------------------------------
async def test_todo_mundo_da_lista_pode_ser_designado(db) -> None:
    """Percorre a lista e designa cada pessoa: qualquer 422 aqui significa
    que o seletor oferece alguem que o salvar recusa."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        membros = await MemberService(db).list_members(reaches_task_id=task.id)
        assert membros, "lista vazia nao prova nada -- o cenario esta errado"
        for m in membros:
            # Sem try/except de proposito: qualquer ValidationError aqui
            # e a falha que o teste existe pra pegar.
            await CollaborationService(db).add_assignee(
                task_id=task.id, user_id=m.user.id
            )


async def test_quem_ficou_de_fora_realmente_nao_pode_ser_designado(db) -> None:
    """O outro lado: a lista nao pode ser CONSERVADORA demais.

    ⚠️ `fora` e derivado de quem sobrou, e nao de uma lista fixa: assim
    qualquer pessoa escondida do seletor que o `add_assignee` aceite quebra
    aqui, inclusive o MANAGER.
    """
    from app.shared.exceptions.base import ValidationError

    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        todos = await _ids(db)
        alcancam = await _ids(db, reaches_task_id=task.id)
        fora = todos - alcancam
        assert fora, "cenario errado: ninguem ficou de fora"
        for uid in fora:
            with pytest.raises(ValidationError):
                await CollaborationService(db).add_assignee(
                    task_id=task.id, user_id=uid
                )


# ==========================================================
# ?reaches_team, para o modal de CRIAR (a tarefa ainda nao existe)
# ==========================================================


async def test_reaches_team_bate_com_reaches_task(db) -> None:
    """A lista do modal de CRIAR e a MESMA da tarefa depois de criada, no
    subtime e na raiz. Se divergirem, a lista muda ao reabrir a tarefa."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    for time in (a, r):
        task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=time)
        with acting_as(**mgr_ctx):
            por_time = await _ids(db, reaches_team_id=time)
            por_task = await _ids(db, reaches_task_id=task.id)
        assert por_time == por_task, time


async def test_os_dois_parametros_juntos_422(db) -> None:
    from app.shared.exceptions.base import ValidationError

    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx), pytest.raises(ValidationError):
        await _ids(db, reaches_task_id=task.id, reaches_team_id=a)


async def test_reaches_team_inativo_nao_aparece(db) -> None:
    from sqlalchemy import text

    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    await db.execute(
        text("UPDATE users SET is_active = false WHERE id = :i"), {"i": op_a}
    )
    await db.flush()
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_team_id=a)
    assert op_a not in alcancam
