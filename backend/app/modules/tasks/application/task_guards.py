"""Guards de escopo de time, usados por TaskService e CollaborationService.

Visibilidade: projeto/avulsa cujo time esta na lente. Edicao: admin tudo, ou
time da task na lente de edicao. `created_by` nao concede leitura nem edicao.
`task_visible` / `task_editable` sao puras, servem tambem para checar o
alcance de um terceiro (ex.: o designado).
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import Membership, TeamNode, require_tenant
from app.db.models import Project, Task
from app.modules.auth.domain import team_scope
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.modules.users.domain.membership import WorkspaceMembership
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from app.shared.exceptions.base import AuthorizationError, EntityNotFoundError


# --------------------------------------------------------
# Nucleo puro (sem DB)
# --------------------------------------------------------
def task_visible(
    *,
    task: Task,
    project: Project | None,
    visible: frozenset[uuid.UUID] | None,
) -> bool:
    """A task e visivel para o usuario com esta lente? `visible=None` => admin.

    `project` = projeto carregado da task (None se avulsa).
    """
    # Projeto referenciado mas ausente: inconsistencia -> invisivel (404).
    if task.project_id is not None and project is None:
        return False

    if visible is None:
        return True

    if project is not None:
        return project.team_id is not None and project.team_id in visible

    # Avulsa: lente sobre o time da task.
    return task.team_id is not None and task.team_id in visible


def task_editable(
    *,
    task: Task,
    project: Project | None,
    editable: frozenset[uuid.UUID] | None,
) -> bool:
    """A task e editavel com esta lente de edicao? `editable=None` => admin."""
    if editable is None:
        return True
    return task.team_id is not None and task.team_id in editable


_SEM_ACESSO = object()  # sentinela: nao e membro ativo do workspace


async def _lente_do_usuario(
    session: AsyncSession, *, user_id: uuid.UUID
) -> frozenset[uuid.UUID] | None | object:
    """Times que o `user_id` enxerga, pela lente dele.

    Tres retornos, e confundi-los inverte a regra:
        `_SEM_ACESSO` -> nao e membro ativo -> nao ve nada
        `None`        -> admin -> ve tudo
        frozenset     -> o conjunto de times
    """
    tenant = require_tenant()
    membership = await MembershipRepository(session).get_membership(
        user_id=user_id, workspace_id=tenant.workspace_id
    )
    return _lente_de(membership, await _arvore_de_times(session))


async def _arvore_de_times(session: AsyncSession) -> tuple[TeamNode, ...]:
    """A arvore de times do contexto, ou do banco se o contexto nao a trouxe.

    Jobs de fundo entram com `team_tree=()`; sem a arvore, `visible_team_ids`
    perde os descendentes. Todo workspace tem o time raiz, entao vazia = nao
    carregada.
    """
    tenant = require_tenant()
    if tenant.team_tree:
        return tenant.team_tree
    rows = await MembershipRepository(session).load_team_tree(
        workspace_id=tenant.workspace_id
    )
    return tuple(TeamNode(team_id=tid, parent_team_id=pid) for tid, pid in rows)


def _lente_de(
    membership: WorkspaceMembership | None,
    tree: tuple[TeamNode, ...],
) -> frozenset[uuid.UUID] | None | object:
    """A lente de um vinculo ja carregado. Mesmos tres retornos de `_lente_do_usuario`."""
    if membership is None or not membership.is_active:
        return _SEM_ACESSO
    target_memberships = tuple(
        Membership(team_id=tid, role=role) for tid, role in membership.team_roles
    )
    # O `org_role` e o do alvo, nao o do ator: senao um admin enxergaria por todo mundo.
    return team_scope.visible_team_ids(
        target_memberships, tree, org_role=membership.org_role
    )


async def user_can_view_task(
    session: AsyncSession, *, task: Task, user_id: uuid.UUID
) -> bool:
    """Nao-lancante: o `user_id` (nao necessariamente o corrente) enxerga a `task`?

    Ausente/inativo no workspace -> False. Usado para notificar mencoes e
    montar os seletores de responsavel e `@`.
    """
    visible = await _lente_do_usuario(session, user_id=user_id)
    if visible is _SEM_ACESSO:
        return False
    project = (
        await ProjectRepository(session).get_by_id(task.project_id)
        if task.project_id is not None
        else None
    )
    return task_visible(
        task=task,
        project=project,
        visible=visible,  # type: ignore[arg-type]
    )


async def user_ids_that_can_view_task(
    session: AsyncSession, *, task: Task, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Quais destes usuarios enxergam a `task`? Trava dos avisos: nenhum aviso
    vai para quem nao alcanca a tarefa no momento do envio.
    """
    alcance = await user_ids_that_can_view_tasks(session, alvos=[(task, user_ids)])
    return alcance.get(task.id, set())


