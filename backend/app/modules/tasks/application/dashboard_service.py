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
from datetime import datetime, time, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import can_in, require_tenant
from app.modules.auth.domain import team_scope
from app.modules.solicitations.infrastructure.repository import SolicitationRepository
from app.modules.tasks.domain.dashboard import (
    MAX_PERIOD_DAYS,
    TIMEZONE,
    Period,
    WorkspaceNow,
    workspace_now,
)
from app.modules.tasks.infrastructure.task_repository import (
    DashboardCounts,
    TaskRepository,
    Workload,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError

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
    period: Period | None
    counts: DashboardCounts
    workload: list[Workload] | None
    queue: RequestQueue | None


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self._tasks = TaskRepository(session)
        self._queue = SolicitationRepository(session)

    async def build(
        self,
        under_team_id: uuid.UUID | None,
        *,
        assignee_id: uuid.UUID | None = None,
        period: Period | None = None,
        at: datetime | None = None,
    ) -> Dashboard:
        """`assignee_id` (14/10, pedido da chefe dela): o relatorio INTEIRO de
        uma pessoa -- a semana, as atrasadas, os proximos dias, a lista "de hoje"
        (que deixa de ser a de quem olha e passa a ser a dela) e a linha dela na
        carga. A fila de solicitacoes NAO muda: solicitacao nao tem responsavel
        ate virar tarefa.

        ⚠️ SO PARA QUEM VE A CARGA: filtrar por pessoa e comparar pessoas, e o
        operador nao tem o ranking (D1). Sem o verbo, 403 -- e nao um filtro
        ignorado em silencio, que devolveria os numeros do time inteiro com a
        tela dizendo que sao de uma pessoa.
        """
        tenant = require_tenant()
        if period is not None:
            _assert_period(period)
        can_see_workload = _allowed(WORKLOAD_VERB, under_team_id)
        if assignee_id is not None and not can_see_workload:
            raise AuthorizationError("Filtrar por pessoa e de quem ve a carga do time.")
        now = workspace_now(at)
        counts = await self._tasks.dashboard_counts(
            under_team_id,
            now,
            me=assignee_id or tenant.user_id,
            assignee_id=assignee_id,
            period=period,
        )

        workload = None
        if can_see_workload:
            workload = await self._tasks.workload_by_person(
                under_team_id, now, _member_teams(under_team_id), period
            )
            if assignee_id is not None:
                workload = [w for w in workload if w.user_id == assignee_id]

        queue = None
        if _allowed(QUEUE_VERB, under_team_id):
            # Com periodo: as que CHEGARAM nele e seguem pendentes hoje.
            chegada = _instants(period) if period is not None else None
            queue = RequestQueue(
                pending=await self._queue.count_pending(under_team_id, chegada),
                oldest_at=await self._queue.oldest_pending_at(under_team_id, chegada),
            )

        return Dashboard(
            now=now, period=period, counts=counts, workload=workload, queue=queue
        )


def _assert_period(period: Period) -> None:
    if period.end < period.start:
        raise ValidationError(
            "O fim do periodo vem antes do inicio.", details={"field": "end"}
        )
    if period.days > MAX_PERIOD_DAYS:
        raise ValidationError(
            f"O periodo passa de {MAX_PERIOD_DAYS} dias.", details={"field": "end"}
        )


def _instants(period: Period) -> tuple[datetime, datetime]:
    """O periodo de DIAS como instantes `[inicio, fim)`, no fuso do sistema:
    a solicitacao das 23h do ultimo dia ainda e do periodo."""
    inicio = datetime.combine(period.start, time.min, tzinfo=TIMEZONE)
    fim = datetime.combine(period.end + timedelta(days=1), time.min, tzinfo=TIMEZONE)
    return inicio, fim


def _allowed(verb: str, under_team_id: uuid.UUID | None) -> bool:
    """O verbo NO TIME da tela. Em "todos os times", so quem o tem na
    organizacao inteira (`None` de `teams_with_permission`): um supervisor de
    um subtime nao ganha a carga da organizacao por ter o verbo num canto."""
    if under_team_id is not None:
        return can_in(verb, under_team_id)
    return require_tenant().teams_with_permission(verb) is None


def _member_teams(under_team_id: uuid.UUID | None) -> frozenset[uuid.UUID] | None:
    """De quais times vem a lista de pessoas do card 1. `None` = todos.

    ⚠️ DENTRO DA LENTE de quem olha (revisao de 15/10). O supervisor de um
    subtime tem o verbo tambem na RAIZ, e olhando a raiz recebia os membros
    dos subtimes VIZINHOS -- com zero tarefas, porque as deles a lente nao
    mostra. "Fulano esta livre" era mentira de quem nao enxerga.
    """
    tenant = require_tenant()
    visible = team_scope.visible_team_ids(
        tenant.memberships, tenant.team_tree, org_role=tenant.org_role
    )
    if under_team_id is None:
        return visible
    times = frozenset(
        {under_team_id} | team_scope.descendants(under_team_id, tenant.team_tree)
    )
    return times if visible is None else times & visible
