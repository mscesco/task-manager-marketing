"""Contratos HTTP da Base.

Os cadeados (`can_*`) vem do servidor, por base, para a tela nunca oferecer um
botao que o servidor recusa. Cada um e a mesma pergunta do servico:
`has_permission_in(verbo, team_id)`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field

from app.core.tenant import can_in
from app.modules.bases.domain.columns import NAME_MAX, live_options

#: Teto para nao estourar a coluna `integer`; o piso (1) e do servico.
POSITION_MAX = 10_000

#: O texto do topo, generoso como a descricao de tarefa.
_DESCRIPTION_MAX = 50_000


class _Cadeados(BaseModel):
    """Os botoes de uma base, para quem pergunta."""

    team_id: uuid.UUID

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update(self) -> bool:
        return can_in("base.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return can_in("base.delete", self.team_id)


class OptionResponse(BaseModel):
    id: str
    label: str
    color: str


class ColumnResponse(BaseModel):
    """Uma coluna viva. As opcoes apagadas nao saem: a celula que guarda o id
    de uma delas aparece vazia."""

    id: uuid.UUID
    name: str
    type: str
    options: list[OptionResponse]
    position: int
    width: int | None
    version: int

    @classmethod
    def from_model(cls, coluna: Any) -> ColumnResponse:
        return cls(
            id=coluna.id,
            name=coluna.name,
            type=coluna.type,
            options=[
                OptionResponse(id=o["id"], label=o["label"], color=o["color"])
                for o in live_options(coluna.options)
            ],
            position=coluna.position,
            width=coluna.width,
            version=coluna.version,
        )


class ViewResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    layout: str
    config: dict[str, Any]
    position: int
    is_default: bool


class BaseSummaryResponse(_Cadeados):
    """Uma base na lista (menu lateral). Sem colunas: a lista nao as desenha."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    updated_at: datetime


class BaseTrashItemResponse(BaseModel):
    """Uma base na lixeira: quando foi excluida, por quem, e ate quando
    volta. `can_restore` e a mesma pergunta do `restore`."""

    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    deleted_at: datetime
    deleted_by: uuid.UUID | None
    restorable_until: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_restore(self) -> bool:
        return can_in("base.restore", self.team_id)


class BaseResponse(_Cadeados):
    """A base aberta: colunas, visoes e todos os cadeados."""

    id: uuid.UUID
    name: str
    description: str
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    columns: list[ColumnResponse]
    views: list[ViewResponse]

    @classmethod
    def from_detail(cls, detail: Any) -> BaseResponse:
        b = detail.base
        return cls(
            id=b.id,
            team_id=b.team_id,
            name=b.name,
            description=b.description,
            created_by=b.created_by,
            created_at=b.created_at,
            updated_at=b.updated_at,
            columns=[ColumnResponse.from_model(c) for c in detail.columns],
            views=[ViewResponse.model_validate(v) for v in detail.views],
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_create_column(self) -> bool:
        return can_in("base_column.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_column(self) -> bool:
        return can_in("base_column.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_column(self) -> bool:
        return can_in("base_column.delete", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_create_row(self) -> bool:
        return can_in("base_row.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_row(self) -> bool:
        return can_in("base_row.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_row(self) -> bool:
        return can_in("base_row.delete", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_create_view(self) -> bool:
        return can_in("base_view.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_view(self) -> bool:
        return can_in("base_view.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_view(self) -> bool:
        return can_in("base_view.delete", self.team_id)


class BaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    team_id: uuid.UUID
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)


class BaseUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)


class OptionRequest(BaseModel):
    """Sem `id` = opcao nova; com `id` = opcao que ja existe."""

    id: str | None = None
    label: str = Field(min_length=1, max_length=NAME_MAX)
    color: str | None = None


class ColumnCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    type: str
    options: list[OptionRequest] | None = None
    #: A posicao da coluna nova; as de la em diante andam uma casa. Ausente = no fim.
    position: int | None = Field(default=None, le=POSITION_MAX)


class RowResponse(BaseModel):
    """Uma linha. `values` e `{id da coluna: valor}`, cru: a chave de uma coluna
    apagada pode estar la (o desfazer precisa dela), e a tela so desenha as
    colunas vivas que recebeu da base."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    values: dict[str, Any]
    version: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class RowListResponse(BaseModel):
    items: list[RowResponse]
    total: int
    #: A tela mostra o aviso a quem tem `base.update` quando `total >= warning_at`.
    limit: int
    warning_at: int


class RowCreateRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class RowUpdateRequest(BaseModel):
    """As celulas de uma linha. `null` esvazia a celula."""

    values: dict[str, Any]


class CellRequest(BaseModel):
    row_id: uuid.UUID
    column_id: uuid.UUID
    value: Any = None


#: Celulas num lote. Tem de bater com `MAX_CELULAS_COLADAS` em `web/lib/baseClipboard.ts`.
CELLS_BATCH_LIMIT = 50_000


class CellsUpdateRequest(BaseModel):
    """Varias celulas, de varias linhas, como uma acao: um Ctrl+Z desfaz o grupo."""

    cells: list[CellRequest] = Field(min_length=1, max_length=CELLS_BATCH_LIMIT)


class ViewCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    layout: str
    config: dict[str, Any] = Field(default_factory=dict)


class ViewUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    config: dict[str, Any] | None = None
    position: int | None = Field(default=None, le=POSITION_MAX)


class UndoResponse(BaseModel):
    """`applied`: aconteceu. `conflict`: recusado porque alguem mexeu depois (o
    proximo Ctrl+Z tenta a acao anterior). Os dois falsos: nao havia nada."""

    applied: bool
    conflict: bool
    kind: str | None


class ColumnUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    type: str | None = None
    #: A lista viva inteira, na ordem da tela. Sumir daqui nao apaga (422).
    options: list[OptionRequest] | None = None
    position: int | None = Field(default=None, le=POSITION_MAX)
    width: int | None = None
