"""Casos de uso de tasks.

Toda regra de negocio fica aqui. Commit no UoW (router).

Casos de uso (publicos):
    TaskService.create
    TaskService.get
    TaskService.list_page
    TaskService.update
    TaskService.move
    TaskService.archive
    TaskService.unarchive
    TaskService.soft_delete   -- cascateado (ADR 0005)

Decisoes-chave (ver specs/002-tasks-nucleo/spec.md +
docs/adr/0002 / 0003 / 0004 / 0005):

  - LTREE label: "t" + uuid.hex (ADR 0002).
  - Move e soft-delete usam SQL textual com predicado de tenant
    manual (ADR 0003);
  - Soft-delete cascateia pra subtree (ADR 0005);
  - task_history hibrido (ADR 0004), escrito atomicamente no UoW.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.application.project_service import ProjectService
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
)
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
from app.modules.tasks.infrastructure.comment_repository import CommentRepository
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    BusinessRuleError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)


# --------------------------------------------------------
# Commands / DTOs
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateTaskCommand:
    title: str
    project_id: uuid.UUID | None = None  # Entrega 3: opcional -> avulsa.
    description: str = ""
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None  # default = subtime do criador.
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None
    # Spec 021: responsaveis aplicados APOS a task nascer, reusando os gates
    # de atribuicao. Atomico: invalido(s) -> 422 e a criacao inteira reverte.
    assignee_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class DuplicateTaskCommand:
    """Spec 033. Os campos ja REVISADOS no modal + a caixa das subtarefas.

    ⚠️ NAO EXISTE CAMPO DE DATA AQUI, e nao e esquecimento -- e a D5.
    `start_date`/`due_date` ausentes garantem os criterios 3 e 4 de uma vez:
    a copia nasce sem prazo, e como `create()` tambem nao aceita
    `due_soon_notified_for`/`overdue_notified_for`, ela nasce sem as colunas
    de dedup preenchidas. Acrescentar `due_date: date | None = None` aqui
    reabre os dois SEM deixar nada vermelho: a copia de uma campanha de marco
    nasceria vencida e a proxima execucao do job dispararia TASK_OVERDUE em
    lote (em 01/08 foram 51 numa execucao so).

    ⚠️ NAO EXISTE CAMPO DE STATUS. BACKLOG e o default de CreateTaskCommand;
    deixar o default agir e mais seguro que repassar o status da origem.
    """

    source_id: uuid.UUID
    title: str
    description: str = ""
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    assignee_ids: list[uuid.UUID] = field(default_factory=list)
    include_subtasks: bool = False
    # D13 (03/08): controla SO os responsaveis das SUBTAREFAS. Os do pai vem
    # em `assignee_ids`, ja revisados no modal -- la a pessoa edita direto no
    # campo, entao uma caixa pro pai duplicaria um controle que existe.
    #
    # ⚠️ False cria N subtarefas SEM RESPONSAVEL de uma vez, que e o passivo
    # que a regra de 29/07 combate (44 das 50 tarefas ativas sem responsavel
    # eram subtarefas). A porta esta aberta por decisao explicita (D14), e a
    # tela AVISA antes de salvar. Nao remova o aviso sem remover a caixa.
    include_assignees: bool = True


@dataclass(frozen=True, slots=True)
class DuplicateResult:
    """A copia + quem ficou pelo caminho (D9-c).

    `skipped_assignees` sao responsaveis de SUBTAREFA descartados por nao
    alcancarem mais a task. Nao e erro: e o que a tela mostra depois
    ("2 subtarefas ficaram sem responsavel"), pra pessoa saber o que corrigir.
    """

    task: Task
    skipped_assignees: list[uuid.UUID]
    # ⚠️ True quando a copia foi PROMOVIDA a tarefa de topo porque a irma que
    # ela seria nasceria dentro de um pai ARQUIVADO. Ver `duplicate`.
    promoted_to_root: bool = False


@dataclass(frozen=True, slots=True)
class UpdateTaskCommand:
    """Patch parcial. None = nao mexer -- EXCETO nos campos nullable (datas),
    onde None significa LIMPAR. Pra distinguir "omitido" de "null explicito"
    nesses campos, o router preenche `fields_set` com os campos que vieram no
    JSON (Pydantic model_fields_set); o apply consulta esse conjunto.

    project_id e parent_task_id NAO entram aqui -- usar move.
    """

    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    # Nomes dos campos presentes no PATCH (mesmo quando o valor e None).
    fields_set: frozenset[str] = frozenset()


@dataclass(frozen=True, slots=True)
class MoveTaskCommand:
    """Move pra outro pai e/ou projeto.

    Pelo menos um deve vir. None = nao mexe naquele campo. No-op
    silencioso se nada muda no final.

    Spec 022: `detach_project=True` tira a task de projeto (avulsa). Sinal
    EXPLICITO -- `project_id=None` continua significando "nao mexe no projeto",
    entao null nao serve pra desassociar. So vale em task de topo; nao combina
    com project_id/parent_task_id preenchidos.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    detach_project: bool = False


