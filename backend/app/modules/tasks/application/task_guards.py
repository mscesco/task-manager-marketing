"""Guards de escopo de time -- reusados por TaskService e CollaborationService.

Extraidos do TaskService (Entrega 4) para que o assignment/watcher use a
MESMA regra de visibilidade/edicao, sem duplicar logica de time.

Duas camadas, alinhadas a Entrega 3 (ADR 0009) + ADR 0013:
    - visibilidade (leitura): pessoal proprio, OU projeto/avulsa cujo time
      esta na lente. Pessoal alheio nunca. ⚠️ `created_by` NAO concede
      leitura desde a Spec 037 (E1) -- a ADR 0013 caiu com a 0038.
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

from app.core.tenant import Membership, require_tenant
from app.db.models import Project, Task
from app.modules.auth.domain import team_scope
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
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

    # ⚠️ AQUI HAVIA O RAMO `created_by` DA ADR 0013, E ELE SAIU NA SPEC 037
    # (E1). A regra era "quem criou sempre ve, mesmo fora da lente" -- ou seja,
    # uma relacao concedia leitura por cima da hierarquia de time. A ADR 0038
    # inverteu: a lente de time e a UNICA fonte de visibilidade, e perder a
    # lente perde a visao.
    #
    # ⚠️ ESTE E UM DOS **DOIS** PONTOS DA E1. O outro e o ramo
    # `Task.created_by == tenant.user_id` do bloco (B) em
    # `task_repository.py`. NAO existe um terceiro: `task_repository.py:117`,
    # `:130` e `project_service.py:215` mencionam `created_by` mas sao o filtro
    # de PESSOAL ALHEIO -- apagar qualquer um deles VAZA projeto pessoal, e o
    # portao nao pega (ver `spec.md` §Correcao de 06/08).
    #
    # ⚠️ `task.created_by` CONTINUA EXISTINDO E SENDO EXIBIDO (E2). A tarefa
    # mostra "criada por fulano" mesmo depois de fulano perder a lente -- e
    # historico, nao permissao. A E1 nao pode ser implementada apagando o
    # campo, e ha teste afirmando isso (criterio 2 da spec).
    #
    # ⚠️ O RAMO DE PESSOAL ACIMA NAO E ESTE. `project.is_personal` compara
    # `project.created_by`, nao `task.created_by`, e ele fica.

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

    `editable=None` => admin. created_by nunca concedeu edicao, e desde a
    Spec 037 (E1) tambem nao concede LEITURA:
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


_SEM_ACESSO = object()  # sentinela: nao e membro ativo do workspace


async def _lente_do_usuario(
    session: AsyncSession, *, user_id: uuid.UUID
) -> frozenset[uuid.UUID] | None | object:
    """Times que o `user_id` ENXERGA, pela lente DELE.

    ⚠️ TRES retornos distintos, e confundi-los inverte a regra:
        `_SEM_ACESSO` -> nao e membro ativo do workspace -> nao ve NADA
        `None`        -> ADMIN -> ve TUDO (contrato de `visible_team_ids`)
        frozenset     -> o conjunto de times

    Extraido na Spec 034 (Fatia 5) porque `user_can_view_task` e
    `user_can_view_team` precisam do MESMO carregamento. Escrever duas vezes
    era como a regra de alcance ja tinha divergido antes (ver D2/D4).
    """
    tenant = require_tenant()
    membership = await MembershipRepository(session).get_membership(
        user_id=user_id, workspace_id=tenant.workspace_id
    )
    if membership is None or not membership.is_active:
        return _SEM_ACESSO
    target_memberships = tuple(
        Membership(team_id=tid, role=role) for tid, role in membership.team_roles
    )
    return team_scope.visible_team_ids(target_memberships, tenant.team_tree)


async def user_can_view_task(
    session: AsyncSession, *, task: Task, user_id: uuid.UUID
) -> bool:
    """Nao-lancante: o `user_id` enxerga a `task` pela lente DELE?

    Ausente/inativo no workspace -> False. Reusa a MESMA regra pura
    (task_visible + visible_team_ids) do resto do app, so que aplicada a um
    usuario que NAO e o corrente. Usado para so notificar mencoes a quem
    realmente alcanca a task (senao o deep-link leva a 404 e o titulo da task
    vazaria pra fora do escopo) e, desde a Spec 034, para montar a lista dos
    seletores de responsavel e `@`.
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
        viewer_user_id=user_id,
        visible=visible,  # type: ignore[arg-type]
    )


async def user_can_view_team(
    session: AsyncSession, *, team_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """Nao-lancante: o `user_id` enxerga as tasks do time `team_id`?

    Spec 034, Fatia 5. Existe porque o modal de CRIAR precisa da lista de
    responsaveis para uma tarefa que AINDA NAO EXISTE -- nao ha id pra
    perguntar em `user_can_view_task`. Ate 03/08 esse caminho era aproximado
    no front por `lib/escopoTarefa.ts`, que so tinha `team_id` e nunca papel;
    o resultado, reportado com captura: criando tarefa no quadro de um
    subtime, a GESTORA sumia do seletor.

    ⚠️ NAO considera projeto. A tarefa nova ainda nao tem um. Se o modal
    passar a escolher projeto antes de criar, esta funcao deixa de bastar.
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
    """Gates de visibilidade/edicao do usuario CORRENTE sobre uma task."""

    def __init__(self, session: AsyncSession) -> None:
        self._projects = ProjectRepository(session)

    async def _load_project(self, task: Task) -> Project | None:
        if task.project_id is None:
            return None
        return await self._projects.get_by_id(task.project_id)

    async def assert_visible(self, task: Task) -> None:
        """404 (EntityNotFound) se o usuario corrente nao enxerga a task.

        Nao 403 -- nao vaza existencia. Cobre privacidade do pessoal e
        lente de time. ⚠️ `created_by` NAO entra mais (Spec 037, E1).
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
