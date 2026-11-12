"""Schemas (DTOs) de request/response do modulo users (membros)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.db.models.enums import OrgRole, UserTeamRole


# Declarado antes de `MemberResponse`, que o usa.
class MemberTeamResponse(BaseModel):
    """Vinculo (time, papel) de um membro."""

    model_config = {"from_attributes": True}

    team_id: uuid.UUID
    role: UserTeamRole


class MemberResponse(BaseModel):
    """Representacao de um membro do workspace."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    email: EmailStr
    is_active: bool
    created_at: datetime
    #: Ativo e com senha provisoria nao trocada = "convidado" na tela.
    must_change_password: bool = False
    #: Papel na organizacao; `None` para a maioria.
    org_role: OrgRole | None = None
    #: Times raiz da pessoa (vinculo na raiz ou em subtime dela). Vazia = sem
    #: vinculo nenhum. So a listagem preenche; respostas de mutacao saem vazias.
    root_team_ids: list[uuid.UUID] = Field(default_factory=list)
    #: Todos os vinculos, com o papel. Nao substitui `team_ids` (o filtro do
    #: quadro depende dele). So a listagem preenche.
    memberships: list[MemberTeamResponse] = Field(default_factory=list)
    #: So os subtimes do membro (sem a raiz); usado pelo filtro de subtime do
    #: quadro. So a listagem preenche.
    team_ids: list[uuid.UUID] = Field(default_factory=list)


class MemberCreateRequest(BaseModel):
    """Cadastro de membro. A senha provisoria e gerada no backend e devolvida
    uma vez em `MemberCreatedResponse`; `team_id` pode ser raiz ou subtime.
    """

    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    team_id: uuid.UUID
    role: UserTeamRole


class MemberCreatedResponse(MemberResponse):
    """Resposta do POST /members. `temporary_password` so aparece aqui."""

    # Redeclarado sem default: aqui e sempre obrigatorio.
    must_change_password: bool
    password_expires_at: datetime | None
    temporary_password: str


class ResetPasswordResponse(BaseModel):
    """Resposta do reset administrativo de senha."""

    user_id: uuid.UUID
    must_change_password: bool
    password_expires_at: datetime | None
    temporary_password: str


class MemberListResponse(BaseModel):
    """Lista de membros do workspace."""

    items: list[MemberResponse]
    total: int


class TeamAssignmentRequest(BaseModel):
    """Vincula um membro a uma equipe com um papel."""

    team_id: uuid.UUID
    role: UserTeamRole


class ChangeMemberRoleRequest(BaseModel):
    """Troca o papel de um vinculo (user, team) existente."""

    role: UserTeamRole


class ChangeOrganizationRoleRequest(BaseModel):
    """Troca o papel de organizacao de uma pessoa. `None` remove o papel."""

    role: OrgRole | None = None


class TeamMembershipResponse(BaseModel):
    """Representacao de um vinculo membro<->equipe."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    team_id: uuid.UUID
    role: UserTeamRole
    joined_at: datetime


class MemberAccountActionsResponse(BaseModel):
    """O que o ator pode fazer com a conta de uma pessoa. Rota por pessoa
    para nao encarecer `GET /members`.
    """

    can_reset_password: bool
    can_deactivate: bool
    #: So para conta desativada, com as mesmas travas de desativar.
    can_reactivate: bool


class TeamMemberListItemResponse(BaseModel):
    """Uma pessoa dentro de um time, com o cadeado. Espelho de
    `MemberTeamListItemResponse` (la: onde esta a pessoa; aqui: quem esta no time).
    """

    model_config = {"from_attributes": True}

    user_id: uuid.UUID
    role: UserTeamRole
    #: Separa "desativada" de "fora do seu escopo" como motivo do cadeado.
    is_active: bool
    #: O ator conseguiria trocar o papel deste vinculo? Mesma funcao do PATCH.
    can_edit_role: bool


class MemberTeamListItemResponse(MemberTeamResponse):
    """Um vinculo na listagem, com o cadeado resolvido no backend.

    Subclasse para nao pendurar um `can_edit_role` opcional na resposta do PATCH.
    """

    #: So o papel. Remover do time e outra rota, com outro gate.
    can_edit_role: bool