async def user_ids_that_can_view_tasks(
    session: AsyncSession, *, alvos: list[tuple[Task, list[uuid.UUID]]]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Trava dos avisos em lote: `task.id -> quem a enxerga`.

    Tres consultas para o lote inteiro, qualquer que seja o numero de tarefas.
    """
    todos = list(dict.fromkeys(uid for _, ids in alvos for uid in ids))
    if not todos:
        return {}
    tenant = require_tenant()
    vinculos = await MembershipRepository(session).get_memberships(
        user_ids=todos, workspace_id=tenant.workspace_id
    )
    projetos = await ProjectRepository(session).get_many_by_ids(
        list({t.project_id for t, _ in alvos if t.project_id is not None})
    )
    arvore = await _arvore_de_times(session)
    lentes = {uid: _lente_de(vinculos.get(uid), arvore) for uid in todos}
    alcance: dict[uuid.UUID, set[uuid.UUID]] = {}
    for task, ids in alvos:
        project = projetos.get(task.project_id) if task.project_id else None
        alcance[task.id] = {
            uid
            for uid in ids
            if lentes[uid] is not _SEM_ACESSO
            and task_visible(task=task, project=project, visible=lentes[uid])  # type: ignore[arg-type]
        }
    return alcance


async def user_can_view_team(
    session: AsyncSession, *, team_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """Nao-lancante: o `user_id` enxerga as tasks do time `team_id`?

    Para o modal de criar, quando a tarefa ainda nao existe. Nao considera
    projeto: se o modal passar a escolher projeto antes de criar, deixa de bastar.
    """
    visible = await _lente_do_usuario(session, user_id=user_id)
    if visible is _SEM_ACESSO:
        return False
    if visible is None:
        return True  # ADMIN enxerga tudo
    return team_id in visible  # type: ignore[operator]


# --------------------------------------------------------
# Guard com DB (carrega projeto + lente do usuario corrente)
# --------------------------------------------------------
class TaskScopeGuards:
    """Gates de visibilidade/edicao do usuario corrente sobre uma task."""

    def __init__(self, session: AsyncSession) -> None:
        self._projects = ProjectRepository(session)

    async def _load_project(self, task: Task) -> Project | None:
        if task.project_id is None:
            return None
        return await self._projects.get_by_id(task.project_id)

    async def assert_visible(self, task: Task) -> None:
        """404 se o usuario corrente nao enxerga a task (403 vazaria a existencia)."""
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,)
        project = await self._load_project(task)
        if not task_visible(
            task=task,
            project=project,
            visible=visible,
        ):
            raise EntityNotFoundError("Task", identifier=task.id)

    async def assert_editable(self, task: Task) -> None:
        """403 se o usuario ve a task mas nao pode edita-la. Chamar apos assert_visible."""
        tenant = require_tenant()
        editable = team_scope.editable_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )
        project = await self._load_project(task)
        if not task_editable(
            task=task,
            project=project,
            editable=editable,
        ):
            raise AuthorizationError(
                "Sem permissao para editar tasks deste time.",
                details={
                    "task_id": str(task.id),
                    "team_id": str(task.team_id) if task.team_id else None,
                },
            )
