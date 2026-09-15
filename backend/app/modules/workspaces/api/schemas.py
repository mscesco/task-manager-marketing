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
    description: str | None = None
    created_at: datetime


class TeamListItem(TeamResponse):
    """Time na listagem: TeamResponse + o que impede remove-lo (Spec 029).

    As contagens vem em LOTE (uma query para a pagina inteira) e existem para
    a tela INFORMAR -- "14 tarefas, 2 membros" -- e desabilitar o botao obvio.
    Elas NAO autorizam nada: a checagem que vale roda no DELETE, porque estes
    numeros envelhecem entre carregar a tela e clicar.
    """

    tarefas: int = 0
    projetos: int = 0
    membros: int = 0
    filhos: int = 0
    #: Quem pergunta pode EDITAR este time? (Spec 049, fatia F)
    #:
    #: ⚠️⚠️ O CADEADO VEM DO SERVIDOR, e nao da tela -- mesma regra da Spec 047
    #: §3.1 (`can_edit_role` do vinculo). O front so sabe "o que" a pessoa
    #: pode, nunca "onde"; com o SUPERVISOR editando o proprio subtime, a tela
    #: que olhasse so `subteam.update` desenharia o lapis em TODOS os subtimes,
    #: e todos menos um dariam 403. Calculado pela mesma pergunta do PATCH.
    #:
    #: ⚠️ OBRIGATORIO, sem default: quem monta um `TeamListItem` tem de responder.
    can_update: bool


class TeamCreateRequest(BaseModel):
    """Criacao de uma equipe.

    `parent_team_id` opcional: se ausente/null, a equipe nasce
    como raiz; se informado, nasce como subtime daquele pai.
    """

    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=120, pattern=_SLUG_PATTERN)
    parent_team_id: uuid.UUID | None = None


class TeamUpdateRequest(BaseModel):
    """Edicao de uma equipe (Spec 029/D6).

    O SLUG NAO ENTRA aqui, de proposito: ele e unico no workspace e serve de
    identificador estavel. Editar o rotulo e barato; editar o identificador
    so cria chance de colisao.

    `description` ausente preserva o valor atual; string vazia limpa.
    """

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class TeamMoveRequest(BaseModel):
    """Move uma equipe para um novo pai.

    `new_parent_id=None` torna a equipe raiz.
    """

    new_parent_id: uuid.UUID | None = None


class PreviaRemocaoResponse(BaseModel):
    """O que sai junto se o time for esvaziado e removido (Spec 029/D3-B).

    `tarefas_vivas` sao arquivadas e movidas para a AREA da propria arvore;
    `tarefas_na_lixeira` so trocam de time (ja estao fora de tudo, mas
    seguram a foreign key). Numeros do MOMENTO DA CHAMADA -- os da listagem
    podem ter envelhecido.

    ⚠️ ESTA DOCSTRING DIZIA "movidas para o time principal", e a Spec 046
    tornou a frase ambigua: com N areas, QUAL principal? O destino sempre foi
    -- e agora precisa dizer que e -- a raiz da MESMA arvore. Esvaziar um
    subtime do Marketing nunca empurra nada para o TI.
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
    # Spec 046, fatia 3 (§4.2): a tela precisa NOMEAR o destino antes de
    # confirmar. `None` quando o time e a propria area -- ai nao ha destino, e
    # a operacao ja e recusada.
    destino_team_id: uuid.UUID | None = None
    destino_nome: str | None = None


class TeamListResponse(BaseModel):
    """Lista de equipes do workspace."""

    items: list[TeamListItem]
    total: int
