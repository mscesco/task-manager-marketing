"""Schemas (DTOs) de request/response do modulo workspaces.

Fronteira da API: validam entrada e moldam saida. Nao sao
entidades de dominio nem models ORM.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# Slug: minusculas, digitos e hifen (igual ao CHECK do schema).
_SLUG_PATTERN = r"^[a-z0-9-]+$"


# --------------------------------------------------------
# Workspace
# --------------------------------------------------------
class WorkspaceResponse(BaseModel):
    """Representacao de um workspace."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime
    updated_at: datetime


class WorkspaceUpdateRequest(BaseModel):
    """Atualizacao do workspace. So o nome e editavel."""

    name: str = Field(min_length=1, max_length=255)


# --------------------------------------------------------
# Team
# --------------------------------------------------------
class TeamResponse(BaseModel):
    """Representacao de uma equipe (com posicao na hierarquia)."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    parent_team_id: uuid.UUID | None
    name: str
    slug: str
    created_at: datetime


class TeamCreateRequest(BaseModel):
    """Criacao de uma equipe.

    `parent_team_id` opcional: se ausente/null, a equipe nasce
    como raiz; se informado, nasce como subtime daquele pai.
    """

    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=120, pattern=_SLUG_PATTERN)
    parent_team_id: uuid.UUID | None = None


class TeamMoveRequest(BaseModel):
    """Move uma equipe para um novo pai.

    `new_parent_id=None` torna a equipe raiz.
    """

    new_parent_id: uuid.UUID | None = None


class TeamListResponse(BaseModel):
    """Lista de equipes do workspace."""

    items: list[TeamResponse]
    total: int
