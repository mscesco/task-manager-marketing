"""GET /members?reaches_task -- Spec 034, Fatia 3.

Prova que a lista devolvida pro seletor e EXATAMENTE o conjunto que o
`POST` de designacao aceita. Ate 03/08 o front reconstruia uma aproximacao
dessa regra com metade dos dados (`GET /members` devolve `team_id` e nao
devolve papel), e o sintoma era gestor/admin sumindo do seletor de tarefa
interna de subtime.

O teste que carrega a spec e `test_todo_mundo_da_lista_pode_ser_designado`:
ele percorre a lista e designa cada pessoa, esperando zero 422. Sem ele, a
entrega devolve uma lista PARECIDA com a certa -- que e o estado de hoje.
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
# Criterio 1 -- o caminho sem parametro NAO muda
# ----------------------------------------------------------
async def test_sem_parametro_lista_igual_a_hoje(db) -> None:
    """Seis telas consomem esta rota sem parametro. Se o padrao mudar,
    quebram as seis de uma vez."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        todos = await _ids(db)
    assert {manager, op_a, sup_a, op_b, solto} <= todos


# ----------------------------------------------------------
# Criterios 2-4 -- o filtro
# ----------------------------------------------------------
async def test_tarefa_da_raiz_todo_mundo(db) -> None:
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=r)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    # Tarefa da raiz: SUPERVISOR/OPERATOR de qualquer subtime enxergam a raiz.
    assert {manager, op_a, sup_a, op_b} <= alcancam


async def test_tarefa_interna_inclui_manager(db) -> None:
    """O PEDIDO de 03/08. Gestor da raiz alcanca tarefa interna de subtime
    (MANAGER de T enxerga T + descendentes) e some do seletor hoje."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    assert manager in alcancam
    assert op_a in alcancam
    assert sup_a in alcancam


async def test_tarefa_interna_exclui_operator_de_outro_subtime(db) -> None:
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    assert op_b not in alcancam


async def test_membro_sem_time_nao_aparece_em_tarefa_interna(db) -> None:
    """Borda do `team_id` nulo. O front trata "sem subtime" como "nao e do
    subtime"; aqui a mesma conclusao tem que vir da regra, nao da coincidencia."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_task_id=task.id)
    assert solto not in alcancam


# ----------------------------------------------------------
# Criterio 5 -- inativo
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
# Criterio 6 -- task inexistente / invisivel
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
# Criterio 7 -- O TESTE QUE CARREGA A SPEC
# ----------------------------------------------------------
async def test_todo_mundo_da_lista_pode_ser_designado(db) -> None:
    """Seletor e salvar usam a MESMA regra (D2).

    Sem este teste, a entrega devolve uma lista parecida com a certa -- que
    e exatamente o estado de hoje. Percorre a lista e designa cada pessoa:
    qualquer 422 aqui significa que o seletor esta oferecendo alguem que o
    salvar recusa.
    """
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
    """O outro lado do criterio 7: a lista nao pode ser CONSERVADORA demais.

    ⚠️ Corrigido em 03/08 depois da sabotagem A. A primeira versao montava
    `fora` a partir de uma dupla fixa ({op_b, solto}) em vez de derivar de
    quem sobrou. Com a regra errada do front (`subteam_id == task.team_id`)
    o MANAGER sumia da lista -- e como ele nao estava na dupla fixa, o teste
    ficava VERDE com o defeito de 03/08 inteiro de pe.

    Derivar `fora` da lista completa e o que fecha esse buraco: qualquer
    pessoa escondida do seletor que o `add_assignee` aceite quebra aqui.
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
# Fatia 5 -- ?reaches_team, para o modal de CRIAR
# ==========================================================
# Reportado com captura em 03/08: criando tarefa no quadro do subtime "CRM e
# Automacao", a GESTORA nao aparecia no seletor de responsaveis. A Fatia 4
# consertou a tarefa que JA EXISTE; o modal de criar continuou aproximando por
# `team_id` no front, que nunca enxergou papel.


async def test_reaches_team_inclui_manager(db) -> None:
    """O PEDIDO de 03/08 (segunda metade)."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_team_id=a)
    assert manager in alcancam
    assert op_a in alcancam
    assert sup_a in alcancam


async def test_reaches_team_exclui_outro_subtime(db) -> None:
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_team_id=a)
    assert op_b not in alcancam
    assert solto not in alcancam


async def test_reaches_team_na_raiz_todo_mundo(db) -> None:
    """SUPERVISOR/OPERATOR de X enxergam X + a raiz -- nao filtra ninguem."""
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        alcancam = await _ids(db, reaches_team_id=r)
    assert {manager, op_a, sup_a, op_b} <= alcancam


async def test_reaches_team_bate_com_reaches_task(db) -> None:
    """A lista do modal de CRIAR tem que ser a MESMA da tarefa depois de criada.

    Se divergirem, a pessoa designa alguem no modal e ao reabrir a tarefa a
    lista muda -- exatamente o tipo de incoerencia que a Spec 034 existe pra
    acabar.
    """
    ws, r, a, b, manager, op_a, sup_a, op_b, solto, forest, mgr_ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a)
    with acting_as(**mgr_ctx):
        por_time = await _ids(db, reaches_team_id=a)
        por_task = await _ids(db, reaches_task_id=task.id)
    assert por_time == por_task


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
