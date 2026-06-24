"""Schemas (DTOs) de request/response da autenticacao.

Schemas sao a fronteira da API: validam entrada e moldam
saida. Eles NAO sao entidades de dominio nem models ORM --
ficam so na camada de API.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Credenciais de login."""

    email: EmailStr
    password: str = Field(min_length=1)
    # Em multi-tenant por workspace, o login precisa saber em
    # QUAL workspace autenticar (o mesmo e-mail pode existir em
    # workspaces diferentes). O frontend envia o slug do
    # workspace (ex. da URL/subdominio).
    workspace_slug: str = Field(min_length=1, max_length=120)


class RefreshRequest(BaseModel):
    """Pedido de renovacao de access token."""

    refresh_token: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    """Troca de senha pelo proprio usuario (Entrega 7).

    Serve tanto ao 1o acesso (destrava o gate, ADR 0020) quanto a
    troca voluntaria. new_password segue o piso de 8 caracteres.
    """

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    """Par de tokens devolvido no login e no refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CurrentUserResponse(BaseModel):
    """Representacao do usuario autenticado (rota /auth/me).

    Inclui roles e permissions resolvidos do TenantContext --
    o frontend usa isso para habilitar/ocultar acoes na UI.
    """

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    email: EmailStr
    is_active: bool
    #: Entrega 7: front usa para redirecionar a tela de troca obrigatoria.
    must_change_password: bool = False
    roles: list[str]
    permissions: list[str]
