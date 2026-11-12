"""Provisionamento de workspace: cria, atomicamente, workspace + time raiz +
admin + quadro geral. Acionado por `scripts/provision_workspace.py`.

Roda antes de existir tenant, entao escreve direto na sessao.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import Team, User, UserTeam, Workspace
from app.db.models.enums import OrgRole, UserTeamRole
from app.modules.auth.infrastructure.security import hash_password
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from app.shared.exceptions.base import ConflictError, ValidationError

logger = get_logger(__name__)

# Mesmo formato de slug do CHECK do schema v5.
_SLUG_REGEX = re.compile(r"^[a-z0-9-]+$")


@dataclass(frozen=True, slots=True)
class ProvisionWorkspaceCommand:
    """Dados de entrada do provisionamento (validados no service)."""

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


class WorkspaceProvisioningService:
    """Caso de uso: provisionar um workspace completo e atomico."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def provision(
        self, command: ProvisionWorkspaceCommand
    ) -> ProvisionWorkspaceResult:
        """Cria workspace + equipe inicial + admin + quadro geral.

        Numa transacao so; o commit e de quem chama.
        """
        self._validate(command)

        await self._ensure_workspace_slug_free(command.workspace_slug)

        workspace = Workspace(
            name=command.workspace_name,
            slug=command.workspace_slug,
        )
        self._session.add(workspace)
        await self._session.flush()

        team = Team(
            workspace_id=workspace.id,
            name=command.initial_team_name,
            slug=command.initial_team_slug,
            parent_team_id=None,
        )
        self._session.add(team)

        admin = User(
            workspace_id=workspace.id,
            name=command.admin_name,
            # Em minusculas, como o cadastro de membro (`member_service`).
            email=command.admin_email.strip().lower(),
            password_hash=hash_password(command.admin_password),
            is_active=True,
            # O admin do bootstrap escolhe a propria senha: sem provisoria.
            must_change_password=False,
        )
        self._session.add(admin)
        await self._session.flush()  # ids de team e admin

        # ADMIN e papel de organizacao, sem time; sem ele o workspace nasce
        # sem dono e ninguem consegue promover alguem pela tela.
        admin.org_role = OrgRole.ADMIN

        # Vinculo de trabalho na raiz como MANAGER (triar solicitacoes desde
        # o primeiro minuto).
        membership = UserTeam(
            workspace_id=workspace.id,
            user_id=admin.id,
            team_id=team.id,
            role=UserTeamRole.MANAGER,
        )
        self._session.add(membership)
        await self._session.flush()

        # Quadro geral do time raiz, na mesma transacao. BoardService nao
        # precisa de tenant.
        quadro = await BoardService(self._session).create_default_board(
            workspace_id=workspace.id,
            team_id=team.id,
            # As oito colunas da migration `0008`; time raiz criado depois
            # nasce com quatro (ver `create_default_board`).
            colunas=COLUNAS_PADRAO,
        )

        logger.info(
            "workspace.provisioned",
            workspace_id=str(workspace.id),
            workspace_slug=workspace.slug,
            admin_user_id=str(admin.id),
            board_id=str(quadro.id),
        )
        return ProvisionWorkspaceResult(
            workspace_id=workspace.id,
            team_id=team.id,
            admin_user_id=admin.id,
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
