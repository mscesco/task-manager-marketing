"""Responsaveis (assignees) e seguidores (watchers) de uma task.

    - assignment usa os gates de time (TaskScopeGuards) e nao concede edicao;
    - designado precisa alcancar a task pela lente dele -> 422 senao;
    - seguidor: self exige so ver; terceiro exige `task.assign` no time da
      tarefa + edicao;
    - tarefa arquivada: seguidores so leitura -> 422 `tarefa_arquivada`;
    - assigned/unassigned e watched/unwatched entram no history;
    - idempotente: re-adicionar -> no-op; remover inexistente -> 404.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Task
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
    user_ids_that_can_view_task,
)
from app.modules.tasks.domain.history import (
    MotivoDoSeguidor,
    build_assigned_entry,
    build_unassigned_entry,
    build_unwatched_entry,
    build_watched_entry,
)
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
    TaskWatcherRepository,
)
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)

_ASSIGN_PERMISSION = "task.assign"


class CollaborationService:
    """Responsaveis e observadores de uma task. Commit no UoW (router)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tasks = TaskRepository(session)
        self._assignees = TaskAssignmentRepository(session)
        self._watchers = TaskWatcherRepository(session)
        self._guards = TaskScopeGuards(session)
        self._notify = NotificationEmitter(session)

    # ----------------------------------------------------
    # Assignees
    # ----------------------------------------------------
    async def add_assignee(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Task, bool]:
        """Designa um responsavel. Retorna (task, created).

        created=False => no-op idempotente, sem history. Gates: visivel(404),
        editavel(403), designado alcanca a task(422).
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)
        await self._assert_target_reaches_task(task=task, user_id=user_id)

        if await self._assignees.get(task_id=task_id, user_id=user_id) is not None:
            return task, False  # idempotente

        tenant = require_tenant()
        self._assignees.add(
            task_id=task_id, user_id=user_id, assigned_by=tenant.user_id
        )
        await self._session.flush()
        await self._tasks.write_history(
            task=task,
            user_id=tenant.user_id,
            entries=[
                build_assigned_entry(user_id=user_id, assigned_by=tenant.user_id)
            ],
        )
        await self._session.flush()
        # Na mesma transacao; no-op se auto-designacao (tratado no emitter).
        await self._notify.task_assigned(
            recipient_id=user_id,
            actor_id=tenant.user_id,
            task_id=task.id,
            task_title=task.title,
        )
        logger.info("task.assigned", task_id=str(task_id), user_id=str(user_id))
        return task, True

    async def assign_many_or_fail(
        self, *, task: Task, user_ids: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """Designa varios responsaveis de uma vez, atomico.

        Valida todos antes de aplicar qualquer um; havendo invalidos, 422 com
        details["invalid_ids"] e a transacao do chamador reverte. Ja-responsavel
        e pulado. Retorna os ids efetivamente designados.
        """
        # Dedup preservando ordem.
        ids: list[uuid.UUID] = []
        vistos: set[uuid.UUID] = set()
        for u in user_ids:
            if u not in vistos:
                vistos.add(u)
                ids.append(u)
        if not ids:
            return []

        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)

        invalidos: list[uuid.UUID] = []
        for uid in ids:
            try:
                await self._assert_target_reaches_task(task=task, user_id=uid)
            except (ValidationError, ConflictError):
                invalidos.append(uid)
        if invalidos:
            raise ValidationError(
                "Um ou mais responsaveis nao podem ser designados a esta task.",
                details={
                    "field": "assignee_ids",
                    "invalid_ids": [str(u) for u in invalidos],
                },
            )

        tenant = require_tenant()
        designados: list[uuid.UUID] = []
        for uid in ids:
            if await self._assignees.get(task_id=task.id, user_id=uid) is not None:
                continue  # idempotente
            self._assignees.add(
                task_id=task.id, user_id=uid, assigned_by=tenant.user_id
            )
            await self._session.flush()
            await self._tasks.write_history(
                task=task,
                user_id=tenant.user_id,
                entries=[
                    build_assigned_entry(user_id=uid, assigned_by=tenant.user_id)
                ],
            )
            await self._session.flush()
            await self._notify.task_assigned(
                recipient_id=uid,
                actor_id=tenant.user_id,
                task_id=task.id,
                task_title=task.title,
            )
            designados.append(uid)

        if designados:
            logger.info(
                "task.assigned_many",
                task_id=str(task.id),
                count=len(designados),
            )
        return designados

    async def remove_assignee(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> Task:
        """Remove um responsavel. Par inexistente -> 404. Grava `unassigned`.

        Recusa remover o ultimo: toda tarefa precisa de pelo menos um responsavel.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)

        # Trava a tarefa antes de contar: sem ela, duas remocoes simultaneas
        # dos dois ultimos responsaveis passariam e a tarefa ficaria sem dono.
        await self._session.execute(
            select(Task.id)
            .where(Task.id == task.id, Task.workspace_id == task.workspace_id)
            .with_for_update()
        )
        atuais = await self._assignees.list_user_ids(task_id)
        if user_id in atuais and len(atuais) == 1:
            raise ValidationError(
                "Toda tarefa precisa de pelo menos um responsável. "
                "Escolha outro antes de remover este.",
                details={"field": "assignee_ids"},
            )

        if not await self._assignees.remove(task_id=task_id, user_id=user_id):
            raise EntityNotFoundError("TaskAssignment", identifier=user_id)

        tenant = require_tenant()
        await self._session.flush()
        await self._tasks.write_history(
            task=task,
            user_id=tenant.user_id,
            entries=[build_unassigned_entry(user_id=user_id)],
        )
        await self._session.flush()
        logger.info("task.unassigned", task_id=str(task_id), user_id=str(user_id))
        return task

    async def list_assignees(self, *, task_id: uuid.UUID) -> list[uuid.UUID]:
        """user_ids dos responsaveis. Exige ver a task (404 senao)."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        return await self._assignees.list_user_ids(task_id)

    # ----------------------------------------------------
    # Watchers
    # ----------------------------------------------------
    async def add_watcher(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID | None
    ) -> tuple[Task, bool]:
        """Inscreve seguidor. Retorna (task, created).

        Self (user_id None/==eu) exige so ver; terceiro exige `task.assign` no
        time da tarefa + edicao + alcance do alvo. Tarefa arquivada -> 422.
        Idempotente; o no-op nao grava historico nem avisa.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        self._assert_nao_arquivada(task)

        tenant = require_tenant()
        target = user_id if user_id is not None else tenant.user_id
        if target != tenant.user_id:
            await self._assert_can_manage_others(task)
            await self._assert_target_reaches_task(task=task, user_id=target)

        if await self._watchers.get(task_id=task_id, user_id=target) is not None:
            return task, False  # idempotente

        await self._gravar_seguidor(
            task=task, user_id=target, motivo=MotivoDoSeguidor.MANUAL
        )
        logger.info("task.watched", task_id=str(task_id), user_id=str(target))
        return task, True

    async def remove_watcher(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> Task:
        """Tira seguidor. Self exige so ver; terceiro exige a mesma permissao
        de por. Par inexistente -> 404. Tarefa arquivada -> 422.

        Sem conferir alcance do alvo, de proposito: e assim que se tira quem
        ja nao alcanca a tarefa.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        self._assert_nao_arquivada(task)

        tenant = require_tenant()
        if user_id != tenant.user_id:
            await self._assert_can_manage_others(task)

        if not await self._watchers.remove(task_id=task_id, user_id=user_id):
            raise EntityNotFoundError("TaskWatcher", identifier=user_id)
        await self._session.flush()
        await self._tasks.write_history(
            task=task,
            user_id=tenant.user_id,
            entries=[
                build_unwatched_entry(
                    user_id=user_id, by=tenant.user_id, reason=MotivoDoSeguidor.MANUAL
                )
            ],
        )
        await self._session.flush()
        await self._notify.watch_removed(
            recipient_id=user_id,
            actor_id=tenant.user_id,
            task_id=task.id,
            task_title=task.title,
        )
        logger.info("task.unwatched", task_id=str(task_id), user_id=str(user_id))
        return task

    async def watch_many_or_fail(
        self, *, task: Task, user_ids: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """Seguidores escolhidos no modal de criar, atomico como `assign_many_or_fail`.

        Quem nao alcanca a tarefa -> 422 com `details.invalid_ids`. Incluir
        outra pessoa exige a permissao de por terceiro.
        """
        ids = list(dict.fromkeys(user_ids))
        if not ids:
            return []

        tenant = require_tenant()
        await self._guards.assert_visible(task)
        if any(uid != tenant.user_id for uid in ids):
            await self._assert_can_manage_others(task)

        alcancam = await user_ids_that_can_view_task(
            self._session, task=task, user_ids=ids
        )
        invalidos = [uid for uid in ids if uid not in alcancam]
        if invalidos:
            raise ValidationError(
                "Um ou mais seguidores nao alcancam esta tarefa.",
                details={
                    "field": "watcher_ids",
                    "invalid_ids": [str(u) for u in invalidos],
                },
            )

        inscritos: list[uuid.UUID] = []
        for uid in ids:
            if await self._watchers.get(task_id=task.id, user_id=uid) is not None:
                continue
            await self._gravar_seguidor(
                task=task, user_id=uid, motivo=MotivoDoSeguidor.CREATED_WITH
            )
            inscritos.append(uid)
        return inscritos

    async def remove_watchers_without_reach(
        self, *, task_ids: list[uuid.UUID]
    ) -> int:
        """Tira os seguidores que deixaram de alcancar estas tarefas; devolve quantos.

        Chamado depois de troca de time ou de projeto. Sem aviso para quem sai
        (mostraria o titulo de uma tarefa que ele nao ve); o historico grava
        `lost_access`. Recarrega as tarefas (`populate_existing`) porque o `move`
        troca o projeto por SQL cru. Responsavel que perde o alcance nao sai,
        so para de receber aviso.
        """
        if not task_ids:
            return 0
        por_tarefa = await self._watchers.list_user_ids_for_tasks(task_ids)
        com_seguidor = [tid for tid, uids in por_tarefa.items() if uids]
        if not com_seguidor:
            return 0

        await self._session.flush()
        tarefas = (
            await self._session.execute(
                select(Task)
                .where(Task.id.in_(com_seguidor))
                .execution_options(populate_existing=True)
            )
        ).scalars().all()

        tenant = require_tenant()
        saidas = 0
        for tarefa in tarefas:
            seguidores = por_tarefa[tarefa.id]
            alcancam = await user_ids_that_can_view_task(
                self._session, task=tarefa, user_ids=seguidores
            )
            perderam = [uid for uid in seguidores if uid not in alcancam]
            if not perderam:
                continue
            await self._watchers.remove_many(task_id=tarefa.id, user_ids=perderam)
            await self._tasks.write_history(
                task=tarefa,
                user_id=tenant.user_id,
                entries=[
                    build_unwatched_entry(
                        user_id=uid,
                        by=tenant.user_id,
                        reason=MotivoDoSeguidor.LOST_ACCESS,
                    )
                    for uid in perderam
                ],
            )
            saidas += len(perderam)

        if saidas:
            await self._session.flush()
            logger.info(
                "task.watchers_lost_access", tarefas=len(com_seguidor), saidas=saidas
            )
        return saidas

    async def list_watchers(self, *, task_id: uuid.UUID) -> list[uuid.UUID]:
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        return await self._watchers.list_user_ids(task_id)

    # ----------------------------------------------------
    # Hidratacao do detalhe (GET /tasks/{id})
    # ----------------------------------------------------
    async def assignee_ids_for(self, task: Task) -> list[uuid.UUID]:
        """IDs pro TaskDetailResponse. Assume task ja visivel."""
        return await self._assignees.list_user_ids(task.id)

    async def assignee_ids_for_tasks(
        self, tasks: list[Task]
    ) -> dict[uuid.UUID, list[uuid.UUID]]:
        """Assignees de uma pagina de tasks em 1 query. Assume tasks ja visiveis."""
        return await self._assignees.list_user_ids_for_tasks(
            [t.id for t in tasks]
        )

    async def watcher_ids_for(self, task: Task) -> list[uuid.UUID]:
        return await self._watchers.list_user_ids(task.id)

    # ----------------------------------------------------
    # Helpers privados
    # ----------------------------------------------------
    async def _gravar_seguidor(
        self, *, task: Task, user_id: uuid.UUID, motivo: MotivoDoSeguidor
    ) -> None:
        """Grava um seguidor + historico + aviso. Caminho unico de entrada como seguidor."""
        tenant = require_tenant()
        self._watchers.add(task_id=task.id, user_id=user_id)
        await self._session.flush()
        await self._tasks.write_history(
            task=task,
            user_id=tenant.user_id,
            entries=[
                build_watched_entry(user_id=user_id, by=tenant.user_id, reason=motivo)
            ],
        )
        await self._session.flush()
        await self._notify.watch_added(
            recipient_id=user_id,
            actor_id=tenant.user_id,
            task_id=task.id,
            task_title=task.title,
        )

    @staticmethod
    def _assert_nao_arquivada(task: Task) -> None:
        """Seguidores de tarefa arquivada sao so leitura."""
        if task.is_archived:
            raise ValidationError(
                "Tarefa arquivada: os seguidores não podem mudar.",
                code="tarefa_arquivada",
                details={"task_id": str(task.id)},
            )

    async def _assert_can_manage_others(self, task: Task) -> None:
        """Gate pra mexer em seguidor de terceiro: `task.assign` no time da tarefa + edicao."""
        tenant = require_tenant()
        if not tenant.has_permission_in(_ASSIGN_PERMISSION, task.team_id):
            raise AuthorizationError(
                f"Permissao necessaria: {_ASSIGN_PERMISSION}.",
                details={"required_permission": _ASSIGN_PERMISSION},
            )
        await self._guards.assert_editable(task)

    async def _assert_target_reaches_task(
        self, *, task: Task, user_id: uuid.UUID
    ) -> None:
        """422 se o `user_id` alvo nao alcanca (nao enxerga) a task.

        Usa a lente do alvo, nao do ator; cobre alvo inexistente ou inativo.
        A regra vive so em `user_can_view_task`: nao duplicar aqui, senao o
        seletor oferece alguem que o salvar recusa.
        """
        if not await user_can_view_task(
            self._session, task=task, user_id=user_id
        ):
            raise ValidationError(
                "Usuario designado inexistente, inativo ou sem acesso a esta task.",
                details={"field": "user_id"},
            )
