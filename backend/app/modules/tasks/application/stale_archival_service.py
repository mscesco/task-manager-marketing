"""Orquestracao da varredura de auto-arquivamento (Spec 013, Fatia 2).

Roda FORA de contexto de tenant: lista todos os workspaces e resolve o admin
de cada um direto pela sessao (mesmo padrao do MembershipRepository, que opera
pre-contexto). Por workspace, entra em `tenant_scope` e chama
TaskService.archive_stale.

ISOLAMENTO: commita POR workspace. Um workspace que falha (ex. sem admin, ou
erro de banco pontual) e registrado e PULADO -- nao derruba os demais nem
desfaz o que ja arquivou nos anteriores.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import tenant_scope
from app.db.models import User, UserTeam, Workspace
from app.db.models.enums import UserTeamRole
from app.modules.tasks.application.task_service import TaskService

logger = get_logger(__name__)


class StaleArchivalService:
    """Varre TODOS os workspaces arquivando tasks terminais velhas."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict:
        """Executa a varredura. Retorna contagem total + por workspace.

        Idempotente: tasks ja arquivadas nao reentram (filtro no repo).
        """
        ws_ids = list(
            (await self._session.execute(select(Workspace.id))).scalars().all()
        )
        by_workspace: dict[str, dict] = {}
        total = 0

        for ws_id in ws_ids:
            admin_id = await self._resolve_admin(ws_id)
            if admin_id is None:
                # Sem admin ativo: nao ha a quem atribuir o historico (user_id
                # do task_history e NOT NULL). Pula em vez de falhar.
                logger.warning(
                    "archive_stale.no_admin", workspace_id=str(ws_id)
                )
                by_workspace[str(ws_id)] = {"archived": 0, "skipped": "no_admin"}
                continue

            try:
                with tenant_scope(workspace_id=ws_id, user_id=admin_id):
                    count = await TaskService(self._session).archive_stale(
                        now=now, actor_user_id=admin_id
                    )
                    await self._session.commit()
            except Exception:
                # Falha pontual de um workspace nao contamina os outros.
                await self._session.rollback()
                logger.exception(
                    "archive_stale.workspace_failed", workspace_id=str(ws_id)
                )
                by_workspace[str(ws_id)] = {"archived": 0, "error": True}
                continue

            by_workspace[str(ws_id)] = {"archived": count}
            total += count

        logger.info(
            "archive_stale.done", total=total, workspaces=len(ws_ids)
        )
        return {"archived_count": total, "by_workspace": by_workspace}

    async def _resolve_admin(
        self, workspace_id: uuid.UUID
    ) -> uuid.UUID | None:
        """Um usuario ADMIN ATIVO do workspace, escolha deterministica.

        Ordena por (created_at, id) -> estavel quando ha mais de um admin.
        None se o workspace nao tem admin ativo (sera pulado).
        """
        stmt = (
            select(UserTeam.user_id)
            .join(
                User,
                and_(
                    User.id == UserTeam.user_id,
                    User.workspace_id == UserTeam.workspace_id,
                ),
            )
            .where(
                UserTeam.workspace_id == workspace_id,
                UserTeam.role == UserTeamRole.ADMIN,
                User.is_active.is_(True),
            )
            .order_by(User.created_at.asc(), User.id.asc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()
