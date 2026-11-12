"""Casos de uso de tasks. Commit e do router (UoW).

Move e soft-delete usam SQL textual com predicado de tenant manual.
"""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
    user_ids_that_can_view_task,
)
from app.modules.tasks.domain.archival import is_terminal
from app.modules.tasks.domain.board_semantics import status_da_coluna
from app.modules.tasks.domain.dates import validate_dates
from app.modules.tasks.domain.history import (
    HistoryEntry,
    build_archived_entry,
    build_created_entry,
    build_deleted_entry,
    build_field_update_entry,
    build_move_entry,
    build_status_change_entry,
    build_unarchived_entry,
)
from app.modules.tasks.infrastructure.attachment_repository import (
    AttachmentRepository,
)
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.tasks.infrastructure.comment_repository import CommentRepository
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

#: `board_id` fora do alcance (separa de "quadro inexistente", tambem 422).
CODIGO_QUADRO_FORA_DE_ALCANCE = "board_fora_de_alcance"

#: Pai e filha ficariam em quadros diferentes. Lido pelo n8n.
CODIGO_PAI_EM_OUTRO_QUADRO = "pai_em_outro_quadro"

#: Time da tarefa fora do time do quadro.
CODIGO_TIME_FORA_DO_QUADRO = "time_fora_do_quadro"


# --------------------------------------------------------
# Commands / DTOs
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateTaskCommand:
    title: str
    project_id: uuid.UUID | None = None  # None = avulsa.
    description: str = ""
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None  # default = subtime do criador.
    # Quadro da tarefa de topo; `None` = Quadro geral. Ignorado em subtarefa
    # (filha herda o quadro do pai).
    board_id: uuid.UUID | None = None
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None
    # Hora do prazo; `None` = "vence no dia".
    due_time: time | None = None
    # Aplicados depois de a tarefa nascer; invalido -> 422 e a criacao reverte.
    assignee_ids: list[uuid.UUID] = field(default_factory=list)
    # Seguidores, tambem atomicos.
    watcher_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class DuplicateTaskCommand:
    """Campos revisados no modal da duplicacao.

    Sem data nem status de proposito: a copia nasce sem prazo (senao dispararia
    TASK_OVERDUE em lote) e em BACKLOG.
    """

    source_id: uuid.UUID
    title: str
    description: str = ""
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    #: `None` = herda o quadro da origem (nao "Quadro geral").
    board_id: uuid.UUID | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    assignee_ids: list[uuid.UUID] = field(default_factory=list)
    include_subtasks: bool = False
    # Responsaveis das SUBTAREFAS (os do pai vem em `assignee_ids`). False cria
    # subtarefas sem responsavel; a tela avisa antes.
    include_assignees: bool = True

    # Passo 2 do modal; chaves sao ids de filhas DIRETAS da origem (neto herda
    # da filha). `subtask_assignees`: escolha explicita, invalido -> 422; lista
    # vazia e recusada (use `skip_subtasks`).
    subtask_assignees: dict[uuid.UUID, list[uuid.UUID]] = field(
        default_factory=dict
    )
    # Filhas diretas que nao vao; a subarvore delas fica junto.
    skip_subtasks: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class DuplicateResult:
    """A copia + responsaveis de subtarefa descartados por nao alcancarem mais
    a tarefa (a tela mostra)."""

    task: Task
    skipped_assignees: list[uuid.UUID]
    # True quando a copia virou tarefa de topo porque o pai esta arquivado.
    promoted_to_root: bool = False


@dataclass(frozen=True, slots=True)
class UpdateTaskCommand:
    """Patch parcial. None = nao mexer, exceto nas datas, onde None limpa;
    `fields_set` distingue omitido de null. Projeto e pai mudam por `move`.
    """

    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    # Hora do prazo; `None` = "vence no dia".
    due_time: time | None = None
    # Exclusivo com `status` (o schema recusa os dois); o status deriva da coluna.
    column_id: uuid.UUID | None = None
    # Nomes dos campos presentes no PATCH (mesmo quando o valor e None).
    fields_set: frozenset[str] = frozenset()


