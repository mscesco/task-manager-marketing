"""Router /dashboard -- a tela inicial do time (Spec 058).

Uma rota so, com todos os cards: a tela abre com UM pedido, e nao seis.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.application.dashboard_service import DashboardService
from app.modules.tasks.domain.dashboard import DAYS_AHEAD
from app.modules.tasks.infrastructure.task_repository import DashboardItem

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DashboardTask(BaseModel):
    """Uma tarefa citada num card: o bastante para o link e a data."""

    id: uuid.UUID
    title: str
    due_date: date | None
    due_time: time | None
    parent_task_id: uuid.UUID | None
    priority: str
    column_name: str
    #: A cor da coluna como o quadro a desenha (`var(--status-...)`).
    column_color: str


class DashboardWeek(BaseModel):
    """Card 2. ⚠️ `start`/`end` vem daqui: a tela mostra, nao recalcula."""

    start: date
    end: date
    done: int
    total: int


class DashboardDay(BaseModel):
    date: date
    count: int


class DashboardMine(BaseModel):
    """Card 11 -- as minhas, no time da tela."""

    overdue: list[DashboardTask]
    overdue_total: int
    due_today: list[DashboardTask]
    due_today_total: int


class DashboardPerson(BaseModel):
    user_id: uuid.UUID
    name: str
    open: int
    overdue: int
    #: `false` = conta desativada que ainda tem tarefa aberta no time.
    is_active: bool


class DashboardQueue(BaseModel):
    pending: int
    oldest_at: datetime | None


class DashboardResponse(BaseModel):
    today: date
    week: DashboardWeek
    overdue_total: int
    oldest_overdue: list[DashboardTask]
    #: Card 4: um item por dia, de hoje a hoje+6 -- inclusive os dias com zero.
    due_ahead: list[DashboardDay]
    mine: DashboardMine
    #: Card 1. `null` = sem `team_workload.read` no time da tela.
    workload: list[DashboardPerson] | None
    #: Card 6. `null` = sem `solicitation.read` no time da tela.
    queue: DashboardQueue | None


def _task(i: DashboardItem) -> DashboardTask:
    return DashboardTask(
        id=i.id,
        title=i.title,
        due_date=i.due_date,
        due_time=i.due_time,
        parent_task_id=i.parent_id,
        priority=i.priority,
        column_name=i.column_name,
        column_color=i.column_color,
    )


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    _: TenantContextDep,
    session: SessionDep,
    under_team_id: uuid.UUID | None = Query(
        None,
        description=(
            "O time da barra lateral e os descendentes dele (o mesmo recorte "
            "de GET /tasks). Ausente = todos os times que a pessoa ve."
        ),
    ),
    assignee_id: uuid.UUID | None = Query(
        None,
        description=(
            "So as tarefas desta pessoa: o relatorio inteiro passa a ser dela. "
            "Exige `team_workload.read` no time (403 sem ele)."
        ),
    ),
) -> DashboardResponse:
    d = await DashboardService(session).build(under_team_id, assignee_id=assignee_id)
    c = d.counts
    days = [d.now.today + timedelta(days=n) for n in range(DAYS_AHEAD)]
    return DashboardResponse(
        today=d.now.today,
        week=DashboardWeek(
            start=d.now.week_start,
            end=d.now.week_end,
            done=c.done_this_week,
            total=c.total_this_week,
        ),
        overdue_total=c.overdue_count,
        oldest_overdue=[_task(i) for i in c.oldest_overdue],
        due_ahead=[DashboardDay(date=x, count=c.due_by_day.get(x, 0)) for x in days],
        mine=DashboardMine(
            overdue=[_task(i) for i in c.my_overdue],
            overdue_total=c.my_overdue_total,
            due_today=[_task(i) for i in c.my_due_today],
            due_today_total=c.my_due_today_total,
        ),
        workload=(
            None
            if d.workload is None
            else [
                DashboardPerson(
                    user_id=w.user_id,
                    name=w.name,
                    open=w.open_count,
                    overdue=w.overdue_count,
                    is_active=w.is_active,
                )
                for w in d.workload
            ]
        ),
        queue=(
            None
            if d.queue is None
            else DashboardQueue(pending=d.queue.pending, oldest_at=d.queue.oldest_at)
        ),
    )

