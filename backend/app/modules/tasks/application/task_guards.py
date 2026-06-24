"""Guards de escopo de time -- reusados por TaskService e CollaborationService.

Extraidos do TaskService (Entrega 4) para que o assignment/watcher use a
MESMA regra de visibilidade/edicao, sem duplicar logica de time.

Duas camadas, alinhadas a Entrega 3 (ADR 0009) + ADR 0013:
    - visibilidade (leitura): pessoal proprio, OU projeto/avulsa cujo time
      esta na lente, OU `created_by == eu` (ADR 0013). Pessoal alheio nunca.
    - edicao (escrita): admin tudo; pessoal proprio; time da task na lente
      de edicao. `created_by` NAO concede edicao.

As funcoes `task_visible` / `task_editable` sao PURAS (sem DB) -- recebem o
projeto ja carregado e a lente ja resolvida. Testaveis isoladamente e
reaproveitaveis para checar o ALCANCE de um terceiro (o designado), nao so
do usuario corrente.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.modules.auth.domain import team_scope
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.shared.exceptions.base import AuthorizationError, EntityNotFoundError


# --------------------------------------------------------
# Nucleo puro (sem DB)
# --------------------------------------------------------
def task_visible(
    *,
    task: Task,
    project: Project | None,
    viewer_user_id: uuid.UUID,
    visible: frozenset[uuid.UUID] | None,
) -> bool:
    """A task e visivel para o usuario com esta lente?

    `visible=None` => admin (ve tudo, menos pessoal alheio).
    `project` = projeto carregado da task (None se avulsa). Se a task tem
    project_id mas o projeto nao veio (inconsistencia), trata como invisivel.
    """
    # Projeto referenciado mas ausente: inconsistencia -> invisivel (404).
    if task.project_id is not None and project is None:
        return False

    # Pessoal: so o dono ve (vale ate para admin). created_by do pessoal
    # E o dono, entao a regra de created_by nunca expoe pessoal alheio.
    if project is not None and project.is_personal:
        return project.created_by == viewer_user_id

    # Criador sempre ve a propria task (ADR 0013) -- so leitura.
    if task.created_by == viewer_user_id:
        return True

    # Admin ve o resto.
    if visible is None:
        return True

    # Projeto comum: ve o projeto -> ve a task (lente sobre o time do projeto).
    if project is not None:
        return project.team_id is not None and project.team_id in visible

    # Avulsa: lente sobre o time da task.
    return task.team_id is not None and task.team_id in visible


def task_editable(
    *,
    task: Task,
    project: Project | None,
    viewer_user_id: uuid.UUID,
    editable: frozenset[uuid.UUID] | None,
) -> bool:
    """A task e editavel para o usuario com esta lente de edicao?

    `editable=None` => admin. created_by NAO concede edicao (ADR 0013):
    quem edita e funcao do time da task, nao de quem criou nem de quem e
    responsavel.
    """
    if editable is None:
        return True
    # Pessoal proprio: o dono edita.
    if (
        project is not None
        and project.is_personal
        and project.created_by == viewer_user_id
    ):
        return True
    return task.team_id is not None and task.team_id in editable


# --------------------------------------------------------
# Guard com DB (carrega projeto + lente do usuario corrente)
# --------------------------------------------------------
class TaskScopeGuards:
    """Gates de visibilidade/edicao do usuario CORRENTE sobre uma task."""

    def __init__(self, session: AsyncSession) -> None:
        self._projects = ProjectRepository(session)

    async def _load_project(self, task: Task) -> Project | None:
        if task.project_id is None:
            return None
        return await self._projects.get_by_id(task.project_id)

    async def assert_visible(self, task: Task) -> None:
        """404 (EntityNotFound) se o usuario corrente nao enxerga a task.

        Nao 403 -- nao vaza existencia. Cobre privacidade do pessoal,
        lente de time e a regra `created_by` (ADR 0013).
        """
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(tenant.memberships, tenant.team_tree)
        project = await self._load_project(task)
        if not task_visible(
            task=task,
            project=project,
            viewer_user_id=tenant.user_id,
            visible=visible,
        ):
            raise EntityNotFoundError("Task", identifier=task.id)

    async def assert_editable(self, task: Task) -> None:
        """403 se o usuario VE a task mas nao pode edita-la (Fase B).

        Chamar APOS assert_visible. Editar depende SO do time da task.
        """
        tenant = require_tenant()
        editable = team_scope.editable_team_ids(
            tenant.memberships, tenant.team_tree
        )
        project = await self._load_project(task)
        if not task_editable(
            task=task,
            project=project,
            viewer_user_id=tenant.user_id,
            editable=editable,
        ):
            raise AuthorizationError(
                "Sem permissao para editar tasks deste time.",
                details={
                    "task_id": str(task.id),
                    "team_id": str(task.team_id) if task.team_id else None,
                },
            )
