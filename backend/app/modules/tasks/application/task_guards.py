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
    """A task e visivel para o usuario com esta lente?

    `visible=None` => admin (ve tudo).
    `project` = projeto carregado da task (None se avulsa). Se a task tem
    project_id mas o projeto nao veio (inconsistencia), trata como invisivel.
    """
    # Projeto referenciado mas ausente: inconsistencia -> invisivel (404).
    if task.project_id is not None and project is None:
        return False

    # ⚠️⚠️ AQUI HAVIA O RAMO DO PROJETO PESSOAL, e ele saiu em 10/09 junto
    # com o projeto pessoal. Era a UNICA regra de privacidade do produto:
    # tarefa em pessoal era invisivel para todo mundo, INCLUSIVE para o admin.
    # Hoje nao ha nada privado aqui -- a lente de time e a unica fonte de
    # visibilidade, sem excecao.

    # ⚠️ AQUI HAVIA O RAMO `created_by` DA ADR 0013, E ELE SAIU NA SPEC 037
    # (E1). A regra era "quem criou sempre ve, mesmo fora da lente" -- ou seja,
    # uma relacao concedia leitura por cima da hierarquia de time. A ADR 0038
    # inverteu: a lente de time e a UNICA fonte de visibilidade, e perder a
    # lente perde a visao.
    #
    # ⚠️ ESTE E UM DOS **DOIS** PONTOS DA E1. O outro e o ramo
    # `Task.created_by == tenant.user_id` do bloco (B) em
    # `task_repository.py`.
    #
    # ⚠️ ESTE COMENTARIO CITAVA UM TERCEIRO GRUPO -- os filtros de "pessoal
    # alheio" em `task_repository.py` e `project_service.py`, com o aviso de
    # que apagar qualquer um deles VAZAVA projeto pessoal. Eles sairam em
    # 10/09, com o proprio projeto pessoal. Nao ha mais nada a vazar.
    #
    # ⚠️ `task.created_by` CONTINUA EXISTINDO E SENDO EXIBIDO (E2). A tarefa
    # mostra "criada por fulano" mesmo depois de fulano perder a lente -- e
    # historico, nao permissao. A E1 nao pode ser implementada apagando o
    # campo, e ha teste afirmando isso (criterio 2 da spec).
    #

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
    # ⚠️ AQUI HAVIA A EXCECAO DO PESSOAL PROPRIO: o dono editava a tarefa do
    # seu projeto pessoal mesmo com o time dela fora da lente de edicao. Saiu
    # em 10/09 -- hoje quem edita e funcao do time da tarefa, e de mais nada.
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
    return _lente_de(membership, await _arvore_de_times(session))


async def _arvore_de_times(session: AsyncSession) -> tuple[TeamNode, ...]:
    """A arvore de times do contexto -- ou do banco, se o contexto nao a trouxe.

    ⚠️⚠️ JOB DE FUNDO ENTRA SEM ARVORE. `tenant_scope` tem `team_tree=()` por
    padrao, e os jobs (`deadline_notify`, `archive-stale`) nao a passam. Com a
    arvore vazia, `visible_team_ids` perde os DESCENDENTES: o gerente da raiz
    deixa de enxergar a tarefa do subtime. Achado na Spec 053 (A), quando a
    trava dos avisos passou a rodar dentro do job de prazo -- e teria calado,
    sem erro nenhum, o aviso de prazo de quem enxerga por hierarquia.

    Arvore vazia so pode ser "nao carregada": todo workspace tem o time raiz.
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
    """A lente de UM vinculo ja carregado. Mesmos tres retornos de
    `_lente_do_usuario`, que agora so carrega e delega para ca -- a versao em
    lote (`user_ids_that_can_view_task`) usa esta mesma funcao, para que a
    regra nao exista duas vezes.
    """
    if membership is None or not membership.is_active:
        return _SEM_ACESSO
    target_memberships = tuple(
        Membership(team_id=tid, role=role) for tid, role in membership.team_roles
    )
    # ⚠️ O `org_role` E O DO ALVO, e nao o do ator (Spec 045, fatia B). Esta
    # funcao responde "o que ELE enxerga"; passar o papel de quem pergunta
    # faria um admin enxergar por todo mundo. O vinculo carregado ja traz o
    # campo, entao nao ha query nova.
    return team_scope.visible_team_ids(
        target_memberships, tree, org_role=membership.org_role
    )


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
        visible=visible,  # type: ignore[arg-type]
    )


async def user_ids_that_can_view_task(
    session: AsyncSession, *, task: Task, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Quais destes usuarios enxergam a `task`? `user_can_view_task` em lote.

    Spec 053, fatia A: a TRAVA DOS AVISOS. Nenhum aviso de tarefa vai para quem
    nao a alcanca no momento do envio -- responsavel ou criador que perdeu o
    time continuavam recebendo o aviso de comentario, com o titulo da tarefa.

    ⚠️ Duas consultas para o grupo inteiro (usuarios + papeis), mais o projeto
    uma vez. A regra e a MESMA de `user_can_view_task` (`_lente_de` +
    `task_visible`) -- ha teste afirmando que as duas respondem igual.
    """
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return set()
    tenant = require_tenant()
    vinculos = await MembershipRepository(session).get_memberships(
        user_ids=ids, workspace_id=tenant.workspace_id
    )
    project = (
        await ProjectRepository(session).get_by_id(task.project_id)
        if task.project_id is not None
        else None
    )
    arvore = await _arvore_de_times(session)
    alcancam: set[uuid.UUID] = set()
    for uid in ids:
        visible = _lente_de(vinculos.get(uid), arvore)
        if visible is _SEM_ACESSO:
            continue
        if task_visible(task=task, project=project, visible=visible):  # type: ignore[arg-type]
            alcancam.add(uid)
    return alcancam


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
        """403 se o usuario VE a task mas nao pode edita-la (Fase B).

        Chamar APOS assert_visible. Editar depende SO do time da task.
        """
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
