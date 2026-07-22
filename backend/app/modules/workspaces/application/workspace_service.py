"""Casos de uso de gestao do workspace e de equipes.

Toda regra de negocio fica aqui -- os routers apenas
delegam. Os services recebem a sessao e instanciam seus
repositories; o commit e feito pelo Unit of Work acionado
no router/DI.

Casos de uso:
    WorkspaceService.get_current   -- ver o workspace atual
    WorkspaceService.rename        -- renomear o workspace
    TeamService.create             -- criar uma equipe (raiz ou subtime)
    TeamService.list_teams         -- listar equipes
    TeamService.move               -- mover equipe (validando ciclos)
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import Team, Workspace
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.modules.workspaces.infrastructure.workspace_repository import (
    WorkspaceRepository,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)

_SLUG_REGEX = re.compile(r"^[a-z0-9-]+$")


class WorkspaceService:
    """Casos de uso do proprio workspace."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = WorkspaceRepository(session)

    async def get_current(self) -> Workspace:
        """Retorna o workspace do tenant corrente."""
        return await self._repo.get_current()

    async def rename(self, *, new_name: str) -> Workspace:
        """Renomeia o workspace corrente.

        So o nome e editavel: o slug e usado em URLs/login e
        muda-lo quebraria referencias -- por isso fica imutavel
        apos o provisionamento.
        """
        name = new_name.strip()
        if not name:
            raise ValidationError(
                "Nome do workspace nao pode ser vazio.",
                details={"field": "name"},
            )

        workspace = await self._repo.get_current()
        workspace.name = name
        logger.info("workspace.renamed", workspace_id=str(workspace.id))
        return workspace


