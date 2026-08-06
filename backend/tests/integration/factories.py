"""Factories minimas para os testes de integracao.

Criam apenas o necessario dentro da transacao revertida do teste. Sem
dependencia do seed de producao. Inserem via add()/flush() (sem commit --
o teste controla a transacao) e devolvem o id.

make_task computa path/depth do mesmo jeito do dominio (label = 't'+hex),
para os testes que so precisam de "uma task existente". Os testes de
hierarquia usam TaskService.create de proposito, pra exercitar a logica.
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Project,
    Task,
    Team,
    User,
    UserTeam,
    Workspace,
)
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService


def _label(task_id: uuid.UUID) -> str:
    return f"t{task_id.hex}"


async def make_workspace(db: AsyncSession, *, name: str = "WS Teste") -> uuid.UUID:
    ws = Workspace(id=uuid.uuid4(), name=name, slug=f"ws-{uuid.uuid4().hex[:8]}")
    db.add(ws)
    await db.flush()
    return ws.id


async def make_user(
    db: AsyncSession, *, workspace_id: uuid.UUID, email: str | None = None
) -> uuid.UUID:
    uid = uuid.uuid4()
    db.add(
        User(
            id=uid,
            workspace_id=workspace_id,
            name="User Teste",
            email=email or f"u-{uid.hex[:8]}@teste.dev",
            password_hash="x",
            is_active=True,
        )
    )
    await db.flush()
    return uid


async def make_team(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    parent_team_id: uuid.UUID | None = None,
    slug: str | None = None,
) -> uuid.UUID:
    tid = uuid.uuid4()
    db.add(
        Team(
            id=tid,
            workspace_id=workspace_id,
            parent_team_id=parent_team_id,
            name=slug or f"team-{tid.hex[:6]}",
            slug=slug or f"team-{tid.hex[:6]}",
        )
    )
    await db.flush()

    # ⚠️ TIME RAIZ NASCE COM QUADRO, igual ao produto (Spec 035 fatia 3a).
    # Desde a fatia 3b, `TaskService.create` resolve a coluna a partir do
    # status e FALHA se o workspace nao tiver quadro -- sem isto aqui, os 53
    # arquivos de teste que montam mundo pela factory parariam de conseguir
    # criar tarefa.
    #
    # ⚠️ SO na raiz. Subtime nao ganha quadro por existir (ADR 0032), e criar
    # um aqui violaria o `board_um_padrao_por_time` no primeiro subtime -- alem
    # de fazer a factory mentir sobre o produto.
    #
    # ⚠️ Quem precisa de um quadro NAO-padrao ou de colunas fora do padrao
    # continua criando a mao (ver `test_boards_schema_db`). O que a factory
    # entrega e o mundo comum, nao todos os mundos.
    if parent_team_id is None:
        await BoardService(db).create_default_board(
            workspace_id=workspace_id, team_id=tid
        )
    return tid


async def add_member(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    role: str,
) -> None:
    db.add(
        UserTeam(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            team_id=team_id,
            role=role,
        )
    )
    await db.flush()


async def make_project(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    team_id: uuid.UUID | None,
    is_personal: bool = False,
    title: str = "Projeto",
) -> uuid.UUID:
    pid = uuid.uuid4()
    db.add(
        Project(
            id=pid,
            workspace_id=workspace_id,
            title=title,
            description="",
            created_by=created_by,
            team_id=team_id,
            is_personal=is_personal,
        )
    )
    await db.flush()
    return pid


async def make_task(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    team_id: uuid.UUID | None,
    project_id: uuid.UUID | None = None,
    parent: Task | None = None,
    title: str = "Task",
    status: TaskStatus = TaskStatus.BACKLOG,
) -> Task:
    tid = uuid.uuid4()
    if parent is None:
        path = _label(tid)
        depth = 0
        parent_task_id = None
    else:
        path = f"{parent.path}.{_label(tid)}"
        depth = parent.depth + 1
        parent_task_id = parent.id
    # ⚠️ QUADRO E COLUNA, senao a `0011` recusa a linha: os dois viraram NOT
    # NULL. A factory monta a linha DIRETO, sem passar pelo TaskService -- e o
    # service e quem resolve a coluna no produto. Sem isto aqui, 121 testes
    # caem de uma vez com IntegrityError, e nenhum deles tem a ver com quadro.
    #
    # ⚠️ A coluna vem do `status` (ADR 0033), pela mesma consulta do
    # `BoardRepository`: quadro do time RAIZ, coluna com aquele
    # `legacy_status`.
    #
    # ⚠️ LIMITE CONHECIDO: quem mexe em `task.status` DEPOIS de chamar a
    # factory (varios testes fazem, com `t.status = ...`) fica com a coluna do
    # status ANTIGO. O banco aceita -- a FK composta so garante que a coluna e
    # do mesmo quadro, nao que e a do status certo. Para esses testes tanto
    # faz; quem testa a coluna usa o service, que e o caminho real. Se um dia
    # isso incomodar, passe `status=` aqui em vez de atribuir depois.
    quadro = (
        await db.execute(
            text(
                """
                SELECT b.id, c.id
                FROM board b
                JOIN team t
                  ON t.id = b.team_id
                 AND t.workspace_id = b.workspace_id
                 AND t.parent_team_id IS NULL
                JOIN board_column c
                  ON c.board_id = b.id
                 AND c.legacy_status = CAST(:st AS task_status)
                WHERE b.workspace_id = :ws
                  AND b.is_default
                """
            ),
            {"ws": workspace_id, "st": status.value},
        )
    ).first()
    assert quadro is not None, (
        f"workspace {workspace_id} nao tem quadro com coluna para "
        f"{status.value}. O time RAIZ foi criado por `make_team`? Desde a "
        "fatia 3a e ele quem cria o quadro."
    )

    task = Task(
        id=tid,
        workspace_id=workspace_id,
        project_id=project_id,
        parent_task_id=parent_task_id,
        team_id=team_id,
        created_by=created_by,
        title=title,
        description="",
        path=path,
        depth=depth,
        status=status,
        board_id=quadro[0],
        column_id=quadro[1],
    )
    db.add(task)
    await db.flush()
    return task


async def make_assignment(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    assigned_by: uuid.UUID,
) -> None:
    """Insere assignment DIRETO (sem as travas do service) -- e assim que
    cenarios out_of_scope nascem (admin designou, ou pessoa movida depois)."""
    from app.db.models import TaskAssignment

    db.add(
        TaskAssignment(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=task_id,
            user_id=user_id,
            assigned_by=assigned_by,
        )
    )
    await db.flush()


async def make_watcher(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    from app.db.models import TaskWatcher

    db.add(
        TaskWatcher(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=task_id,
            user_id=user_id,
        )
    )
    await db.flush()
