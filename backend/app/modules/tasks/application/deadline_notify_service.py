"""Varredura de avisos de prazo (Spec 023, Fatia 2).

Roda FORA de contexto de tenant (igual StaleArchivalService): lista todos os
workspaces e, por workspace, entra em `tenant_scope` e emite:
  - TASK_DUE_SOON  -- task aberta com due_date em [hoje, hoje+2] ainda nao avisada;
  - TASK_OVERDUE   -- task aberta com due_date < hoje ainda nao avisada.

Destinatarios (D2): responsaveis da task; se nao houver, o criador (fallback).
Idempotencia (D3): cada task tem due_soon_notified_for / overdue_notified_for
guardando o due_date ja avisado. So dispara se DIFERE do due_date atual -> troca
de prazo reabilita sozinho. Apos emitir, grava a coluna.

TIMEZONE (D7): due_date e data pura; "hoje" e a data em America/Sao_Paulo, NAO
UTC -- perto da meia-noite UTC/BRT divergem e o dia sairia errado.

ISOLAMENTO: commita POR workspace. Um workspace que falha e logado e PULADO.

BEST-EFFORT: a coluna de dedup e gravada apos a emissao independente de a
notificacao ter tido sucesso (o emitter e best-effort e loga falha alto). Vies
consciente: at-most-once (perder 1 aviso) e melhor que re-notificar em loop.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import tenant_scope
from app.db.models import Task, TaskAssignment, User, Workspace
from app.db.models.enums import TaskStatus
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)

logger = get_logger(__name__)

_TZ_SP = ZoneInfo("America/Sao_Paulo")
_TERMINAIS = (TaskStatus.COMPLETED, TaskStatus.CANCELLED)


class DeadlineNotifyService:
    """Varre TODOS os workspaces emitindo avisos de prazo (due-soon/overdue)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict:
        """Executa a varredura. `now` (UTC) e convertido pra data local (D7)."""
        hoje = now.astimezone(_TZ_SP).date()
        limite_soon = hoje + timedelta(days=2)

        ws_ids = list(
            (await self._session.execute(select(Workspace.id))).scalars().all()
        )
        by_workspace: dict[str, dict] = {}
        total_soon = 0
        total_overdue = 0

        for ws_id in ws_ids:
            ctx_user = await self._resolve_ctx_user(ws_id)
            if ctx_user is None:
                # Sem usuario ativo: nao ha a quem notificar nem contexto valido.
                logger.warning("deadline_notify.no_user", workspace_id=str(ws_id))
                by_workspace[str(ws_id)] = {"skipped": "no_active_user"}
                continue

            try:
                with tenant_scope(workspace_id=ws_id, user_id=ctx_user):
                    soon = await self._run_kind(
                        ws_id=ws_id,
                        hoje=hoje,
                        limite_soon=limite_soon,
                        overdue=False,
                    )
                    over = await self._run_kind(
                        ws_id=ws_id,
                        hoje=hoje,
                        limite_soon=limite_soon,
                        overdue=True,
                    )
                    await self._session.commit()
            except Exception:
                await self._session.rollback()
                logger.exception(
                    "deadline_notify.workspace_failed", workspace_id=str(ws_id)
                )
                by_workspace[str(ws_id)] = {"error": True}
                continue

            by_workspace[str(ws_id)] = {"due_soon": soon, "overdue": over}
            total_soon += soon
            total_overdue += over

        logger.info(
            "deadline_notify.done",
            due_soon=total_soon,
            overdue=total_overdue,
            workspaces=len(ws_ids),
        )
        return {
            "due_soon_count": total_soon,
            "overdue_count": total_overdue,
            "by_workspace": by_workspace,
        }

    async def _run_kind(
        self,
        *,
        ws_id: uuid.UUID,
        hoje: date,
        limite_soon: date,
        overdue: bool,
    ) -> int:
        """Emite um tipo (overdue=False -> due_soon; True -> overdue) e grava a
        coluna de dedup. Retorna quantas tasks foram notificadas."""
        emitter = NotificationEmitter(self._session)

        base = (
            select(Task)
            .where(
                Task.workspace_id == ws_id,
                Task.due_date.is_not(None),
                Task.status.not_in(_TERMINAIS),
                Task.is_archived.is_(False),
                Task.deleted_at.is_(None),
            )
        )
        if overdue:
            stmt = base.where(
                Task.due_date < hoje,
                Task.overdue_notified_for.is_distinct_from(Task.due_date),
            )
        else:
            stmt = base.where(
                Task.due_date >= hoje,
                Task.due_date <= limite_soon,
                Task.due_soon_notified_for.is_distinct_from(Task.due_date),
            )

        tasks = list((await self._session.execute(stmt)).scalars().all())
        for t in tasks:
            recipients = await self._recipients(ws_id=ws_id, task=t)
            due_iso = t.due_date.isoformat()  # type: ignore[union-attr]
            if overdue:
                await emitter.overdue(
                    recipient_ids=recipients,
                    task_id=t.id,
                    task_title=t.title,
                    due_date_iso=due_iso,
                )
                t.overdue_notified_for = t.due_date
            else:
                await emitter.due_soon(
                    recipient_ids=recipients,
                    task_id=t.id,
                    task_title=t.title,
                    due_date_iso=due_iso,
                )
                t.due_soon_notified_for = t.due_date

        return len(tasks)

    async def _recipients(
        self, *, ws_id: uuid.UUID, task: Task
    ) -> list[uuid.UUID]:
        """Responsaveis da task; se nao houver, o criador (fallback D2)."""
        stmt = select(TaskAssignment.user_id).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.workspace_id == ws_id,
        )
        ids = list((await self._session.execute(stmt)).scalars().all())
        return ids if ids else [task.created_by]

    async def _resolve_ctx_user(
        self, workspace_id: uuid.UUID
    ) -> uuid.UUID | None:
        """Um usuario ATIVO do workspace, so pra satisfazer o tenant_scope (o
        user_id do contexto nao entra na notificacao -- actor e None). None se o
        workspace nao tem usuario ativo (sera pulado)."""
        stmt = (
            select(User.id)
            .where(User.workspace_id == workspace_id, User.is_active.is_(True))
            .order_by(User.created_at.asc(), User.id.asc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()
