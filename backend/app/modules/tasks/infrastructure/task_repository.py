"""Repository da entidade Task (tenant e soft delete via `_base_select`).

As operacoes de subarvore usam SQL textual com o filtro de tenant escrito a mao.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import (
    Select,
    Subquery,
    and_,
    case,
    delete,
    exists,
    func,
    literal_column,
    not_,
    or_,
    select,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement

from app.core.tenant import TeamNode, require_tenant
from app.db.models import (
    BoardColumn,
    Project,
    Task,
    TaskAssignment,
    TaskHistory,
    TaskWatcher,
    Team,
    User,
    UserTeam,
)
from app.db.models.enums import ColumnSemantic
from app.db.repository import BaseRepository
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.archival import TERMINAL_STATUSES
from app.modules.tasks.domain.board_semantics import TERMINAL_SEMANTICS
from app.modules.tasks.domain.dashboard import (
    DAYS_AHEAD,
    Bucket,
    Period,
    WorkspaceNow,
    chart_buckets,
)
from app.modules.tasks.domain.history import HistoryEntry
from app.modules.tasks.domain.perda_de_alcance import (
    RelacaoPerdida,
    TarefaBloqueio,
)
from app.modules.tasks.domain.subtask_progress import (
    SEMANTICA_CONCLUIDA,
    Progresso,
)
from app.shared.pagination import Page, PageParams


@dataclass(frozen=True)
class DashboardItem:
    """Uma tarefa citada num card do painel: o bastante para o link."""

    id: uuid.UUID
    title: str
    due_date: date | None
    due_time: time | None
    parent_id: uuid.UUID | None
    priority: str
    column_name: str
    column_color: str


@dataclass(frozen=True)
class DashboardCounts:
    """Os numeros dos cards que todos veem, como o banco os contou."""

    overdue_count: int
    #: A janela do resumo: a semana corrente, ou o periodo escolhido.
    summary_start: date
    summary_end: date
    done: int
    total: int
    #: Abertas e ainda no prazo: as que vencem hoje, ou as do periodo.
    on_time_total: int
    bucket_unit: str
    buckets: list[BucketCounts]
    oldest_overdue: list[DashboardItem]
    my_overdue: list[DashboardItem]
    my_overdue_total: int
    my_on_time: list[DashboardItem]
    my_on_time_total: int


@dataclass(frozen=True)
class DashboardExportRow:
    """Uma tarefa da planilha do painel: o que o painel contou."""

    title: str
    state: str  # "done" | "on_time" | "overdue"
    column_name: str
    priority: str
    due_date: date | None
    due_time: time | None
    assignees: str
    parent_title: str | None


@dataclass(frozen=True)
class BucketCounts:
    start: date
    end: date
    done: int
    on_time: int
    overdue: int


@dataclass(frozen=True)
class Workload:
    user_id: uuid.UUID
    name: str
    open_count: int
    overdue_count: int
    #: Conta desativada com tarefa aberta: a tela a marca como trabalho orfao.
    is_active: bool


def _casa_busca_na_subarvore(
    termo: str, *, pode_ver_arquivada: bool
) -> ColumnElement[bool]:
    """A busca do quadro: casa o titulo da tarefa ou de qualquer descendente.

    Devolve a raiz, porque o card do quadro e sempre a raiz; o `<@` do LTREE e
    descendente-ou-igual, entao um EXISTS cobre a propria linha tambem. So
    titulo, nao descricao. `%` e `_` no termo viram curinga (nao escapados).
    """
    descendente = aliased(Task)
    padrao = f"%{termo.strip()}%"
    sub = (
        select(1)
        .select_from(descendente)
        .where(
            descendente.path.op("<@")(Task.path),
            descendente.workspace_id == Task.workspace_id,
            descendente.deleted_at.is_(None),
            func.unaccent(func.lower(descendente.title)).like(
                func.unaccent(func.lower(padrao))
            ),
        )
    )
    if not pode_ver_arquivada:
        sub = sub.where(descendente.is_archived.is_(False))
    return sub.exists()


def _lente_de_time(visible: frozenset[uuid.UUID]) -> ColumnElement[bool]:
    """A lente de time em SQL; nao chamar com `visible=None` (admin).

    `None` quer dizer "sem filtro de time", nao "sem filtro": o tenant vem do
    `_base_select`. Exige `Project` no FROM (outerjoin).
    """
    return _time_efetivo_em(visible)


def _time_efetivo_em(
    times: frozenset[uuid.UUID] | set[uuid.UUID],
) -> ColumnElement[bool]:
    """"O time da tarefa esta neste conjunto?" -- usado pela lente e pelo recorte.

    Nao use `coalesce(Project.team_id, Task.team_id)`: com projeto invisivel o
    outerjoin deixa `Project.team_id` NULL e o coalesce cairia no time da
    tarefa, mostrando tarefa de projeto que a pessoa nao ve. Exige `Project`
    no FROM (outerjoin).
    """
    return or_(
        # projeto cujo time esta no conjunto -> vale para todas as tarefas dele
        Project.team_id.in_(times),
        # avulsa cujo proprio time esta no conjunto
        and_(
            Task.project_id.is_(None),
            Task.team_id.in_(times),
        ),
    )


def _sob_o_time(
    team_id: uuid.UUID, tree: tuple[TeamNode, ...]
) -> ColumnElement[bool]:
    """O recorte da tela: tarefas do time e dos descendentes dele.

    Diferente do filtro `team_id` de `GET /tasks`, que compara so `Task.team_id`
    e ignoraria subtimes e o time do projeto.
    """
    return _time_efetivo_em({team_id} | team_scope.descendants(team_id, tree))


class TaskRepository(BaseRepository[Task]):
    """Acesso a dados de tasks, escopado ao tenant corrente."""

    model = Task

    # ----------------------------------------------------
    # Filhos diretos
    # ----------------------------------------------------
    async def list_children(
        self, *, parent_task_id: uuid.UUID, include_archived: bool = False
    ) -> list[Task]:
        """Filhos diretos de uma task, em ordem de `position`.

        Sem arquivadas por padrao: a contagem da tela conta as mesmas linhas.
        """
        stmt = self._base_select().where(Task.parent_task_id == parent_task_id)
        if not include_archived:
            stmt = stmt.where(Task.is_archived.is_(False))
        # `Task.id` desempata irmas criadas na mesma transacao.
        stmt = stmt.order_by(
            Task.position.asc(), Task.created_at.asc(), Task.id
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # ----------------------------------------------------
    # Listagem com filtros + privacidade
    # ----------------------------------------------------
    async def list_page_with_filters(
        self,
        params: PageParams,
        *,
        project_id: uuid.UUID | None = None,
        parent_task_id: uuid.UUID | None = None,
        root_only: bool = False,
        status: ColumnElement | None = None,
        priority: ColumnElement | None = None,
        team_id: uuid.UUID | None = None,
        under_team_id: uuid.UUID | None = None,
        created_by: uuid.UUID | None = None,
        include_archived: bool = False,
        archived_only: bool = False,
        q: str | None = None,
    ) -> Page[Task]:
        """Lista tasks com filtros e a lente de time.

        `q` busca por titulo, inclusive de descendentes, e devolve a raiz.
        """
        tenant = require_tenant()
        base = self._base_select()

        # LEFT JOIN: tarefa avulsa nao some, e `_lente_de_time` le `Project.team_id`.
        visible = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )  # None = admin (sem filtro de time)

        base = base.outerjoin(
            Project,
            and_(
                Project.id == Task.project_id,
                Project.workspace_id == Task.workspace_id,
            ),
        )

        if visible is not None:
            base = base.where(_lente_de_time(visible))

        if project_id is not None:
            base = base.where(Task.project_id == project_id)
        if root_only:
            base = base.where(Task.parent_task_id.is_(None))
        elif parent_task_id is not None:
            base = base.where(Task.parent_task_id == parent_task_id)
        if status is not None:
            base = base.where(Task.status == status)
        if priority is not None:
            base = base.where(Task.priority == priority)
        if team_id is not None:
            base = base.where(Task.team_id == team_id)
        if under_team_id is not None:
            base = base.where(_sob_o_time(under_team_id, tenant.team_tree))
        if created_by is not None:
            base = base.where(Task.created_by == created_by)
        if q is not None and q.strip() != "":
            base = base.where(
                _casa_busca_na_subarvore(
                    q,
                    # sem `or archived_only`, a busca em Arquivadas volta sempre
                    # vazia: a raiz arquivada nao casaria consigo mesma.
                    pode_ver_arquivada=include_archived or archived_only,
                )
            )
        # archived_only tem precedencia; senao, include_archived decide.
        if archived_only:
            base = base.where(Task.is_archived.is_(True))
        elif not include_archived:
            base = base.where(Task.is_archived.is_(False))

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        # `created_at` e o instante da transacao e empata entre tasks criadas juntas;
        # `Task.id` torna a ordem estavel (nao semantica: e UUIDv4).
        page_stmt = (
            base.order_by(Task.created_at.desc(), Task.id)
            .limit(params.limit)
            .offset(params.offset)
        )
        items = list((await self.session.execute(page_stmt)).scalars().all())

        return Page(items=items, total=total, page=params.page, size=params.size)

    # ----------------------------------------------------
    # /me/assignments -- relacoes do usuario corrente
    # ----------------------------------------------------
    async def titles_for_ids(
        self, task_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        """Titulos de um conjunto de tasks numa query so (evita N+1).

        Filtrado por tenant: mae de outro workspace nao volta.
        """
        if not task_ids:
            return {}
        stmt = self._base_select().where(Task.id.in_(task_ids))
        rows = (await self.session.execute(stmt)).scalars().all()
        return {t.id: t.title for t in rows}

    async def buscar_no_quadro(
        self,
        *,
        board_id: uuid.UUID,
        q: str,
        excluir: Task | None,
        limite: int = 20,
    ) -> list[tuple[Task, list[str]]]:
        """Tarefas de qualquer nivel do quadro, pelo titulo, com o caminho.

        Devolve `(tarefa, titulos das ancestrais da raiz para baixo)`, pela lente
        de quem busca, sem arquivadas e sem a `excluir` e a subarvore dela.
        """
        tenant = require_tenant()
        stmt = self._base_select().outerjoin(
            Project,
            and_(
                Project.id == Task.project_id,
                Project.workspace_id == Task.workspace_id,
            ),
        )
        visible = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
        if visible is not None:
            stmt = stmt.where(_lente_de_time(visible))
        stmt = stmt.where(
            Task.board_id == board_id,
            Task.is_archived.is_(False),
        )
        termo = q.strip()
        if termo:
            # A dobra de acento da busca do quadro (`_casa_busca_na_subarvore`).
            stmt = stmt.where(
                func.unaccent(func.lower(Task.title)).like(
                    func.unaccent(func.lower(f"%{termo}%"))
                )
            )
        if excluir is not None:
            stmt = stmt.where(~Task.path.op("<@")(excluir.path))
        stmt = stmt.order_by(Task.depth, Task.title, Task.id).limit(limite)
        tarefas = list((await self.session.execute(stmt)).scalars().all())

        # O caminho: os rotulos do `path` sao `t` + hex do id.
        ancestrais = {
            uuid.UUID(hex=rotulo[1:])
            for t in tarefas
            for rotulo in t.path.split(".")[:-1]
        }
        titulos: dict[uuid.UUID, str] = {}
        if ancestrais:
            # Pela mesma lente: ancestral que a pessoa nao ve vira "…".
            consulta = (
                self._base_select()
                .with_only_columns(Task.id, Task.title)
                .outerjoin(
                    Project,
                    and_(
                        Project.id == Task.project_id,
                        Project.workspace_id == Task.workspace_id,
                    ),
                )
                .where(Task.id.in_(ancestrais))
            )
            if visible is not None:
                consulta = consulta.where(_lente_de_time(visible))
            titulos = dict((await self.session.execute(consulta)).all())
        return [
            (
                t,
                [
                    titulos.get(uuid.UUID(hex=rotulo[1:]), "…")
                    for rotulo in t.path.split(".")[:-1]
                ],
            )
            for t in tarefas
        ]

    async def list_my_relations(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
        under_team_id: uuid.UUID | None,
    ) -> Page[tuple[Task, Project | None, frozenset[str]]]:
        """Tasks do tenant onde sou assignee/creator/watcher, pela lente de time.

        Os tres vinculos sao computados sempre (preenchem `relations`); o recorte
        e o OR das relacoes selecionadas. Ser responsavel ou observador nao
        concede leitura: a task fora da lente nao aparece.
        """
        tenant = require_tenant()
        me = tenant.user_id

        is_assignee = (
            exists()
            .where(TaskAssignment.task_id == Task.id)
            .where(TaskAssignment.workspace_id == Task.workspace_id)
            .where(TaskAssignment.user_id == me)
        )
        is_watcher = (
            exists()
            .where(TaskWatcher.task_id == Task.id)
            .where(TaskWatcher.workspace_id == Task.workspace_id)
            .where(TaskWatcher.user_id == me)
        )
        is_creator = Task.created_by == me

        base = (
            self._base_select()
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .add_columns(
                Project,
                is_assignee.label("rel_assignee"),
                is_creator.label("rel_creator"),
                is_watcher.label("rel_watcher"),
            )
        )

        visible = team_scope.visible_team_ids(tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,)
        if visible is not None:
            base = base.where(_lente_de_time(visible))

        # Recorte do time ativo; `None` = todos os times.
        if under_team_id is not None:
            base = base.where(_sob_o_time(under_team_id, tenant.team_tree))

        # Recorte por relacao (OR); o router garante `relations` nao vazio.
        selected: list[ColumnElement[bool]] = []
        if "assignee" in relations:
            selected.append(is_assignee)
        if "creator" in relations:
            selected.append(is_creator)
        if "watcher" in relations:
            selected.append(is_watcher)
        base = base.where(or_(*selected))

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        page_stmt = (
            base.order_by(Task.updated_at.desc(), Task.id).limit(params.limit).offset(params.offset)
        )
        rows = (await self.session.execute(page_stmt)).all()

        items: list[tuple[Task, Project | None, frozenset[str]]] = []
        for task, project, r_assignee, r_creator, r_watcher in rows:
            rels = {
                name
                for name, on in (
                    ("assignee", r_assignee),
                    ("creator", r_creator),
                    ("watcher", r_watcher),
                )
                if on
            }
            items.append((task, project, frozenset(rels)))

        return Page(items=items, total=total, page=params.page, size=params.size)

    # ----------------------------------------------------
    # Operacoes de subtree (SQL textual, tenant explicito)
    # ----------------------------------------------------
    async def reparent_subtree(
        self,
        *,
        task: Task,
        old_path: str,
        old_depth: int,
        new_parent_path: str | None,
        new_parent_depth: int | None,
        new_parent_task_id: uuid.UUID | None,
        new_project_id: uuid.UUID | None,
    ) -> None:
        """Atualiza path/depth/project_id/parent_task_id da task e
        de toda a subtree.

        `new_project_id=None`: a task e a subtree viram avulsas.
        SQL textual com predicado de tenant manual.

        Args:
            task: task alvo (estado atual ainda).
            old_path: path atual da task (label_da_task como sufixo).
            old_depth: depth atual.
            new_parent_path: path do novo pai (None se task virar raiz).
            new_parent_depth: depth do novo pai (None se raiz).
            new_parent_task_id: id do novo pai (None se raiz).
            new_project_id: novo project_id (igual ao atual se nao trocou).
        """
        tenant = require_tenant()
        old_label = old_path.split(".")[-1]

        if new_parent_path is None:
            new_self_path = old_label
            new_self_depth = 0
        else:
            new_self_path = f"{new_parent_path}.{old_label}"
            new_self_depth = (new_parent_depth or 0) + 1

        depth_delta = new_self_depth - old_depth

        # UPDATE 1: a propria task.
        await self.session.execute(
            text(
                """
                UPDATE task
                SET path = CAST(:new_path AS ltree),
                    depth = :new_depth,
                    parent_task_id = :new_parent,
                    project_id = :new_project
                WHERE id = :task_id
                  AND workspace_id = :tenant_id
                """
            ),
            {
                "new_path": new_self_path,
                "new_depth": new_self_depth,
                "new_parent": new_parent_task_id,
                "new_project": new_project_id,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )

        # UPDATE 2: descendentes. `subpath(path, old_depth + 1)` corta o path antigo
        # inteiro, rotulo da task incluido (o indice do subpath comeca em 0).
        await self.session.execute(
            text(
                """
                UPDATE task
                SET path = CAST(:new_self_path AS ltree)
                           || subpath(path, :old_depth + 1),
                    depth = depth + :depth_delta,
                    project_id = :new_project
                WHERE path <@ CAST(:old_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                """
            ),
            {
                "new_self_path": new_self_path,
                "old_depth": old_depth,
                "depth_delta": depth_delta,
                "new_project": new_project_id,
                "old_path": old_path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )

        task.path = new_self_path
        task.depth = new_self_depth
        task.parent_task_id = new_parent_task_id
        task.project_id = new_project_id

    async def soft_delete_subtree(self, *, task: Task) -> int:
        """Soft-delete da task e de toda a subtree.

        Retorna o numero de descendentes apagados (sem a propria task).
        """
        tenant = require_tenant()

        # A task e todos os descendentes; nao re-marca as ja apagadas.
        result = await self.session.execute(
            text(
                """
                UPDATE task
                SET deleted_at = NOW()
                WHERE path <@ CAST(:task_path AS ltree)
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                """
            ),
            {
                "task_path": task.path,
                "tenant_id": tenant.workspace_id,
            },
        )

        # rowcount inclui a propria task.
        total_affected = result.rowcount or 0
        cascade_count = max(0, total_affected - 1)

        task.deleted_at = func.now()  # type: ignore[assignment]
        return cascade_count

    async def complete_descendants(self, *, task: Task) -> int:
        """Conclui todos os descendentes de `task` (nao a propria task).

        Pula ja concluidos, cancelados e arquivados. Retorna quantos mudaram.

        UPDATE textual nao dispara o `onupdate` do ORM: `updated_at`,
        `terminal_since` e `column_id` sao gravados aqui. A coluna e a do quadro
        de cada descendente, pela mesma regra de `BoardRepository.coluna_para_status`
        (ponte `legacy_status` primeiro, depois `is_default_target` da semantica
        DONE); `DESC NULLS LAST` porque a comparacao e NULL em coluna sem ponte.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                UPDATE task t
                SET status = CAST('COMPLETED' AS task_status),
                    completed_at = NOW(),
                    terminal_since = NOW(),
                    updated_at = NOW(),
                    column_id = (
                        SELECT c.id FROM board_column c
                        WHERE c.board_id = t.board_id
                          AND (
                            c.legacy_status
                                = CAST('COMPLETED' AS task_status)
                            OR (
                              c.is_default_target
                              AND c.semantic
                                  = CAST('DONE' AS column_semantic)
                            )
                          )
                        ORDER BY (
                          c.legacy_status
                              = CAST('COMPLETED' AS task_status)
                        ) DESC NULLS LAST
                        LIMIT 1
                    )
                WHERE path <@ CAST(:task_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND is_archived = false
                  AND status NOT IN (
                        CAST('COMPLETED' AS task_status),
                        CAST('CANCELLED' AS task_status)
                      )
                """
            ),
            {
                "task_path": task.path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )
        return result.rowcount or 0

    async def set_archived_subtree(self, *, task: Task, archived: bool) -> int:
        """Arquiva (ou desarquiva) todos os descendentes de `task`.

        Nao inclui a propria task. Retorna quantos descendentes mudaram.
        UPDATE em massa nao atualiza objetos ja carregados no ORM; `updated_at`
        e gravado aqui pelo mesmo motivo. Desarquivar recomeca `terminal_since`,
        senao a varredura noturna arquivaria as filhas de novo.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                UPDATE task
                SET is_archived = :alvo,
                    terminal_since = CASE
                        WHEN :alvo OR terminal_since IS NULL THEN terminal_since
                        ELSE NOW()
                    END,
                    updated_at = NOW()
                WHERE path <@ CAST(:task_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND is_archived <> :alvo
                """
            ),
            {
                "alvo": archived,
                "task_path": task.path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )
        return result.rowcount or 0

    async def detect_cycle(
        self,
        *,
        task: Task,
        new_parent_id: uuid.UUID,
    ) -> bool:
        """Retorna True se mover `task` para baixo de `new_parent_id`
        criaria ciclo (novo pai eh descendente de task).

        Usa LTREE: `new_parent.path <@ task.path`.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                SELECT 1
                FROM task
                WHERE id = :new_parent_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND path <@ CAST(:task_path AS ltree)
                LIMIT 1
                """
            ),
            {
                "new_parent_id": new_parent_id,
                "tenant_id": tenant.workspace_id,
                "task_path": task.path,
            },
        )
        return result.scalar_one_or_none() is not None

    # ----------------------------------------------------
    # task_history
    # ----------------------------------------------------
    async def list_stale_terminal(
        self, *, now: datetime, days: int
    ) -> list[Task]:
        """Tasks terminais paradas ha mais de `days` dias, para o arquivamento.

        Par de `domain.archival.is_stale_terminal`: mudou aqui, muda la.
        """
        cutoff = now - timedelta(days=days)
        stmt = (
            self._base_select()
            .where(
                Task.is_archived.is_(False),
                Task.status.in_(tuple(TERMINAL_STATUSES)),
                Task.terminal_since.is_not(None),
                Task.terminal_since < cutoff,
            )
            # Duas varreduras simultaneas nao pegam as mesmas tarefas.
            .with_for_update(skip_locked=True)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_history(
        self, *, task_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[TaskHistory], int]:
        """As linhas de historico de uma tarefa, mais nova primeiro.

        Desempate por `id`: `now()` e constante na transacao, e sem ele a
        paginacao repete ou pula linha. Sem `_base_select` (tipado em `Task`):
        o filtro de tenant aqui e obrigatorio.
        """
        tenant = require_tenant()
        onde = (
            TaskHistory.workspace_id == tenant.workspace_id,
            TaskHistory.task_id == task_id,
        )
        total = (
            await self.session.execute(
                select(func.count()).select_from(TaskHistory).where(*onde)
            )
        ).scalar_one()
        linhas = (
            await self.session.execute(
                select(TaskHistory)
                .where(*onde)
                .order_by(TaskHistory.created_at.desc(), TaskHistory.id.desc())
                .offset(offset)
                .limit(limit)
            )
        ).scalars().all()
        return list(linhas), total

    async def write_history(
        self,
        *,
        task: Task,
        user_id: uuid.UUID,
        entries: list[HistoryEntry],
    ) -> None:
        """Insere linhas em task_history. Append-only.

        NAO faz commit -- mesma sessao do caller (atomico no UoW).
        """
        await self.write_history_por_id(
            task_id=task.id, user_id=user_id, entries=entries
        )

    async def write_history_por_id(
        self,
        *,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        entries: list[HistoryEntry],
    ) -> None:
        """O `write_history` para quem so tem o id da tarefa."""
        if not entries:
            return

        tenant = require_tenant()
        for entry in entries:
            row = TaskHistory(
                workspace_id=tenant.workspace_id,
                task_id=task_id,
                user_id=user_id,
                event_type=entry.event_type.value,
                field_name=entry.field_name,
                old_value=entry.old_value,
                new_value=entry.new_value,
                event_metadata=entry.metadata,
            )
            self.session.add(row)

    # ----------------------------------------------------
    # Perda de alcance
    # ----------------------------------------------------
    async def bloqueios_por_perda_de_alcance(
        self,
        *,
        user_id: uuid.UUID,
        times_depois: frozenset[uuid.UUID] | None,
    ) -> list[TarefaBloqueio]:
        """De quais tarefas ela e a unica responsavel e deixaria de alcancar?

        `times_depois` e a lente que a pessoa teria depois da mudanca de vinculo;
        `None` = admin, nada bloqueia. Terminal vem da semantica da coluna. O time
        que decide o alcance e `COALESCE(project.team_id, task.team_id)`, igual a
        `task_guards.task_visible`. Regra unica: nao duplicar.
        """
        tenant = require_tenant()
        if times_depois is None:
            return []

        # Um responsavel so, e e ela: o count e sobre todas as designacoes da
        # tarefa, nao so as dela.
        unico = (
            select(TaskAssignment.task_id)
            .where(TaskAssignment.workspace_id == tenant.workspace_id)
            .group_by(TaskAssignment.task_id)
            .having(func.count() == 1)
            # `bool_and`, nao `min(user_id)`: `min(uuid)` nao existe no Postgres.
            .having(func.bool_and(TaskAssignment.user_id == user_id))
            .subquery()
        )

        time_efetivo = func.coalesce(Project.team_id, Task.team_id)

        stmt = (
            select(
                Task.id,
                Task.title,
                time_efetivo.label("team_id"),
                Team.name.label("subtime"),
                BoardColumn.name.label("coluna"),
            )
            .join(unico, unico.c.task_id == Task.id)
            .join(
                BoardColumn,
                and_(
                    BoardColumn.id == Task.column_id,
                    BoardColumn.board_id == Task.board_id,
                ),
            )
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .outerjoin(
                Team,
                and_(
                    Team.id == time_efetivo,
                    Team.workspace_id == Task.workspace_id,
                ),
            )
            # Fora de qualquer `if`: o tenant entra sempre.
            .where(Task.workspace_id == tenant.workspace_id)
            .where(Task.deleted_at.is_(None))
            .where(Task.is_archived.is_(False))
            .where(BoardColumn.semantic.not_in(TERMINAL_SEMANTICS))
            .where(
                or_(
                    time_efetivo.is_(None),
                    time_efetivo.not_in(times_depois),
                )
            )
            .order_by(Task.title)
        )

        rows = (await self.session.execute(stmt)).all()
        return [
            TarefaBloqueio(
                task_id=r.id,
                titulo=r.title,
                team_id=r.team_id,
                subtime=r.subtime,
                coluna=r.coluna,
            )
            for r in rows
        ]

    async def relacoes_perdidas(
        self,
        *,
        user_id: uuid.UUID,
        times_depois: frozenset[uuid.UUID] | None,
    ) -> list[RelacaoPerdida]:
        """Tudo que ela deixa de alcancar e ainda tem relacao.

        Conjunto maior que o de `bloqueios_por_perda_de_alcance`: inclui
        terminal, tarefa com outros responsaveis e observador. Arquivada e
        apagada ficam fora. `times_depois=None` = admin, nada perde.
        """
        tenant = require_tenant()
        if times_depois is None:
            return []

        time_efetivo = func.coalesce(Project.team_id, Task.team_id)
        eh_resp = exists(
            select(1).where(
                TaskAssignment.task_id == Task.id,
                TaskAssignment.user_id == user_id,
                TaskAssignment.workspace_id == tenant.workspace_id,
            )
        )
        eh_obs = exists(
            select(1).where(
                TaskWatcher.task_id == Task.id,
                TaskWatcher.user_id == user_id,
                TaskWatcher.workspace_id == tenant.workspace_id,
            )
        )

        stmt = (
            select(
                Task.id,
                Task.title,
                time_efetivo.label("team_id"),
                Team.name.label("subtime"),
                eh_resp.label("era_responsavel"),
                eh_obs.label("era_observador"),
            )
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .outerjoin(
                Team,
                and_(
                    Team.id == time_efetivo,
                    Team.workspace_id == Task.workspace_id,
                ),
            )
            .where(Task.workspace_id == tenant.workspace_id)
            .where(Task.deleted_at.is_(None))
            .where(Task.is_archived.is_(False))
            .where(or_(eh_resp, eh_obs))
            .where(
                or_(
                    time_efetivo.is_(None),
                    time_efetivo.not_in(times_depois),
                )
            )
            .order_by(Task.title)
        )

        rows = (await self.session.execute(stmt)).all()
        return [
            RelacaoPerdida(
                task_id=r.id,
                titulo=r.title,
                team_id=r.team_id,
                subtime=r.subtime,
                era_responsavel=r.era_responsavel,
                era_observador=r.era_observador,
            )
            for r in rows
        ]

    async def apagar_relacoes(
        self, *, user_id: uuid.UUID, task_ids: list[uuid.UUID]
    ) -> tuple[int, list[uuid.UUID]]:
        """Apaga responsavel e observador dela nessas tarefas.

        Devolve `(responsaveis apagados, tarefas em que ela seguia)`. DELETE em
        massa: nao atualiza objetos ja carregados na sessao.
        """
        if not task_ids:
            return (0, 0)

        tenant = require_tenant()
        resp = await self.session.execute(
            delete(TaskAssignment).where(
                TaskAssignment.workspace_id == tenant.workspace_id,
                TaskAssignment.user_id == user_id,
                TaskAssignment.task_id.in_(task_ids),
            )
        )
        obs = await self.session.execute(
            delete(TaskWatcher)
            .where(
                TaskWatcher.workspace_id == tenant.workspace_id,
                TaskWatcher.user_id == user_id,
                TaskWatcher.task_id.in_(task_ids),
            )
            .returning(TaskWatcher.task_id)
        )
        return (resp.rowcount or 0, list(obs.scalars().all()))

    async def ids_da_subarvore(self, *, path: str) -> list[uuid.UUID]:
        """Ids vivos da tarefa de `path` e de todas as descendentes.

        Chamar antes do reparent: os ids nao mudam, o `path` sim.
        """
        rows = await self.session.execute(
            text(
                """
                SELECT id FROM task
                WHERE path <@ CAST(:path AS ltree)
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                """
            ),
            {"path": path, "tenant_id": require_tenant().workspace_id},
        )
        return [r[0] for r in rows.all()]

    async def travar_subarvore(self, *, path: str) -> None:
        """Trava (`FOR UPDATE`) a tarefa de `path` e todas as descendentes.

        Impede que um `create` (que trava a mae com `FOR SHARE`) ponha filha na
        subarvore enquanto o mover reescreve quadro e time. Chamar antes de
        `ids_da_subarvore`, que entao ja enxerga tudo.
        """
        await self.session.execute(
            text(
                """
                SELECT id FROM task
                WHERE path <@ CAST(:path AS ltree)
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                ORDER BY id
                FOR UPDATE
                """
            ),
            {"path": path, "tenant_id": require_tenant().workspace_id},
        )

    # ----------------------------------------------------
    # Agregacao de subtarefa para a listagem
    # ----------------------------------------------------
    # LTREE e agregacao com FILTER, fora do `_base_select`: o filtro de tenant
    # vem explicito em toda tabela das duas queries.

    async def subtask_progress_for_tasks(
        self, parent_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Progresso]:
        """Checklist de varias tasks numa query -- pro contador do card.

        Devolve `{parent_id: Progresso}` com todo id pedido presente. Conta so
        filha direta e sempre sem arquivada; coluna nao resolvida entra no total
        mas nao como concluida.
        """
        if not parent_ids:
            return {}
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                SELECT f.parent_task_id AS parent_id,
                       COUNT(*) AS total,
                       COUNT(*) FILTER (
                           WHERE c.semantic::text = :semantica_concluida
                       ) AS concluidas
                FROM task f
                LEFT JOIN board_column c
                       ON c.id = f.column_id
                      AND c.workspace_id = f.workspace_id
                WHERE f.workspace_id = :tenant_id
                  AND f.deleted_at IS NULL
                  AND f.is_archived = false
                  AND f.parent_task_id = ANY(CAST(:parent_ids AS uuid[]))
                GROUP BY f.parent_task_id
                """
            ),
            {
                "tenant_id": tenant.workspace_id,
                "semantica_concluida": SEMANTICA_CONCLUIDA.value,
                "parent_ids": [str(pid) for pid in parent_ids],
            },
        )
        out: dict[uuid.UUID, Progresso] = {
            pid: Progresso(concluidas=0, total=0) for pid in parent_ids
        }
        for parent_id, total, concluidas in result.all():
            out[parent_id] = Progresso(
                concluidas=int(concluidas), total=int(total)
            )
        return out

    async def subtree_assignee_ids_for_tasks(
        self, root_ids: list[uuid.UUID], *, include_archived: bool
    ) -> dict[uuid.UUID, list[uuid.UUID]]:
        """Responsaveis da subarvore de varias tasks, raiz inclusa, numa query.

        Alimenta o filtro por pessoa do quadro. `include_archived` acompanha o
        da listagem. Ordem nao e garantida.
        """
        if not root_ids:
            return {}
        tenant = require_tenant()
        filtro_arquivada = "" if include_archived else "AND d.is_archived = false"
        result = await self.session.execute(
            text(
                f"""
                SELECT r.id AS raiz_id, a.user_id AS user_id
                FROM task r
                JOIN task d
                  ON d.path <@ r.path
                 AND d.workspace_id = r.workspace_id
                 AND d.deleted_at IS NULL
                 {filtro_arquivada}
                JOIN task_assignment a
                  ON a.task_id = d.id
                 AND a.workspace_id = d.workspace_id
                WHERE r.workspace_id = :tenant_id
                  AND r.deleted_at IS NULL
                  AND r.id = ANY(CAST(:root_ids AS uuid[]))
                GROUP BY r.id, a.user_id
                """
            ),
            {
                "tenant_id": tenant.workspace_id,
                "root_ids": [str(rid) for rid in root_ids],
            },
        )
        out: dict[uuid.UUID, list[uuid.UUID]] = {rid: [] for rid in root_ids}
        for raiz_id, user_id in result.all():
            out.setdefault(raiz_id, []).append(user_id)
        return out

    async def subtree_team_ids(self, task: Task) -> set[uuid.UUID | None]:
        """Times da subarvore da task, ela inclusa e arquivadas tambem."""
        stmt = (
            self._base_select()
            .with_only_columns(Task.team_id)
            .where(Task.path.op("<@")(task.path))
            .distinct()
        )
        return set((await self.session.execute(stmt)).scalars().all())

    # ----------------------------------------------------
    # Tela inicial do time
    # ----------------------------------------------------
    def _dashboard_tasks(
        self, under_team_id: uuid.UUID | None, assignee_id: uuid.UUID | None = None
    ) -> Subquery:
        """As tarefas que o painel conta: a mesma consulta-base da listagem.

        Tenant, lente e recorte iguais aos de `list_page_with_filters`, para o
        painel nao contar tarefa que a pessoa nao abre. Sem filtro de arquivada:
        concluida arquivada conta. `assignee_id` restringe as tarefas dela.
        """
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
        base = (
            self._base_select()
            .with_only_columns(
                Task.id,
                Task.title,
                Task.due_date,
                Task.due_time,
                Task.is_archived,
                Task.parent_task_id,
                Task.priority,
                BoardColumn.semantic,
                BoardColumn.notify_deadline,
                BoardColumn.name.label("column_name"),
                BoardColumn.color.label("column_color"),
            )
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .join(BoardColumn, BoardColumn.id == Task.column_id)
        )
        if visible is not None:
            base = base.where(_lente_de_time(visible))
        if under_team_id is not None:
            base = base.where(_sob_o_time(under_team_id, tenant.team_tree))
        if assignee_id is not None:
            base = base.where(
                exists().where(
                    TaskAssignment.task_id == Task.id,
                    TaskAssignment.user_id == assignee_id,
                )
            )
        return base.subquery("t")

    async def dashboard_counts(
        self,
        under_team_id: uuid.UUID | None,
        now: WorkspaceNow,
        *,
        me: uuid.UUID,
        assignee_id: uuid.UUID | None = None,
        period: Period | None = None,
    ) -> DashboardCounts:
        """Os numeros dos cards que todos veem; `period` recorta pelo prazo."""
        t = self._dashboard_tasks(under_team_id, assignee_id)
        p = _DashboardPredicates(t, now, period)

        summary = (
            await self.session.execute(
                select(
                    func.count().filter(p.overdue),
                    func.count().filter(p.done),
                    func.count().filter(p.counted),
                    func.count().filter(p.on_time),
                ).select_from(t)
            )
        ).one()

        # O grafico: os 7 dias a partir de hoje, ou o periodo -- por dia, ou
        # por semana quando o periodo passa de 14 dias.
        if period is None:
            window_start, window_end = now.today, now.today + timedelta(days=DAYS_AHEAD - 1)
        else:
            window_start, window_end = period.start, period.end
        unit, buckets = chart_buckets(window_start, window_end)
        buckets_counts = await self._bucket_counts(t, p, buckets)

        def item_columns() -> Select:
            return select(
                t.c.id,
                t.c.title,
                t.c.due_date,
                t.c.due_time,
                t.c.parent_task_id,
                t.c.priority,
                t.c.column_name,
                t.c.column_color,
            )

        oldest_first = (t.c.due_date, t.c.due_time.asc().nulls_last(), t.c.id)
        # As listas rolam dentro do card; o teto so evita milhares de linhas.
        list_cap = 50
        oldest_overdue = await self._dashboard_items(
            item_columns().where(p.overdue).order_by(*oldest_first).limit(list_cap)
        )

        # As minhas: o mesmo conjunto, so as tarefas em que sou responsavel.
        assigned_to_me = exists().where(
            TaskAssignment.task_id == t.c.id, TaskAssignment.user_id == me
        )
        my_overdue = await self._dashboard_items(
            item_columns()
            .where(p.overdue, assigned_to_me)
            .order_by(*oldest_first)
            .limit(list_cap)
        )
        my_on_time = await self._dashboard_items(
            item_columns()
            .where(p.on_time, assigned_to_me)
            .order_by(*oldest_first)
            .limit(list_cap)
        )
        my_counts = (
            await self.session.execute(
                select(func.count().filter(p.overdue), func.count().filter(p.on_time))
                .select_from(t)
                .where(assigned_to_me)
            )
        ).one()

        return DashboardCounts(
            overdue_count=summary[0],
            summary_start=p.summary_start,
            summary_end=p.summary_end,
            done=summary[1],
            total=summary[2],
            on_time_total=summary[3],
            bucket_unit=unit,
            buckets=buckets_counts,
            oldest_overdue=oldest_overdue,
            my_overdue=my_overdue,
            my_overdue_total=my_counts[0],
            my_on_time=my_on_time,
            my_on_time_total=my_counts[1],
        )

    async def dashboard_export_rows(
        self,
        under_team_id: uuid.UUID | None,
        now: WorkspaceNow,
        *,
        assignee_id: uuid.UUID | None = None,
        period: Period | None = None,
    ) -> list[DashboardExportRow]:
        """As tarefas que o painel contou, para a planilha.

        Os mesmos predicados dos numeros: a planilha tem de bater com a tela."""
        tenant = require_tenant()
        t = self._dashboard_tasks(under_team_id, assignee_id)
        p = _DashboardPredicates(t, now, period)
        names = (
            select(
                TaskAssignment.task_id.label("task_id"),
                func.string_agg(
                    User.name, aggregate_order_by(literal_column("', '"), User.name)
                ).label("names"),
            )
            .join(User, User.id == TaskAssignment.user_id)
            .where(TaskAssignment.workspace_id == tenant.workspace_id)
            .group_by(TaskAssignment.task_id)
            .subquery("n")
        )
        parent = aliased(Task)
        state = case(
            (t.c.semantic == ColumnSemantic.DONE, "done"),
            (p.overdue_any, "overdue"),
            else_="on_time",
        )
        rows = (
            await self.session.execute(
                select(
                    t.c.title,
                    state,
                    t.c.column_name,
                    t.c.priority,
                    t.c.due_date,
                    t.c.due_time,
                    func.coalesce(names.c.names, ""),
                    parent.title,
                )
                .select_from(t)
                .outerjoin(names, names.c.task_id == t.c.id)
                .outerjoin(
                    parent,
                    and_(parent.id == t.c.parent_task_id, parent.deleted_at.is_(None)),
                )
                .where(or_(p.counted, p.overdue))
                .order_by(t.c.due_date, t.c.due_time.asc().nulls_last(), t.c.title)
            )
        ).all()
        return [
            DashboardExportRow(
                title=r[0],
                state=r[1],
                column_name=r[2],
                priority=str(getattr(r[3], "value", r[3])),
                due_date=r[4],
                due_time=r[5],
                assignees=r[6],
                parent_title=r[7],
            )
            for r in rows
        ]

    async def _bucket_counts(
        self, t: Subquery, p: _DashboardPredicates, buckets: list[Bucket]
    ) -> list[BucketCounts]:
        """Concluidas, no prazo e atrasadas por coluna do grafico, numa ida so.

        O grafico usa a propria janela, nao o recorte do periodo.
        """
        if not buckets:
            return []
        c = t.c
        janela = c.due_date.between(buckets[0].start, buckets[-1].end)
        # A coluna de cada tarefa: o inicio do dia, ou da semana (truncado
        # dentro da janela -- a primeira semana pode comecar no meio).
        starts = [b.start for b in buckets]
        key = case(
            *[(c.due_date >= b.start, b.start) for b in reversed(buckets)],
            else_=None,
        ).label("bucket")
        rows = (
            await self.session.execute(
                select(
                    key,
                    func.count().filter(c.semantic == ColumnSemantic.DONE),
                    func.count().filter(p.charges_deadline, not_(p.overdue_any)),
                    func.count().filter(p.overdue_any),
                )
                .select_from(t)
                .where(janela)
                .group_by(key)
            )
        ).all()
        por_inicio = {r[0]: r for r in rows}
        assert set(por_inicio) <= set(starts)
        return [
            BucketCounts(
                start=b.start,
                end=b.end,
                done=por_inicio[b.start][1] if b.start in por_inicio else 0,
                on_time=por_inicio[b.start][2] if b.start in por_inicio else 0,
                overdue=por_inicio[b.start][3] if b.start in por_inicio else 0,
            )
            for b in buckets
        ]

    async def workload_by_person(
        self,
        under_team_id: uuid.UUID | None,
        now: WorkspaceNow,
        member_teams: frozenset[uuid.UUID] | None,
        period: Period | None = None,
    ) -> list[Workload]:
        """Tarefas abertas de cada pessoa, e quantas delas atrasadas.

        Parte dos membros do time (`None` = organizacao inteira), entao quem tem
        zero aparece; quem tem tarefa no time sem ser membro entra tambem. Tarefa
        com dois responsaveis conta para os dois.
        """
        tenant = require_tenant()
        t = self._dashboard_tasks(under_team_id)
        p = _DashboardPredicates(t, now, period)
        counts_by_user = (
            select(
                TaskAssignment.user_id.label("user_id"),
                func.count().label("open_count"),
                func.count().filter(p.overdue).label("overdue_count"),
            )
            .select_from(t)
            .join(TaskAssignment, TaskAssignment.task_id == t.c.id)
            .where(p.open_scoped, TaskAssignment.workspace_id == tenant.workspace_id)
            .group_by(TaskAssignment.user_id)
            .subquery("c")
        )
        members = select(UserTeam.user_id).where(
            UserTeam.workspace_id == tenant.workspace_id
        )
        if member_teams is not None:
            members = members.where(UserTeam.team_id.in_(member_teams))
        open_count = func.coalesce(counts_by_user.c.open_count, 0)
        rows = (
            await self.session.execute(
                select(
                    User.id,
                    User.name,
                    open_count,
                    func.coalesce(counts_by_user.c.overdue_count, 0),
                    User.is_active,
                )
                .outerjoin(counts_by_user, counts_by_user.c.user_id == User.id)
                .where(
                    User.workspace_id == tenant.workspace_id,
                    # Desativado so entra se ainda tiver tarefa aberta.
                    or_(
                        and_(User.is_active.is_(True), User.id.in_(members)),
                        counts_by_user.c.user_id.is_not(None),
                    ),
                )
                .order_by(open_count.desc(), User.name, User.id)
            )
        ).all()
        return [
            Workload(user_id=u, name=n, open_count=a, overdue_count=x, is_active=ativo)
            for u, n, a, x, ativo in rows
        ]

    async def _dashboard_items(self, stmt: Select) -> list[DashboardItem]:
        return [
            DashboardItem(
                id=i,
                title=tt,
                due_date=d,
                due_time=h,
                parent_id=m,
                priority=str(getattr(pr, "value", pr)),
                column_name=cn,
                column_color=cc,
            )
            for i, tt, d, h, m, pr, cn, cc in (await self.session.execute(stmt)).all()
        ]


class _DashboardPredicates:
    """As definicoes do painel em SQL, sobre a subconsulta `t`, escritas uma vez.

    Com periodo, o recorte e "prazo dentro do periodo" em todas as perguntas; o
    estado e sempre o de hoje.
    """

    def __init__(self, t: Subquery, now: WorkspaceNow, period: Period | None = None) -> None:
        c = t.c
        #: nem DONE nem CANCELLED, e nao arquivada.
        self.open = and_(
            c.semantic.not_in(TERMINAL_SEMANTICS), c.is_archived.is_(False)
        )
        #: A mesma pergunta do selo de prazo; a coluna Bloqueado nasce sem aviso.
        self.charges_deadline = and_(self.open, c.notify_deadline.is_(True))
        #: `estaAtrasada` do front: sem hora vence quando o dia acaba; com hora,
        #: no minuto seguinte. Sem o recorte do periodo (o grafico usa esta).
        self.overdue_any = and_(
            self.charges_deadline,
            c.due_date.is_not(None),
            or_(
                c.due_date < now.today,
                and_(
                    c.due_date == now.today,
                    c.due_time.is_not(None),
                    c.due_time < now.minute,
                ),
            ),
        )

        if period is None:
            in_scope = true()
            self.summary_start, self.summary_end = now.week_start, now.week_end
            #: Sem periodo, "no prazo" e o que vence HOJE e ainda nao venceu.
            on_time_window = c.due_date == now.today
        else:
            in_scope = c.due_date.between(period.start, period.end)
            self.summary_start, self.summary_end = period.start, period.end
            on_time_window = in_scope
        in_summary = c.due_date.between(self.summary_start, self.summary_end)

        self.overdue = and_(self.overdue_any, in_scope)
        #: A carga: as abertas (inclusive a bloqueada -- ainda e dela).
        self.open_scoped = and_(self.open, in_scope)
        #: concluida arquivada conta.
        self.done = and_(c.semantic == ColumnSemantic.DONE, in_summary)
        #: cancelada e bloqueada ficam fora.
        self.counted = or_(self.done, and_(self.charges_deadline, in_summary))
        self.on_time = and_(self.charges_deadline, on_time_window, not_(self.overdue_any))
