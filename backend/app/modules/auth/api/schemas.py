"""Schemas (DTOs) de request/response da autenticacao.

Schemas sao a fronteira da API: validam entrada e moldam
saida. Eles NAO sao entidades de dominio nem models ORM --
ficam so na camada de API.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.db.models.enums import OrgRole


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


class RenameSelfRequest(BaseModel):
    """Troca do PROPRIO nome (Spec 051, fatia E).

    ⚠️ So `name`: nao ha `user_id` no corpo, e a ausencia e a trava -- o alvo
    e sempre quem esta no token.
    """

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
    #: Papel na ORGANIZACAO -- `None` para a maioria. Spec 047, 10/09.
    #:
    #: ⚠️⚠️ CAMPO PROPRIO PORQUE `roles` MISTURA OS DOIS NIVEIS, de proposito
    #: (ver o comentario na rota). A mistura serve para "quais acoes esta
    #: pessoa pode" e ARRUINA a pergunta "ela administra a ORGANIZACAO?" --
    #: um ADMIN de TIME entra em `roles` como "ADMIN" e fica indistinguivel
    #: de um ADMIN de organizacao.
    #:
    #: ⚠️ E o defeito foi visto em producao, em 10/09: uma pessoa com papel de
    #: time ADMIN (residuo anterior a Spec 045) via "Gerenciar a organizacao"
    #: no seletor da barra. O gate era `permissions.includes("area.create")`,
    #: e `area.create` tambem vem do papel de TIME ADMIN.
    org_role: OrgRole | None = None
    #: Trabalho 2: vinculos (time, papel) para o front derivar a lente
    #: (quais quadros de subtime mostrar, qual e a raiz).
    teams: list[TeamMembershipOut] = []
