"""Schemas (DTOs) de request/response do modulo users (membros)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.db.models.enums import OrgRole, UserTeamRole


# --------------------------------------------------------
# Membro (User)
# --------------------------------------------------------
class MemberResponse(BaseModel):
    """Representacao de um membro do workspace."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    email: EmailStr
    is_active: bool
    created_at: datetime
    #: Entrega 13 (Fatia 2): ids dos SUBTIMES do membro (times nao-raiz).
    #: NAO inclui o time principal. Usado pelo filtro de subtime no quadro.
    #: Em respostas de mutacao (criar/desativar) sai VAZIO -- so a listagem
    #: resolve os subtimes.
    #:
    #: ⚠️⚠️ ERA `team_id: uuid.UUID | None`, SINGULAR, ate 31/08 (Spec 044,
    #: fatia 1). A TROCA DE NOME E O PONTO, e nao um efeito colateral de
    #: pluralizar: acrescentar `team_ids` ao lado de `team_id` deixaria os
    #: cinco consumidores do front COMPILANDO E ERRADOS -- que e exatamente
    #: o roteiro do defeito que esta spec existe para nao repetir ("a regra
    #: mudou e um consumidor ficou para tras", quinze vezes na Spec 043).
    #: Trocando o nome, o `tsc` fica vermelho nos cinco e a conversa
    #: acontece antes do deploy. O `tsc` e o unico portao que pega isto, e
    #: ele so pega se o campo mudar de nome.
    team_ids: list[uuid.UUID] = Field(default_factory=list)


class MemberCreateRequest(BaseModel):
    """Cadastro de um novo membro.

    Entrega 7: o cliente NAO escolhe mais senha. O backend gera uma
    senha provisoria aleatoria e a devolve uma unica vez em
    MemberCreatedResponse (ADR 0019/0021).

    Spec 014: team_id e role sao AMBOS obrigatorios. O time pode ser o
    principal (raiz) OU um subtime -- a escolha e explicita na tela. Nao
    existe mais membro orfao (sem vinculo). Criar com role=ADMIN exige
    que o ator seja ADMIN (gate no service).
    """

    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    team_id: uuid.UUID
    role: UserTeamRole


class MemberCreatedResponse(MemberResponse):
    """Resposta do POST /members. Carrega o segredo UMA vez (ADR 0021).

    `temporary_password` so existe nesta resposta -- nao e persistido em
    claro nem retornado em nenhuma outra rota.
    """

    must_change_password: bool
    password_expires_at: datetime | None
    temporary_password: str


class ResetPasswordResponse(BaseModel):
    """Resposta do reset administrativo (POST /members/{id}/reset-password).

    Mesmo segredo efemero, sem recriar o membro.
    """

    user_id: uuid.UUID
    must_change_password: bool
    password_expires_at: datetime | None
    temporary_password: str


class MemberListResponse(BaseModel):
    """Lista de membros do workspace."""

    items: list[MemberResponse]
    total: int


# --------------------------------------------------------
# Vinculo membro <-> equipe
# --------------------------------------------------------
class TeamAssignmentRequest(BaseModel):
    """Vincula um membro a uma equipe com um papel."""

    team_id: uuid.UUID
    role: UserTeamRole


class ChangeMemberRoleRequest(BaseModel):
    """Troca o papel de um vinculo (user, team) existente. Spec 015, F2."""

    role: UserTeamRole


class ChangeOrganizationRoleRequest(BaseModel):
    """Troca o papel de ORGANIZACAO de uma pessoa. Spec 045, fatia D.

    ⚠️ IRMA de `ChangeMemberRoleRequest`, e o campo se chama `role` nas duas de
    proposito: a diferenca esta no CAMINHO, nao no corpo.

        PATCH /members/{id}/teams/{team_id}   -> papel NAQUELE time
        PATCH /members/{id}/organization-role -> papel na ORGANIZACAO

    `None` remove o papel -- a pessoa deixa de administrar a organizacao e
    continua com os vinculos de time que tiver.
    """

    role: OrgRole | None = None


class MoveSubteamRequest(BaseModel):
    """Move um membro de um time para outro, preservando o papel. F4 (B2)."""

    from_team_id: uuid.UUID
    to_team_id: uuid.UUID


class TeamMembershipResponse(BaseModel):
    """Representacao de um vinculo membro<->equipe."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    team_id: uuid.UUID
    role: UserTeamRole
    joined_at: datetime


class MemberTeamResponse(BaseModel):
    """Vinculo enxuto (time, papel) de um membro (Spec 015, Fatia 1).

    Usado por GET /members/{id}/teams para a UI mostrar o papel atual por
    time antes de oferecer alteracao. Mais leve que TeamMembershipResponse
    (so o que a tela precisa).
    """

    model_config = {"from_attributes": True}

    team_id: uuid.UUID
    role: UserTeamRole
