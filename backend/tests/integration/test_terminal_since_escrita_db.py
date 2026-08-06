"""O relogio do arquivamento e ESCRITO pelo produto (Spec 035, fatia 2a).

A 0008 preencheu `terminal_since` uma vez e nada mais o escrevia. Um campo
preenchido por migration e nunca atualizado nao e uma fundacao: e uma foto.
Esta fatia da corda no relogio, e SO ELA torna a fatia 2b (a varredura passar a
LER o campo) segura.

⚠️ POR QUE ESTES TESTES EXISTEM, E POR QUE SAO CHATOS. O defeito que eles
impedem nao aparece: se `terminal_since` ficar NULL numa tarefa concluida, a
varredura da fatia 2b simplesmente NAO A VE. O job roda, nao levanta excecao,
nao registra erro e imprime um numero menor do que o certo. Nao existe tela,
log nem portao que denuncie -- so a contagem, e ninguem confere a contagem.
Mesma familia do `cascade_count` que dizia 2 enquanto o produto arquivava ao
contrario: numero plausivel, estado errado.

O que defendem, em ordem:

  1. Nasce terminal -> nasce datada. Inclusive CANCELLED, que `completed_at`
     nao conhece.
  2. Entra em terminal -> grava. Sai -> limpa.
  3. Terminal -> OUTRO terminal REGRAVA. E o comportamento de hoje: cancelar
     uma concluida troca a leitura de `completed_at` para `updated_at`, que
     acabou de virar agora. Preservar a data antiga ADIANTARIA o arquivamento,
     e a equivalencia com a varredura atual e criterio de aceitacao.
  4. A CASCATA de conclusao data os descendentes. E o ponto que o ORM nao
     enxerga -- `UPDATE` textual em massa -- e por isso o mais facil de
     esquecer. Foi assim que `updated_at` dos cascateados ficou velho por
     meses.
  5. A invariante do banco continua de pe: nao-terminal nunca tem relogio
     correndo. Se tiver, a fatia 2b arquiva tarefa VIVA -- o unico defeito
     desta spec que o usuario ve na hora.

⚠️ NOTA DE HARNESS, herdada do test_completion_cascade_db: o `db` roda tudo
numa transacao externa, entao `NOW()` e `transaction_timestamp()` sao
CONSTANTES no teste inteiro. Assercao do tipo "a data nova e maior que a
velha" nao distingue nada aqui. Por isso o setup planta uma SENTINELA antiga e
o teste verifica se ela foi SOBRESCRITA.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.db.models import Task
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

# Data claramente anterior ao teste. Se o produto escrever o campo, o valor
# deixa de ser esta sentinela; se nao escrever, permanece.
_SENTINELA = datetime(2020, 1, 1, tzinfo=UTC)


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws)
    ana = await f.make_user(db, workspace_id=ws)
    for u, papel in ((admin, "ADMIN"), (ana, "OPERATOR")):
        await f.add_member(
            db, workspace_id=ws, user_id=u, team_id=team, role=papel
        )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=admin, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ws, team, admin, ana, proj, ctx


async def _relogio(db, task_id: uuid.UUID) -> datetime | None:
    """Le `terminal_since` DO BANCO.

    ⚠️ Nao basta olhar o objeto em memoria: a cascata escreve por UPDATE
    textual, que passa por fora do identity map. Ler o atributo devolveria o
    valor velho e o teste passaria com o produto quebrado.
    """
    return (
        await db.execute(
            text("SELECT terminal_since FROM task WHERE id = :i"),
            {"i": task_id},
        )
    ).scalar_one()


async def _plantar_sentinela(db, *tasks: Task) -> None:
    for t in tasks:
        t.terminal_since = _SENTINELA  # type: ignore[assignment]
    await db.flush()


# ---------------------------------------------------------------------------
# 1. Nascimento
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status", [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
)
async def test_tarefa_que_NASCE_terminal_ja_nasce_datada(db, status) -> None:
    """⚠️ CANCELLED e o caso que `completed_at` nao cobre. A trava da 0031
    obriga responsavel, mas nao obriga status -- criar direto como cancelada e
    um POST valido, e a duplicacao de uma tarefa encerrada passa por aqui."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Ja encerrada",
                project_id=proj,
                team_id=team,
                status=status,
                assignee_ids=[ana],
            )
        )
    assert await _relogio(db, t.id) is not None


async def test_tarefa_normal_nasce_SEM_relogio(db) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Em aberto",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
    assert await _relogio(db, t.id) is None


# ---------------------------------------------------------------------------
# 2 e 3. Transicoes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "destino", [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
)
async def test_entrar_em_terminal_liga_o_relogio(db, destino) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, t.id) is None
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=destino, fields_set=frozenset({"status"})
            ),
        )
    assert await _relogio(db, t.id) is not None