class TeamService:
    """Casos de uso de equipes.

    DECISOES ARQUITETURAIS (hierarquia + permissoes)
    -----------------------------------------------------
    1. HIERARQUIA E APENAS ORGANIZACIONAL
       parent_team_id serve para organizacao, navegacao e
       agrupamento. NAO implica heranca de permissoes nem
       cascata de acesso.

    2. PERMISSOES SAO EXPLICITAS, via user_team
       Para ser ADMIN de um subtime, e preciso um registro
       PROPRIO em user_team -- mesmo se o usuario ja for
       ADMIN do team pai.

    3. SEPARACAO DE RESPONSABILIDADES
         - team / parent_team_id : estrutura
         - user_team             : autorizacao (RBAC)
       Essa separacao e intencional e deve ser preservada.

    4. EVOLUCAO FUTURA CONTINUA POSSIVEL
       Se um dia for preciso heranca de permissoes, sera uma
       camada NOVA sobre esta estrutura -- nao precisa mudar
       este service nem o schema.

    5. PROFUNDIDADE ILIMITADA
       Sem CHECK depth <= N no banco. A UI pode futuramente
       impor recomendacoes visuais. O service guarda apenas
       um max_depth=50 defensivo no collect_ancestor_ids
       (rede contra arvore corrompida, nao regra de negocio).

    6. ESTRUTURA: SO parent_team_id
       Optamos por NAO adicionar `path` (LTREE) nem `depth`
       em team -- diferente de task. Motivo: equipes sao
       poucas (poucas dezenas no maximo, profundidade <10)
       e recursao Python e suficiente. LTREE seria
       overengineering para esse volume. Schema v5 maduro,
       nao se mexe.

    7. BANCO VALIDA O QUE PODE
       FK composta (parent_team_id, workspace_id) ja garante
       isolamento por workspace. CHECK team_no_self_parent
       impede self-reference direta. NAO duplicamos essas
       validacoes aqui.

    8. SERVICE VALIDA APENAS CICLOS INDIRETOS
       A->B->C->A. Implementado por recursao subindo a arvore
       (collect_ancestor_ids no repository). Sem LTREE.

    9. SEM HERANCA DE PERMISSOES
       Reforco: o BaseRepository nao consulta a arvore para
       decidir acesso. require_permission le apenas o
       TenantContext, que vem de user_team direto.
    -----------------------------------------------------
    """

    def __init__(self, session: AsyncSession) -> None:
        self._repo = TeamRepository(session)
        self._session = session

    async def create(
        self,
        *,
        name: str,
        slug: str,
        parent_team_id: uuid.UUID | None = None,
    ) -> Team:
        """Cria uma equipe no workspace corrente.

        Se `parent_team_id` for informado, a equipe nasce como
        subtime daquele pai. Ao criar (sem id ainda), nao ha
        risco de ciclo -- so precisamos validar que o pai
        existe no workspace.

        Erros:
            ValidationError -- nome vazio ou slug mal formado.
            ConflictError   -- slug ja usado no workspace.
            EntityNotFoundError -- parent_team_id inexistente.
        """
        name = name.strip()
        slug = slug.strip()

        if not name:
            raise ValidationError(
                "Nome da equipe nao pode ser vazio.",
                details={"field": "name"},
            )
        if not _SLUG_REGEX.match(slug):
            raise ValidationError(
                "Slug de equipe invalido: use minusculas, "
                "digitos e hifen.",
                details={"field": "slug"},
            )
        if await self._repo.slug_exists(slug):
            raise ConflictError(
                f"Ja existe uma equipe com o slug '{slug}'.",
                details={"field": "slug", "value": slug},
            )

        # Spec 024/D4 -- mesma logica do comentario abaixo, agora para o
        # indice unico `team_unica_raiz_por_workspace`: sem esta checagem,
        # criar um segundo time raiz vira IntegrityError cru (HTTP 500).
        if parent_team_id is None and await self._repo.root_exists():
            raise ConflictError(
                "Este workspace ja possui um time principal. Novos times "
                "precisam ser criados como subtime de algum time existente.",
                details={"field": "parent_team_id"},
            )

        # Se o pai foi informado, ele precisa existir no workspace.
        # A FK composta no banco ja garantiria, mas falhar aqui
        # da uma mensagem de dominio clara em vez de IntegrityError.
        if parent_team_id is not None:
            parent = await self._repo.get_by_id(parent_team_id)
            if parent is None:
                raise EntityNotFoundError("Team", identifier=parent_team_id)

        # workspace_id e injetado pelo BaseRepository.add a partir
        # do tenant corrente -- nao precisamos seta-lo aqui.
        team = Team(name=name, slug=slug, parent_team_id=parent_team_id)
        self._repo.add(team)
        await self._repo.session.flush()  # garante o id

        logger.info("team.created", team_id=str(team.id), slug=slug)
        return team

    async def list_teams(self) -> list[Team]:
        """Lista todas as equipes do workspace corrente."""
        return await self._repo.list_all()

    async def move(
        self,
        *,
        team_id: uuid.UUID,
        new_parent_id: uuid.UUID | None,
    ) -> Team:
        """Move uma equipe para um novo pai (ou para a raiz).

        `new_parent_id=None` torna a equipe raiz. Se informado,
        a equipe vira filha do pai indicado.

        Validacoes:
            - Equipe a mover existe no workspace.
            - Novo pai (se informado) existe no workspace.
            - Equipe nao pode ser pai dela mesma (auto-referencia).
            - Mover nao pode criar CICLO INDIRETO (A->B->C->A):
              checamos se a propria `team_id` aparece entre os
              ancestrais do `new_parent_id`.

        Erros:
            EntityNotFoundError -- team_id ou new_parent_id ausente.
            BusinessRuleError   -- ciclo detectado / auto-referencia.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # No-op: pai novo igual ao atual, nada a fazer. (Cobre tambem o caso
        # "raiz continua raiz", que por isso nunca chega na checagem abaixo.)
        if team.parent_team_id == new_parent_id:
            return team

        # Spec 024/D4 -- promover subtime a raiz quando ja existe uma esbarra
        # no indice unico. Falha aqui, com mensagem de dominio, em vez de
        # IntegrityError (HTTP 500).
        if new_parent_id is None and await self._repo.root_exists():
            raise ConflictError(
                "Este workspace ja possui um time principal. Para trocar qual "
                "time e o principal, mova o atual para baixo de outro antes.",
                details={"field": "new_parent_id"},
            )

        if new_parent_id is not None:
            # Banco ja bloquearia, mas mensagem clara antes do flush.
            if new_parent_id == team_id:
                raise BusinessRuleError(
                    "Uma equipe nao pode ser pai de si mesma.",
                    details={"team_id": str(team_id)},
                )
            new_parent = await self._repo.get_by_id(new_parent_id)
            if new_parent is None:
                raise EntityNotFoundError(
                    "Team", identifier=new_parent_id
                )
            # Checagem de ciclo: subo a arvore a partir do novo
            # pai; se eu encontrar o proprio team_id no caminho,
            # estou criando um ciclo.
            ancestors = await self._repo.collect_ancestor_ids(new_parent_id)
            if team_id in ancestors:
                raise BusinessRuleError(
                    "Movimentacao criaria um ciclo na hierarquia "
                    "de equipes.",
                    details={
                        "team_id": str(team_id),
                        "new_parent_id": str(new_parent_id),
                    },
                )

        team.parent_team_id = new_parent_id
        await self._session.flush()

        logger.info(
            "team.moved",
            team_id=str(team_id),
            new_parent_id=str(new_parent_id) if new_parent_id else None,
        )
        return team
