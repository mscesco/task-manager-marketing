"""Casos de uso de comentarios (Entrega 14).

Espelha o CollaborationService: reusa TaskScopeGuards (visibilidade do
comentario = visibilidade da task, D6) e NAO duplica regra de time. Commit no
UoW (router). Comentario NAO entra no task_history (D7).

Casos de uso:
    list_comments   -- thread paginado, ja com tombstone aplicado
    create_comment  -- quem ve, comenta (D1); valida threading (D4)
    edit_comment    -- so o autor (D2); seta edited_at
    delete_comment  -- autor ou moderador task.delete (D3); soft-delete
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Comment, User
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.tasks.domain.comment import (
    assert_reply_target,
    can_delete,
    can_edit,
    extract_mentions,
    mask_content,
    normalize_content,
)
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
)
from app.modules.tasks.infrastructure.comment_repository import CommentRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

#: Permissao que habilita moderacao (apagar comentario alheio). ADMIN/MANAGER
#: ja a possuem (E12). Reusada de proposito -- sem permissao nova (D3).
_MODERATE_PERMISSION = "task.delete"


@dataclass(frozen=True, slots=True)
class CommentDTO:
    """Projecao de um comentario pra API (ja com tombstone resolvido)."""

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    content: str
    edited_at: datetime | None
    created_at: datetime
    is_deleted: bool


class CommentService:
    """Comentarios de uma task. Commit no UoW (router)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tasks = TaskRepository(session)
        self._comments = CommentRepository(session)
        self._guards = TaskScopeGuards(session)
        self._assignees = TaskAssignmentRepository(session)
        self._notify = NotificationEmitter(session)

    async def list_comments(
        self, *, task_id: uuid.UUID, params: PageParams
    ) -> Page[CommentDTO]:
        """Thread paginado da task. Exige enxergar a task (404 senao, D6)."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)

        items, total = await self._comments.list_for_task(
            task_id=task_id, limit=params.limit, offset=params.offset
        )
        dtos = [self._to_dto(c) for c in items]
        return Page(items=dtos, total=total, page=params.page, size=params.size)

    async def create_comment(
        self,
        *,
        task_id: uuid.UUID,
        content: str,
        parent_comment_id: uuid.UUID | None = None,
    ) -> CommentDTO:
        """Cria um comentario. Quem enxerga a task comenta (D1).

        Se for replica, valida o alvo (1 nivel, mesma task -- D4).
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        clean = normalize_content(content)

        if parent_comment_id is not None:
            parent = await self._comments.get_by_id(parent_comment_id)
            if parent is None:  # inexistente ou ja apagado
                raise ValidationError(
                    "Comentario-pai inexistente.",
                    details={"field": "parent_comment_id"},
                )
            assert_reply_target(
                parent_task_id=parent.task_id,
                parent_parent_comment_id=parent.parent_comment_id,
                task_id=task_id,
            )

        tenant = require_tenant()
        comment = Comment(
            workspace_id=tenant.workspace_id,
            task_id=task_id,
            user_id=tenant.user_id,
            parent_comment_id=parent_comment_id,
            content=clean,
        )
        self._comments.add(comment)
        await self._session.flush()

        # --- Notificacoes (Spec 018 + 019) ---
        # 1) Mencoes @[Nome](id) no conteudo: valida que os ids sao usuarios
        #    REAIS do workspace (a FK do recipient e users -> um id invalido
        #    quebraria o INSERT e, no savepoint do emitter, derrubaria TODAS as
        #    mencoes do comentario) e emite TASK_MENTIONED. O emitter deduplica
        #    e exclui o autor (auto-mencao nao notifica).
        mencionados = extract_mentions(clean)
        if mencionados:
            validos = set(
                (
                    await self._session.execute(
                        select(User.id).where(
                            User.id.in_(mencionados),
                            User.workspace_id == tenant.workspace_id,
                        )
                    )
                ).scalars().all()
            )
            mencionados = [m for m in mencionados if m in validos]
            if mencionados:
                await self._notify.mentioned(
                    recipient_ids=mencionados,
                    actor_id=tenant.user_id,
                    task_id=task_id,
                    task_title=task.title,
                    comment_id=comment.id,
                )

        # 2) Comentario: fan-out pros responsaveis E pro criador, menos o autor
        #    (emitter) e MENOS quem ja foi mencionado (D3: a mencao tem
        #    prioridade -- ninguem recebe duas notificacoes pelo mesmo
        #    comentario). Replica tambem notifica.
        mencionados_set = set(mencionados)
        recipient_ids = [
            uid
            for uid in (
                *await self._assignees.list_user_ids(task_id),
                task.created_by,
            )
            if uid not in mencionados_set
        ]
        await self._notify.comment_on_task(
            recipient_ids=recipient_ids,
            actor_id=tenant.user_id,
            task_id=task_id,
            task_title=task.title,
            comment_id=comment.id,
        )

        logger.info(
            "comment.created",
            task_id=str(task_id),
            comment_id=str(comment.id),
            is_reply=parent_comment_id is not None,
        )
        return self._to_dto(comment)

    async def edit_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID, content: str
    ) -> CommentDTO:
        """Edita o conteudo. So o autor (D2). Seta edited_at."""
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        if not can_edit(author_id=comment.user_id, actor_id=tenant.user_id):
            raise AuthorizationError(
                "So o autor edita o proprio comentario."
            )
        comment.content = normalize_content(content)
        comment.edited_at = datetime.now(UTC)
        await self._session.flush()

        logger.info("comment.edited", comment_id=str(comment_id))
        return self._to_dto(comment)

    async def delete_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> None:
        """Soft-delete. Autor ou moderador (task.delete) -- D3."""
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        autorizado = can_delete(
            author_id=comment.user_id,
            actor_id=tenant.user_id,
            actor_can_moderate=_MODERATE_PERMISSION in tenant.permissions,
        )
        if not autorizado:
            raise AuthorizationError(
                "Sem permissao para apagar este comentario."
            )
        comment.deleted_at = datetime.now(UTC)
        await self._session.flush()

        logger.info("comment.deleted", comment_id=str(comment_id))

    # ----------------------------------------------------
    # Helpers
    # ----------------------------------------------------
    async def _load_active(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> Comment:
        """Carrega comentario ATIVO da task visivel. 404 se a task nao for
        vista, se o comentario nao existir/ja apagado, ou se for de outra task.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        comment = await self._comments.get_by_id_or_raise(comment_id)
        if comment.task_id != task_id:
            # comentario existe, mas nao e desta task -> 404 (nao vaza)
            raise EntityNotFoundError("Comment", identifier=comment_id)
        return comment

    @staticmethod
    def _to_dto(comment: Comment) -> CommentDTO:
        is_deleted = comment.deleted_at is not None
        return CommentDTO(
            id=comment.id,
            task_id=comment.task_id,
            user_id=comment.user_id,
            parent_comment_id=comment.parent_comment_id,
            content=mask_content(comment.content, is_deleted=is_deleted),
            edited_at=comment.edited_at,
            created_at=comment.created_at,
            is_deleted=is_deleted,
        )
