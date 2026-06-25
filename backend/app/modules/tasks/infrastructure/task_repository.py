"""Repository da entidade Task.

Padrao: herda BaseRepository[Task] (filtro automatico de tenant e
soft delete via `_base_select`).

Metodos especificos:

    - list_page_with_filters: lista com filtros + privacidade do pessoal.
    - reparent_subtree: SQL textual para atualizar path/depth/project_id
      de uma subtree. EXCECAO AUTORIZADA ao `_base_select` (ADR 0003).
    - soft_delete_subtree: SQL textual para soft-delete cascateado.
      EXCECAO AUTORIZADA (ADR 0003 + 0005). Retorna cascade_count.
    - detect_cycle: usa LTREE `<@` para detectar ciclo em move.
    - write_history: insere linhas em task_history.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select, text
from sqlalchemy.sql.elements import ColumnElement

from app.core.tenant import require_tenant
from app.db.models import Project, Task, TaskAssignment, TaskHistory, TaskWatcher
from app.db.models.enums import TaskStatus
from app.db.repository import BaseRepository
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.history import HistoryEntry
from app.shared.pagination import Page, PageParams


class TaskRepository(BaseRepository[Task]):
    """Acesso a dados de tasks, escopado ao tenant corrente."""

    model = Task

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
        created_by: uuid.UUID | None = None,
        include_archived: bool = False,
    ) -> Page[Task]:
        """Lista tasks com filtros + privacidade do pessoal.

        PRIVACIDADE: JOIN com project filtrando
        `project.is_personal=false OR project.created_by=me`.
        """
        tenant = require_tenant()
        base = self._base_select()

        # Privacidade do pessoal + lente de time (Entrega 3).
        # LEFT JOIN: tarefa avulsa (project_id NULL) nao some.
        visible = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree
        )  # None = admin (sem filtro de time)

        base = base.outerjoin(
            Project,
            and_(
                Project.id == Task.project_id,
                Project.workspace_id == Task.workspace_id,
            ),
        )

        # (A) nunca mostrar pessoal alheio (vale ate pra admin).
        base = base.where(
            or_(
                Task.project_id.is_(None),
                Project.is_personal.is_(False),
                Project.created_by == tenant.user_id,
            )
        )

        # (B) lente de time -- pulada para admin (visible is None).
        if visible is not None:
            base = base.where(
                or_(
                    # criador sempre ve a propria task (Entrega 4 -- ADR 0013).
                    Task.created_by == tenant.user_id,
                    # pessoal proprio: sempre visivel
                    and_(
                        Project.is_personal.is_(True),
                        Project.created_by == tenant.user_id,
                    ),
                    # projeto comum cujo time esta na lente -> ve tudo dele
                    and_(
                        Project.is_personal.is_(False),
                        Project.team_id.in_(visible),
                    ),
                    # avulsa cujo time esta na lente
                    and_(
                        Task.project_id.is_(None),
                        Task.team_id.in_(visible),
                    ),
                )
            )

        # Filtros opcionais.
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
        if created_by is not None:
            base = base.where(Task.created_by == created_by)
        if not include_archived:
            base = base.where(Task.is_archived.is_(False))

        # Count + page seguindo o padrao do BaseRepository.list_page.
        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        page_stmt = base.order_by(Task.created_at.desc()).limit(params.limit).offset(params.offset)
        items = list((await self.session.execute(page_stmt)).scalars().all())

        return Page(items=items, total=total, page=params.page, size=params.size)

    # ----------------------------------------------------
    # /me/assignments -- relacoes do usuario corrente (ADR 0018)
    # ----------------------------------------------------
    async def list_my_relations(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
    ) -> Page[tuple[Task, Project | None, frozenset[str]]]:
        """Tasks do tenant (nao deletadas) onde sou assignee/creator/watcher.

        Parte do `_base_select` (tenant + soft-delete). Mantem a camada (A)
        (pessoal alheio nunca) mas OMITE a camada (B) (lente de time) -- e o
        que permite a task aparecer marcada como out_of_scope na aplicacao
        (ADR 0017/0018). Os 3 vinculos sao computados SEMPRE (preenchem
        `relations`); o recorte e por OR das relacoes selecionadas.
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

        # (A) nunca mostrar pessoal alheio (vale ate pra admin).
        base = base.where(
            or_(
                Task.project_id.is_(None),
                Project.is_personal.is_(False),
                Project.created_by == me,
            )
        )

        # Recorte por relacao selecionada (OR). `relations` nunca vazio
        # (o router preenche o default com as tres).
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
    # Operacoes de subtree (excecao autorizada -- ADR 0003)
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
        new_project_id: uuid.UUID,
    ) -> None:
        """Atualiza path/depth/project_id/parent_task_id da task e
        de toda a subtree.

        EXCECAO AUTORIZADA ao `_base_select` (ADR 0003).
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

        # Calcula o novo path da PROPRIA task.
        if new_parent_path is None:
            new_self_path = old_label
            new_self_depth = 0
        else:
            new_self_path = f"{new_parent_path}.{old_label}"
            new_self_depth = (new_parent_depth or 0) + 1

        depth_delta = new_self_depth - old_depth

        # UPDATE 1: a PROPRIA task (atualiza tambem parent_task_id e
        # project_id, alem de path/depth).
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

        # UPDATE 2: DESCENDENTES (se houver). Reescrever path com
        # subpath() e ajustar depth e project_id.
        # subpath(path, old_depth) corta o prefixo antigo da task.
        # Concatenamos com o novo path da task.
        # Excluimos a propria task (ja atualizada acima).
        await self.session.execute(
            text(
                """
                UPDATE task
                SET path = CAST(:new_self_path AS ltree) || subpath(path, :old_depth),
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

        # Atualiza o objeto Python para refletir o novo estado.
        task.path = new_self_path
        task.depth = new_self_depth
        task.parent_task_id = new_parent_task_id
        task.project_id = new_project_id

    async def soft_delete_subtree(self, *, task: Task) -> int:
        """Soft-delete da task e de toda a subtree.

        EXCECAO AUTORIZADA (ADR 0003 + 0005).

        Retorna o numero de DESCENDENTES apagados (nao inclui a
        propria task). Esse valor vai para event_metadata.cascade_count.
        """
        tenant = require_tenant()

        # UPDATE em massa: a task e todos os descendentes (path <@ task.path).
        # Filtra deleted_at IS NULL pra nao re-marcar ja apagadas.
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

        # rowcount inclui a propria task (1) + descendentes apagados.
        # cascade_count eh "filhas apagadas junto", sem contar a raiz.
        total_affected = result.rowcount or 0
        cascade_count = max(0, total_affected - 1)

        # Atualiza o objeto Python.
        task.deleted_at = func.now()  # type: ignore[assignment]
        return cascade_count

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
        """Tasks terminais paradas ha mais de `days` dias (Spec 013).

        Espelha app.modules.tasks.domain.archival.is_stale_terminal:
            COMPLETED por completed_at, CANCELLED por updated_at.
        `_base_select` ja filtra tenant + soft-delete. Excluimos arquivadas
        (nao reentram). Sem paginacao -- e um job de varredura.
        """
        cutoff = now - timedelta(days=days)
        stmt = self._base_select().where(
            Task.is_archived.is_(False),
            or_(
                and_(
                    Task.status == TaskStatus.COMPLETED,
                    Task.completed_at.is_not(None),
                    Task.completed_at < cutoff,
                ),
                and_(
                    Task.status == TaskStatus.CANCELLED,
                    Task.updated_at < cutoff,
                ),
            ),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

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
        if not entries:
            return

        tenant = require_tenant()
        for entry in entries:
            row = TaskHistory(
                workspace_id=tenant.workspace_id,
                task_id=task.id,
                user_id=user_id,
                event_type=entry.event_type.value,
                field_name=entry.field_name,
                old_value=entry.old_value,
                new_value=entry.new_value,
                event_metadata=entry.metadata,
            )
            self.session.add(row)
