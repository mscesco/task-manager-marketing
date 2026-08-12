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
from dataclasses import dataclass, field, replace
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
from app.modules.tasks.domain.archival import is_terminal
from app.modules.tasks.domain.board_semantics import status_da_coluna
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
from app.modules.tasks.infrastructure.board_repository import BoardRepository
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

    # ⚠️ PASSO 2 DO MODAL (ADR 0031). As duas chaves sao ids de subtarefa da
    # ORIGEM, e valem SO no primeiro nivel (filhas diretas) -- neto herda da
    # filha correspondente na copia, porque listar tres niveis num seletor e
    # uma parede e arvore de tres niveis e rara.
    #
    # `subtask_assignees`: quem responde por cada filha. Presente = escolha
    # EXPLICITA de quem clicou, entao vai crua pro `assign_many_or_fail` e um
    # invalido DEVE dar 422 -- mesma regra do `assignee_ids` do pai. Ausente =
    # comportamento antigo (`include_assignees` decide).
    #
    # ⚠️ Lista VAZIA e recusada, nao aceita como "ninguem": criar filha sem
    # responsavel e exatamente o que a ADR 0031 fecha. Quem nao quer a
    # subtarefa usa `skip_subtasks`.
    subtask_assignees: dict[uuid.UUID, list[uuid.UUID]] = field(
        default_factory=dict
    )
    # Filhas diretas que NAO vao. Excluir uma exclui a SUBARVORE dela -- neto
    # nao tem onde se pendurar se a mae nao veio.
    skip_subtasks: list[uuid.UUID] = field(default_factory=list)


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
    # ⚠️ ADR 0041. Mutuamente exclusivo com `status` -- o schema recusa os dois
    # juntos com 422, antes de chegar aqui. Quando ele vem, o STATUS e derivado
    # dele, e nao o contrario.
    column_id: uuid.UUID | None = None
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
    @staticmethod
    def _assert_team_in_reach(team_id: uuid.UUID) -> None:
        """`team_id` escrito a mao tem de estar na lente de quem escreve.

        Spec 037 fatia 1, criterio 3 (ADR 0038, E1). Ate 06/08/2026 a
        precedencia do time em `create` era literalmente *"quem manda,
        manda"*: qualquer `team_id` passava. A TELA ja respeitava a regra
        (nao ha seletor de time no modal, e `web/lib/api.ts:702` fixa a
        raiz) -- n8n, Swagger e chamada direta, nao.

        ⚠️ Mesmo padrao e mesmo motivo da ADR 0031: a regra valia para quem
        usava a tela e nao valia para o resto dos clientes.

        ⚠️ CHAMADO EM DOIS LUGARES, e o segundo NAO estava no `plan.md`:
        `create` e `update`. O `PATCH /tasks/{id}` aceita `team_id` e o
        escrevia direto em `task.team_id` sem checar alcance nenhum -- a
        mesma porta, do lado de fora. `_assert_editable` guarda o time
        ATUAL da tarefa, nunca o novo. Fechar so o `create` deixaria a
        regra valendo na criacao e nao valendo na edicao.

        ⚠️ Lente `None` = ADMIN, e aqui `None` significa mesmo "sem filtro
        de time" -- diferente das CONSULTAS, onde `None` nunca dispensa o
        `workspace_id` (ver `board_repository.list_visible`). Nao ha
        vazamento de tenant aqui: a arvore vem do tenant corrente, entao um
        `team_id` de outro workspace nao esta nela e cai no 422.
        """
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(tenant.memberships, tenant.team_tree)
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

        # ⚠️ Spec 037, fatia 1 (criterio 3 / ADR 0038): `team_id` EXPLICITO tem
        # de estar dentro da lente de quem escreve. Ver `_assert_team_in_reach`.
        #
        # ⚠️ MORDE `command.team_id`, NAO o `team_id` resolvido acima. O valor
        # resolvido pode vir do PAI (heranca de subtarefa, ADR 0024) ou do
        # default do criador, e nenhum dos dois foi escolhido por quem chama.
        #
        # ⚠️ O MOTIVO ORIGINAL ERA OUTRO E JA NAO VALE: ate a F5 o ramo
        # `created_by` da ADR 0013 deixava o PAI estar fora da lente, e validar
        # o resolvido quebraria a criacao de subtarefa. A F5 tirou o ramo, e
        # agora quem enxerga o pai ja o alcanca por time. A regra FICA mesmo
        # assim: validar o explicito e o que a E1 pede (criterio 3), e validar
        # o resolvido acrescentaria uma segunda checagem sem regra por tras.
        if command.team_id is not None:
            self._assert_team_in_reach(command.team_id)

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

        # ⚠️ ADR 0031: NENHUMA tarefa nasce sem responsavel. A regra vivia so
        # no modal (`criacaoTarefa.motivoNaoCria`) -- ou seja, valia pra quem
        # usava a tela e nao valia pro n8n, pro Swagger nem pra duplicacao.
        # Aqui ela passa a valer pra todo cliente.
        #
        # ⚠️ Isto NAO retroage: as 37 tarefas vivas sem responsavel medidas em
        # 05/08 continuam editaveis. A regra mora na escrita de RESPONSAVEL
        # (criar e remover), nunca no PATCH de outros campos -- validar estado
        # inteiro num PATCH parcial faria editar o titulo de uma tarefa antiga
        # devolver 422, que e a forma exata do defeito de 04/08.
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
            created_by=tenant.user_id,
            path=path,
            depth=depth,
        )
        # Se ja vem como COMPLETED, marca completed_at.
        if command.status == TaskStatus.COMPLETED:
            task.completed_at = datetime.now(UTC)  # type: ignore[assignment]

        # Spec 035 (D6), fatia 2a: relogio do arquivamento. Tarefa que NASCE
        # terminal ja nasce com o relogio correndo. ⚠️ Cobre COMPLETED e
        # CANCELLED -- `completed_at` acima so conhece a primeira, e uma tarefa
        # criada direto como CANCELLED existe (o `status` vem do POST).
        # `duplicate()` passa por aqui tambem: e uma sequencia de create(), nao
        # copia de linha, entao a copia de uma tarefa concluida nasce datada.
        if is_terminal(command.status):
            task.terminal_since = datetime.now(UTC)  # type: ignore[assignment]

        # Spec 035 (D3 invertida, ADR 0033) fatia 3b: a COLUNA vem do STATUS.
        # ⚠️ ANTES do `add`, nao depois: os dois campos viram NOT NULL na
        # `0011`, e resolver depois do flush deixaria uma janela em que a linha
        # existe sem coluna. Se o status nao tiver coluna, a criacao inteira
        # falha aqui -- alto e visivel, em vez de gravar na coluna errada.
        #
        # ⚠️ SUBTAREFA HERDA O QUADRO DO PAI (F2, 06/08). Hoje o resultado e
        # IDENTICO -- ha um quadro so, e o do pai E o geral. Passa a importar no
        # dia do quadro interno, e o modo de falhar e o pior possivel: sem esta
        # linha a subtarefa nasceria com `board_id` do geral E coluna do geral,
        # que e um par internamente consistente. A FK composta ACEITA, e o
        # resultado e pai num quadro e filha em outro -- sem erro, sem tela.
        # Consistente com a ADR 0024, que ja manda a subtarefa herdar o time.
        if parent is not None:
            task.board_id = parent.board_id
            # ⚠️ O STATUS VOLTA DA COLUNA (ADR 0042 D2), e nao e sempre o
            # pedido. O quadro do pai pode ser um quadro de quatro colunas, que
            # nao conhece `PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL` nem
            # `BLOCKED`: a subtarefa cai na coluna de destino da semantica e o
            # status TEM de acompanhar, senao coluna e status discordam e a
            # invariante 3 do `invariantes.sql` sai de zero.
            task.column_id, task.status = await BoardRepository(
                self._session
            ).coluna_para_status(
                board_id=parent.board_id, status=command.status
            )
        else:
            task.board_id, task.column_id = await BoardRepository(
                self._session
            ).default_board_and_column_for_status(command.status)

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
            # ⚠️ Incoerencia do chamador, nao preferencia: mandar decisao
            # sobre subtarefa pedindo pra nao levar subtarefa nenhuma. Aceitar
            # em silencio esconderia uma caixa desmarcada por engano na tela.
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
        escolhas = responsaveis_por_filha or {}
        filhos = await self._repo.list_children(parent_task_id=origem.id)
        for filho in filhos:
            if filho.id in pular:
                continue  # ⚠️ leva a SUBARVORE dela junto (ADR 0031)
            # ⚠️ ORDEM INVERTIDA EM 05/08 (ADR 0031). Antes era criar e depois
            # designar; com a trava no `create`, criar sem responsavel deixou
            # de ser possivel -- e "criar e corrigir depois" abriria, dentro da
            # propria transacao, o estado que a ADR fecha.
            #
            # ⚠️ O ALCANCE PASSA A SER MEDIDO CONTRA `destino`, nao contra a
            # copia. E equivalente e nao e atalho: a filha herda `project_id`
            # de `destino` e o time do pai por precedencia do `create`, e
            # alcance se decide por projeto e time. Medir contra `destino`
            # responde a mesma pergunta ANTES de a filha existir.
            #
            # Precedencia: escolha explicita do passo 2 > heranca do nivel de
            # cima (neto) > responsaveis da origem filtrados por alcance.
            escolhidos = escolhas.get(filho.id, forcados)
            if escolhidos is None and levar_responsaveis:
                escolhidos = await self._herdados_da_filha(
                    origem=filho, destino=destino, pulados=pulados
                )
            if not escolhidos:
                # ⚠️ Aqui morre a excecao que a Spec 033 (D9-c) abria: "filha
                # nasce sem responsavel quando o original perdeu o alcance".
                # Com a ADR 0031 isso vira 422, e a tela resolve ANTES do POST
                # (passo 2 do modal). A mensagem NOMEIA a subtarefa: sem o
                # nome, quem clicou nao tem como saber qual das seis travou.
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
            await self._copiar_subarvore(
                origem=filho,
                destino=copia,
                pulados=pulados,
                levar_responsaveis=levar_responsaveis,
                # ⚠️ Mapa e exclusao valem SO no primeiro nivel -- por isso
                # nao descem. O que desce e `forcados`: o neto herda de quem
                # foi decidido pra mae dele.
                responsaveis_por_filha=None,
                pular=frozenset(),
                forcados=escolhidos,
            )

    async def _validar_mapa_de_subtarefas(
        self, command: DuplicateTaskCommand, source: Task
    ) -> None:
        """Chaves do passo 2 tem de ser filhas DIRETAS e VIVAS da origem.

        ⚠️ Chave desconhecida NAO pode passar em silencio. Um id de neto, ou
        de subtarefa arquivada, ou de outra tarefa, viraria uma decisao que a
        pessoa tomou na tela e que o backend ignora -- ela salva achando que
        designou alguem e a filha nasce sem ninguem. E a mesma familia do
        query param nao declarado que o FastAPI descarta calado.

        ⚠️ Lista vazia e recusada aqui, e nao mais adiante: `assign_many_or_fail`
        com lista vazia e no-op silencioso, entao a filha nasceria orfa sem
        nenhum erro. Quem nao quer a subtarefa manda em `skip_subtasks`.
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
        """Responsaveis da subtarefa que PODEM assumir a copia (D9-c).

        Devolve a lista em vez de designar: com a ADR 0031 a filha ja nasce
        com responsavel, entao a decisao precisa estar pronta ANTES do
        `create`. Quem foi descartado entra em `pulados` e volta na resposta
        (`skipped_assignees`) -- a tela avisa, e a pessoa corrige.

        ⚠️ Passar a lista crua para o `create` seria o comportamento (b) da
        D9, que NAO foi o escolhido: `assign_many_or_fail` e atomico, entao um
        unico responsavel desativado numa das seis filhas derrubaria a
        duplicacao inteira com um 422 sobre uma pessoa que quem clicou nao
        sabe que existe, numa subtarefa que ela nao viu.

        ⚠️ O alcance e medido contra `destino` -- o pai da copia --, nao
        contra a origem. A copia pode nascer em outro projeto ou sob outro
        pai, e quem alcanca uma nao alcanca necessariamente a outra. Medir na
        origem daria a resposta certa por acaso no caso comum e errada
        exatamente nos casos que a duplicacao existe pra resolver.

        Lista VAZIA e resposta legitima daqui; quem transforma isso em 422 e o
        chamador, que tem o titulo da subtarefa para a mensagem.
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

        # ⚠️ ADR 0041 -- A ESCRITA POR COLUNA E RESOLVIDA AQUI, ANTES DE TUDO.
        # Quando o PATCH manda `column_id`, ele e a fonte e o STATUS e o
        # derivado. A partir desta linha o resto do metodo trabalha com
        # `command`, que ja carrega o status resultante -- assim existe UM
        # caminho de aplicacao, e nao dois.
        #
        # ⚠️ `coluna_no_quadro` e quem VALIDA que a coluna e do quadro DESTA
        # tarefa. Sem essa consulta, o par (coluna de outro quadro, board da
        # tarefa) seria recusado la embaixo pela FK composta -- 500 em vez de
        # 422.
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

        # Calcula entries ANTES de mutar (snapshot do estado antigo).
        entries = self._diff_for_update(task, command)

        # ⚠️ A COLUNA GERA HISTORICO PROPRIO (ADR 0041, D5). Sem esta linha,
        # mover uma tarefa entre duas colunas de MESMO status nao deixaria
        # rastro nenhum -- o mesmo buraco que a designacao ja tem, e que ja
        # custou uma sessao de arqueologia. Calculado aqui porque
        # `task.column_id` ainda e o VELHO.
        if coluna_alvo is not None and coluna_alvo != task.column_id:
            entries.append(
                build_field_update_entry(
                    field_name="column_id",
                    old=task.column_id,
                    new=coluna_alvo,
                )
            )

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
            # ⚠️ Spec 037 fatia 1: a MESMA regra do `create`. `_assert_editable`
            # acima guarda o time ATUAL da tarefa; nada guardava o time NOVO.
            self._assert_team_in_reach(command.team_id)
            task.team_id = command.team_id

        # Status com ajuste de completed_at.
        virou_concluido = False
        if command.status is not None and command.status != task.status:
            if command.status == TaskStatus.COMPLETED:
                task.completed_at = datetime.now(UTC) # type: ignore[assignment]
                virou_concluido = True
            elif task.status == TaskStatus.COMPLETED:
                task.completed_at = None

            # Spec 035 (D6), fatia 2a: relogio do arquivamento.
            #
            # ⚠️ ENTRAR em terminal SEMPRE regrava, inclusive vindo de OUTRO
            # terminal (COMPLETED -> CANCELLED). Nao e detalhe: e o que o
            # produto faz HOJE. Cancelar uma concluida troca a regra de leitura
            # de `completed_at` para `updated_at`, e `updated_at` acabou de
            # virar agora -- ou seja, o relogio zera. Preservar `terminal_since`
            # nesse caso adiantaria o arquivamento em relacao ao comportamento
            # atual, e a equivalencia com a varredura de hoje e criterio de
            # aceitacao da spec, nao expectativa.
            #
            # Este bloco le `task.status` ANTES da atribuicao abaixo -- e o
            # status VELHO. Mover a linha `task.status = ...` para cima
            # transforma "saiu de terminal" em "entrou", em silencio.
            if is_terminal(command.status):
                task.terminal_since = datetime.now(UTC)  # type: ignore[assignment]
            elif is_terminal(task.status):
                task.terminal_since = None

            # Spec 035 fatia 3b: a coluna acompanha o status (ADR 0033) --
            # ⚠️ MAS SO QUANDO A ESCRITA VEIO POR `status`. Ver o bloco de
            # coluna logo abaixo do fim deste `if`.
            # ⚠️ So a COLUNA muda; `board_id` fica. Uma tarefa vive num quadro
            # so (ADR 0030, decisao B), e mudar de status nunca a muda de
            # quadro. Gravar `board_id` aqui de novo seria inofensivo hoje --
            # ha um quadro so -- e viraria defeito no dia do quadro de subtime.
            #
            # ⚠️ A coluna e procurada DENTRO do quadro DA TAREFA (F2, 06/08).
            # Antes o repositorio cravava o quadro do time raiz no SQL: com um
            # quadro so dava a resposta certa, e com dois devolveria a coluna do
            # geral para uma tarefa do quadro interno. O par
            # `(coluna do geral, board interno)` nao existe, entao a FK composta
            # recusaria -- erro alto ao salvar um status. Visivel, mas quebrado.
            if coluna_alvo is None:
                # ⚠️ `status_efetivo` E NAO `command.status` (ADR 0042 D2). Num
                # quadro de quatro colunas, pedir `BLOCKED` devolve a coluna
                # `Em Andamento` e o status `IN_PROGRESS`. Gravar o pedido aqui
                # deixaria o card em `Em Andamento` e a tarefa agrupada em
                # `Bloqueado` no `/minhas-tarefas` -- dois lugares discordando
                # sobre a mesma tarefa, que e pior que um numero velho.
                task.column_id, status_efetivo = await BoardRepository(
                    self._session
                ).coluna_para_status(
                    board_id=task.board_id, status=command.status
                )
            else:
                # Escrita veio por `column_id`: a coluna ja foi resolvida acima
                # e o status dela tambem. Aqui `command.status` e o status que
                # o proprio caminho da coluna derivou (ADR 0041).
                status_efetivo = command.status

            task.status = status_efetivo

        # ⚠️ A GRAVACAO POR COLUNA MORA FORA DO `if` DE STATUS, E ISSO E A
        # DECISAO D4 DA ADR 0041. Duas colunas de mesma semantica e sem ponte
        # -- exatamente o que a fatia 5 cria -- derivam o MESMO status: com a
        # gravacao la dentro, mover a tarefa de uma para a outra nao mudaria o
        # status, o bloco nao rodaria, e a tarefa NAO SAIRIA DA COLUNA, sem
        # erro nenhum. Arrastar o card e ve-lo voltar sozinho.
        #
        # `board_id` NAO e tocado: mover tarefa de quadro nao existe (adendo do
        # `plan.md` da 036, 10/08).
        if coluna_alvo is not None:
            task.column_id = coluna_alvo

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

        ⚠️ CASCATEIA A SUBARVORE (06/08), igual ao `archive` manual desde
        05/08. Ate aqui as duas portas de arquivamento faziam coisas
        DIFERENTES: clicar em "Arquivar" levava as filhas junto e a varredura
        da madrugada nao levava, deixando a filha ATIVA debaixo de um pai
        arquivado -- o estado que o quadro nao desenha (`depth === 0`,
        Board.tsx:580) e que so vive na checklist de uma tarefa que ninguem
        abre. Era a pendencia aberta desde 04/08.

        ⚠️ A FILHA ATIVA VAI JUNTO, e foi decisao explicita da Camila (06/08).
        O retorno e SEM PERDA: `set_archived_subtree` nao toca em `status`, e
        o `unarchive` do pai cascateia para baixo -- a filha volta com o status
        que tinha. O que se perde ao desarquivar e o status do PAI, que a
        Spec 013 (DECISAO C) zera para BACKLOG de proposito, por ele ser
        terminal.

        ⚠️ RAIZ PRIMEIRO, e a lista de `processados` NAO e otimizacao. Quando
        um pai e concluido, `complete_descendants` marca a subarvore inteira
        como COMPLETED no MESMO instante -- entao pai e filhas ficam elegiveis
        na mesma rodada, e esse e o caso COMUM, nao a excecao. Sem a ordem e o
        filtro, a filha seria arquivada pela cascata do pai E processada de
        novo pelo laco, ganhando uma linha de history que o arquivamento
        manual nunca gera.

        O retorno conta TODAS as tarefas arquivadas (raizes + cascateadas), que
        e o que o `archived=` do log sempre significou. `cascade_count` vai no
        metadata da linha do pai, igual ao `archive` manual; filha cascateada
        nao ganha linha propria (ADR 0005, mesma forma do soft-delete).
        """
        effective_days = (
            settings.stale_archive_days if days is None else days
        )
        stale = list(
            await self._repo.list_stale_terminal(now=now, days=effective_days)
        )
        # Raiz antes de folha. `path` desempata para a ordem ser estavel entre
        # execucoes -- log de job que muda de ordem sozinho e ruim de diffar.
        stale.sort(key=lambda t: (t.depth, t.path))

        processados: list[str] = []
        count = 0
        cascateadas = 0
        for task in stale:
            if any(task.path.startswith(f"{p}.") for p in processados):
                # Ja foi arquivada pela cascata de um ancestral NESTA rodada.
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
                # ⚠️ Log POR PAI, e nao por filha. O `path` do pai e o que
                # localiza as arrastadas depois
                # (`WHERE path <@ CAST('<path>' AS ltree)`), entao uma linha
                # por cascata basta para reconstruir quem sumiu do quadro --
                # sem uma query a mais por tarefa dentro do job.
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
        task_guards), que cobre privacidade do pessoal e lente de time.
        ⚠️ `created_by` NAO entra mais (Spec 037, E1). Levanta
        EntityNotFoundError (404) -- nao 403 -- pra nao vazar existencia.
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
