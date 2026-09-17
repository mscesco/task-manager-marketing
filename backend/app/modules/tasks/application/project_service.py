"""Casos de uso de projetos.

Project e o container de tasks. Toda regra de negocio fica aqui --
o router so delega. Commit eh responsabilidade do Unit of Work,
acionado no router (ou no service-caller, no caso do provisioning).

Casos de uso (publicos):
    ProjectService.create                    -- cria projeto comum
    ProjectService.get                       -- obtem projeto
    ProjectService.list_page                 -- lista paginada
    ProjectService.update                    -- atualiza campos
    ProjectService.soft_delete               -- deleted_at=now()

Decisoes-chave (ver specs/001-projects/spec.md):

  - ⚠️ ARQUIVAR PROJETO SAIU EM 17/09/2026 (`archive`/`unarchive` e as duas
    rotas), por decisao da Camila: com projeto apagavel, arquivar nao tinha
    uso. `project.is_archived` CONTINUA no modelo e e LIDO (filtro
    `include_archived` da listagem, campo da resposta), mas NAO TEM MAIS
    ESCRITOR no produto -- ver `ProjectFilters.include_archived`.
  - status livre + auto-marcacao de completed_at.
  - start_date <= due_date quando ambos informados.
  - PATCH "campo ausente = nao mexer".

⚠️⚠️ O PROJETO PESSOAL SAIU EM 10/09/2026, e com ele a ADR 0001 (marcada como
revertida la). Decisao dela: *"nao sei como implementar projeto pessoal, muito
confuso, minha intencao e tirar, pois foi pensado de outra forma"*.

⚠️ E O QUE SAIU JUNTO E O QUE VALE LEMBRAR: era a UNICA regra de privacidade do
produto -- tarefa em projeto pessoal era invisivel para todo mundo, inclusive
para o ADMIN, e o dono a editava mesmo fora dos times que ele alcanca. Hoje nao
ha nada privado neste sistema: tudo o que existe pertence a um time, e quem
alcanca o time ve. Se um dia voltar a fazer sentido esconder algo de todos,
isto e um recorte novo -- e nao a volta de uma flag.

⚠️ A remocao foi limpa por sorte de medicao: 29 pessoais no banco, TODOS com
zero tarefas, e sem tela nenhuma que os expusesse.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

# --------------------------------------------------------
# Commands / DTOs internos do dominio
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateProjectCommand:
    """Dados para criar um projeto."""

    title: str
    team_id: uuid.UUID  # Entrega 3: time dono (obrigatorio em comum).
    description: str = ""
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class UpdateProjectCommand:
    """Patch parcial. Campo None = "nao mexer".

    `created_by` ausente por DESIGN -- nao e editavel em nenhuma
    circunstancia.
    """

    title: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class ProjectFilters:
    """Filtros de listagem suportados nesta entrega."""

    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    #: ⚠️ SEM ESCRITOR DESDE 17/09/2026: arquivar projeto saiu do produto, e
    #: nenhum caminho grava `is_archived=True` num projeto. O filtro ficou
    #: porque o front ainda manda o parametro e le o campo -- mas um projeto
    #: arquivado ANTES dessa data continua escondido por padrao, e nao ha
    #: mais rota para desarquiva-lo (so SQL).
    include_archived: bool = False
    #: Recorte por TIME (Spec 048). ``None`` = sem recorte -- a lente decide
    #: sozinha. Quando vem, casa o time E seus descendentes: projeto criado num
    #: subtime continua aparecendo no contexto da raiz dele.
    team_id: uuid.UUID | None = None


# --------------------------------------------------------
# Service
# --------------------------------------------------------
class ProjectService:
    """Casos de uso de projeto."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = ProjectRepository(session)
        self._session = session

    # ----------------------------------------------------
    # CRUD-de-casos-de-uso (publico)
    # ----------------------------------------------------
    async def create(self, command: CreateProjectCommand) -> Project:
        """Cria um projeto COMUM no workspace corrente.

        Erros:
            ValidationError -- title vazio, start > due.
        """
        title = command.title.strip()
        if not title:
            raise ValidationError(
                "Titulo do projeto nao pode ser vazio.",
                details={"field": "title"},
            )
        self._validate_dates(command.start_date, command.due_date)

        tenant = require_tenant()
        # Entrega 3: o time tem que existir no workspace (arvore do contexto).
        if command.team_id not in {n.team_id for n in tenant.team_tree}:
            raise ValidationError(
                "Time informado nao existe neste workspace.",
                details={"field": "team_id"},
            )
        # ⚠️⚠️ E TEM DE ESTAR NA LENTE de quem cria (Spec 049, fatia 0b). Ate
        # 14/09 bastava existir: o MANAGER do Marketing criava projeto no
        # Comercial. Mesma forma e mesma mensagem do `POST /tasks` (Spec 037):
        # 422 no campo, porque o time e um VALOR que o corpo trouxe.
        editavel = team_scope.editable_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
        if editavel is not None and command.team_id not in editavel:
            raise ValidationError(
                "Time informado esta fora do seu alcance.",
                details={"field": "team_id"},
            )
        # ⚠️⚠️ Spec 051, fatia A: E O VERBO NAQUELE TIME. A lente acima responde
        # "trabalho la?"; quem e OPERATOR no Comercial trabalha, e a rota ja
        # tinha visto `project.create` -- no Marketing, onde a pessoa e MANAGER.
        # Fora da lente continua 422 no campo; na lente sem o verbo, 403.
        self._assert_verbo_no_time("project.create", command.team_id)
        project = Project(
            title=title,
            description=command.description,
            status=command.status,
            priority=command.priority,
            start_date=command.start_date,
            due_date=command.due_date,
            created_by=tenant.user_id,
            team_id=command.team_id,
        )
        # Se ja vem como COMPLETED, marca completed_at na criacao.
        if command.status == ProjectStatus.COMPLETED:
            project.completed_at = func.now()  # type: ignore[assignment]

        # workspace_id e injetado pelo BaseRepository.add a partir
        # do tenant corrente.
        self._repo.add(project)
        await self._session.flush()

        logger.info(
            "project.created",
            project_id=str(project.id),
            title=project.title,
            status=project.status.value,
        )
        return project

    async def get(self, project_id: uuid.UUID) -> Project:
        """Retorna um projeto pelo id, DENTRO da lente de time.

        Erros:
            EntityNotFoundError -- projeto nao existe, esta em outro
              workspace, OU o time dele esta fora da lente de quem pergunta.

        ⚠️ 404 E NAO 403, de proposito: a mesma convencao que o projeto pessoal
        usava ("privacy-preserving") -- responder 403 confirmaria que aquele id
        existe. Aqui nem o nome do projeto de outro time raiz deve escapar.

        ⚠️ SEM ISTO A LENTE DA LISTAGEM SERIA ENFEITE: esconder o projeto da
        lista e entrega-lo por `GET /projects/<id>` protege contra navegar, nao
        contra pedir. Um unico chamador (o router), entao a trava mora aqui.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )
        if visible is not None and project.team_id not in visible:
            # ⚠️ A MESMA FORMA que o `get_by_id_or_raise` levanta quando o id
            # nao existe (`_base_select` -> `EntityNotFoundError(model, id)`).
            # Uma mensagem propria aqui tornaria as duas respostas
            # DISTINGUIVEIS, e distinguir e justamente o que o 404 nega.
            raise EntityNotFoundError(Project.__name__, identifier=project_id)
        return project

    async def list_page(
        self,
        params: PageParams,
        filters: ProjectFilters,
    ) -> Page[Project]:
        """Listagem paginada, escopada ao tenant, A LENTE e (opcionalmente) a um time.

        Filtros aplicados:
            - status, priority (opcionais, igualdade exata);
            - include_archived (default False);
            - LENTE DE TIME (sempre, exceto admin);
            - team_id (opcional): aquele time e seus descendentes.

        ⚠️ NAO HA MAIS PREDICADO DE PRIVACIDADE. Ate 10/09 este metodo injetava
        `(is_personal = false) OR (created_by = me)` para esconder o pessoal
        alheio.

        ⚠️⚠️ E ATE 11/09 NAO HAVIA PREDICADO DE TIME NENHUM -- O ESCOPO ERA O
        WORKSPACE INTEIRO. Quando tirei a privacidade eu escrevi aqui que "a
        lente do time responde sozinha". ERA FALSO: os filtros eram status,
        priority e arquivado, e o `_base_select` do `BaseRepository` fecha por
        `workspace_id` e soft delete -- nada olhava `Project.team_id`.
        Reportado na tela: o seletor de projeto oferecia projeto de outro time
        raiz. (Achado LENDO `BaseRepository._base_select`, e nao a spec.)

        ⚠️⚠️ E A LENTE AQUI NAO E FEATURE NOVA: e a ADR 0007, por escrito, desde
        o dia em que `project.team_id` nasceu -- *"a visibilidade de um projeto
        passa a depender de project.team_id estar na lente de time do usuario"*.
        Ela foi implementada para as TASKS (`_lente_de_time`, que casa por
        `Project.team_id`) e esquecida na listagem dos PROJETOS. O vazamento
        era de METADADO, nao de trabalho: dava para ler o nome de um projeto de
        outro time raiz, nunca as tarefas dele.

        ⚠️ SAO DOIS RECORTES, E SO UM RESOLVE O QUE ELA REPORTOU:
          - a LENTE responde "posso ver?", e para o ADMIN ela e `None` (ve
            tudo) -- portanto sozinha ela NAO tira o projeto do Comercial da
            tela de quem administra;
          - `team_id` responde "estou olhando qual time?", e vale para todos.
        Confundir os dois teria fechado o furo de seguranca e deixado o defeito
        da tela de pe.

        Ordenacao fixa: created_at DESC.
        """
        tenant = require_tenant()
        extra_filters = []
        if filters.status is not None:
            extra_filters.append(Project.status == filters.status)
        if filters.priority is not None:
            extra_filters.append(Project.priority == filters.priority)
        if not filters.include_archived:
            extra_filters.append(Project.is_archived.is_(False))

        # (A) A lente. `None` = admin de organizacao, sem filtro de TIME -- e
        # nao "sem filtro": o `workspace_id` entra sempre, no `_base_select`.
        visible = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )
        if visible is not None:
            extra_filters.append(Project.team_id.in_(visible))

        # (B) O recorte por time pedido pela tela.
        if filters.team_id is not None:
            # ⚠️ O TIME E SEUS DESCENDENTES, e nao igualdade. Projeto criado
            # num SUBTIME pertence ao contexto da raiz dele -- pedir a raiz e
            # receber so o que e dela mesma esconderia esse projeto de toda
            # tela que recorta por raiz.
            alvo = {filters.team_id} | team_scope.descendants(
                filters.team_id, tenant.team_tree
            )
            # ⚠️ O PARAMETRO ESTREITA, NUNCA ALARGA -- e isso e ESTRUTURAL, nao
            # uma checagem. Os dois predicados entram na MESMA lista e o repo os
            # combina com AND: pedir um time fora da lente devolve a intersecao
            # vazia sozinho.
            #
            # ⚠️ EU TINHA ESCRITO UM `alvo &= set(visible)` AQUI, com um
            # comentario dizendo que sem ele `?team_id=<time alheio>` furaria a
            # lente. Sabotei a linha para conferir: NENHUM teste caiu. Era
            # codigo morto, e o comentario afirmava uma protecao que o AND ja
            # dava -- pior que a ausencia, porque o proximo leitor confiaria
            # nela em vez de procurar quem protege de verdade.
            extra_filters.append(Project.team_id.in_(alvo))
        return await self._repo.list_page(
            params,
            filters=extra_filters,
            order_by=Project.created_at.desc(),
        )

    async def update(
        self,
        *,
        project_id: uuid.UUID,
        command: UpdateProjectCommand,
    ) -> Project:
        """Atualiza campos editaveis com semantica PATCH.

            - title eh normalizado com strip() se vier;
            - start_date <= due_date sobre o estado RESULTANTE
              (apos o merge);
            - transicao para COMPLETED -> seta completed_at;
            - transicao saindo de COMPLETED -> limpa completed_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
            ValidationError     -- title invalido ou datas inconsistentes.
        """
        # ⚠️⚠️ PELO `get`, E NAO PELO REPOSITORIO (Spec 049, fatia 0b): o `get`
        # tem a lente, e o repositorio so o workspace. Ate 14/09 as escritas
        # daqui (eram quatro; arquivar saiu em 17/09) buscavam direto -- a
        # lente de 11/09 protegia o LER e deixava o ESCREVER aberto, e o SUPERVISOR do SEO editou projeto do
        # Comercial. Fora da lente e 404, como no `get`.
        project = await self.get(project_id)
        # Spec 051, fatia A: a lente (404) e do `get`; o verbo no time, daqui.
        self._assert_verbo_no_time("project.update", project.team_id)

        # Aplica o patch campo a campo. None = nao mexer.
        if command.title is not None:
            title = command.title.strip()
            if not title:
                raise ValidationError(
                    "Titulo do projeto nao pode ser vazio.",
                    details={"field": "title"},
                )
            project.title = title

        if command.description is not None:
            project.description = command.description

        if command.priority is not None:
            project.priority = command.priority

        # Transicao de status com ajuste de completed_at.
        if command.status is not None and command.status != project.status:
            if command.status == ProjectStatus.COMPLETED:
                project.completed_at = func.now()  # type: ignore[assignment]
            elif project.status == ProjectStatus.COMPLETED:
                # Saindo de COMPLETED para qualquer outro: limpa.
                project.completed_at = None
            project.status = command.status

        if command.start_date is not None:
            project.start_date = command.start_date
        if command.due_date is not None:
            project.due_date = command.due_date

        # Valida o ESTADO RESULTANTE (apos o merge).
        self._validate_dates(project.start_date, project.due_date)

        await self._session.flush()

        logger.info(
            "project.updated",
            project_id=str(project.id),
        )
        return project

    async def soft_delete(self, *, project_id: uuid.UUID) -> Project:
        """Soft-delete: seta deleted_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
        """
        project = await self.get(project_id)  # a lente -- ver `update`
        self._assert_verbo_no_time("project.delete", project.team_id)

        project.deleted_at = func.now()  # type: ignore[assignment]
        await self._session.flush()

        logger.info("project.deleted", project_id=str(project.id))
        return project

    @staticmethod
    def _assert_verbo_no_time(verbo: str, team_id: uuid.UUID | None) -> None:
        """403 se quem chama nao tem `verbo` NO TIME do projeto. Spec 051, fatia A.

        ⚠️ SEMPRE DEPOIS DA LENTE (o `get`, ou o 422 do `create`): o que chega
        aqui a pessoa ja enxerga, entao o 403 nao vaza existencia.

        ⚠️ `team_id` NULO so existe em projeto antigo sem time, e `can_in(p,
        None)` responde so pela organizacao -- o mesmo "sem time nao e curinga"
        da Spec 045.
        """
        if not require_tenant().has_permission_in(verbo, team_id):
            raise AuthorizationError(
                "Você não tem essa permissão nos projetos deste time.",
                details={"permission": verbo},
            )

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    @staticmethod
    def _validate_dates(
        start_date: date | None, due_date: date | None
    ) -> None:
        """Garante start_date <= due_date quando ambos informados."""
        if start_date is not None and due_date is not None:
            if start_date > due_date:
                raise ValidationError(
                    "Data de inicio nao pode ser posterior a data limite.",
                    details={"field": "due_date"},
                )
