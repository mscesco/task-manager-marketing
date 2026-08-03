"""Casos de uso de colaboracao: responsaveis (assignees) e observadores
(watchers) de uma task -- Entrega 4.

Regras (fonte da verdade: specs/004-assignment-watchers/spec.md):
    - assignment reusa os gates de time (TaskScopeGuards, ADR 0010) e NAO
      concede edicao;
    - designado precisa alcancar a task (lente DELE) -> 422 senao;
    - pessoal e monouser -> 409 pra terceiro;
    - watcher: self exige so ver; terceiro exige task.assign+edicao (ADR 0011);
    - assigned/unassigned entram no history; watcher nao (ADR 0012);
    - idempotente: re-adicionar -> no-op; remover inexistente -> 404.

Reuso do gate de time: via TaskScopeGuards (helpers extraidos do
TaskService). NAO duplica logica de time.
"""

from __future__ import annotations

import uuid

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
)
from app.modules.tasks.domain.history import (
    build_assigned_entry,
    build_unassigned_entry,
)
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
    TaskWatcherRepository,
)
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
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
        self._projects = ProjectRepository(session)
        self._guards = TaskScopeGuards(session)
        self._notify = NotificationEmitter(session)

    # ----------------------------------------------------
    # Assignees
    # ----------------------------------------------------
    async def add_assignee(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Task, bool]:
        """Designa um responsavel. Retorna (task, created).

        created=False => no-op idempotente (ja era responsavel), sem
        linha de history. Gates: visivel(404)+editavel(403); pessoal
        monouser(409); designado alcanca a task(422).
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)
        await self._assert_personal_monouser(task=task, user_id=user_id)
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
        # Emissao de notificacao (Spec 018, F2): na MESMA transacao.
        # No-op se for auto-designacao (tratado no emitter).
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
        """Designa varios responsaveis de uma vez, ATOMICO (Spec 021).

        Valida TODOS os ids ANTES de aplicar qualquer um. Havendo invalido(s),
        levanta ValidationError (422) com a lista em details["invalid_ids"] e
        NAO aplica nenhum -- a transacao do chamador (que ainda nao commitou)
        reverte. Senao, aplica cada um reusando o mesmo caminho de add_assignee
        (gravar + history + notificacao). Idempotente: ja-responsavel e pulado.
        Retorna os ids efetivamente designados.

        Os gates de TASK (visivel/editavel) rodam uma vez; os gates por-ALVO
        (alcance/ativo, pessoal-monouser) rodam por id, COLETANDO as falhas em
        vez de estourar na primeira. Nota: violacao de monouser (que isolada
        seria 409) entra aqui na lista de invalidos do 422 unico -- decisao
        consciente pra dar UMA resposta coerente "estes nao podem ser
        responsaveis" (Spec 021, decisao B).
        """
        # Dedup preservando ordem (id repetido vira um so).
        ids: list[uuid.UUID] = []
        vistos: set[uuid.UUID] = set()
        for u in user_ids:
            if u not in vistos:
                vistos.add(u)
                ids.append(u)
        if not ids:
            return []

        # Gates de task (uma vez). Quem cria a task pode edita-la; se nao
        # puder, a criacao inteira falha (403) -- correto: nao se designa
        # responsavel numa task que voce nao pode editar.
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)

        # Validacao em lote: coleta TODOS os invalidos.
        invalidos: list[uuid.UUID] = []
        for uid in ids:
            try:
                await self._assert_personal_monouser(task=task, user_id=uid)
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

        # Aplicacao: todos validos -> grava + history + notifica cada um.
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
            # No-op se auto-designacao do criador (tratado no emitter).
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
        """Remove um responsavel. Par inexistente -> 404. Grava `unassigned`."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)

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
        """Inscreve observador. Self (user_id None/==eu) exige so ver;
        terceiro exige task.assign+edicao + alcance + monouser.
        Idempotente. Sem history (ADR 0012)."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)

        tenant = require_tenant()
        target = user_id if user_id is not None else tenant.user_id
        if target != tenant.user_id:
            await self._assert_can_manage_others(task)
            await self._assert_personal_monouser(task=task, user_id=target)
            await self._assert_target_reaches_task(task=task, user_id=target)

        if await self._watchers.get(task_id=task_id, user_id=target) is not None:
            return task, False  # idempotente

        self._watchers.add(task_id=task_id, user_id=target)
        await self._session.flush()
        logger.info("task.watched", task_id=str(task_id), user_id=str(target))
        return task, True

    async def remove_watcher(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> Task:
        """Remove observador. Self exige so ver; terceiro exige permissao.
        Par inexistente -> 404."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)

        tenant = require_tenant()
        if user_id != tenant.user_id:
            await self._assert_can_manage_others(task)

        if not await self._watchers.remove(task_id=task_id, user_id=user_id):
            raise EntityNotFoundError("TaskWatcher", identifier=user_id)
        logger.info("task.unwatched", task_id=str(task_id), user_id=str(user_id))
        return task

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
        """assignees de uma pagina de tasks em LOTE (1 query) -- pro selo do
        quadro. Assume as tasks ja visiveis (vieram da listagem escopada)."""
        return await self._assignees.list_user_ids_for_tasks(
            [t.id for t in tasks]
        )

    async def watcher_ids_for(self, task: Task) -> list[uuid.UUID]:
        return await self._watchers.list_user_ids(task.id)

    # ----------------------------------------------------
    # Helpers privados
    # ----------------------------------------------------
    async def _assert_can_manage_others(self, task: Task) -> None:
        """Gate pra mexer em colaborador de TERCEIRO: task.assign + edicao."""
        tenant = require_tenant()
        if not tenant.has_permission(_ASSIGN_PERMISSION):
            raise AuthorizationError(
                f"Permissao necessaria: {_ASSIGN_PERMISSION}.",
                details={"required_permission": _ASSIGN_PERMISSION},
            )
        await self._guards.assert_editable(task)

    async def _assert_target_reaches_task(
        self, *, task: Task, user_id: uuid.UUID
    ) -> None:
        """422 se o `user_id` alvo nao alcanca (nao enxerga) a task.

        Usa a lente do ALVO (memberships dele), nao do ator. Cobre tambem
        alvo inexistente ou inativo no workspace.

        Spec 034 (D2/D4): a regra vive em UM lugar so -- `user_can_view_task`
        em `task_guards.py`. Ate 03/08 este metodo tinha uma copia byte a byte
        daquele corpo (get_membership -> is_active -> team_roles ->
        visible_team_ids -> task_visible). Duas copias de uma regra de
        VISIBILIDADE divergem em silencio: o sintoma seria o seletor oferecer
        alguem que o salvar recusa, que e exatamente o defeito que a 034
        existe pra acabar. NAO reintroduzir a logica aqui -- se a regra
        precisar mudar, ela muda em `user_can_view_task` e os tres chamadores
        acompanham juntos.
        """
        if not await user_can_view_task(
            self._session, task=task, user_id=user_id
        ):
            raise ValidationError(
                # Mensagem UNICA de proposito. `user_can_view_task` devolve
                # False sem distinguir "nao e membro ativo" de "nao alcanca",
                # e as duas mensagens antigas nao eram afirmadas por nenhum
                # teste (conferido por grep em 03/08). Recuperar a distincao
                # exigiria uma consulta de membership so pra escolher texto --
                # a segunda copia voltando pela porta dos fundos.
                "Usuario designado inexistente, inativo ou sem acesso a esta task.",
                details={"field": "user_id"},
            )

    async def _assert_personal_monouser(
        self, *, task: Task, user_id: uuid.UUID
    ) -> None:
        """409 se a task e de projeto pessoal e `user_id` nao e o dono."""
        if task.project_id is None:
            return
        project = await self._projects.get_by_id(task.project_id)
        if (
            project is not None
            and project.is_personal
            and project.created_by != user_id
        ):
            raise ConflictError(
                "Task de projeto pessoal e monouser.",
                details={"task_id": str(task.id)},
            )
