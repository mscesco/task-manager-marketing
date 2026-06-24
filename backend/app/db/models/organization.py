"""Models ORM da camada de Organizacao.

workspace : o tenant. Raiz de tudo.
team      : equipes, com hierarquia propria (parent_team_id).
users     : usuarios, escopados a um workspace.
user_team : pivot N:N usuario<->equipe, com papel (role).

Cada model corresponde 1:1 a uma tabela do schema_v5.sql.
As FKs COMPOSTAS (id, workspace_id) sao declaradas via
ForeignKeyConstraint, exatamente como no schema, para
impedir cruzamento relacional entre tenants.
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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import UserTeamRole

# Regex de slug, identica ao CHECK do schema v5.
_SLUG_REGEX = r"^[a-z0-9-]+$"


class Workspace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """O tenant. workspace NAO carrega workspace_id (e a raiz)."""

    __tablename__ = "workspace"
    __table_args__ = (
        CheckConstraint(f"slug ~ '{_SLUG_REGEX}'", name="workspace_slug_format"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)


class Team(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Equipe. Hierarquia via parent_team_id (ciclos validados na service)."""

    __tablename__ = "team"
    __table_args__ = (
        # FK simples: workspace.
        # FK composta: parent_team -> (team.id, team.workspace_id).
        UniqueConstraint("id", "workspace_id", name="team_id_workspace"),
        ForeignKeyConstraint(
            ["parent_team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="team_parent",
        ),
        UniqueConstraint("workspace_id", "slug", name="team_workspace_slug"),
        CheckConstraint(
            "parent_team_id IS NULL OR parent_team_id <> id",
            name="team_no_self_parent",
        ),
        CheckConstraint(f"slug ~ '{_SLUG_REGEX}'", name="team_slug_format"),
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
    description: Mapped[str | None] = mapped_column(String, nullable=True)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Usuario. Escopado a um workspace; e-mail unico por workspace.

    Nota: a tabela e `users` (plural) no schema, pois `user`
    e palavra reservada do PostgreSQL.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="users_id_workspace"),
        UniqueConstraint("workspace_id", "email", name="users_workspace_email"),
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
    # Entrega 7: senha provisoria pendente de troca (gate -> ADR 0020).
    must_change_password: Mapped[bool] = mapped_column(
        nullable=False, server_default="false", default=False
    )
    # Entrega 7: validade da provisoria (ADR 0019). NULL = senha
    # definitiva (nao expira). password_hash continua NOT NULL.
    password_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class UserTeam(UUIDPrimaryKeyMixin, Base):
    """Pivot N:N usuario<->equipe. Carrega o papel do usuario na equipe."""

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
        UniqueConstraint("user_id", "team_id", name="user_team_user_team"),
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
