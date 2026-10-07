"""Visoes da Base (Spec 056, fatia C) -- salvas e COMPARTILHADAS (D14).

`config` (spec §8): `filters`, `sorts`, `group_by`, `date_column`,
`hidden_columns`, `column_order`. O servidor confere a FORMA e as chaves; o
significado (filtrar, ordenar, agrupar) e do navegador, que tem a base inteira
(§8.1).

⚠️ `group_by` e `date_column` NAO sao obrigatorios na criacao, embora o quadro
e o calendario precisem deles: a visao nasce pelo "+ Visao" e a pessoa escolhe
a coluna em seguida. Sem ela, a tela pede a escolha em vez de desenhar.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.bases import VIEW_LAYOUTS, BaseView
from app.modules.bases.application import journal
from app.modules.bases.application.access import require_verb, visible_base
from app.modules.bases.domain.columns import clean_name
from app.modules.bases.infrastructure.base_repository import (
    BaseTableRepository,
    BaseViewRepository,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)

_LISTAS = ("filters", "sorts", "hidden_columns", "column_order")
_TEXTOS = ("group_by", "date_column")


def clean_config(config: dict[str, Any]) -> dict[str, Any]:
    desconhecidas = set(config) - set(_LISTAS) - set(_TEXTOS)
    if desconhecidas:
        raise ValidationError(
            "Configuracao de visao com chave desconhecida.",
            details={"field": "config", "keys": sorted(desconhecidas)},
        )
    for chave in _LISTAS:
        if chave in config and not isinstance(config[chave], list):
            raise ValidationError(
                "Lista esperada.", details={"field": f"config.{chave}"}
            )
    for chave in _TEXTOS:
        if config.get(chave) is not None and not isinstance(config[chave], str):
            raise ValidationError(
                "Id de coluna esperado.", details={"field": f"config.{chave}"}
            )
    return dict(config)


def view_data(v: BaseView) -> dict[str, Any]:
    """O que o diario guarda para RECRIAR uma visao (spec §9.2)."""
    return {
        "name": v.name,
        "layout": v.layout,
        "config": dict(v.config),
        "position": v.position,
    }


class ViewService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._bases = BaseTableRepository(session)
        self._views = BaseViewRepository(session)

    async def create(
        self,
        base_id: uuid.UUID,
        *,
        name: str,
        layout: str,
        config: dict[str, Any] | None = None,
    ) -> BaseView:
        base = await visible_base(self._bases, base_id)
        require_verb("base_view.create", base.team_id)
        if layout not in VIEW_LAYOUTS:
            raise ValidationError("Layout desconhecido.", details={"field": "layout"})
        visao = BaseView(
            base_id=base.id,
            name=clean_name(name),
            layout=layout,
            config=clean_config(config or {}),
            position=await self._views.next_position(base.id),
            is_default=False,
        )
        self._views.add(visao)
        await self._session.flush()
        await journal.record(
            self._session,
            base.id,
            "view.create",
            {"view": str(visao.id), "data": view_data(visao)},
        )
        return visao

    async def update(
        self,
        base_id: uuid.UUID,
        view_id: uuid.UUID,
        *,
        name: str | None = None,
        config: dict[str, Any] | None = None,
        position: int | None = None,
    ) -> BaseView:
        base = await visible_base(self._bases, base_id)
        require_verb("base_view.update", base.team_id)
        visao = await self._visao(base.id, view_id)
        antes = view_data(visao)
        if name is not None:
            visao.name = clean_name(name)
        if config is not None:
            visao.config = clean_config(config)
        if position is not None:
            if position < 1:
                raise ValidationError("Posicao comeca em 1.", details={"field": "position"})
            visao.position = position
        await self._session.flush()
        depois = view_data(visao)
        if antes != depois:
            await journal.record(
                self._session,
                base.id,
                "view.update",
                {"view": str(visao.id), "before": antes, "after": depois},
            )
        return visao

    async def delete(self, base_id: uuid.UUID, view_id: uuid.UUID) -> None:
        """Apaga de verdade -- a visao nao tem `deleted_at`. O diario guarda os
        dados, e o desfazer a recria com o mesmo id."""
        base = await visible_base(self._bases, base_id)
        require_verb("base_view.delete", base.team_id)
        visao = await self._visao(base.id, view_id)
        if visao.is_default:
            # D25: a base sempre tem pelo menos uma visao de tabela.
            raise BusinessRuleError(
                "A visao padrao nao se apaga.", details={"view_id": str(view_id)}
            )
        dados = view_data(visao)
        await self._session.delete(visao)
        await self._session.flush()
        await journal.record(
            self._session, base.id, "view.delete", {"view": str(view_id), "data": dados}
        )

    async def _visao(self, base_id: uuid.UUID, view_id: uuid.UUID) -> BaseView:
        visao = await self._views.get_in(base_id, view_id)
        if visao is None:
            raise EntityNotFoundError("BaseView", identifier=view_id)
        return visao
