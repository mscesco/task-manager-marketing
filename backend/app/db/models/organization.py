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
        # No banco esta UNIQUE se chama `workspace_slug_key` (nome default do
        # Postgres, herdado do baseline). Declarada explicitamente porque
        # `unique=True` geraria `uq_workspace_slug` pela NAMING_CONVENTION --
        # e nome divergente vira drop+create no autogenerate.
        UniqueConstraint("slug", name="workspace_slug_key"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)


class Team(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Equipe. Hierarquia via parent_team_id (ciclos validados na service)."""

    __tablename__ = "team"
    __table_args__ = (
        # FK simples: workspace.
        # FK composta: parent_team -> (team.id, team.workspace_id).
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
        # ⚠️⚠️ AQUI MORAVA `team_unica_raiz_por_workspace` -- indice unico
        # parcial (`WHERE parent_team_id IS NULL`) que permitia UM time raiz
        # por workspace. Ele saiu na Spec 046, fatia 2 (migration `0023`).
        #
        # O que ele sustentava, e o que aconteceu com cada coisa:
        #
        #   "time principal e fato estrutural, nao convencao de slug"
        #       -> continua verdade, e agora ha N deles. `root_of()` sempre
        #          subiu pelos pais e devolveu a raiz DAQUELA arvore, entao a
        #          nocao nao dependia da unicidade.
        #
        #   "a invariante de papeis (ADMIN/MANAGER so existem na raiz)"
        #       -> a Spec 045 (fatia D) reescreveu essa invariante e ela nao
        #          depende mais de haver uma raiz: MANAGER continua so na
        #          raiz, e a permissao dele carrega o `team_id` desde a fatia
        #          C. Era esse acoplamento que fazia a 045 ser pre-requisito
        #          desta spec.
        #
        # ⚠️ NAO RECRIE. O que impede duas AREAS com o mesmo nome e o
        # `uq_team_workspace_slug` logo acima, que continua de pe e vale para
        # qualquer nivel. Este indice falava de QUANTIDADE, nao de nome.
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
    """Usuario. Escopado a um workspace; e-mail unico por workspace.

    Nota: a tabela e `users` (plural) no schema, pois `user`
    e palavra reservada do PostgreSQL.
    """

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
    # Entrega 7: senha provisoria pendente de troca (gate -> ADR 0020).
    must_change_password: Mapped[bool] = mapped_column(
        nullable=False, server_default="false", default=False
    )
    # Entrega 7: validade da provisoria (ADR 0019). NULL = senha
    # definitiva (nao expira). password_hash continua NOT NULL.
    password_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Spec 045 (fatia B): PAPEL NA ORGANIZACAO -- sem time.
    #
    # ⚠️ MORA EM `users`, e nao numa tabela nova, porque a pertenca ja esta
    # aqui: `users.workspace_id` e FK propria, e-mail e unico POR workspace, e
    # nao existe usuario em dois workspaces. Uma tabela `workspace_member`
    # repetiria essa chave sem acrescentar nada.
    #
    # NULL = sem papel de organizacao (a maioria). O papel de TIME continua
    # em `user_team`, e as duas pertencas sao independentes: quem tem papel
    # aqui NAO precisa de vinculo de time nenhum -- e esse e o ponto.
    # ⚠️ O `comment` PRECISA BATER COM O DA MIGRATION, palavra por palavra. O
    # portao de drift compara os dois e reprovou aqui na primeira tentativa:
    # a migration tinha `COMMENT ON COLUMN` e o modelo nao, entao o
    # autogenerate propunha remover o comentario. Nenhum teste ve isso.
    org_role: Mapped[OrgRole | None] = mapped_column(
        Enum(OrgRole, name="org_role", create_type=False),
        nullable=True,
        comment=(
            "Papel na ORGANIZACAO (sem time). NULL = nenhum. Spec 045, fatia B."
        ),
    )
    # Spec 030: contador de revogacao de sessao. Todo token carrega o valor
    # do momento em que foi emitido (claim `tv`); incrementar aqui invalida
    # de uma vez TODOS os tokens ja emitidos para este usuario.
    #
    # Quem incrementa (Spec 030, D3): troca de senha, reset pelo gestor e
    # logout. Criar membro NAO incrementa (nao ha sessao para matar), e
    # desativar tambem nao (is_active ja e conferido a cada requisicao).
    token_version: Mapped[int] = mapped_column(
        nullable=False, server_default="0", default=0
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
    # ⚠️ Coluna do baseline 0001, redundante com joined_at. Mapeada so pra
    # o autogenerate parar de propor `drop_column`. Ninguem le.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
