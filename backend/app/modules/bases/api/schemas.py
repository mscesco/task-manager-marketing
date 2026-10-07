"""Contratos HTTP da Base (Spec 056).

⚠️⚠️ OS CADEADOS (`can_*`) SAO DO SERVIDOR, POR BASE (spec §5.6). Hoje todo
mundo da arvore edita celula, e seria tentador a tela mostrar tudo. Se fizesse,
no dia em que um verbo fosse desligado para alguem a tela continuaria
oferecendo o botao -- e o servidor recusaria. E o defeito que a Spec 044 deixou
("um botao que a tela oferece e o servidor recusa"). Cada campo e a MESMA
pergunta do servico: `has_permission_in(verbo, team_id)`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field

from app.core.tenant import current_tenant
from app.modules.bases.domain.columns import NAME_MAX, live_options

#: O texto do topo (D15) -- generoso, como a descricao de tarefa.
_DESCRIPTION_MAX = 50_000


def _pode(permission: str, team_id: uuid.UUID) -> bool:
    """Puro: le o contexto da requisicao, nao o banco. Sem contexto, False."""
    tenant = current_tenant()
    return tenant is not None and tenant.has_permission_in(permission, team_id)


class _Cadeados(BaseModel):
    """Os botoes de UMA base, para quem pergunta."""

    team_id: uuid.UUID

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update(self) -> bool:
        return _pode("base.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return _pode("base.delete", self.team_id)


class OptionResponse(BaseModel):
    id: str
    label: str
    color: str


class ColumnResponse(BaseModel):
    """Uma coluna viva. ⚠️ As opcoes APAGADAS nao saem: a celula que guarda o id
    de uma delas aparece vazia (D17)."""

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
    """Uma base na LISTA (menu lateral). Sem colunas: a lista nao as desenha."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    updated_at: datetime


class BaseTrashItemResponse(BaseModel):
    """Uma base na LIXEIRA (D5): quando foi excluida, por quem, e ate quando
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
        return _pode("base.restore", self.team_id)


class BaseResponse(_Cadeados):
    """A base aberta: colunas, visoes e todos os cadeados (spec §5.6)."""

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
        return _pode("base_column.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_column(self) -> bool:
        return _pode("base_column.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_column(self) -> bool:
        return _pode("base_column.delete", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_create_row(self) -> bool:
        return _pode("base_row.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_row(self) -> bool:
        return _pode("base_row.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_row(self) -> bool:
        return _pode("base_row.delete", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_create_view(self) -> bool:
        return _pode("base_view.create", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update_view(self) -> bool:
        return _pode("base_view.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete_view(self) -> bool:
        return _pode("base_view.delete", self.team_id)


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
    #: Fatia I ("Inserir a esquerda/direita"): a posicao da coluna nova; as de
    #: la em diante andam uma casa. Ausente = no fim.
    position: int | None = None


class RowResponse(BaseModel):
    """Uma linha. `values` e `{id da coluna: valor}`, cru: a chave de uma coluna
    APAGADA pode estar la (o desfazer precisa dela), e a tela so desenha as
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
    #: O teto (5.000) e o ponto do aviso (4.000) -- spec §8.1. A tela mostra o
    #: aviso a quem tem `base.update` quando `total >= warning_at`.
    limit: int
    warning_at: int


class RowCreateRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class RowUpdateRequest(BaseModel):
    """As celulas de UMA linha. `null` esvazia a celula."""

    values: dict[str, Any]


class CellRequest(BaseModel):
    row_id: uuid.UUID
    column_id: uuid.UUID
    value: Any = None


class CellsUpdateRequest(BaseModel):
    """Varias celulas, de varias linhas, como UMA acao -- colar, ou arrastar um
    card que muda mais de uma celula. Um Ctrl+Z desfaz o grupo."""

    cells: list[CellRequest] = Field(min_length=1, max_length=5_000)


class ViewCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    layout: str
    config: dict[str, Any] = Field(default_factory=dict)


class ViewUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    config: dict[str, Any] | None = None
    position: int | None = None


class UndoResponse(BaseModel):
    """`applied`: aconteceu. `conflict`: recusado porque alguem mexeu depois --
    a tela avisa, e o proximo Ctrl+Z tenta a acao anterior. Os dois falsos: nao
    havia nada. ⚠️ A tela RECARREGA a base depois de um `applied`."""

    applied: bool
    conflict: bool
    kind: str | None


class ColumnUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    type: str | None = None
    #: A lista VIVA inteira, na ordem da tela. Sumir daqui NAO apaga (422).
    options: list[OptionRequest] | None = None
    position: int | None = None
    width: int | None = None
