"""Provisionamento de workspace -- caso de uso permanente.

ESTE E O CASO DE USO REAL, nao um script descartavel.

Provisionar um workspace e a operacao de "dar vida" a uma
empresa nova no sistema: cria, de forma ATOMICA, o
workspace + sua primeira equipe + seu primeiro usuario
admin + o projeto pessoal do admin (ADR 0001). E uma
operacao administrativa rara -- nao um signup publico.

QUEM ACIONA este service pode mudar ao longo do tempo:
    - hoje: um script de linha de comando
      (scripts/provision_workspace.py) -- gatilho fino;
    - amanha: um painel administrativo interno, ou um
      webhook de um sistema de billing.
A REGRA (este service) e a mesma sempre. So o gatilho muda.

Por que NAO usa o BaseRepository (parcialmente):
    O provisionamento roda ANTES de existir qualquer tenant
    -- ele esta justamente criando o primeiro. Logo nao ha
    TenantContext nos primeiros passos, e o BaseRepository
    (que o exige) nao se aplica para workspace/team/user/
    user_team. Este service escreve direto na sessao para
    esses.

    DEPOIS de criar o admin, abrimos um tenant_scope
    efemero para reaproveitar o ProjectService.create_personal_for
    (que usa BaseRepository). Mantemos o principio "provisioning
    nao tem tenant inicial" sem duplicar a logica de pessoal.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import tenant_scope
from app.db.models import Team, User, UserTeam, Workspace
from app.db.models.enums import UserTeamRole
from app.modules.auth.infrastructure.security import hash_password
from app.modules.tasks.application.project_service import ProjectService
from app.shared.exceptions.base import ConflictError, ValidationError

logger = get_logger(__name__)

# Mesmo formato de slug do CHECK do schema v5.
_SLUG_REGEX = re.compile(r"^[a-z0-9-]+$")


@dataclass(frozen=True, slots=True)
class ProvisionWorkspaceCommand:
    """Dados de entrada do provisionamento.

    Frozen: um comando e um valor imutavel, nao um formulario
    mutavel. Validacoes de formato acontecem no service.
    """

    workspace_name: str
    workspace_slug: str
    initial_team_name: str
    initial_team_slug: str
    admin_name: str
    admin_email: str
    admin_password: str


@dataclass(frozen=True, slots=True)
class ProvisionWorkspaceResult:
    """Identificadores das entidades criadas pelo provisionamento."""

    workspace_id: uuid.UUID
    team_id: uuid.UUID
    admin_user_id: uuid.UUID
    personal_project_id: uuid.UUID


class WorkspaceProvisioningService:
    """Caso de uso: provisionar um workspace completo e atomico."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def provision(
        self, command: ProvisionWorkspaceCommand
    ) -> ProvisionWorkspaceResult:
        """Cria workspace + equipe inicial + admin + pessoal do admin.

        Tudo numa unica transacao: ou as cinco linhas (workspace,
        team, users, user_team, project_personal) sao gravadas, ou
        nenhuma. Quem chama este service e responsavel pelo commit
        (Unit of Work ou session_scope).

        Erros possiveis:
            ValidationError -- slug/e-mail mal formado.
            ConflictError   -- slug de workspace ja existe.
        """
        self._validate(command)

        # Slug de workspace e unico globalmente (UNIQUE no schema).
        await self._ensure_workspace_slug_free(command.workspace_slug)

        # 1. Workspace -- a raiz do tenant.
        workspace = Workspace(
            name=command.workspace_name,
            slug=command.workspace_slug,
        )
        self._session.add(workspace)
        # flush: precisamos do workspace.id para as FKs abaixo.
        await self._session.flush()

        # 2. Equipe inicial.
        team = Team(
            workspace_id=workspace.id,
            name=command.initial_team_name,
            slug=command.initial_team_slug,
            parent_team_id=None,
        )
        self._session.add(team)

        # 3. Usuario admin.
        admin = User(
            workspace_id=workspace.id,
            name=command.admin_name,
            email=command.admin_email,
            password_hash=hash_password(command.admin_password),
            is_active=True,
            # Entrega 7: o admin do bootstrap escolhe a propria senha e
            # NAO entra no fluxo de provisoria -- senao nao haveria admin
            # destravado para emitir o 1o cadastro (chicken-and-egg).
            must_change_password=False,
        )
        self._session.add(admin)
        await self._session.flush()  # ids de team e admin

        # 4. Vinculo admin <-> equipe, com papel ADMIN.
        # Spec 024/D6: o time criado no passo 1 e a RAIZ
        # (parent_team_id=None), e ADMIN so existe na raiz -- entao este
        # vinculo ja nasce conforme a invariante de nivel. E tambem o que
        # garante que todo workspace novo tem alguem apto a triar
        # solicitacoes (anti-lockout).
        membership = UserTeam(
            workspace_id=workspace.id,
            user_id=admin.id,
            team_id=team.id,
            role=UserTeamRole.ADMIN,
        )
        self._session.add(membership)
        await self._session.flush()

        # 5. Projeto pessoal do admin (ADR 0001).
        # ProjectService usa BaseRepository -> require_tenant(),
        # entao abrimos um tenant_scope efemero. Tudo continua no
        # mesmo session/transacao.
        with tenant_scope(workspace.id, admin.id):
            personal = await ProjectService(self._session).create_personal_for(
                admin.id
            )

        logger.info(
            "workspace.provisioned",
            workspace_id=str(workspace.id),
            workspace_slug=workspace.slug,
            admin_user_id=str(admin.id),
            personal_project_id=str(personal.id),
        )
        return ProvisionWorkspaceResult(
            workspace_id=workspace.id,
            team_id=team.id,
            admin_user_id=admin.id,
            personal_project_id=personal.id,
        )

    # ----------------------------------------------------
    # Validacoes
    # ----------------------------------------------------
    @staticmethod
    def _validate(command: ProvisionWorkspaceCommand) -> None:
        """Valida formato dos campos antes de tocar no banco."""
        if not _SLUG_REGEX.match(command.workspace_slug):
            raise ValidationError(
                "Slug de workspace invalido: use minusculas, "
                "digitos e hifen.",
                details={"field": "workspace_slug"},
            )
        if not _SLUG_REGEX.match(command.initial_team_slug):
            raise ValidationError(
                "Slug de equipe invalido: use minusculas, "
                "digitos e hifen.",
                details={"field": "initial_team_slug"},
            )
        if "@" not in command.admin_email:
            raise ValidationError(
                "E-mail do admin invalido.",
                details={"field": "admin_email"},
            )
        if len(command.admin_password) < 8:
            raise ValidationError(
                "Senha do admin deve ter ao menos 8 caracteres.",
                details={"field": "admin_password"},
            )

    async def _ensure_workspace_slug_free(self, slug: str) -> None:
        """Garante que o slug de workspace ainda nao foi usado."""
        exists = (
            await self._session.execute(
                select(Workspace.id).where(Workspace.slug == slug).limit(1)
            )
        ).scalar_one_or_none()
        if exists is not None:
            raise ConflictError(
                f"Ja existe um workspace com o slug '{slug}'.",
                details={"field": "workspace_slug", "value": slug},
            )
