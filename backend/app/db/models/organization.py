"""Models de organizacao: workspace (tenant), team, users e user_team.

As FKs compostas (id, workspace_id) impedem cruzar dados entre tenants.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import OrgRole, UserTeamRole

# Regex de slug, identica ao CHECK do schema v5.
_SLUG_REGEX = r"^[a-z0-9-]+$"


class Workspace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """O tenant. workspace NAO carrega workspace_id (e a raiz)."""

    __tablename__ = "workspace"
    __table_args__ = (
        CheckConstraint(f"slug ~ '{_SLUG_REGEX}'", name="workspace_slug_format"),
        # Nome explicito: `unique=True` geraria outro nome pela
        # NAMING_CONVENTION, e o autogenerate proporia drop+create.
        UniqueConstraint("slug", name="workspace_slug_key"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)


class Team(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Equipe. Hierarquia via parent_team_id (ciclos validados na service)."""

    __tablename__ = "team"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_team_id_workspace"),
        ForeignKeyConstraint(
            ["parent_team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="team_parent",
        ),
        UniqueConstraint("workspace_id", "slug", name="uq_team_workspace_slug"),
        CheckConstraint(
            "parent_team_id IS NULL OR parent_team_id <> id",
            name="team_no_self_parent",
        ),
        CheckConstraint(f"slug ~ '{_SLUG_REGEX}'", name="team_slug_format"),
        # Um workspace pode ter varios times raiz: nao recrie indice limitando
        # a quantidade. Slug repetido ja e barrado por `uq_team_workspace_slug`.
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    parent_team_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Usuario, com e-mail unico por workspace. `users` porque `user` e reservada."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_users_id_workspace"),
        UniqueConstraint("workspace_id", "email", name="uq_users_workspace_email"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        nullable=False, server_default="true", default=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Senha provisoria pendente de troca.
    must_change_password: Mapped[bool] = mapped_column(
        nullable=False, server_default="false", default=False
    )
    # Validade da senha provisoria. NULL = definitiva.
    password_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Papel na organizacao, independente de vinculo de time. NULL = nenhum.
    # O `comment` tem de bater com o da migration, ou o autogenerate acusa drift.
    org_role: Mapped[OrgRole | None] = mapped_column(
        Enum(OrgRole, name="org_role", create_type=False),
        nullable=True,
        comment=(
            "Papel na ORGANIZACAO (sem time). NULL = nenhum. Spec 045, fatia B."
        ),
    )
    # Revogacao de sessao: todo token carrega este valor (claim `tv`);
    # incrementar invalida todos. Sobe em troca de senha, reset e logout.
    token_version: Mapped[int] = mapped_column(
        nullable=False, server_default="0", default=0
    )


class UserTeam(UUIDPrimaryKeyMixin, Base):
    """Vinculo usuario-time, com o papel."""

    __tablename__ = "user_team"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="user_team_user",
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="CASCADE",
            name="user_team_team",
        ),
        UniqueConstraint("user_id", "team_id", name="uq_userteam_user_team"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    role: Mapped[UserTeamRole] = mapped_column(
        Enum(UserTeamRole, name="user_team_role", create_type=False),
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Redundante com joined_at; mapeada so para o autogenerate nao propor drop.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
