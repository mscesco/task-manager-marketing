"""A tela inicial do time (Spec 058) -- quem ve qual card, e os numeros.

⚠️ O SERVIDOR NAO CALCULA O QUE NAO VAI MOSTRAR. Sem o verbo, o card vem
`None`, e a tela o esconde -- em vez de calcular a carga de todo mundo e
confiar que o front nao a desenhe.

Quais tarefas entram em cada numero e pergunta do `TaskRepository`
(`_dashboard_tasks` e `_DashboardPredicates`), e nao daqui.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import can_in, require_tenant
from app.modules.auth.domain import team_scope
from app.modules.solicitations.infrastructure.repository import SolicitationRepository
from app.modules.tasks.domain.dashboard import WorkspaceNow, workspace_now
from app.modules.tasks.infrastructure.task_repository import (
    DashboardCounts,
    TaskRepository,
    Workload,
)

#: Card 1 -- a carga por pessoa (D1 dela: gestor e supervisor, nao operador).
WORKLOAD_VERB = "team_workload.read"
#: Card 6 -- a fila de solicitacoes: quem ja pode ver a fila.
QUEUE_VERB = "solicitation.read"


@dataclass(frozen=True)
class RequestQueue:
    pending: int
    oldest_at: datetime | None


@dataclass(frozen=True)
class Dashboard:
    now: WorkspaceNow
    counts: DashboardCounts
    workload: list[Workload] | None
    queue: RequestQueue | None


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self._tasks = TaskRepository(session)
        self._queue = SolicitationRepository(session)

    async def build(
        self, under_team_id: uuid.UUID | None, *, at: datetime | None = None
    ) -> Dashboard:
        tenant = require_tenant()
        now = workspace_now(at)
        counts = await self._tasks.dashboard_counts(under_team_id, now, me=tenant.user_id)

        workload = None
        if _allowed(WORKLOAD_VERB, under_team_id):
            workload = await self._tasks.workload_by_person(
                under_team_id, now, _member_teams(under_team_id)
            )

        queue = None
        if _allowed(QUEUE_VERB, under_team_id):
            queue = RequestQueue(
                pending=await self._queue.count_pending(under_team_id),
                oldest_at=await self._queue.oldest_pending_at(under_team_id),
            )

        return Dashboard(now=now, counts=counts, workload=workload, queue=queue)


def _allowed(verb: str, under_team_id: uuid.UUID | None) -> bool:
    """O verbo NO TIME da tela. Em "todos os times", so quem o tem na
    organizacao inteira (`None` de `teams_with_permission`): um supervisor de
    um subtime nao ganha a carga da organizacao por ter o verbo num canto."""
    if under_team_id is not None:
        return can_in(verb, under_team_id)
    return require_tenant().teams_with_permission(verb) is None


def _member_teams(under_team_id: uuid.UUID | None) -> frozenset[uuid.UUID] | None:
    """De quais times vem a lista de pessoas do card 1. `None` = todos."""
    tenant = require_tenant()
    if under_team_id is None:
        return team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
    return frozenset(
        {under_team_id} | team_scope.descendants(under_team_id, tenant.team_tree)
    )
