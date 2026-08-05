"""Arquivar/desarquivar CASCATEADO (05/08/2026).

O QUE ESTA CASCATA CONSERTA. Ate 05/08 arquivar nao cascateava: a filha ficava
ATIVA debaixo de um pai arquivado. O quadro so desenha `depth === 0`
(Board.tsx:580) e a checklist onde ela mora e a de uma tarefa arquivada, que
ninguem abre -- a tarefa existia e nenhuma tela a mostrava. E a MESMA familia
do defeito da duplicacao (`test_pai_arquivado_promove_a_topo`) e do
desarquivar (`test_unarchive_parent_db.py`): "subtarefa ativa sob pai
arquivado" tem mais de uma porta, e esta era a terceira.

⚠️ ARMADILHA CENTRAL DESTE ARQUIVO: a cascata e UPDATE em massa por ltree, e
UPDATE cru NAO avisa o ORM. O objeto ja carregado continua na identity map com
o valor ANTIGO -- um teste que ler `sub.is_archived` direto mede MEMORIA, nao
banco, e passa com a cascata sabotada. Por isso todo assert de estado aqui vem
depois de `db.refresh(...)`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import TaskHistory
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
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


async def _tres_niveis(db, ctx, proj, team, user):
    """pai -> sub -> neto. TRES niveis de proposito: cascata de um nivel so
    passaria num teste com dois, e a subarvore real tem netos."""
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(
            CreateTaskCommand(
                title="Campanha de março", project_id=proj, team_id=team,
                assignee_ids=[user],
            )
        )
        sub = await svc.create(
            CreateTaskCommand(
                title="Roteiro",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
                assignee_ids=[user],
            )
        )
        neto = await svc.create(
            CreateTaskCommand(
                title="Legendas",
                project_id=proj,
                team_id=team,
                parent_task_id=sub.id,
                assignee_ids=[user],
            )
        )
    return pai, sub, neto


async def test_arquivar_o_pai_arquiva_a_subarvore_inteira(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)

    with acting_as(**ctx):
        r = await TaskService(db).archive(task_id=pai.id)

    assert r.cascade_count == 2  # sub + neto, sem contar o pai
    await db.refresh(sub)
    await db.refresh(neto)
    assert r.task.is_archived is True
    assert sub.is_archived is True
    assert neto.is_archived is True


async def test_a_cascata_nao_vaza_para_fora_da_subarvore(db) -> None:
    """Irma de outra raiz nao pode ser tocada. O `path <@` cobre isso, mas e a
    asercao que impede alguem trocar por um filtro mais largo depois."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)
    with acting_as(**ctx):
        outra = await TaskService(db).create(
            CreateTaskCommand(
                title="Newsletter", project_id=proj, team_id=team,
                assignee_ids=[user],
            )
        )

    with acting_as(**ctx):
        await TaskService(db).archive(task_id=pai.id)

    await db.refresh(outra)
    assert outra.is_archived is False


async def test_arquivar_de_novo_nao_conta_nem_escreve_history(db) -> None:
    """Idempotencia: a 2a chamada muda 0 linhas (`is_archived <> :alvo`).

    ⚠️ A PRIMEIRA chamada e afirmada de proposito. Sem isso o teste passava
    com a cascata QUEBRADA -- 0 na segunda chamada e trivialmente verdade
    quando o UPDATE nunca muda nada, e a "idempotencia" seria medida sem
    depender de a cascata ter funcionado. Descoberto por sabotagem em
    05/08 (`"alvo": archived` -> `not archived`): dos 8 testes deste
    arquivo, este foi o unico que sobreviveu pelo motivo errado.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)

    with acting_as(**ctx):
        primeira = await TaskService(db).archive(task_id=pai.id)
        segunda = await TaskService(db).archive(task_id=pai.id)

    assert primeira.cascade_count == 2  # a cascata TEM de ter acontecido
    assert segunda.cascade_count == 0
    linhas = (
        (
            await db.execute(
                select(TaskHistory).where(
                    TaskHistory.task_id == pai.id,
                    TaskHistory.event_type == "archived",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(linhas) == 1


async def test_history_so_na_RAIZ_com_a_contagem_no_metadata(db) -> None:
    """Mesma forma do soft-delete (ADR 0005): a filha cascateada NAO ganha
    linha propria -- arquivar 40 subtarefas viraria 40 linhas que ninguem le.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)

    with acting_as(**ctx):
        await TaskService(db).archive(task_id=pai.id)

    h = (
        (
            await db.execute(
                select(TaskHistory).where(
                    TaskHistory.task_id == pai.id,
                    TaskHistory.event_type == "archived",
                )
            )
        )
        .scalars()
        .one()
    )
    assert h.event_metadata == {"cascade_count": 2}

    da_filha = (
        (
            await db.execute(
                select(TaskHistory).where(
                    TaskHistory.task_id == sub.id,
                    TaskHistory.event_type == "archived",
                )
            )
        )
        .scalars()
        .all()
    )
    assert da_filha == []


