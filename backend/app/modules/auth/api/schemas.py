"""Schemas de request/response da autenticacao."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.db.models.enums import OrgRole


class LoginRequest(BaseModel):
    """Credenciais de login."""

    email: EmailStr
    password: str = Field(min_length=1)
    # O mesmo e-mail pode existir em workspaces diferentes.
    workspace_slug: str = Field(min_length=1, max_length=120)


class RefreshRequest(BaseModel):
    """Pedido de renovacao de access token."""

    refresh_token: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    """Troca de senha pelo proprio usuario: 1o acesso ou voluntaria."""

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class RenameSelfRequest(BaseModel):
    """Troca do proprio nome. Sem `user_id` de proposito: o alvo e o do token."""

    name: str = Field(min_length=1, max_length=255)


class RenameSelfResponse(BaseModel):
    name: str


class TeamMembershipOut(BaseModel):
    """Um vinculo (time, papel) do usuario. Base para o front derivar a
    lente: quais quadros de time mostrar e qual e a raiz. So leitura."""

    team_id: uuid.UUID
    role: str


class TokenPair(BaseModel):
    """Par de tokens devolvido no login e no refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CurrentUserResponse(BaseModel):
    """Usuario autenticado (/auth/me), com roles e permissions resolvidos."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    email: EmailStr
    is_active: bool
    must_change_password: bool = False
    roles: list[str]
    permissions: list[str]
    #: Papel na organizacao (`None` para a maioria). Campo proprio porque
    #: `roles` mistura papel de time e de organizacao.
    org_role: OrgRole | None = None
    teams: list[TeamMembershipOut] = []