@dataclass(frozen=True, slots=True)
class MoveTaskCommand:
    """Move pra outro pai e/ou projeto; None = nao mexe naquele campo.

    `detach_project=True` torna avulsa (`project_id=None` significa "nao mexe").
    So em task de topo, sem project_id/parent_task_id.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    detach_project: bool = False


@dataclass(frozen=True, slots=True)
class RelocateCommand:
    """Destino de `relocate`.

    Com `parent_task_id`, quadro, time e projeto vem da nova mae, e
    `board_id`/`team_id` sao ignorados. Sem ele, a tarefa vira principal no
    `board_id`; `team_id` so escolhe a lente de subtime no Quadro geral.
    """

    board_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class PessoaQueSai:
    user_id: uuid.UUID
    nome: str
    tarefas: int


@dataclass(frozen=True, slots=True)
class RelocateResult:
    """O que o `relocate` fez -- ou faria, no `dry_run`.

    `task` e `None` no `dry_run`: o savepoint desfeito expira o objeto.
    """

    task: Task | None
    mudou: bool
    subtarefas: int = 0
    projeto_antes: str | None = None
    projeto_depois: str | None = None
    saem: tuple[PessoaQueSai, ...] = ()
    assume: int = 0
    #: (status antes, status depois, quantas tarefas): o quadro de destino sem a
    #: coluna do status muda o status; a previa avisa.
    status_muda: tuple[tuple[TaskStatus, TaskStatus, int], ...] = ()


@dataclass(frozen=True, slots=True)
class TaskFilters:
    """Filtros suportados em GET /tasks."""

    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    root_only: bool = False
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    #: Este time e os descendentes, pelo time efetivo da tarefa (projeto, ou a
    #: propria se avulsa). Diferente de `team_id`, que casa por igualdade.
    under_team_id: uuid.UUID | None = None
    include_archived: bool = False
    archived_only: bool = False
    created_by: uuid.UUID | None = None
    #: Busca por titulo, casando tambem descendentes e devolvendo a raiz.
    q: str | None = None


@dataclass(frozen=True, slots=True)
class SoftDeleteResult:
    task: Task
    cascade_count: int


@dataclass(frozen=True, slots=True)
class ArchiveResult:
    """Resultado de archive/unarchive. `cascade_count` = descendentes que
    mudaram junto (a tela avisa)."""

    task: Task
    cascade_count: int


# --------------------------------------------------------
# Service
# --------------------------------------------------------
class TaskService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = TaskRepository(session)
        self._projects = ProjectRepository(session)
        self._guards = TaskScopeGuards(session)
        self._comments = CommentRepository(session)

    # ----------------------------------------------------
    # CRUD (publico)
    # ----------------------------------------------------
    async def _time_do_quadro_alvo(
        self, board_id: uuid.UUID | None
    ) -> uuid.UUID | None:
        """Time da tarefa quando ninguem informou: o dono do quadro pedido, ou o
        unico time raiz do workspace.

        Com mais de um time raiz e sem quadro, recusa em vez de escolher.
        `None` quando o quadro nao existe ou nao ha raiz.
        """
        if board_id is not None:
            await self._assert_board_in_reach(board_id)
            dono = await BoardRepository(self._session).dono_do_quadro(board_id)
            return dono[0] if dono is not None else None

        roots = await TeamRepository(self._session).root_team_ids()
        if len(roots) == 1:
            return roots[0]
        if not roots:
            # Sem time raiz: vira o 422 generico de quem chama.
            return None
        raise ValidationError(
            "Este workspace tem mais de um time raiz: diga em qual a tarefa "
            "nasce, informando `team_id` ou `board_id`.",
            details={"field": "team_id", "root_team_ids": [str(r) for r in roots]},
        )

    async def _assert_time_do_quadro(
        self, *, board_id: uuid.UUID, team_id: uuid.UUID
    ) -> None:
        """Em quadro avulso, o time da tarefa e o do quadro; no Quadro geral, o
        time e livre dentro da mesma raiz (tarefa interna de subtime).

        Alcance (`_assert_board_in_reach`) nao cobre isso: quem alcanca o quadro
        pode mandar `team_id` de outro time pela API.
        """
        dono = await BoardRepository(self._session).dono_do_quadro(board_id)
        # `None` = quadro inexistente; quem chama ja recusou ou a FK garante.
        if dono is None:
            return
        time_do_quadro, eh_padrao = dono
        if eh_padrao:
            arvore = require_tenant().team_tree
            if team_scope.root_of(team_id, arvore) != team_scope.root_of(
                time_do_quadro, arvore
            ):
                raise ValidationError(
                    "Este quadro e de outro time. O time da tarefa tem de ser "
                    "o time do quadro ou um subtime dele.",
                    code=CODIGO_TIME_FORA_DO_QUADRO,
                    details={
                        "field": "team_id",
                        "team_id": str(team_id),
                        "board_team_id": str(time_do_quadro),
                    },
                )
            return
        if team_id != time_do_quadro:
            raise ValidationError(
                "Esta tarefa esta num quadro de outro time. Uma tarefa em "
                "quadro proprio pertence ao time daquele quadro.",
                code=CODIGO_TIME_FORA_DO_QUADRO,
                details={
                    "field": "team_id",
                    "team_id": str(team_id),
                    "board_team_id": str(time_do_quadro),
                },
            )

    async def _assert_board_in_reach(self, board_id: uuid.UUID) -> None:
        """`board_id` vindo do cliente tem de estar na lente de quem escreve.

        Mesma lente do `GET /boards` (`list_visible`). 422, nao 404: e campo do
        corpo.
        """
        alcancaveis = {
            quadro.id
            for quadro, _ in await BoardRepository(self._session).list_visible()
        }
        if board_id not in alcancaveis:
            raise ValidationError(
                "Quadro fora do seu alcance.",
                code=CODIGO_QUADRO_FORA_DE_ALCANCE,
                details={"field": "board_id", "board_id": str(board_id)},
            )

    @staticmethod
    def _assert_team_in_reach(team_id: uuid.UUID) -> None:
        """`team_id` vindo do cliente tem de estar na lente de quem escreve.

        Usado em `create` e `update`. Lente `None` (organizacao) = sem filtro de
        time; a arvore ja e do tenant corrente.
        """
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,)
        if visible is not None and team_id not in visible:
            raise ValidationError(
                "Time informado esta fora do seu alcance.",
                details={"field": "team_id"},
            )

    async def create(self, command: CreateTaskCommand) -> Task:
        """Cria task. 1 linha em task_history (CREATED)."""
        title = command.title.strip()
        if not title:
            raise ValidationError(
                "Titulo da task nao pode ser vazio.",
                details={"field": "title"},
            )
        self._validate_dates(command.start_date, command.due_date)
        self._validate_hora(command.due_date, command.due_time)

        tenant = require_tenant()

        # Pai carregado antes de resolver o time: a subtarefa herda o time dele.
        parent: Task | None = None
        if command.parent_task_id is not None:
            parent = await self._repo.get_by_id_or_raise(command.parent_task_id)
            # Trava a mae para leitura: um mover em andamento termina antes, e a
            # filha nasce com path, quadro e time de depois.
            await self._session.execute(
                select(Task)
                .where(Task.id == parent.id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
            await self._assert_visible_via_project(parent)
            # Pai arquivado nao ganha filha: nenhuma tela a mostraria.
            if parent.is_archived:
                raise ValidationError(
                    "A tarefa pai esta arquivada. Desarquive-a antes.",
                    details={"field": "parent_task_id"},
                )
            if parent.project_id != command.project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )

        # Time, por precedencia: explicito; do pai; do quadro onde vai nascer.
        team_id = (
            command.team_id
            or (parent.team_id if parent is not None else None)
            # Sem `org_role`: resolver o time de tarefa nova nao e lente.
            or await self._time_do_quadro_alvo(command.board_id)
        )
        if team_id is None:
            raise ValidationError(
                "Task precisa de um time: informe `team_id` ou um `board_id` "
                "que exista.",
                details={"field": "team_id"},
            )

        # So o `team_id` explicito passa pela lente; o herdado nao foi escolhido
        # por quem chama.
        if command.team_id is not None:
            self._assert_team_in_reach(command.team_id)

        project: Project | None = None
        if command.project_id is not None:
            project = await self._projects.get_by_id_or_raise(command.project_id)
            self._assert_time_no_projeto(project, team_id)

        # Toda tarefa nasce com responsavel; nao vale no PATCH de outros campos.
        if not command.assignee_ids:
            raise ValidationError(
                "Toda tarefa precisa de pelo menos um responsável.",
                details={"field": "assignee_ids"},
            )

        task_id = uuid.uuid4()
        label = self._label_for(task_id)
        path, depth = self._compute_path_and_depth(parent, label)

        task = Task(
            id=task_id,
            title=title,
            description=command.description,
            project_id=command.project_id,
            parent_task_id=command.parent_task_id,
            team_id=team_id,
            status=command.status,
            priority=command.priority,
            start_date=command.start_date,
            due_date=command.due_date,
            due_time=command.due_time,
            created_by=tenant.user_id,
            path=path,
            depth=depth,
        )
        if command.status == TaskStatus.COMPLETED:
            task.completed_at = datetime.now(UTC)  # type: ignore[assignment]

        # Relogio do arquivamento.
        if is_terminal(command.status):
            task.terminal_since = datetime.now(UTC)  # type: ignore[assignment]

        # A coluna vem do status, resolvida antes do `add` (colunas NOT NULL).
        # Subtarefa herda o quadro do pai.
        if parent is not None:
            # Mesma trava do quadro pedido: com `team_id` explicito, a filha
            # poderia cair num quadro avulso de outro time.
            await self._assert_time_do_quadro(board_id=parent.board_id, team_id=team_id)
            task.board_id = parent.board_id
            # O status volta da coluna: num quadro de quatro colunas, o status
            # pedido pode cair na coluna de outra semantica.
            task.column_id, task.status = await BoardRepository(
                self._session
            ).coluna_para_status(
                board_id=parent.board_id, status=command.status
            )
        elif command.board_id is not None:
            # Quadro pedido: so o quadro avulso recebe tarefa por aqui.
            await self._assert_board_in_reach(command.board_id)
            # Alcance nao e propriedade: tambem confere se o time e o do quadro.
            await self._assert_time_do_quadro(
                board_id=command.board_id, team_id=team_id
            )
            task.board_id = command.board_id
            task.column_id, task.status = await BoardRepository(
                self._session
            ).coluna_para_status(
                board_id=command.board_id, status=command.status
            )
        else:
            # O quadro geral e o do time raiz do `team_id` ja resolvido (que pode
            # ser subtime; a tarefa continua com o time dela).
            root_team_id = await TeamRepository(self._session).root_team_id_of(team_id)
            if root_team_id is None:
                raise ValidationError(
                    "Nao consegui identificar o time raiz desta tarefa.",
                    details={"field": "team_id", "team_id": str(team_id)},
                )
            quadros = BoardRepository(self._session)
            task.board_id, _ = await quadros.default_board_and_column_for_status(
                command.status, root_team_id=root_team_id
            )
            task.column_id, task.status = await quadros.coluna_para_status(
                board_id=task.board_id, status=command.status
            )

        self._repo.add(task)
        await self._session.flush()

        entry = build_created_entry(
            title=title,
            project_id=command.project_id,
            parent_task_id=command.parent_task_id,
        )
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        logger.info(
            "task.created",
            task_id=str(task.id),
            project_id=str(task.project_id),
            title=task.title,
        )

        # Responsaveis so depois do flush (os gates precisam da tarefa
        # persistida). Invalido -> 422 e, sem commit, a criacao inteira reverte.
        if command.assignee_ids:
            # Import local: evita ciclo de import no nivel de modulo.
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            await CollaborationService(self._session).assign_many_or_fail(
                task=task, user_ids=command.assignee_ids
            )

        if command.watcher_ids:
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            await CollaborationService(self._session).watch_many_or_fail(
                task=task, user_ids=command.watcher_ids
            )

        return task

    async def duplicate(self, command: DuplicateTaskCommand) -> DuplicateResult:
        """Duplica uma task como sequencia de `create()`, nunca copia de linha.

        Copia de linha pularia path, depth, time, projeto e historico. Sem
        commit aqui: a arvore inteira persiste ou nada. Os responsaveis do pai
        vao crus (invalido -> 422); os das filhas, ver `_copiar_subarvore`.
        """
        source = await self._repo.get_by_id_or_raise(command.source_id)
        # 404, nao 403: nao revela que a origem existe.
        await self._assert_visible_via_project(source)

        # Pai arquivado: a copia sairia sob ele e nenhuma tela a mostraria.
        # Vira tarefa de topo, e `promoted_to_root` avisa a tela.
        pai_alvo = command.parent_task_id
        promovida = False
        if pai_alvo is not None:
            pai = await self._repo.get_by_id_or_raise(pai_alvo)
            if pai.is_archived:
                pai_alvo = None
                promovida = True

        # Quadro da copia: o da origem, salvo pedido explicito. Subtarefa
        # ignora e herda o do pai.
        quadro_alvo = (
            command.board_id if command.board_id is not None else source.board_id
        )

        novo = await self.create(
            CreateTaskCommand(
                title=command.title,
                description=command.description,
                project_id=command.project_id,
                parent_task_id=pai_alvo,
                team_id=command.team_id,
                board_id=quadro_alvo,
                priority=command.priority,
                assignee_ids=command.assignee_ids,
            )
        )

        await AttachmentRepository(self._session).copy_task_links(
            from_task_id=source.id, to_task_id=novo.id
        )

        pulados: list[uuid.UUID] = []
        if command.include_subtasks:
            await self._validar_mapa_de_subtarefas(command, source)
            await self._copiar_subarvore(
                origem=source,
                destino=novo,
                pulados=pulados,
                levar_responsaveis=command.include_assignees,
                responsaveis_por_filha=command.subtask_assignees,
                pular=frozenset(command.skip_subtasks),
            )
        elif command.subtask_assignees or command.skip_subtasks:
            # Incoerencia do chamador; aceitar esconderia um erro na tela.
            raise ValidationError(
                "Decisões sobre subtarefas exigem include_subtasks=true.",
                details={"field": "include_subtasks"},
            )

        logger.info(
            "task.duplicated",
            source_id=str(source.id),
            task_id=str(novo.id),
            include_subtasks=command.include_subtasks,
            include_assignees=command.include_assignees,
            skipped_assignees=len(pulados),
            promoted_to_root=promovida,
        )
        return DuplicateResult(
            task=novo, skipped_assignees=pulados, promoted_to_root=promovida
        )

    async def _copiar_subarvore(
        self,
        *,
        origem: Task,
        destino: Task,
        pulados: list[uuid.UUID],
        levar_responsaveis: bool,
        responsaveis_por_filha: dict[uuid.UUID, list[uuid.UUID]] | None = None,
        pular: frozenset[uuid.UUID] = frozenset(),
        forcados: list[uuid.UUID] | None = None,
    ) -> None:
        """Copia os filhos de `origem` sob `destino`, recursivamente.

        Filhas sem prefixo "Copia de" e sem `team_id` explicito (herdam o time
        do pai novo).
        """
        escolhas = responsaveis_por_filha or {}
        filhos = await self._repo.list_children(parent_task_id=origem.id)
        for filho in filhos:
            if filho.id in pular:
                continue  # pula a subarvore dela junto
            # Responsaveis decididos antes do `create` (a filha ja nasce com
            # eles), com alcance medido contra `destino`. Precedencia: escolha
            # do passo 2 > herdado da mae > responsaveis da origem que alcancam.
            escolhidos = escolhas.get(filho.id, forcados)
            if escolhidos is None and levar_responsaveis:
                escolhidos = await self._herdados_da_filha(
                    origem=filho, destino=destino, pulados=pulados
                )
            if not escolhidos:
                raise ValidationError(
                    f"A subtarefa \"{filho.title}\" ficaria sem responsável "
                    "na cópia. Escolha quem vai fazer, ou não a leve junto.",
                    details={
                        "field": "subtask_assignees",
                        "subtask_id": str(filho.id),
                    },
                )
            copia = await self.create(
                CreateTaskCommand(
                    title=filho.title,
                    description=filho.description,
                    project_id=destino.project_id,
                    parent_task_id=destino.id,
                    priority=filho.priority,
                    assignee_ids=escolhidos,
                )
            )
            await AttachmentRepository(self._session).copy_task_links(
                from_task_id=filho.id, to_task_id=copia.id
            )
            await self._copiar_subarvore(
                origem=filho,
                destino=copia,
                pulados=pulados,
                levar_responsaveis=levar_responsaveis,
                # Mapa e exclusao valem so no primeiro nivel; o neto herda
                # `forcados` da mae.
                responsaveis_por_filha=None,
                pular=frozenset(),
                forcados=escolhidos,
            )

    async def _validar_mapa_de_subtarefas(
        self, command: DuplicateTaskCommand, source: Task
    ) -> None:
        """Chaves do passo 2: filhas diretas da origem, com lista nao vazia.

        Chave desconhecida ou lista vazia nao passa calada: a filha nasceria
        sem o responsavel que a pessoa escolheu.
        """
        if not command.subtask_assignees and not command.skip_subtasks:
            return

        filhas = await self._repo.list_children(parent_task_id=source.id)
        diretas = {f.id for f in filhas}

        desconhecidas = (
            set(command.subtask_assignees) | set(command.skip_subtasks)
        ) - diretas
        if desconhecidas:
            raise ValidationError(
                "Há decisões apontando para subtarefas que não são filhas "
                "diretas desta tarefa.",
                details={
                    "field": "subtask_assignees",
                    "invalid_ids": sorted(str(i) for i in desconhecidas),
                },
            )

        vazias = [
            str(sid)
            for sid, ids in command.subtask_assignees.items()
            if not ids
        ]
        if vazias:
            raise ValidationError(
                "Toda subtarefa copiada precisa de pelo menos um "
                "responsável. Para não levá-la, use 'não levar esta'.",
                details={"field": "subtask_assignees", "invalid_ids": vazias},
            )

    async def _herdados_da_filha(
        self, *, origem: Task, destino: Task, pulados: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """Responsaveis da subtarefa que alcancam `destino` (o pai da copia).

        Os descartados vao para `pulados` (a tela avisa). Lista vazia e valida;
        o chamador a transforma em 422.
        """
        from app.modules.tasks.application.collaboration_service import (
            CollaborationService,
        )

        colaboracao = CollaborationService(self._session)
        ids = await colaboracao.assignee_ids_for(origem)
        if not ids:
            return []

        validos: list[uuid.UUID] = []
        for uid in ids:
            if await user_can_view_task(
                self._session, task=destino, user_id=uid
            ):
                validos.append(uid)
            elif uid not in pulados:
                pulados.append(uid)
        return validos

    async def get(self, task_id: uuid.UUID) -> Task:
        """Get com privacidade do pessoal (404 em pessoal alheio)."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        return task

    async def list_page(
        self, params: PageParams, filters: TaskFilters
    ) -> Page[Task]:
        """Listagem paginada com filtros + privacidade do pessoal."""
        return await self._repo.list_page_with_filters(
            params,
            project_id=filters.project_id,
            parent_task_id=filters.parent_task_id,
            root_only=filters.root_only,
            status=filters.status,
            priority=filters.priority,
            team_id=filters.team_id,
            under_team_id=filters.under_team_id,
            created_by=filters.created_by,
            include_archived=filters.include_archived,
            archived_only=filters.archived_only,
            q=filters.q,
        )

    async def update(
        self, *, task_id: uuid.UUID, command: UpdateTaskCommand
    ) -> Task:
        """Patch parcial; 1 linha de history por campo alterado."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        # Escrita por `column_id`: a coluna e a fonte e o status deriva dela.
        # `coluna_no_quadro` valida que a coluna e do quadro da tarefa (senao
        # a FK composta daria 500).
        coluna_alvo: uuid.UUID | None = None
        if command.column_id is not None:
            ponte, semantica = await BoardRepository(
                self._session
            ).coluna_no_quadro(
                board_id=task.board_id, column_id=command.column_id
            )
            coluna_alvo = command.column_id
            command = replace(
                command,
                status=status_da_coluna(
                    legacy_status=ponte, semantic=semantica
                ),
            )
        elif command.status is not None and command.status != task.status:
            # Status efetivo antes do diff: num quadro de quatro colunas o
            # status pedido pode virar outro, e o historico tem de mostrar o real.
            coluna, efetivo = await BoardRepository(self._session).coluna_para_status(
                board_id=task.board_id, status=command.status
            )
            coluna_alvo = coluna
            command = replace(command, status=efetivo)

        # Antes de mutar: o diff le o estado antigo.
        entries = self._diff_for_update(task, command)

        # A coluna gera historico proprio (mover entre colunas de mesmo status).
        # Calculado aqui porque `task.column_id` ainda e o velho.
        if coluna_alvo is not None and coluna_alvo != task.column_id:
            entries.append(
                build_field_update_entry(
                    field_name="column_id",
                    old=task.column_id,
                    new=coluna_alvo,
                )
            )

        if command.title is not None:
            title = command.title.strip()
            if not title:
                raise ValidationError(
                    "Titulo da task nao pode ser vazio.",
                    details={"field": "title"},
                )
            task.title = title

        if command.description is not None:
            task.description = command.description

        if command.priority is not None:
            task.priority = command.priority

        if command.team_id is not None:
            self._assert_team_in_reach(command.team_id)
            # Recusa em vez de mover a tarefa de quadro por baixo do PATCH.
            await self._assert_time_do_quadro(
                board_id=task.board_id, team_id=command.team_id
            )
            if task.project_id is not None:
                projeto = await self._projects.get_by_id_or_raise(task.project_id)
                self._assert_time_no_projeto(projeto, command.team_id)
            trocou_de_time = task.team_id != command.team_id
            # Com subtarefa (inclusive arquivada) nao troca: as filhas ficariam
            # no time antigo. Recusar e mais simples que cascatear as travas.
            if trocou_de_time and await self._repo.list_children(
                parent_task_id=task.id, include_archived=True
            ):
                raise ValidationError(
                    "Esta tarefa tem subtarefas, inclusive arquivadas, e nao "
                    "troca de time. Mova as subtarefas antes.",
                    details={"field": "team_id"},
                )
            task.team_id = command.team_id

        virou_concluido = False
        if command.status is not None and command.status != task.status:
            if command.status == TaskStatus.COMPLETED:
                task.completed_at = datetime.now(UTC) # type: ignore[assignment]
                virou_concluido = True
            elif task.status == TaskStatus.COMPLETED:
                task.completed_at = None

            # Relogio do arquivamento. Entrar em terminal sempre regrava
            # (inclusive COMPLETED -> CANCELLED). Le `task.status` velho: a
            # atribuicao `task.status = ...` tem de ficar abaixo.
            if is_terminal(command.status):
                task.terminal_since = datetime.now(UTC)  # type: ignore[assignment]
            elif is_terminal(task.status):
                task.terminal_since = None

            # A coluna acompanha o status so quando a escrita veio por `status`,
            # procurada no quadro da propria tarefa; `board_id` nao muda.
            if coluna_alvo is None:
                # Grava o status efetivo, nao o pedido (podem diferir).
                task.column_id, status_efetivo = await BoardRepository(
                    self._session
                ).coluna_para_status(
                    board_id=task.board_id, status=command.status
                )
            else:
                status_efetivo = command.status

            task.status = status_efetivo

        # Gravacao por coluna fora do `if` de status: duas colunas de mesma
        # semantica derivam o mesmo status, e o bloco acima nao rodaria.
        if coluna_alvo is not None:
            task.column_id = coluna_alvo

        # Datas sao nullable: presenca no PATCH manda (None = limpar).
        if "start_date" in command.fields_set:
            task.start_date = command.start_date
        if "due_date" in command.fields_set:
            task.due_date = command.due_date
        if "due_time" in command.fields_set:
            task.due_time = command.due_time

        self._validate_dates(task.start_date, task.due_date)
        # Sobre o estado resultante: apagar so `due_date` nao deixa hora orfa.
        self._validate_hora(task.due_date, task.due_time)

        if entries:
            tenant = require_tenant()
            await self._repo.write_history(
                task=task, user_id=tenant.user_id, entries=entries
            )

        # Concluir o pai conclui a subarvore (so na transicao, sem history por
        # subtarefa).
        if virou_concluido:
            await self._repo.complete_descendants(task=task)

        await self._session.flush()

        # Quem seguia e deixou de alcancar sai.
        if command.team_id is not None and trocou_de_time:
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            await CollaborationService(
                self._session
            ).remove_watchers_without_reach(task_ids=[task.id])
        logger.info(
            "task.updated",
            task_id=str(task.id),
            changes=len(entries),
        )
        return task

    async def move(
        self, *, task_id: uuid.UUID, command: MoveTaskCommand
    ) -> Task:
        """Move pra novo pai e/ou projeto. No-op silencioso se nada muda."""
        if (
            command.parent_task_id is None
            and command.project_id is None
            and not command.detach_project
        ):
            task = await self._repo.get_by_id_or_raise(task_id)
            await self._assert_visible_via_project(task)
            return task

        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        if command.detach_project:
            if command.project_id is not None or command.parent_task_id is not None:
                raise ValidationError(
                    "detach_project nao combina com project_id ou parent_task_id.",
                    details={"field": "detach_project"},
                )
            if task.parent_task_id is not None:
                raise ValidationError(
                    "Subtarefa nao vira avulsa; mova o pai.",
                    details={"field": "detach_project"},
                )

        if command.detach_project:
            new_project_id: uuid.UUID | None = None
            new_parent_task_id: uuid.UUID | None = None
        else:
            new_project_id = command.project_id or task.project_id
            new_parent_task_id = (
                command.parent_task_id
                if command.parent_task_id is not None
                else task.parent_task_id
            )

        if (
            new_project_id == task.project_id
            and new_parent_task_id == task.parent_task_id
        ):
            return task

        if new_parent_task_id == task.id:
            raise BusinessRuleError(
                "Task nao pode ser pai de si mesma.",
                details={"task_id": str(task.id)},
            )

        if new_project_id is not None and new_project_id != task.project_id:
            novo_projeto = await self._projects.get_by_id_or_raise(new_project_id)
            # Toda a subarvore tem de caber no projeto novo, para quem ve (pelo
            # projeto) e quem edita (pelo time) continuarem os mesmos.
            for team_id in await self._repo.subtree_team_ids(task):
                self._assert_time_no_projeto(novo_projeto, team_id)

        new_parent: Task | None = None
        if new_parent_task_id is not None:
            new_parent = await self._repo.get_by_id_or_raise(new_parent_task_id)
            await self._assert_visible_via_project(new_parent)
            if new_parent.is_archived:
                raise ValidationError(
                    "A tarefa pai esta arquivada. Desarquive-a antes.",
                    details={"field": "parent_task_id"},
                )
            if new_parent.project_id != new_project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )
            # Pai e filha vivem no mesmo quadro. A FK composta aceitaria o par,
            # entao a recusa e aqui; mover entre quadros e o `relocate`.
            if new_parent.board_id != task.board_id:
                raise ValidationError(
                    "A tarefa pai esta em outro quadro. Uma subtarefa vive no "
                    "mesmo quadro do pai -- mova a tarefa de topo inteira.",
                    code=CODIGO_PAI_EM_OUTRO_QUADRO,
                    details={
                        "field": "parent_task_id",
                        "board_id": str(task.board_id),
                        "parent_board_id": str(new_parent.board_id),
                    },
                )
            # Trava as duas linhas, em ordem de id, antes de conferir o ciclo:
            # dois moves cruzados gravariam um ciclo no `ltree`.
            # `populate_existing` recarrega o `path` atualizado.
            await self._session.execute(
                select(Task)
                .where(
                    Task.id.in_((task.id, new_parent.id)),
                    Task.workspace_id == task.workspace_id,
                )
                .order_by(Task.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if await self._repo.detect_cycle(
                task=task, new_parent_id=new_parent_task_id
            ):
                raise BusinessRuleError(
                    "Move criaria ciclo na hierarquia.",
                    details={
                        "task_id": str(task.id),
                        "new_parent_task_id": str(new_parent_task_id),
                    },
                )

        old_project_id = task.project_id
        old_parent_task_id = task.parent_task_id
        old_path = task.path
        old_depth = task.depth

        # Ids da subarvore antes do reparent (o `path` muda, os ids nao).
        trocou_de_projeto = old_project_id != new_project_id
        subarvore = (
            await self._repo.ids_da_subarvore(path=old_path)
            if trocou_de_projeto
            else []
        )

        await self._repo.reparent_subtree(
            task=task,
            old_path=old_path,
            old_depth=old_depth,
            new_parent_path=new_parent.path if new_parent else None,
            new_parent_depth=new_parent.depth if new_parent else None,
            new_parent_task_id=new_parent_task_id,
            new_project_id=new_project_id,
        )

        tenant = require_tenant()
        entry = build_move_entry(
            old_project_id=old_project_id,
            new_project_id=new_project_id,
            old_parent_task_id=old_parent_task_id,
            new_parent_task_id=new_parent_task_id,
        )
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        # Trocar o projeto muda quem ve a subarvore: seguidor sem alcance sai.
        if subarvore:
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            await CollaborationService(
                self._session
            ).remove_watchers_without_reach(task_ids=subarvore)

        logger.info(
            "task.moved",
            task_id=str(task.id),
            old_project_id=str(old_project_id),
            new_project_id=str(new_project_id),
        )
        return task

    async def relocate(
        self, *, task_id: uuid.UUID, command: RelocateCommand, dry_run: bool
    ) -> RelocateResult:
        """Move a tarefa, com a subarvore, para outro quadro e/ou outra mae.

        O `dry_run` roda a operacao num savepoint e desfaz, para a previa sair
        do mesmo codigo que grava. Avisos so fora do `dry_run`.
        """
        if not dry_run:
            return await self._relocate(task_id=task_id, command=command, avisar=True)
        async with self._session.begin_nested() as savepoint:
            resultado = await self._relocate(
                task_id=task_id, command=command, avisar=False
            )
            await savepoint.rollback()
        return replace(resultado, task=None)

    async def _relocate(
        self, *, task_id: uuid.UUID, command: RelocateCommand, avisar: bool
    ) -> RelocateResult:
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)
        # Trava tarefa e mae antes de ler path e estado: um movimento cruzado
        # deixaria path velho e o `detect_cycle` aceitaria um ciclo.
        # `populate_existing` rele as linhas travadas.
        await self._session.execute(
            select(Task)
            .where(
                Task.id.in_({task.id, command.parent_task_id} - {None}),
                Task.workspace_id == task.workspace_id,
            )
            .order_by(Task.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if task.is_archived:
            raise ValidationError(
                "Esta tarefa esta arquivada. Desarquive-a antes de mover.",
                details={"field": "task_id"},
            )

        # --- o destino: quadro, time, projeto e mae -------------------------
        mae: Task | None = None
        if command.parent_task_id is not None:
            if command.parent_task_id == task.id:
                raise ValidationError(
                    "A tarefa nao pode ir para dentro dela mesma.",
                    details={"field": "parent_task_id"},
                )
            mae = await self._repo.get_by_id_or_raise(command.parent_task_id)
            await self._assert_visible_via_project(mae)
            if mae.is_archived:
                raise ValidationError(
                    "A tarefa de destino esta arquivada. Desarquive-a antes.",
                    details={"field": "parent_task_id"},
                )
            if await self._repo.detect_cycle(task=task, new_parent_id=mae.id):
                raise ValidationError(
                    "A tarefa nao pode ir para dentro de uma das proprias "
                    "subtarefas.",
                    details={"field": "parent_task_id"},
                )
            board_id, team_id, project_id = mae.board_id, mae.team_id, mae.project_id
        else:
            if command.board_id is None:
                raise ValidationError(
                    "Diga para qual quadro a tarefa vai.",
                    details={"field": "board_id"},
                )
            await self._assert_board_in_reach(command.board_id)
            dono = await BoardRepository(self._session).dono_do_quadro(
                command.board_id
            )
            if dono is None:  # o `_assert_board_in_reach` ja recusou antes
                raise ValidationError(
                    "Quadro inexistente.", details={"field": "board_id"}
                )
            board_id = command.board_id
            team_id = command.team_id or dono[0]
            await self._assert_time_do_quadro(board_id=board_id, team_id=team_id)
            project_id = task.project_id
            if project_id is not None:
                projeto = await self._projects.get_by_id_or_raise(project_id)
                if not self._time_cabe_no_projeto(projeto, team_id):
                    project_id = None
        # Criar no destino: a mesma lente do `create`.
        self._assert_team_in_reach(team_id)

        mae_id = mae.id if mae is not None else None
        if (
            board_id == task.board_id
            and team_id == task.team_id
            and mae_id == task.parent_task_id
            and project_id == task.project_id
        ):
            return RelocateResult(task=task, mudou=False)

        tenant = require_tenant()
        antes = {
            "board_id": task.board_id,
            "team_id": task.team_id,
            "project_id": task.project_id,
            "parent_task_id": task.parent_task_id,
        }
        # Trava a subarvore antes de listar: subtarefa criada agora ficaria
        # fora da lista, com o quadro antigo.
        await self._repo.travar_subarvore(path=task.path)
        ids = await self._repo.ids_da_subarvore(path=task.path)
        # Editar a origem vale para a subarvore inteira (filha de outro subtime).
        conferidos: set[tuple[uuid.UUID | None, uuid.UUID | None]] = set()
        for t in (
            await self._session.execute(select(Task).where(Task.id.in_(ids)))
        ).scalars():
            if (t.team_id, t.project_id) not in conferidos:
                conferidos.add((t.team_id, t.project_id))
                await self._assert_editable(t)

        # --- path, mae e projeto da subarvore inteira -----------------------
        await self._repo.reparent_subtree(
            task=task,
            old_path=task.path,
            old_depth=task.depth,
            new_parent_path=mae.path if mae is not None else None,
            new_parent_depth=mae.depth if mae is not None else None,
            new_parent_task_id=mae_id,
            new_project_id=project_id,
        )

        # --- quadro, time e coluna: tudo vira o do destino ------------------
        # A coluna e a do mesmo status no quadro novo (mesmos degraus do create).
        tarefas = (
            await self._session.execute(
                select(Task)
                .where(Task.id.in_(ids))
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        colunas: dict[TaskStatus, tuple[uuid.UUID, TaskStatus]] = {}
        quadros = BoardRepository(self._session)
        status_muda: Counter[tuple[TaskStatus, TaskStatus]] = Counter()
        for t in tarefas:
            if t.status not in colunas:
                colunas[t.status] = await quadros.coluna_para_status(
                    board_id=board_id, status=t.status
                )
            antes_status = t.status
            t.column_id, t.status = colunas[t.status]
            if t.status != antes_status:
                status_muda[(antes_status, t.status)] += 1
            t.board_id = board_id
            t.team_id = team_id
        await self._session.flush()

        # --- pessoas ---------------------------------------------------------
        saem, assume = await self._tirar_quem_nao_alcanca(
            raiz=task, ids=ids, avisar=avisar
        )

        # Uma linha so, na raiz, com `cascade_count`.
        entrada = build_move_entry(
            old_project_id=antes["project_id"],
            new_project_id=project_id,
            old_parent_task_id=antes["parent_task_id"],
            new_parent_task_id=mae_id,
        )
        entrada.metadata.update(
            old_board_id=str(antes["board_id"]),
            new_board_id=str(board_id),
            old_team_id=str(antes["team_id"]),
            new_team_id=str(team_id),
            cascade_count=len(ids) - 1,
        )
        if status_muda:
            entrada.metadata["status_changes"] = [
                {"from": de.value, "to": para.value, "count": n}
                for (de, para), n in status_muda.items()
            ]
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entrada]
        )
        await self._session.flush()

        titulos = {}
        for pid in {antes["project_id"], project_id} - {None}:
            p = await self._projects.get_by_id(pid)
            if p is not None:
                titulos[pid] = p.title
        # So o movimento de verdade: a previa roda este mesmo codigo.
        if avisar:
            logger.info(
                "task.relocated",
                task_id=str(task.id),
                board_id=str(board_id),
                team_id=str(team_id),
                parent_task_id=str(mae_id),
                subtarefas=len(ids) - 1,
                saem=len(saem),
                assume=assume,
            )
        return RelocateResult(
            task=task,
            mudou=True,
            subtarefas=len(ids) - 1,
            projeto_antes=titulos.get(antes["project_id"]),
            projeto_depois=titulos.get(project_id),
            saem=tuple(saem),
            assume=assume,
            status_muda=tuple((de, para, n) for (de, para), n in status_muda.items()),
        )

    async def _tirar_quem_nao_alcanca(
        self, *, raiz: Task, ids: list[uuid.UUID], avisar: bool
    ) -> tuple[list[PessoaQueSai], int]:
        """Quem nao enxerga o destino sai, com aviso; tarefa que ficaria sem
        responsavel ganha quem moveu.

        Alcance medido so na raiz: a subarvore inteira tem o mesmo time e projeto.
        """
        from app.db.models import User
        from app.modules.notifications.application.notification_emitter import (
            NotificationEmitter,
        )
        from app.modules.tasks.domain.history import (
            MotivoDoSeguidor,
            build_assigned_entry,
            build_unassigned_entry,
            build_unwatched_entry,
        )
        from app.modules.tasks.infrastructure.collaboration_repository import (
            TaskAssignmentRepository,
            TaskWatcherRepository,
        )

        tenant = require_tenant()
        responsaveis_repo = TaskAssignmentRepository(self._session)
        responsaveis = await responsaveis_repo.list_user_ids_for_tasks(ids)
        seguidores = await TaskWatcherRepository(
            self._session
        ).list_user_ids_for_tasks(ids)
        pessoas = {u for lista in responsaveis.values() for u in lista} | {
            u for lista in seguidores.values() for u in lista
        }
        alcancam = await user_ids_that_can_view_task(
            self._session, task=raiz, user_ids=list(pessoas)
        )
        perdem = pessoas - alcancam
        if not perdem:
            return [], 0

        por_tarefa = {t.id: t for t in (
            await self._session.execute(select(Task).where(Task.id.in_(ids)))
        ).scalars()}
        contagem: dict[uuid.UUID, int] = {}
        for uid in perdem:
            _, seguia_em = await self._repo.apagar_relacoes(user_id=uid, task_ids=ids)
            era_responsavel = [tid for tid in ids if uid in responsaveis.get(tid, [])]
            for tid in era_responsavel:
                await self._repo.write_history(
                    task=por_tarefa[tid],
                    user_id=tenant.user_id,
                    entries=[build_unassigned_entry(user_id=uid)],
                )
            for tid in seguia_em:
                await self._repo.write_history(
                    task=por_tarefa[tid],
                    user_id=tenant.user_id,
                    entries=[
                        build_unwatched_entry(
                            user_id=uid,
                            by=tenant.user_id,
                            reason=MotivoDoSeguidor.LOST_ACCESS,
                        )
                    ],
                )
            contagem[uid] = len(set(era_responsavel) | set(seguia_em))

        # Quem moveu alcanca o destino (so move para onde cria).
        assume = 0
        for tid in ids:
            antes = responsaveis.get(tid, [])
            if antes and all(u in perdem for u in antes):
                responsaveis_repo.add(
                    task_id=tid, user_id=tenant.user_id, assigned_by=tenant.user_id
                )
                await self._repo.write_history(
                    task=por_tarefa[tid],
                    user_id=tenant.user_id,
                    entries=[
                        build_assigned_entry(
                            user_id=tenant.user_id, assigned_by=tenant.user_id
                        )
                    ],
                )
                assume += 1
        await self._session.flush()

        if avisar:
            emissor = NotificationEmitter(self._session)
            for uid, quantidade in contagem.items():
                await emissor.alcance_perdido(
                    recipient_id=uid,
                    actor_id=tenant.user_id,
                    quantidade=quantidade,
                    subtimes=[],
                )

        nomes = dict(
            (
                await self._session.execute(
                    select(User.id, User.name).where(User.id.in_(perdem))
                )
            ).all()
        )
        saem = sorted(
            (
                PessoaQueSai(user_id=uid, nome=nomes.get(uid, ""), tarefas=n)
                for uid, n in contagem.items()
            ),
            key=lambda p: p.nome,
        )
        return saem, assume

    async def archive(self, *, task_id: uuid.UUID) -> ArchiveResult:
        """Arquiva a task e toda a subarvore. Idempotente.

        A cascata roda mesmo com a raiz ja arquivada (recolhe filhas ativas
        deixadas para tras). Uma linha de history na raiz, com `cascade_count`.
        """
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        mudou_raiz = not task.is_archived
        if mudou_raiz:
            task.is_archived = True

        cascade_count = await self._repo.set_archived_subtree(
            task=task, archived=True
        )

        if mudou_raiz or cascade_count:
            tenant = require_tenant()
            await self._repo.write_history(
                task=task,
                user_id=tenant.user_id,
                entries=[build_archived_entry(cascade_count=cascade_count)],
            )
            await self._session.flush()
            logger.info(
                "task.archived",
                task_id=str(task.id),
                cascade_count=cascade_count,
            )
        return ArchiveResult(task=task, cascade_count=cascade_count)

    async def unarchive(self, *, task_id: uuid.UUID) -> ArchiveResult:
        """Desarquiva a task e toda a subarvore. Idempotente.

        Recusa se o pai esta arquivado (a subtarefa sumiria de todas as telas);
        a mensagem nomeia o pai. A subarvore volta inteira, inclusive filha
        arquivada antes do pai (o banco nao distingue).
        """
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        if task.is_archived and task.parent_task_id is not None:
            pai = await self._repo.get_by_id_or_raise(task.parent_task_id)
            if pai.is_archived:
                raise ValidationError(
                    "Esta subtarefa está dentro de "
                    f"\"{pai.title}\", que está arquivada. Desarquive a "
                    "tarefa pai primeiro — a subtarefa volta junto.",
                    details={"field": "parent_task_id", "parent_id": str(pai.id)},
                )

        mudou_raiz = task.is_archived
        if mudou_raiz:
            task.is_archived = False
            # Relogio da varredura recomeca, senao ela rearquivaria a tarefa.
            if task.terminal_since is not None:
                task.terminal_since = datetime.now(UTC)

        # Como no `archive`: a cascata roda mesmo com a raiz ja ativa.
        cascade_count = await self._repo.set_archived_subtree(
            task=task, archived=False
        )

        if mudou_raiz or cascade_count:
            tenant = require_tenant()
            await self._repo.write_history(
                task=task,
                user_id=tenant.user_id,
                entries=[build_unarchived_entry(cascade_count=cascade_count)],
            )
            await self._session.flush()
            logger.info(
                "task.unarchived",
                task_id=str(task.id),
                cascade_count=cascade_count,
            )

        return ArchiveResult(task=task, cascade_count=cascade_count)

    async def archive_stale(
        self,
        *,
        now: datetime,
        actor_user_id: uuid.UUID,
        days: int | None = None,
    ) -> int:
        """Varredura: arquiva tasks terminais paradas ha mais de N dias.

        Caminho de sistema: nao passa pelos guards por task. Idempotente.
        Cascateia a subarvore como o `archive`; raiz primeiro, e `processados`
        evita reprocessar filha ja arquivada pela cascata do pai. Retorna o
        total arquivado (raizes + cascateadas).
        """
        effective_days = (
            settings.stale_archive_days if days is None else days
        )
        stale = list(
            await self._repo.list_stale_terminal(now=now, days=effective_days)
        )
        # Raiz antes de folha; `path` desempata para a ordem ser estavel.
        stale.sort(key=lambda t: (t.depth, t.path))

        processados: list[str] = []
        count = 0
        cascateadas = 0
        for task in stale:
            if any(task.path.startswith(f"{p}.") for p in processados):
                continue

            task.is_archived = True
            cascade_count = await self._repo.set_archived_subtree(
                task=task, archived=True
            )
            await self._repo.write_history(
                task=task,
                user_id=actor_user_id,
                entries=[
                    build_archived_entry(
                        automated=True,
                        reason="stale_terminal",
                        cascade_count=cascade_count,
                    )
                ],
            )
            processados.append(task.path)
            count += 1 + cascade_count
            cascateadas += cascade_count

            if cascade_count:
                # Log por pai: o `path` dele localiza as filhas arrastadas.
                logger.info(
                    "task.archive_stale.cascata",
                    task_id=str(task.id),
                    task_path=task.path,
                    task_title=task.title,
                    cascade_count=cascade_count,
                )

        if count:
            await self._session.flush()
            logger.info(
                "task.archive_stale",
                archived=count,
                raizes=len(processados),
                cascateadas=cascateadas,
            )
        return count

    async def soft_delete(self, *, task_id: uuid.UUID) -> SoftDeleteResult:
        """Soft-delete da task e da subarvore; 1 linha de history so na raiz,
        com `cascade_count`."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)
        # Permissao no time da tarefa, depois da lente: fora da lente e 404
        # (acima), na lente sem o verbo e 403.
        if not require_tenant().has_permission_in("task.delete", task.team_id):
            raise AuthorizationError(
                "Você não apaga tarefas deste time.",
                details={"task_id": str(task.id)},
            )

        cascade_count = await self._repo.soft_delete_subtree(task=task)

        # Comentarios da subarvore vao junto (fora do `cascade_count`).
        await self._comments.soft_delete_for_task_subtree(task_path=task.path)

        tenant = require_tenant()
        entry = build_deleted_entry(cascade_count=cascade_count)
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        logger.info(
            "task.deleted",
            task_id=str(task.id),
            cascade_count=cascade_count,
        )
        return SoftDeleteResult(task=task, cascade_count=cascade_count)

    # ----------------------------------------------------
    # Helpers privados
    # ----------------------------------------------------
    @staticmethod
    def _assert_time_no_projeto(project: Project, team_id: uuid.UUID) -> None:
        """O time da tarefa fica na subarvore do time do projeto.

        Vale em criar, mover de projeto e trocar o time; senao quem ve (pelo
        projeto) e quem edita (pelo time) divergem.
        """
        if not TaskService._time_cabe_no_projeto(project, team_id):
            raise ValidationError(
                "Time da task fora da subarvore do time do projeto.",
                details={"field": "team_id"},
            )

    @staticmethod
    def _time_cabe_no_projeto(project: Project, team_id: uuid.UUID) -> bool:
        """`_assert_time_no_projeto` sem levantar: o `relocate` tira o projeto."""
        if project.team_id is None:
            return True
        allowed = {project.team_id} | team_scope.descendants(
            project.team_id, require_tenant().team_tree
        )
        return team_id in allowed

    async def _assert_visible_via_project(self, task: Task) -> None:
        """404 (nao 403) em task que o usuario nao enxerga: nao vaza existencia."""
        await self._guards.assert_visible(task)

    async def _assert_editable(self, task: Task) -> None:
        """403 se ve mas nao edita; chamar depois de `_assert_visible_via_project`.

        So o time da task conta; responsavel e criador nao ganham edicao.
        """
        await self._guards.assert_editable(task)

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    @staticmethod
    def _label_for(task_id: uuid.UUID) -> str:
        """Label LTREE da task: 't' + uuid.hex."""
        return f"t{task_id.hex}"

    @staticmethod
    def _compute_path_and_depth(
        parent: Task | None, new_label: str
    ) -> tuple[str, int]:
        """Deriva path e depth a partir do pai (None = raiz)."""
        if parent is None:
            return (new_label, 0)
        return (f"{parent.path}.{new_label}", parent.depth + 1)

    @staticmethod
    def _validate_hora(due_date: date | None, due_time: time | None) -> None:
        """Hora de prazo exige data de prazo, no estado resultante.

        Fica no servico: `@model_validator` no Pydantic daria 500, nao 422.
        """
        if due_time is not None and due_date is None:
            raise ValidationError(
                "Hora do prazo exige uma data de prazo.",
                details={"field": "due_time"},
            )

    _validate_dates = staticmethod(validate_dates)

    @staticmethod
    def _diff_for_update(
        task: Task, command: UpdateTaskCommand
    ) -> list[HistoryEntry]:
        """Uma HistoryEntry por campo alterado; status vira STATUS_CHANGED."""
        entries: list[HistoryEntry] = []

        if command.title is not None:
            new_title = command.title.strip()
            if new_title and new_title != task.title:
                entries.append(
                    build_field_update_entry(
                        field_name="title", old=task.title, new=new_title
                    )
                )

        if (
            command.description is not None
            and command.description != task.description
        ):
            entries.append(
                build_field_update_entry(
                    field_name="description",
                    old=task.description,
                    new=command.description,
                )
            )

        if command.priority is not None and command.priority != task.priority:
            entries.append(
                build_field_update_entry(
                    field_name="priority",
                    old=task.priority,
                    new=command.priority,
                )
            )

        if command.team_id is not None and command.team_id != task.team_id:
            entries.append(
                build_field_update_entry(
                    field_name="team_id",
                    old=task.team_id,
                    new=command.team_id,
                )
            )

        if command.status is not None and command.status != task.status:
            completed_changed = (
                command.status == TaskStatus.COMPLETED
                or task.status == TaskStatus.COMPLETED
            )
            entries.append(
                build_status_change_entry(
                    old_status=task.status,
                    new_status=command.status,
                    completed_at_changed=completed_changed,
                )
            )

        # Presenca no PATCH manda: limpar uma data tambem entra no historico.
        if (
            "start_date" in command.fields_set
            and command.start_date != task.start_date
        ):
            entries.append(
                build_field_update_entry(
                    field_name="start_date",
                    old=task.start_date,
                    new=command.start_date,
                )
            )
        if "due_date" in command.fields_set and command.due_date != task.due_date:
            entries.append(
                build_field_update_entry(
                    field_name="due_date",
                    old=task.due_date,
                    new=command.due_date,
                )
            )
        if "due_time" in command.fields_set and command.due_time != task.due_time:
            entries.append(
                build_field_update_entry(
                    field_name="due_time",
                    old=task.due_time,
                    new=command.due_time,
                )
            )

        return entries
