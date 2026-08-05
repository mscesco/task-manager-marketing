"""Desarquivar subtarefa cujo PAI esta arquivado (04/08).

O DEFEITO, encontrado na tela: a operacao respondia 200 e nao entregava nada.
A subtarefa voltava a `is_archived=false`, saia de /arquivadas (nao estava mais
arquivada) e nao aparecia em lugar nenhum -- o quadro so desenha `depth === 0`
(Board.tsx:580) e a checklist onde ela mora e a de um pai arquivado, que
ninguem abre. A pessoa pedia "traz de volta" e a tarefa sumia de vez.

⚠️ MESMA FAMILIA do defeito da duplicacao (test_task_duplicate_db.py,
`test_pai_arquivado_promove_a_topo`). O estado ruim e sempre o mesmo --
"subtarefa ATIVA sob pai ARQUIVADO" -- e ha mais de uma porta pra ele. Ao
mexer em qualquer fluxo que cria ou reativa subtarefa, pergunte se essa porta
esta aberta.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ws, team, user, proj, ctx


async def _arvore(db, ctx, proj, team):
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(
            CreateTaskCommand(
                title="Campanha de março", project_id=proj, team_id=team
            )
        )
        sub = await svc.create(
            CreateTaskCommand(
                title="sub",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
            )
        )
    return pai, sub


async def test_desarquivar_sub_com_pai_arquivado_e_recusado(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team)
    # ⚠️ Arquiva pelo ORM, nao por UPDATE cru: SQL direto nao avisa a sessao e
    # o service leria o objeto CACHEADO com is_archived=False.
    pai.is_archived = True
    sub.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        with pytest.raises(ValidationError) as e:
            await TaskService(db).unarchive(task_id=sub.id)

    # ⚠️ A mensagem tem de NOMEAR o pai. Sem o nome a instrucao e um enigma:
    # /arquivadas nao mostra hierarquia, e nao ha como adivinhar de qual pai a
    # subtarefa veio.
    assert "Campanha de março" in str(e.value)


async def test_a_sub_continua_arquivada_apos_a_recusa(db) -> None:
    """Recusa TEM de ser atomica. Meio-desarquivada e o estado que o conserto
    existe pra impedir."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team)
    pai.is_archived = True
    sub.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await TaskService(db).unarchive(task_id=sub.id)

    await db.refresh(sub)
    assert sub.is_archived is True


async def test_pai_ATIVO_desarquiva_normalmente(db) -> None:
    """O outro lado: com o pai vivo a subtarefa volta pra checklist dele, que
    e alcancavel. Recusar aqui seria travar o caso comum."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team)
    sub.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=sub.id)

    assert r.is_archived is False
    assert pai.is_archived is False


async def test_tarefa_de_TOPO_desarquiva_normalmente(db) -> None:
    """Sem pai nao ha o que checar -- e a tarefa volta direto pro quadro."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        raiz = await TaskService(db).create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
    raiz.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=raiz.id)
    assert r.is_archived is False


async def test_desarquivar_o_PAI_traz_a_arvore_de_volta(db) -> None:
    """O caminho que a mensagem de erro manda a pessoa seguir.

    ⚠️ Funciona porque arquivar NAO cascateia pra baixo: a subtarefa nunca foi
    marcada junto com o pai, entao desarquivar o pai basta -- a checklist volta
    inteira. Se algum dia arquivar passar a cascatear, esta instrucao vira
    mentira e o teste cai.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team)
    pai.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).unarchive(task_id=pai.id)

    await db.refresh(pai)
    await db.refresh(sub)
    assert pai.is_archived is False
    assert sub.is_archived is False


async def test_idempotencia_preservada(db) -> None:
    """Desarquivar quem ja esta ativo continua no-op -- inclusive com pai
    arquivado. A trava so vale pra quem ESTA arquivada; sem esta condicao,
    um clique repetido viraria erro."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team)
    pai.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=sub.id)
    assert r.is_archived is False
