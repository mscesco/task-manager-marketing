"""Router /dashboard -- a tela inicial do time (Spec 058).

Uma rota so, com todos os cards: a tela abre com UM pedido, e nao seis.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.application.dashboard_service import DashboardService
from app.modules.tasks.domain.dashboard import Period
from app.modules.tasks.infrastructure.task_repository import DashboardItem
from app.shared.exceptions.base import ValidationError

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
    """O resumo: a semana corrente, ou o periodo escolhido.
    ⚠️ `start`/`end` vem daqui: a tela mostra, nao recalcula."""

    start: date
    end: date
    done: int
    total: int


class DashboardBucket(BaseModel):
    """Uma coluna do grafico: um dia, ou uma semana (a primeira e a ultima
    podem ser parciais -- `start`/`end` dizem o que conta)."""

    start: date
    end: date
    done: int
    on_time: int
    overdue: int


class DashboardMine(BaseModel):
    """As minhas (ou as da pessoa filtrada): atrasadas, e as no prazo -- que
    sem periodo sao as que vencem hoje."""

    overdue: list[DashboardTask]
    overdue_total: int
    on_time: list[DashboardTask]
    on_time_total: int


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


class DashboardPeriod(BaseModel):
    start: date
    end: date


class DashboardResponse(BaseModel):
    today: date
    #: O periodo escolhido; `null` = "Agora" (a semana corrente e os 7 dias).
    period: DashboardPeriod | None
    week: DashboardWeek
    overdue_total: int
    oldest_overdue: list[DashboardTask]
    #: Abertas e no prazo: as que vencem hoje, ou as do periodo.
    on_time_total: int
    #: "day" ou "week" -- acima de 14 dias o grafico agrupa por semana.
    bucket_unit: str
    buckets: list[DashboardBucket]
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
    start: date | None = Query(
        None,
        description=(
            "Inicio do periodo (com `end`). Escolhido, TUDO passa a ser das "
            "tarefas com prazo nele, no estado de hoje. Ate 366 dias."
        ),
    ),
    end: date | None = Query(None, description="Fim do periodo, inclusive."),
) -> DashboardResponse:
    if (start is None) != (end is None):
        raise ValidationError(
            "O periodo precisa de inicio e fim.", details={"field": "start"}
        )
    period = Period(start, end) if start is not None and end is not None else None
    d = await DashboardService(session).build(
        under_team_id, assignee_id=assignee_id, period=period
    )
    c = d.counts
    return DashboardResponse(
        today=d.now.today,
        period=(
            None if d.period is None else DashboardPeriod(start=d.period.start, end=d.period.end)
        ),
        week=DashboardWeek(
            start=c.summary_start, end=c.summary_end, done=c.done, total=c.total
        ),
        overdue_total=c.overdue_count,
        oldest_overdue=[_task(i) for i in c.oldest_overdue],
        on_time_total=c.on_time_total,
        bucket_unit=c.bucket_unit,
        buckets=[
            DashboardBucket(
                start=b.start, end=b.end, done=b.done, on_time=b.on_time, overdue=b.overdue
            )
            for b in c.buckets
        ],
        mine=DashboardMine(
            overdue=[_task(i) for i in c.my_overdue],
            overdue_total=c.my_overdue_total,
            on_time=[_task(i) for i in c.my_on_time],
            on_time_total=c.my_on_time_total,
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
