"""Varredura de avisos de prazo, fora de contexto de tenant.

Por workspace, entra em `tenant_scope` e emite:
  - TASK_DUE_SOON  -- task aberta com due_date em [hoje, hoje+2] ainda nao avisada;
  - TASK_OVERDUE   -- task aberta com due_date < hoje, ou hoje com `due_time` ja
    passada (mesma regra de `dashboard.is_overdue`), ainda nao avisada.

Dedup: due_soon_notified_for / overdue_notified_for guardam o due_date avisado;
trocar o prazo reabilita o aviso. "Hoje" e a data em America/Sao_Paulo, nao UTC.
Commita por workspace; um que falha e logado e pulado. A marca e gravada mesmo
se a notificacao falhar: at-most-once e melhor que re-notificar em loop.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Final

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import tenant_scope
from app.db.models import BoardColumn, Task, TaskAssignment, User, Workspace
from app.modules.notifications.application.notification_emitter import (
    AvisoDePrazo,
    NotificationEmitter,
)
from app.modules.tasks.domain.board_semantics import TERMINAL_SEMANTICS
from app.modules.tasks.domain.dashboard import workspace_now

logger = get_logger(__name__)

# Espelho SQL de `TERMINAL_SEMANTICS`, ordenado para o SQL gerado ser estavel.
_SEMANTICAS_TERMINAIS_SQL: Final = tuple(
    sorted(TERMINAL_SEMANTICS, key=lambda s: s.value)
)


class DeadlineNotifyService:
    """Varre TODOS os workspaces emitindo avisos de prazo (due-soon/overdue)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict:
        """Executa a varredura. `now` (UTC) e convertido pra data local."""
        agora = workspace_now(now)
        hoje = agora.today
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
                        minuto=agora.minute,
                        limite_soon=limite_soon,
                        overdue=False,
                    )
                    over = await self._run_kind(
                        ws_id=ws_id,
                        hoje=hoje,
                        minuto=agora.minute,
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
        minuto: time,
        limite_soon: date,
        overdue: bool,
    ) -> int:
        """Emite um tipo (overdue=False -> due_soon; True -> overdue) e grava a
        coluna de dedup. Retorna quantas tasks foram notificadas."""
        emitter = NotificationEmitter(self._session)

        # Join interno: se `task.column_id` voltar a ser nullable, tarefa sem
        # coluna para de avisar em silencio.
        base = (
            select(Task)
            .join(
                BoardColumn,
                and_(
                    BoardColumn.id == Task.column_id,
                    BoardColumn.workspace_id == Task.workspace_id,
                ),
            )
            .where(
                Task.workspace_id == ws_id,
                Task.due_date.is_not(None),
                # Espelha `board_semantics.avisa_prazo`: terminal primeiro, depois a flag.
                BoardColumn.semantic.not_in(_SEMANTICAS_TERMINAIS_SQL),
                BoardColumn.notify_deadline.is_(True),
                Task.is_archived.is_(False),
                Task.deleted_at.is_(None),
            )
        )
        # A hora conta: "hoje as 9h" ja esta atrasada as 10h.
        if overdue:
            stmt = base.where(
                or_(
                    Task.due_date < hoje,
                    and_(Task.due_date == hoje, Task.due_time < minuto),
                ),
                Task.overdue_notified_for.is_distinct_from(Task.due_date),
            )
        else:
            stmt = base.where(
                Task.due_date >= hoje,
                Task.due_date <= limite_soon,
                or_(
                    Task.due_date > hoje,
                    Task.due_time.is_(None),
                    Task.due_time >= minuto,
                ),
                Task.due_soon_notified_for.is_distinct_from(Task.due_date),
            )

        # SKIP LOCKED: duas execucoes simultaneas (retry do n8n) nao avisam em dobro.
        stmt = stmt.with_for_update(skip_locked=True, of=Task)
        tasks = list((await self._session.execute(stmt)).scalars().all())
        destinatarios = await self._recipients(ws_id=ws_id, tasks=tasks)
        await emitter.prazos(
            overdue=overdue,
            avisos=[AvisoDePrazo(t, *destinatarios[t.id]) for t in tasks],
        )
        if tasks:
            marca = Task.overdue_notified_for if overdue else Task.due_soon_notified_for
            await self._session.execute(
                update(Task)
                .where(Task.id.in_([t.id for t in tasks]))
                .values({marca: Task.due_date})
                .execution_options(synchronize_session=False)
            )

        return len(tasks)

    async def _recipients(
        self, *, ws_id: uuid.UUID, tasks: list[Task]
    ) -> dict[uuid.UUID, tuple[list[uuid.UUID], str]]:
        """Por tarefa: responsaveis ativos; se nao houver, o criador se ativo.

        Devolve `task.id -> (ids, papel)`, papel `assignee` ou `creator` (nunca
        `watcher`: prazo nao vai para seguidor). Duas consultas para o lote todo.
        Zero destinatarios ainda grava a marca de dedup: a tarefa so volta a
        avisar quando o `due_date` mudar.
        """
        if not tasks:
            return {}
        stmt = (
            select(TaskAssignment.task_id, TaskAssignment.user_id)
            .join(
                User,
                and_(
                    User.id == TaskAssignment.user_id,
                    User.workspace_id == TaskAssignment.workspace_id,
                ),
            )
            .where(
                TaskAssignment.task_id.in_([t.id for t in tasks]),
                TaskAssignment.workspace_id == ws_id,
                User.is_active.is_(True),
            )
        )
        responsaveis: dict[uuid.UUID, list[uuid.UUID]] = {}
        for task_id, user_id in (await self._session.execute(stmt)).all():
            responsaveis.setdefault(task_id, []).append(user_id)

        sem_responsavel = [t for t in tasks if t.id not in responsaveis]
        criadores_ativos: set[uuid.UUID] = set()
        if sem_responsavel:
            criadores_ativos = set(
                (
                    await self._session.execute(
                        select(User.id).where(
                            User.id.in_({t.created_by for t in sem_responsavel}),
                            User.workspace_id == ws_id,
                            User.is_active.is_(True),
                        )
                    )
                )
                .scalars()
                .all()
            )

        resultado: dict[uuid.UUID, tuple[list[uuid.UUID], str]] = {}
        for t in tasks:
            if t.id in responsaveis:
                resultado[t.id] = (responsaveis[t.id], "assignee")
            else:
                criador = [t.created_by] if t.created_by in criadores_ativos else []
                resultado[t.id] = (criador, "creator")
        return resultado

    async def _resolve_ctx_user(
        self, workspace_id: uuid.UUID
    ) -> uuid.UUID | None:
        """Um usuario ativo do workspace, so pra satisfazer o tenant_scope (actor
        da notificacao e None). None se nao ha usuario ativo (workspace pulado)."""
        stmt = (
            select(User.id)
            .where(User.workspace_id == workspace_id, User.is_active.is_(True))
            .order_by(User.created_at.asc(), User.id.asc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()
