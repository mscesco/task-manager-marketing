"""Casos de uso de colaboracao: responsaveis (assignees) e observadores
(watchers) de uma task -- Entrega 4.

Regras (fontes: specs/004-assignment-watchers e
specs/053-seguir-tarefas-e-notificacoes):
    - assignment reusa os gates de time (TaskScopeGuards, ADR 0010) e NAO
      concede edicao;
    - designado precisa alcancar a task (lente DELE) -> 422 senao;
    - watcher (na tela, "seguidor"): self exige so ver; terceiro exige
      `task.assign` NO TIME DA TAREFA + edicao (Spec 053, §6.1);
    - tarefa ARQUIVADA: seguidores so leitura -> 422 `tarefa_arquivada`
      (Spec 053, D10), inclusive para si mesmo;
    - assigned/unassigned E watched/unwatched entram no history (a ADR 0012
      deixava observador de fora; a Spec 053, D13, revogou essa parte);
    - idempotente: re-adicionar -> no-op; remover inexistente -> 404.

⚠️ O "pessoal e monouser -> 409" que esta lista trazia saiu: o projeto pessoal
nao existe desde 10/09, e nenhum caminho levanta mais esse 409.

Reuso do gate de time: via TaskScopeGuards (helpers extraidos do
TaskService). NAO duplica logica de time.
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

        created=False => no-op idempotente (ja era responsavel), sem
        linha de history. Gates: visivel(404)+editavel(403); pessoal
        monouser(409); designado alcanca a task(422).
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
        """Remove um responsavel. Par inexistente -> 404. Grava `unassigned`.

        ⚠️ RECUSA A REMOCAO DO ULTIMO (ADR 0031). Exigir responsavel so na
        criacao nao fecha nada: e a MESMA porta, do outro lado. A pessoa
        criava com alguem e esvaziava depois, e a tarefa ficava exatamente no
        estado que a ADR existe pra impedir -- viva, sem dono, e (num quadro
        personalizado) sem aparecer em "Minhas tarefas" de ninguem.

        ⚠️ Nao retroage: tarefa que JA esta sem responsavel nao passa por aqui
        (nao ha par a remover -> 404). O passivo de 37 medido em 05/08 so
        encolhe.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)

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
        Idempotente, e o no-op NAO grava historico nem avisa.
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

        ⚠️ SEM conferir alcance do alvo, de proposito: e assim que se tira
        quem ja nao alcanca a tarefa.
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
        """Seguidores escolhidos no modal de CRIAR (Spec 053, D6 e §6.10).

        ATOMICO, na forma de `assign_many_or_fail`: valida TODOS antes de gravar
        qualquer um; havendo quem nao alcance a tarefa, 422 com
        `details.invalid_ids` e a criacao inteira reverte.

        Pedir outra pessoa exige a permissao de por terceiro, uma vez; so a
        propria pessoa nao exige nada alem de ver.
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
        """Tira os seguidores que deixaram de alcancar ESTAS tarefas (D12, §6.8).

        Chamado depois que uma tarefa troca de time (`PATCH team_id`) ou de
        projeto (`POST /move`, que troca o da subarvore inteira).

        ⚠️ SEM AVISO para quem sai: o aviso mostraria o titulo de uma tarefa
        que a pessoa nao pode mais ver. O historico grava `lost_access`.

        ⚠️ RECARREGA as tarefas do banco (`populate_existing`): o `move` troca o
        projeto por SQL cru, e a copia em memoria ainda diria o projeto antigo
        -- a regra de alcance leria o time de antes.

        ⚠️ Responsavel que perde o alcance NAO sai (Spec 053, §8): tira-lo
        esbarra na regra do ultimo responsavel (ADR 0031). Ele so para de
        receber aviso, pela trava do emissor.

        Devolve quantas saidas houve.
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
    async def _gravar_seguidor(
        self, *, task: Task, user_id: uuid.UUID, motivo: MotivoDoSeguidor
    ) -> None:
        """Grava UM seguidor + a linha de historico + o aviso de "colocou voce".

        O caminho unico de entrada como seguidor, para que o gesto na tela e o
        modal de criar nao divirjam no que gravam.
        """
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
        """Seguidores de tarefa arquivada sao so leitura (Spec 053, D10)."""
        if task.is_archived:
            raise ValidationError(
                "Tarefa arquivada: os seguidores não podem mudar.",
                code="tarefa_arquivada",
                details={"task_id": str(task.id)},
            )

    async def _assert_can_manage_others(self, task: Task) -> None:
        """Gate pra mexer em seguidor de TERCEIRO: `task.assign` NO TIME DA
        TAREFA + edicao.

        ⚠️ Era `has_permission` -- "tem em algum time" -- ate a Spec 053 (B).
        Como os quatro papeis tem `task.assign` em algum lugar, a metade
        "ve mas nao tem a permissao -> 403" era inalcancavel; a pergunta no
        time do item (Spec 051) a torna real.
        """
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
