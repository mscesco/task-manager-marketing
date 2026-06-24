"""Seed (bootstrap) dos subtimes da UniFECAF -- TEMPORARIO.

Existe ate os endpoints de administracao de time chegarem (entrega
futura). Idempotente: roda 2x sem duplicar (consulta por slug antes de
inserir). NAO e migration -- e dado de tenant, fora do historico do
Alembic.

Padrao igual ao WorkspaceProvisioningService: roda fora de
TenantContext, escrevendo direto na sessao escopada por workspace_id.
O commit e do chamador (script via session_scope).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import Team, User, UserTeam, Workspace
from app.db.models.enums import UserTeamRole
from app.shared.exceptions.base import EntityNotFoundError, ValidationError

logger = get_logger(__name__)

_SLUG_REGEX = re.compile(r"^[a-z0-9-]+$")

# Subtimes do Marketing (nome, slug). Slug normalizado: minusculas,
# sem acento, hifen no lugar de espaco.
DEFAULT_SUBTEAMS: tuple[tuple[str, str], ...] = (
    ("CRM e Automação", "crm-e-automacao"),
    ("Design", "design"),
    ("Eventos", "eventos"),
    ("Audiovisual", "audiovisual"),
    ("Desenvolvimento", "desenvolvimento"),
    ("SEO", "seo"),
    ("Mídias Sociais", "midias-sociais"),
    ("Copy", "copy"),
    ("Tráfego Pago", "trafego-pago"),
)


@dataclass(frozen=True, slots=True)
class TeamSeedResult:
    workspace_id: uuid.UUID
    principal_team_id: uuid.UUID
    created_subteam_slugs: tuple[str, ...]
    admin_user_id: uuid.UUID
    admin_role: str


class TeamSeedService:
    """Cria os subtimes sob o time principal e vincula o admin."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def seed(
        self,
        *,
        workspace_slug: str,
        admin_email: str,
        principal_team_slug: str = "marketing",
        admin_role: UserTeamRole = UserTeamRole.MANAGER,
        subteams: tuple[tuple[str, str], ...] = DEFAULT_SUBTEAMS,
    ) -> TeamSeedResult:
        """Idempotente. Cria subtimes faltantes e faz upsert do papel do
        admin no time principal.

        Erros:
            EntityNotFoundError -- workspace, time principal ou admin
              inexistente.
            ValidationError     -- slug mal formado.
        """
        for _, slug in subteams:
            if not _SLUG_REGEX.match(slug):
                raise ValidationError(
                    f"Slug de subtime invalido: '{slug}'.",
                    details={"field": "slug"},
                )

        # 1. Workspace.
        ws = (
            await self._session.execute(
                select(Workspace).where(Workspace.slug == workspace_slug)
            )
        ).scalar_one_or_none()
        if ws is None:
            raise EntityNotFoundError("Workspace", identifier=workspace_slug)

        # 2. Time principal (raiz: parent NULL).
        principal = (
            await self._session.execute(
                select(Team).where(
                    Team.workspace_id == ws.id,
                    Team.slug == principal_team_slug,
                    Team.parent_team_id.is_(None),
                )
            )
        ).scalar_one_or_none()
        if principal is None:
            raise EntityNotFoundError("Team", identifier=principal_team_slug)

        # 3. Subtimes faltantes (idempotente por slug).
        existing_slugs = set(
            (
                await self._session.execute(
                    select(Team.slug).where(Team.workspace_id == ws.id)
                )
            )
            .scalars()
            .all()
        )
        created: list[str] = []
        for name, slug in subteams:
            if slug in existing_slugs:
                continue
            self._session.add(
                Team(
                    workspace_id=ws.id,
                    name=name,
                    slug=slug,
                    parent_team_id=principal.id,
                )
            )
            created.append(slug)
        await self._session.flush()

        # 4. Admin (por e-mail no workspace).
        admin = (
            await self._session.execute(
                select(User).where(
                    User.workspace_id == ws.id,
                    User.email == admin_email.strip().lower(),
                )
            )
        ).scalar_one_or_none()
        if admin is None:
            raise EntityNotFoundError("User", identifier=admin_email)

        # 5. Upsert do papel do admin no principal.
        membership = (
            await self._session.execute(
                select(UserTeam).where(
                    UserTeam.workspace_id == ws.id,
                    UserTeam.user_id == admin.id,
                    UserTeam.team_id == principal.id,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            self._session.add(
                UserTeam(
                    workspace_id=ws.id,
                    user_id=admin.id,
                    team_id=principal.id,
                    role=admin_role,
                )
            )
        else:
            membership.role = admin_role
        await self._session.flush()

        logger.info(
            "teams.seeded",
            workspace_slug=workspace_slug,
            created_subteams=created,
            admin_role=admin_role.value,
        )
        return TeamSeedResult(
            workspace_id=ws.id,
            principal_team_id=principal.id,
            created_subteam_slugs=tuple(created),
            admin_user_id=admin.id,
            admin_role=admin_role.value,
        )