@dataclass(frozen=True, slots=True)
class TaskFilters:
    """Filtros suportados em GET /tasks."""

    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    root_only: bool = False
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    include_archived: bool = False
    archived_only: bool = False
    created_by: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class SoftDeleteResult:
    """Resultado de soft_delete (cascade)."""

    task: Task
    cascade_count: int


@dataclass(frozen=True, slots=True)
class ArchiveResult:
    """Resultado de archive/unarchive (cascade -- 05/08).

    `cascade_count` = descendentes que mudaram junto, sem contar a propria
    task. Vai para a resposta da API porque a tela AVISA ("3 subtarefas foram
    arquivadas junto"): cascatear em silencio mexe em tarefa que a pessoa nao
    citou, e ela so descobriria pela ausencia.
    """

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
        # Entrega 14: cascata de comentarios no soft-delete (D11).
        self._comments = CommentRepository(session)

    # ----------------------------------------------------
    # CRUD (publico)
    # ----------------------------------------------------
    async def create(self, command: CreateTaskCommand) -> Task:
        """Cria task. 1 linha em task_history (CREATED)."""
        title = command.title.strip()
        if not title:
            raise ValidationError(
                "Titulo da task nao pode ser vazio.",
                details={"field": "title"},
            )
        self._validate_dates(command.start_date, command.due_date)

        tenant = require_tenant()

        # Se tem pai: deve existir, no mesmo workspace, e no mesmo projeto.
        # Carregado ANTES da resolucao de time porque a subtarefa HERDA o
        # team_id do pai (Entrega 10 / ADR 0024): mantem a subtree coerente e
        # evita o fallback silencioso pro subtime do criador (divida #2).
        parent: Task | None = None
        if command.parent_task_id is not None:
            parent = await self._repo.get_by_id_or_raise(command.parent_task_id)
            if parent.project_id != command.project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )

        # Resolve o time da task, em ordem de precedencia:
        #   1. team_id explicito (quem manda, manda);
        #   2. team_id do pai (heranca de subtarefa -- Entrega 10);
        #   3. subtime default do criador (avulsa -- Entrega 3, regra 5-7).
        # Sem nada resolvido -> 422.
        team_id = (
            command.team_id
            or (parent.team_id if parent is not None else None)
            or team_scope.default_team_id(tenant.memberships, tenant.team_tree)
        )
        if team_id is None:
            raise ValidationError(
                "Task precisa de um time (voce nao esta em nenhum subtime; "
                "informe team_id).",
                details={"field": "team_id"},
            )

        # Projeto (opcional). Se informado: deve existir e ser visivel.
        project: Project | None = None
        if command.project_id is not None:
            project = await self._projects.get_by_id_or_raise(command.project_id)
            ProjectService._assert_visible_to_current_user(project)
            # Em projeto comum, o time da task fica na subarvore do time
            # do projeto (regra 8 da spec). A heranca do pai ja satisfaz isto
            # por construcao (o pai passou pela mesma checagem ao nascer).
            if not project.is_personal and project.team_id is not None:
                allowed = {project.team_id} | team_scope.descendants(
                    project.team_id, tenant.team_tree
                )
                if team_id not in allowed:
                    raise ValidationError(
                        "Time da task fora da subarvore do time do projeto.",
                        details={"field": "team_id"},
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
            created_by=tenant.user_id,
            path=path,
            depth=depth,
        )
        # Se ja vem como COMPLETED, marca completed_at.
        if command.status == TaskStatus.COMPLETED:
            task.completed_at = datetime.now(UTC)  # type: ignore[assignment]

        self._repo.add(task)
        await self._session.flush()

        # History
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

        # Spec 021: responsaveis na criacao. So agora (task ja flushada, com id
        # e team_id resolvido) -- os gates de atribuicao precisam da task
        # persistida. Atomico: a validacao em lote levanta ValidationError (422)
        # nomeando TODOS os invalidos sem aplicar nenhum; como ainda nao houve
        # commit (quem commita e o router), a criacao inteira reverte. Reusa o
        # caminho de atribuicao -> ganha escopo, history e notificacao.
        if command.assignee_ids:
            # Import local: evita ciclo de import no nivel de modulo.
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            await CollaborationService(self._session).assign_many_or_fail(
                task=task, user_ids=command.assignee_ids
            )

        return task

    async def duplicate(self, command: DuplicateTaskCommand) -> DuplicateResult:
        """Duplica uma task (Spec 033).

        ⚠️ DECISAO DE ARQUITETURA, e a mais importante da spec: duplicar e uma
        SEQUENCIA DE `create()`, NUNCA copia de linha. Um `INSERT ... SELECT`
        ou um clone no repositorio passaria por fora de `path`, `depth`,
        precedencia de time, validacao de projeto e `task_history` -- em
        silencio, com a tela identica e os portoes verdes. `path` e `depth`
        sao as duas colunas cuja corrupcao nao aparece na tela e nao tem
        conserto por deploy.

        ⚠️ NADA de `commit()` aqui dentro. Quem commita e o router. O criterio
        10 ("falha no meio -> nada persiste") depende de a arvore inteira
        viver numa unidade de trabalho so; um commit por filho troca "falhou"
        por "meia arvore no quadro", que e o pior estado possivel -- e os
        testes continuam passando.

        A copia do PAI usa `command.assignee_ids` cru: eles ja passaram pelo
        modal, e um invalido ali DEVE dar 422 (a pessoa escolheu). Nas FILHAS
        e o contrario -- ver `_copiar_subarvore`.
        """
        source = await self._repo.get_by_id_or_raise(command.source_id)
        # 404, nao 403 (criterio 11): quem nao enxerga a origem nao pode nem
        # descobrir que ela existe.
        await self._assert_visible_via_project(source)

        # ⚠️ PROMOCAO POR PAI ARQUIVADO (03/08). A D3 manda a copia de uma
        # subtarefa nascer IRMA, sob o mesmo pai. Isso quebra quando o pai esta
        # arquivado: o quadro so desenha `depth === 0` (Board.tsx:580), entao a
        # copia nasce ATIVA, correta no banco, e SEM NENHUMA TELA que a mostre
        # -- a checklist onde ela mora e a de uma tarefa arquivada, que
        # ninguem abre. Foi encontrado duplicando a partir de /arquivadas.
        #
        # A saida e promover a copia a tarefa de topo. ⚠️ E promover CONTANDO:
        # `promoted_to_root` volta na resposta e a tela avisa. Promover em
        # silencio mudaria a hierarquia pelas costas de quem clicou, que e
        # pior que o defeito original.
        pai_alvo = command.parent_task_id
        promovida = False
        if pai_alvo is not None:
            pai = await self._repo.get_by_id_or_raise(pai_alvo)
            if pai.is_archived:
                pai_alvo = None
                promovida = True

        novo = await self.create(
            CreateTaskCommand(
                title=command.title,
                description=command.description,
                project_id=command.project_id,
                parent_task_id=pai_alvo,
                team_id=command.team_id,
                priority=command.priority,
                assignee_ids=command.assignee_ids,
            )
        )

        pulados: list[uuid.UUID] = []
        if command.include_subtasks:
            await self._copiar_subarvore(
                origem=source,
                destino=novo,
                pulados=pulados,
                levar_responsaveis=command.include_assignees,
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
    ) -> None:
        """Copia os filhos de `origem` sob `destino`, RECURSIVAMENTE (D4).

        ⚠️ Profundidade nao e limitada em task (o banco so exige `depth >= 0`).
        A recursao para porque a arvore de origem acaba, nao porque existe
        trava. Arvore profunda de verdade percorre tudo.

        ⚠️ Sem prefixo "Copia de" nas filhas (D8): so o pai leva. Com prefixo,
        a checklist inteira da copia fica com "Copia de" repetido em cada
        linha.

        ⚠️ Sem `team_id` explicito: a filha HERDA o time do pai NOVO pela
        precedencia normal de `create()` (criterio 9). Repassar o time da
        origem furaria a heranca quando a copia nasce em outro lugar.
        """
        filhos = await self._repo.list_children(parent_task_id=origem.id)
        for filho in filhos:
            copia = await self.create(
                CreateTaskCommand(
                    title=filho.title,
                    description=filho.description,
                    project_id=destino.project_id,
                    parent_task_id=destino.id,
                    priority=filho.priority,
                    # Responsaveis NAO vao aqui: precisam ser filtrados contra
                    # a task NOVA, que ainda nao existe neste ponto.
                )
            )
            if levar_responsaveis:
                await self._aplicar_responsaveis_da_filha(
                    origem=filho, copia=copia, pulados=pulados
                )
            await self._copiar_subarvore(
                origem=filho,
                destino=copia,
                pulados=pulados,
                levar_responsaveis=levar_responsaveis,
            )

    async def _aplicar_responsaveis_da_filha(
        self, *, origem: Task, copia: Task, pulados: list[uuid.UUID]
    ) -> None:
        """Responsaveis da subtarefa, FILTRADOS por alcance (D9-c).

        ⚠️ Passar a lista crua para `create()` seria o comportamento (b) da
        D9, que NAO foi o escolhido: `assign_many_or_fail` e atomico, entao um
        unico responsavel desativado numa das seis filhas derrubaria a
        duplicacao inteira com um 422 sobre uma pessoa que quem clicou nao
        sabe que existe, numa subtarefa que ela nao viu.

        ⚠️ O alcance e medido contra a COPIA, nao contra a origem. A copia
        pode nascer em outro projeto ou sob outro pai, e quem alcanca uma nao
        alcanca necessariamente a outra. Medir na origem daria a resposta
        certa por acaso no caso comum e errada exatamente nos casos que a
        duplicacao existe pra resolver.

        ⚠️ A regra de 29/07 ("responsavel obrigatorio ao criar") CEDE aqui, e
        por escrito na spec: uma filha pode nascer sem responsavel quando o
        responsavel original perdeu o alcance. E a unica excecao, e ela e
        VISIVEL -- por isso o id entra em `pulados` e volta na resposta.
        """
        from app.modules.tasks.application.collaboration_service import (
            CollaborationService,
        )

        colaboracao = CollaborationService(self._session)
        ids = await colaboracao.assignee_ids_for(origem)
        if not ids:
            return

        validos: list[uuid.UUID] = []
        for uid in ids:
            if await user_can_view_task(
                self._session, task=copia, user_id=uid
            ):
                validos.append(uid)
            elif uid not in pulados:
                pulados.append(uid)

        if validos:
            await colaboracao.assign_many_or_fail(task=copia, user_ids=validos)

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
            created_by=filters.created_by,
            include_archived=filters.include_archived,
            archived_only=filters.archived_only,
        )

    async def update(
        self, *, task_id: uuid.UUID, command: UpdateTaskCommand
    ) -> Task:
        """Patch parcial. 1 linha em history por campo alterado.
        Status vira STATUS_CHANGED. parent/project NAO mexem (usar move)."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        # Calcula entries ANTES de mutar (snapshot do estado antigo).
        entries = self._diff_for_update(task, command)

        # Aplica patch campo a campo. None = nao mexer.
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
            task.team_id = command.team_id

        # Status com ajuste de completed_at.
        virou_concluido = False
        if command.status is not None and command.status != task.status:
            if command.status == TaskStatus.COMPLETED:
                task.completed_at = datetime.now(UTC) # type: ignore[assignment]
                virou_concluido = True
            elif task.status == TaskStatus.COMPLETED:
                task.completed_at = None
            task.status = command.status

        # Datas sao nullable: presenca no PATCH manda (None = limpar). Usar
        # `is not None` aqui era o bug de "limpar data nao salvava" -- o null
        # explicito era tratado como "nao mexer".
        if "start_date" in command.fields_set:
            task.start_date = command.start_date
        if "due_date" in command.fields_set:
            task.due_date = command.due_date

        # Valida estado resultante.
        self._validate_dates(task.start_date, task.due_date)

        if entries:
            tenant = require_tenant()
            await self._repo.write_history(
                task=task, user_id=tenant.user_id, entries=entries
            )

        # Cascata de conclusao: concluir o PAI conclui toda a subtree (regra de
        # negocio -- vale pra qualquer caminho: quadro, modal, API). Roda so na
        # TRANSICAO pra COMPLETED. Nao gera history por subtarefa (UPDATE em
        # massa) -- se precisar de rastro por-item, e outra entrega.
        if virou_concluido:
            await self._repo.complete_descendants(task=task)

        await self._session.flush()
        logger.info(
            "task.updated",
            task_id=str(task.id),
            changes=len(entries),
        )
        return task

    async def move(
        self, *, task_id: uuid.UUID, command: MoveTaskCommand
    ) -> Task:
        """Move pra novo pai e/ou projeto (ADR 0003).

        No-op silencioso se nada muda.
        """
        # Pelo menos um dos tres (pai, projeto, ou detach).
        if (
            command.parent_task_id is None
            and command.project_id is None
            and not command.detach_project
        ):
            # Nada informado -- nao eh erro, eh no-op.
            task = await self._repo.get_by_id_or_raise(task_id)
            await self._assert_visible_via_project(task)
            return task

        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        # Spec 022 -- detach (tornar avulsa): valida combinacoes e escopo ANTES
        # de resolver o destino. Sinal explicito, nao combina com projeto/pai,
        # e so vale em task de topo (subtarefa segue o projeto do pai).
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

        # Estado resultante. Detach zera projeto (e pai, por coerencia -- avulsa
        # nao tem pai; ja garantimos acima que a task e de topo).
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

        # Se nao mudou nada de fato, no-op.
        if (
            new_project_id == task.project_id
            and new_parent_task_id == task.parent_task_id
        ):
            return task

        # Move pra si mesmo.
        if new_parent_task_id == task.id:
            raise BusinessRuleError(
                "Task nao pode ser pai de si mesma.",
                details={"task_id": str(task.id)},
            )

        # Projeto novo deve existir e ser visivel (pessoal alheio -> 404).
        # Detach (new_project_id None) pula: nao ha projeto destino pra validar.
        if new_project_id is not None and new_project_id != task.project_id:
            new_project = await self._projects.get_by_id_or_raise(new_project_id)
            ProjectService._assert_visible_to_current_user(new_project)

        # Pai novo (se houver): existe, mesmo workspace, mesmo projeto final.
        new_parent: Task | None = None
        if new_parent_task_id is not None:
            new_parent = await self._repo.get_by_id_or_raise(new_parent_task_id)
            if new_parent.project_id != new_project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )
            # Ciclo: novo pai eh descendente da task?
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

        # Snapshot para o history.
        old_project_id = task.project_id
        old_parent_task_id = task.parent_task_id
        old_path = task.path
        old_depth = task.depth

        # Reparent: atualiza task e subtree via SQL textual.
        await self._repo.reparent_subtree(
            task=task,
            old_path=old_path,
            old_depth=old_depth,
            new_parent_path=new_parent.path if new_parent else None,
            new_parent_depth=new_parent.depth if new_parent else None,
            new_parent_task_id=new_parent_task_id,
            new_project_id=new_project_id,
        )

        # History
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

        logger.info(
            "task.moved",
            task_id=str(task.id),
            old_project_id=str(old_project_id),
            new_project_id=str(new_project_id),
        )
        return task

    async def archive(self, *, task_id: uuid.UUID) -> ArchiveResult:
        """Arquiva a task E TODA A SUBARVORE (05/08). Idempotente.

        ⚠️ A CASCATA E A CORRECAO DE UMA PORTA ABERTA, nao conveniencia. Sem
        ela a filha ficava ATIVA debaixo de um pai arquivado: o quadro so
        desenha `depth === 0`, e a checklist onde ela mora e a de uma tarefa
        arquivada, que ninguem abre. A tarefa existia e nenhuma tela a
        mostrava -- a mesma classe de defeito que a promocao da duplicacao e a
        trava do desarquivar ja fecharam por outros dois caminhos.

        ⚠️ A CASCATA RODA MESMO QUANDO A RAIZ JA ESTAVA ARQUIVADA, e isso e
        deliberado: e o unico caminho de conserto para as filhas orfas que o
        comportamento antigo deixou no banco. Arquivar de novo um pai ja
        arquivado passa a recolher as filhas que ficaram para tras. Continua
        idempotente no que importa: a segunda chamada muda 0 linhas
        (`is_archived <> :alvo` no WHERE) e nao escreve history.

        1 linha em history NA RAIZ, com `cascade_count` no metadata quando
        houve cascata. Filhas NAO ganham linha propria -- mesma forma do
        soft-delete (ADR 0005): a auditoria de arquivar 40 subtarefas viraria
        40 linhas que ninguem le.
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
        # Nada mudou (raiz e subarvore ja arquivadas) -> no-op silencioso.

        return ArchiveResult(task=task, cascade_count=cascade_count)

    async def unarchive(self, *, task_id: uuid.UUID) -> ArchiveResult:
        """Desarquiva a task E TODA A SUBARVORE (05/08). Idempotente.

        ⚠️ RECUSA quando o PAI esta arquivado (04/08). Sem esta trava a
        operacao "funcionava" e nao entregava nada: a subtarefa voltava a
        `is_archived=false`, saia de /arquivadas (nao esta mais arquivada) e
        NAO aparecia no quadro (que so desenha `depth === 0`, Board.tsx:580)
        nem na checklist do pai (que esta arquivado e ninguem abre). A pessoa
        pedia "traz de volta", recebia 200, e a tarefa sumia de vez.

        ⚠️ A mensagem NOMEIA o pai. Sem o nome, "desarquive a tarefa pai" e
        um enigma: a subtarefa esta numa lista de arquivadas que nao mostra
        hierarquia, e nao ha como adivinhar de qual pai ela veio.

        E a opcao 1 de tres (04/08). A 2 era cascata pra cima com
        confirmacao -- melhor de usar, mas mexe em OUTRA tarefa; a 3 era
        promover a subtarefa a topo, recusada porque desarquivar e mover sao
        coisas diferentes. Se a trava incomodar na pratica, a 2 e o caminho.

        ⚠️ A CASCATA PRA BAIXO EXISTE PORQUE A MENSAGEM ACIMA JA A PROMETIA.
        "Desarquive a tarefa pai primeiro -- a subtarefa volta junto" estava em
        producao desde 04/08 e era MENTIRA: `unarchive` nao cascateava, entao
        a subtarefa continuava arquivada e a pessoa fazia o que a tela mandou
        sem receber o que a tela prometeu.

        ⚠️ CUSTO ACEITO (decisao de 05/08, opcao 2 de tres): a subarvore volta
        INTEIRA, inclusive filha que tinha sido arquivada de proposito ANTES
        do pai. O banco nao guarda quem foi arquivado pela cascata, entao
        distinguir os dois casos exigiria coluna nova (era a opcao 3). Se
        ressuscitar subtarefa encerrada incomodar na pratica, a opcao 3 e o
        caminho -- e ai a migration entra junto.
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

        # ⚠️ Mesma decisao do `archive`: a cascata roda mesmo com a raiz ja
        # ativa. E o caminho de conserto para a arvore que ficou meio
        # arquivada antes de 05/08.
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
        """Varredura: arquiva tasks terminais paradas ha mais de N dias (Spec 013).

        Caminho de SISTEMA, nao de usuario: NAO passa pelos guards por-task
        (assert_editable) -- opera workspace-wide sob tenant_scope confiavel,
        montado pelo endpoint trancado (Fatia 2). `now`/`actor` injetados
        (testavel). Historico atribuido ao ator (admin do workspace) com
        flag automated. Idempotente: 2a rodada no mesmo dia arquiva 0.
        """
        effective_days = (
            settings.stale_archive_days if days is None else days
        )
        stale = await self._repo.list_stale_terminal(
            now=now, days=effective_days
        )
        count = 0
        for task in stale:
            task.is_archived = True
            await self._repo.write_history(
                task=task,
                user_id=actor_user_id,
                entries=[
                    build_archived_entry(
                        automated=True, reason="stale_terminal"
                    )
                ],
            )
            count += 1
        if count:
            await self._session.flush()
            logger.info("task.archive_stale", archived=count)
        return count

    async def soft_delete(self, *, task_id: uuid.UUID) -> SoftDeleteResult:
        """Soft-delete CASCATEADO (ADR 0005).

        Apaga a task e toda a subtree. 1 linha em history para a
        task raiz com event_metadata.cascade_count. Filhas apagadas
        em cascade NAO geram history individual.
        """
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        cascade_count = await self._repo.soft_delete_subtree(task=task)

        # Entrega 14 (D11): os comentarios das tasks da subtree vao junto.
        # NAO entram no cascade_count (que conta so tarefas-filhas).
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
    async def _assert_visible_via_project(self, task: Task) -> None:
        """Bloqueia leitura/escrita em task que o usuario nao enxerga.

        Delega ao guard compartilhado (app.modules.tasks.application.
        task_guards), que cobre privacidade do pessoal, lente de time e a
        regra `created_by` (ADR 0013). Levanta EntityNotFoundError (404)
        -- nao 403 -- pra nao vazar existencia.
        """
        await self._guards.assert_visible(task)

    async def _assert_editable(self, task: Task) -> None:
        """403 se o usuario VE a task mas nao pode edita-la (Fase B).

        Chamar APOS _assert_visible_via_project. Editavel depende SO do
        time da task -- assignment/criador nao concedem edicao (ADR 0013).
        """
        await self._guards.assert_editable(task)

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    @staticmethod
    def _label_for(task_id: uuid.UUID) -> str:
        """Label LTREE da task (ADR 0002): 't' + uuid.hex."""
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
    def _validate_dates(
        start_date: date | None, due_date: date | None
    ) -> None:
        """start_date <= due_date quando ambos informados."""
        if start_date is not None and due_date is not None:
            if start_date > due_date:
                raise ValidationError(
                    "Data de inicio nao pode ser posterior a data limite.",
                    details={"field": "due_date"},
                )

    @staticmethod
    def _diff_for_update(
        task: Task, command: UpdateTaskCommand
    ) -> list[HistoryEntry]:
        """Calcula HistoryEntry list pra um update. Puro.

        Regras (ADR 0004):
            - 0 entries se nada mudou de fato;
            - 1 entry por campo alterado;
            - status vira STATUS_CHANGED, nao UPDATED.
        """
        entries: list[HistoryEntry] = []

        # Title (apos strip).
        if command.title is not None:
            new_title = command.title.strip()
            if new_title and new_title != task.title:
                entries.append(
                    build_field_update_entry(
                        field_name="title", old=task.title, new=new_title
                    )
                )

        # Description.
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

        # Priority.
        if command.priority is not None and command.priority != task.priority:
            entries.append(
                build_field_update_entry(
                    field_name="priority",
                    old=task.priority,
                    new=command.priority,
                )
            )

        # Team_id.
        if command.team_id is not None and command.team_id != task.team_id:
            entries.append(
                build_field_update_entry(
                    field_name="team_id",
                    old=task.team_id,
                    new=command.team_id,
                )
            )

        # Status: evento dedicado.
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

        # Datas: presenca no PATCH manda (mesmo motivo do apply). Assim limpar
        # uma data (None) tambem entra no historico (old=data, new=None).
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

        return entries