async def test_arquivar_folha_nao_muda_o_metadata_antigo(db) -> None:
    """Sem cascata, `event_metadata` continua None -- a auditoria antiga nao
    passa a ter um campo novo com 0 em toda linha."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        folha = await TaskService(db).create(
            CreateTaskCommand(title="Avulsa", project_id=proj, team_id=team, assignee_ids=[user])
        )
        r = await TaskService(db).archive(task_id=folha.id)

    assert r.cascade_count == 0
    h = (
        (
            await db.execute(
                select(TaskHistory).where(
                    TaskHistory.task_id == folha.id,
                    TaskHistory.event_type == "archived",
                )
            )
        )
        .scalars()
        .one()
    )
    assert h.event_metadata is None


async def test_desarquivar_o_pai_traz_a_subarvore_inteira(db) -> None:
    """A promessa que a mensagem de erro do desarquivar ja fazia desde 04/08
    ("a subtarefa volta junto") e que ate 05/08 era MENTIRA."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)

    with acting_as(**ctx):
        await TaskService(db).archive(task_id=pai.id)
        r = await TaskService(db).unarchive(task_id=pai.id)

    assert r.cascade_count == 2
    await db.refresh(sub)
    await db.refresh(neto)
    assert r.task.is_archived is False
    assert sub.is_archived is False
    assert neto.is_archived is False


async def test_desarquivar_TAMBEM_traz_quem_foi_arquivado_antes(db) -> None:
    """⚠️ CUSTO ACEITO da opcao 2 (decisao de 05/08), travado por teste.

    A subtarefa foi arquivada de PROPOSITO antes do pai, e volta junto assim
    mesmo -- o banco nao guarda quem foi arquivado pela cascata. Se este teste
    incomodar algum dia, a mudanca e a opcao 3 (coluna nova marcando a origem
    do arquivamento), e ai ela e consciente em vez de acidental.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)

    with acting_as(**ctx):
        await TaskService(db).archive(task_id=sub.id)  # encerrada sozinha
        await TaskService(db).archive(task_id=pai.id)
        await TaskService(db).unarchive(task_id=pai.id)

    await db.refresh(sub)
    assert sub.is_archived is False


async def test_arquivar_recolhe_a_filha_orfa_do_comportamento_antigo(
    db,
) -> None:
    """O caminho de CONSERTO do legado.

    Antes de 05/08 dava pra ter pai arquivado com filha ATIVA -- e essas linhas
    seguem no banco. Arquivar de novo o pai (que ja esta arquivado) passa a
    recolher a filha, em vez de ser no-op. Sem isto, so SQL na mao consertaria.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub, neto = await _tres_niveis(db, ctx, proj, team, user)
    # Estado legado montado a mao: pai arquivado, subarvore ativa.
    pai.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).archive(task_id=pai.id)

    assert r.cascade_count == 2
    await db.refresh(sub)
    await db.refresh(neto)
    assert sub.is_archived is True
    assert neto.is_archived is True
