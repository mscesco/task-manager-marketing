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

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Project,
    Task,
    Team,
    User,
    UserTeam,
    Workspace,
)


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