@pytest.mark.parametrize(
    "origem", [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
)
async def test_SAIR_de_terminal_desliga_o_relogio(db, origem) -> None:
    """Reabrir uma tarefa nao pode deixar o relogio correndo: na fatia 2b ela
    seria arquivada de madrugada, viva, com data velha."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=origem,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, t.id) is not None
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.IN_PROGRESS,
                fields_set=frozenset({"status"}),
            ),
        )
    assert await _relogio(db, t.id) is None


async def test_de_um_terminal_para_o_OUTRO_regrava_o_relogio(db) -> None:
    """⚠️ Nao e detalhe: e o que o produto faz HOJE. Cancelar uma concluida
    troca a leitura do job de `completed_at` para `updated_at`, e `updated_at`
    acabou de virar agora -- o relogio zera. Manter a data antiga adiantaria o
    arquivamento em relacao ao comportamento atual, e a equivalencia com a
    varredura de hoje e criterio de aceitacao da spec."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=TaskStatus.COMPLETED,
                assignee_ids=[ana],
            )
        )
        obj = await db.get(Task, t.id)
        assert obj is not None
        await _plantar_sentinela(db, obj)

        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.CANCELLED,
                fields_set=frozenset({"status"}),
            ),
        )

    agora = await _relogio(db, t.id)
    assert agora is not None
    assert agora != _SENTINELA, (
        "mudar de COMPLETED para CANCELLED tem de REGRAVAR o relogio -- "
        "manter a data antiga adianta o arquivamento em relacao ao que o "
        "produto faz hoje."
    )


async def test_editar_SEM_mexer_no_status_nao_toca_no_relogio(db) -> None:
    """PATCH parcial nao pode ter efeito colateral. Se editar o titulo de uma
    tarefa concluida regravasse a data, o arquivamento seria adiado toda vez
    que alguem passasse por ela -- e ninguem descobriria."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=TaskStatus.COMPLETED,
                assignee_ids=[ana],
            )
        )
        obj = await db.get(Task, t.id)
        assert obj is not None
        await _plantar_sentinela(db, obj)

        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                title="Peça revisada", fields_set=frozenset({"title"})
            ),
        )

    assert await _relogio(db, t.id) == _SENTINELA


# ---------------------------------------------------------------------------
# 4. A cascata (o UPDATE que o ORM nao ve)
# ---------------------------------------------------------------------------


async def test_cascata_de_conclusao_data_os_DESCENDENTES(db) -> None:
    """⚠️ O ponto mais facil de esquecer da fatia inteira: os descendentes sao
    concluidos por `UPDATE` textual em massa, que passa por fora do ORM. Sem a
    linha no SQL, concluir um pai deixaria a subarvore com o relogio NULL e o
    defeito so apareceria na fatia 2b, como "arquivou menos do que devia".

    Sub direta E neta: cobre o `<@ ltree` pegando a subarvore inteira, nao so
    o primeiro nivel."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        pai = await TaskService(db).create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
        sub = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
                assignee_ids=[ana],
            )
        )
        neta = await TaskService(db).create(
            CreateTaskCommand(
                title="Corte",
                project_id=proj,
                team_id=team,
                parent_task_id=sub.id,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, sub.id) is None
        assert await _relogio(db, neta.id) is None

        await TaskService(db).update(
            task_id=pai.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED,
                fields_set=frozenset({"status"}),
            ),
        )

    for filha, nome in ((sub, "subtarefa"), (neta, "neta")):
        assert await _relogio(db, filha.id) is not None, (
            f"a {nome} foi concluida pela cascata e ficou sem relogio: na "
            "fatia 2b ela nunca seria arquivada, sem erro nenhum."
        )


# ---------------------------------------------------------------------------
# 5. A invariante
# ---------------------------------------------------------------------------


async def test_nenhuma_NAO_terminal_com_relogio_correndo(db) -> None:
    """A invariante que a fatia 2b transforma em comportamento: relogio
    correndo == elegivel para arquivamento. Numa tarefa viva, isso e o job
    arquivando trabalho em andamento -- o unico defeito desta spec que aparece
    na tela no dia seguinte."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=TaskStatus.COMPLETED,
                assignee_ids=[ana],
            )
        )
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.IN_PROGRESS,
                fields_set=frozenset({"status"}),
            ),
        )

    linhas = (
        await db.execute(
            text(
                """
                SELECT count(*) FROM task
                WHERE terminal_since IS NOT NULL
                  AND status NOT IN (
                        CAST('COMPLETED' AS task_status),
                        CAST('CANCELLED' AS task_status)
                      )
                """
            )
        )
    ).scalar_one()
    assert linhas == 0
