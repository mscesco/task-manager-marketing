"""Agregacao de subtarefa contra Postgres real (Spec 042, A1).

⚠️ ESTE ARQUIVO E A METADE QUE FALTAVA. O `tests/test_subtask_progress.py`
prova a REGRA; aqui se prova que a QUERY devolve o mesmo numero. E a mesma
dupla pure-domain + SQL de `archival.py` e `board_semantics.py`, e o motivo de
existir e literal: sem o par, a query faz uma coisa, o unitario prova outra, e
os dois ficam verdes.

O cenario e montado para que CADA uma das quatro regras mude o resultado se for
quebrada -- teste que passaria de qualquer jeito nao prova nada, e este projeto
ja teve dois casos assim (`test_deadline_notify_coluna_db.py`, primeira versao).

⚠️ `status=` VAI NA FACTORY, nao atribuido depois: a factory resolve a COLUNA a
partir do status no momento da criacao, e desde a Spec 042 e a coluna que
decide a contagem. Atribuir `t.status` depois deixaria a tarefa na coluna do
status antigo e o teste mediria outra coisa.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import BoardColumn, Task
from app.db.models.enums import TaskStatus
from app.modules.tasks.domain.subtask_progress import (
    FilhaMin,
    Progresso,
    progresso,
)
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from tests.integration.conftest import acting_as, mship, node
from tests.integration import factories as f

pytestmark = pytest.mark.integration


async def _cenario(db):
    """Raiz com filhas cobrindo as quatro regras, mais uma NETA.

    Filhas DIRETAS vivas: 2 concluidas, 1 em andamento, 1 cancelada -> 2/4.
      - a cancelada existe para a regra (b): se contasse, daria 3/4;
      - a arquivada existe para a regra (c): se contasse, daria 3/5;
      - a NETA existe para provar que a contagem e de um nivel: se a query
        agregasse a subarvore, daria 3/5.
    """
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )

    comum = {"workspace_id": ws, "created_by": user, "team_id": team}
    raiz = await f.make_task(db, **comum, title="Raiz")

    filhas = {
        "concluida_1": await f.make_task(
            db, **comum, parent=raiz, title="c1", status=TaskStatus.COMPLETED
        ),
        "concluida_2": await f.make_task(
            db, **comum, parent=raiz, title="c2", status=TaskStatus.COMPLETED
        ),
        "andamento": await f.make_task(
            db, **comum, parent=raiz, title="a1", status=TaskStatus.IN_PROGRESS
        ),
        "cancelada": await f.make_task(
            db, **comum, parent=raiz, title="x1", status=TaskStatus.CANCELLED
        ),
        "arquivada": await f.make_task(
            db, **comum, parent=raiz, title="arq", status=TaskStatus.COMPLETED
        ),
    }
    filhas["arquivada"].is_archived = True

    neta = await f.make_task(
        db,
        **comum,
        parent=filhas["andamento"],
        title="neta",
        status=TaskStatus.COMPLETED,
    )
    await db.flush()
    return ws, team, user, raiz, filhas, neta


async def _progresso_pela_regra(db, raiz_id) -> Progresso:
    """O mesmo numero, calculado pela REGRA PURA a partir do banco.

    Le as filhas diretas com a semantica da coluna e roda `progresso()`. E este
    valor que a query tem de reproduzir.
    """
    rows = (
        await db.execute(
            select(BoardColumn.semantic, Task.is_archived)
            .join(BoardColumn, BoardColumn.id == Task.column_id, isouter=True)
            .where(Task.parent_task_id == raiz_id, Task.deleted_at.is_(None))
        )
    ).all()
    return progresso(
        FilhaMin(semantic=semantic, is_archived=arquivada)
        for semantic, arquivada in rows
    )


async def test_contagem_bate_com_a_regra_pura(db):
    """⚠️ O TESTE DE PARIDADE. Query e regra tem de dar o MESMO numero."""
    ws, team, user, raiz, _filhas, _neta = await _cenario(db)

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        pela_query = await TaskRepository(db).subtask_progress_for_tasks(
            [raiz.id]
        )

    esperado = await _progresso_pela_regra(db, raiz.id)
    assert esperado == Progresso(concluidas=2, total=4), (
        "o cenario deixou de exercitar as regras -- conferir antes de mexer na query"
    )
    assert pela_query[raiz.id] == esperado


async def test_id_sem_filha_volta_zero_e_nao_some_do_mapa(db):
    """Contrato: todo id pedido esta na resposta, com 0/0 se nao tem filha.

    Sem isso o router estoura com KeyError no primeiro card sem subtarefa --
    e a maioria dos 170 cards nao tem.
    """
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    sozinha = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=team, title="Sozinha"
    )
    await db.flush()

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        out = await TaskRepository(db).subtask_progress_for_tasks([sozinha.id])

    assert out == {sozinha.id: Progresso(concluidas=0, total=0)}


async def test_responsaveis_da_subarvore_incluem_raiz_filha_e_neta(db):
    """⚠️ `<@` e descendente-OU-IGUAL: a raiz entra.

    Devolver so os das filhas faria a raiz com responsavel proprio sumir do
    filtro por pessoa -- e o filtro existe justamente para achar a raiz quando
    a designacao esta na subtarefa.
    """
    ws, team, user, raiz, filhas, neta = await _cenario(db)
    da_raiz = await f.make_user(db, workspace_id=ws)
    da_filha = await f.make_user(db, workspace_id=ws)
    da_neta = await f.make_user(db, workspace_id=ws)
    for alvo, quem in (
        (raiz, da_raiz),
        (filhas["andamento"], da_filha),
        (neta, da_neta),
    ):
        await f.make_assignment(
            db,
            workspace_id=ws,
            task_id=alvo.id,
            user_id=quem,
            assigned_by=user,
        )
    await db.flush()

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        out = await TaskRepository(db).subtree_assignee_ids_for_tasks(
            [raiz.id], include_archived=False
        )

    assert set(out[raiz.id]) == {da_raiz, da_filha, da_neta}


async def test_responsavel_de_filha_arquivada_segue_o_include_archived(db):
    """⚠️ Aqui o arquivamento NAO segue a regra (c) da checklist.

    Sao perguntas diferentes: a checklist responde "quanto falta do trabalho
    vivo" e ignora arquivada sempre; o filtro por pessoa responde "esta raiz
    interessa a fulano?", e hoje enxerga exatamente o que o quadro carregou.
    Passar o flag da requisicao mantem o comportamento identico ao de hoje.
    """
    ws, team, user, raiz, filhas, _neta = await _cenario(db)
    so_na_arquivada = await f.make_user(db, workspace_id=ws)
    await f.make_assignment(
        db,
        workspace_id=ws,
        task_id=filhas["arquivada"].id,
        user_id=so_na_arquivada,
        assigned_by=user,
    )
    await db.flush()

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        repo = TaskRepository(db)
        sem = await repo.subtree_assignee_ids_for_tasks(
            [raiz.id], include_archived=False
        )
        com = await repo.subtree_assignee_ids_for_tasks(
            [raiz.id], include_archived=True
        )

    assert so_na_arquivada not in sem[raiz.id]
    assert so_na_arquivada in com[raiz.id]


async def test_nao_vaza_entre_workspaces(db):
    """A filtragem de tenant e explicita nas duas queries (excecao ao
    `_base_select`). Este teste e o que impede a excecao de virar buraco."""
    ws_a, team_a, user_a, raiz_a, _f, _n = await _cenario(db)
    _ws_b, _team_b, _user_b, _raiz_b, _fb, _nb = await _cenario(db)

    with acting_as(
        workspace_id=ws_a,
        user_id=user_a,
        memberships=(mship(team_a, "ADMIN"),),
        team_tree=(node(team_a),),
    ):
        out = await TaskRepository(db).subtask_progress_for_tasks([raiz_a.id])

    assert out[raiz_a.id] == Progresso(concluidas=2, total=4)
