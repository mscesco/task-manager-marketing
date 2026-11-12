"""Schemas de request/response do modulo workspaces."""

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
    description: str | None = None
    created_at: datetime


class TeamListItem(TeamResponse):
    """Time na listagem, com o que impede remove-lo e o que quem pergunta pode.

    As contagens so informam a tela; quem autoriza e o DELETE.
    """

    tarefas: int = 0
    projetos: int = 0
    membros: int = 0
    filhos: int = 0
    #: Tambem seguram o time (FK RESTRICT).
    quadros: int = 0
    formularios: int = 0
    #: Os `can_*` vem do servidor porque `me.permissions` diz "o que", nao
    #: "onde". Cada um repete a pergunta da rota correspondente; sem default.
    can_update: bool
    #: Mesma pergunta do `ProjectService.create`.
    can_create_project: bool
    #: Mesma pergunta de `TeamService._assert_apaga_subtime`; raiz nunca.
    can_delete: bool
    #: Mesma pergunta do `BaseService.create`: `False` para todo subtime.
    can_create_base: bool
    #: Mesma pergunta do `SolicitationFormService.criar_formulario`.
    can_create_form: bool


class TeamCreateRequest(BaseModel):
    """Criacao de time. Sem `parent_team_id` nasce raiz."""

    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=120, pattern=_SLUG_PATTERN)
    parent_team_id: uuid.UUID | None = None


class TeamUpdateRequest(BaseModel):
    """Edicao de time. O slug nao e editavel (identificador estavel).

    `description` ausente preserva o valor; string vazia limpa.
    """

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class TeamMoveRequest(BaseModel):
    """Move um time para um novo pai (`None` e recusado pelo servico)."""

    new_parent_id: uuid.UUID | None = None


class PreviaRemocaoResponse(BaseModel):
    """O que sai junto se o time for esvaziado e removido.

    Tudo vai para a raiz da mesma arvore; `tarefas_vivas` sao tambem arquivadas.
    """

    model_config = {"from_attributes": True}

    team_id: uuid.UUID
    nome: str
    eh_raiz: bool
    tarefas_vivas: int
    tarefas_na_lixeira: int
    projetos: int
    membros: int
    filhos: int
    # `None` quando o time ja e raiz (nao ha destino; a remocao e recusada).
    destino_team_id: uuid.UUID | None = None
    destino_nome: str | None = None
    #: Sobem para a raiz junto, incluindo os apagados.
    quadros: int = 0
    formularios: int = 0


class TeamListResponse(BaseModel):
    """Lista de equipes do workspace."""

    items: list[TeamListItem]
    total: int
