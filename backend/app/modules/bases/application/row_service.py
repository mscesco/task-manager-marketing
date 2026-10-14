"""Linhas da Base (Spec 056, fatia C).

⚠️⚠️ EDITAR GRAVA SO A CELULA (spec §6): `values || {col: valor}`, e nunca a
linha inteira. Duas pessoas em celulas diferentes da mesma linha nao se
atropelam; na mesma celula vale a ultima gravacao (o ao vivo da fatia G mostra
para as duas).

⚠️ COLAR VARIAS CELULAS (ou arrastar um card que muda mais de uma) E UMA ACAO
SO no diario: um Ctrl+Z desfaz o grupo inteiro (spec §9.2). Por isso
`update_cells` recebe uma lista, e a rota de uma linha so e o caso de uma.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import User, UserTeam
from app.db.models.bases import BaseRow, BaseTable
from app.modules.auth.domain.team_scope import descendants
from app.modules.bases.application import journal
from app.modules.bases.application.access import require_verb, visible_base
from app.modules.bases.domain.cells import clean_value
from app.modules.bases.infrastructure.base_repository import (
    BaseColumnRepository,
    BaseRowRepository,
    BaseTableRepository,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)

#: O teto de linhas por base (spec §8.1, D23). Filtro e ordenacao acontecem no
#: navegador com a base inteira carregada; passou disso, o filtro vai para o
#: servidor, numa spec propria. O aviso dos 4.000 e da tela (fatia E).
ROW_LIMIT = 5_000
ROW_WARNING = 4_000


@dataclass(frozen=True, slots=True)
class CellWrite:
    row_id: uuid.UUID
    column_id: uuid.UUID
    value: Any


class RowService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._bases = BaseTableRepository(session)
        self._columns = BaseColumnRepository(session)
        self._rows = BaseRowRepository(session)

    async def list_rows(self, base_id: uuid.UUID) -> list[BaseRow]:
        base = await visible_base(self._bases, base_id)
        return await self._rows.list_for(base.id)

    async def create_row(
        self, base_id: uuid.UUID, values: dict[str, Any] | None = None
    ) -> BaseRow:
        base = await visible_base(self._bases, base_id)
        require_verb("base_row.create", base.team_id)
        if await self._rows.count_live(base.id) >= ROW_LIMIT:
            raise BusinessRuleError(
                f"Esta base chegou ao limite de {ROW_LIMIT} linhas.",
                details={"limit": ROW_LIMIT},
            )
        limpos = await self._limpar(base, values or {})
        linha = BaseRow(
            base_id=base.id,
            values={k: v for k, v in limpos.items() if v is not None},
            created_by=require_tenant().user_id,
        )
        self._rows.add(linha)
        await self._session.flush()
        await journal.record(self._session, base.id, "row.create", {"row": str(linha.id)})
        return linha

    async def update_row(
        self, base_id: uuid.UUID, row_id: uuid.UUID, values: dict[str, Any]
    ) -> BaseRow:
        """As celulas de UMA linha -- o caso de um de `update_cells`. Corpo vazio
        nao grava nada, mas passa pelas mesmas perguntas (404, 403)."""
        cells = []
        for chave, valor in values.items():
            try:
                coluna = uuid.UUID(str(chave))
            except ValueError as exc:
                raise ValidationError(
                    "Coluna desconhecida nesta base.",
                    details={"field": "values", "column_id": str(chave)},
                ) from exc
            cells.append(CellWrite(row_id=row_id, column_id=coluna, value=valor))
        if cells:
            (linha,) = await self.update_cells(base_id, cells)
            return linha
        base = await visible_base(self._bases, base_id)
        require_verb("base_row.update", base.team_id)
        linha = await self._rows.get_in(base.id, row_id)
        if linha is None:
            raise EntityNotFoundError("BaseRow", identifier=row_id)
        return linha

    async def update_cells(
        self, base_id: uuid.UUID, cells: list[CellWrite]
    ) -> list[BaseRow]:
        """Grava as celulas dadas, de uma ou mais linhas, como UMA acao."""
        base = await visible_base(self._bases, base_id)
        require_verb("base_row.update", base.team_id)
        if not cells:
            return []
        linhas = await self._rows.get_many(base.id, {c.row_id for c in cells})
        faltam = {c.row_id for c in cells} - set(linhas)
        if faltam:
            raise EntityNotFoundError("BaseRow", identifier=sorted(faltam)[0])

        por_linha: dict[uuid.UUID, dict[str, Any]] = {}
        for c in cells:
            por_linha.setdefault(c.row_id, {})[str(c.column_id)] = c.value

        # ⚠️ AS COLUNAS E AS PESSOAS SAO LIDAS UMA VEZ POR PEDIDO (revisao de
        # 08/10): eram uma consulta por linha, e uma colagem pode ter 5.000.
        colunas = await self._colunas_por_id(base)
        limpos_por_linha: dict[uuid.UUID, dict[str, Any]] = {}
        pessoas: set[str] = set()
        for row_id, valores in por_linha.items():
            limpos, novas = self._limpar_com(colunas, valores, linhas[row_id].values)
            limpos_por_linha[row_id] = limpos
            pessoas |= novas
        if pessoas:
            await self._assert_pessoas_da_arvore(base, pessoas)

        registro: list[dict[str, Any]] = []
        for row_id, limpos in limpos_por_linha.items():
            linha = linhas[row_id]
            novos = dict(linha.values)
            for chave, valor in limpos.items():
                antes = novos.get(chave)
                if valor is None:
                    novos.pop(chave, None)
                else:
                    novos[chave] = valor
                if antes != valor:
                    registro.append(
                        {"row": str(row_id), "col": chave, "before": antes, "after": valor}
                    )
            if novos != linha.values:
                linha.values = novos
                linha.version += 1

        await self._session.flush()
        if registro:
            await journal.record(
                self._session, base.id, "cell.update", {"cells": registro}
            )
        return [linhas[r] for r in por_linha]

    async def delete_row(self, base_id: uuid.UUID, row_id: uuid.UUID) -> BaseRow:
        """Marca a linha. O Ctrl+Z de 1 dia tira a marca (D13)."""
        base = await visible_base(self._bases, base_id)
        require_verb("base_row.delete", base.team_id)
        linha = await self._rows.get_in(base.id, row_id)
        if linha is None:
            raise EntityNotFoundError("BaseRow", identifier=row_id)
        linha.deleted_at = datetime.now(UTC)
        linha.deleted_by = require_tenant().user_id
        linha.version += 1
        await self._session.flush()
        await journal.record(self._session, base.id, "row.delete", {"row": str(row_id)})
        return linha

    # ------------------------------------------------------------ apoio
    async def _limpar(
        self, base: BaseTable, valores: dict[str, Any]
    ) -> dict[str, Any]:
        """`{id da coluna: valor limpo}` de uma linha NOVA. Coluna desconhecida
        ou apagada e 422."""
        if not valores:
            return {}
        limpos, pessoas = self._limpar_com(await self._colunas_por_id(base), valores, {})
        if pessoas:
            await self._assert_pessoas_da_arvore(base, pessoas)
        return limpos

    async def _colunas_por_id(self, base: BaseTable) -> dict[str, Any]:
        return {str(c.id): c for c in await self._columns.list_for(base.id)}

    @staticmethod
    def _limpar_com(
        colunas: dict[str, Any], valores: dict[str, Any], atuais: dict[str, Any]
    ) -> tuple[dict[str, Any], set[str]]:
        """Os valores limpos e as pessoas a conferir na arvore.

        ⚠️ SO O QUE A CELULA AINDA NAO TINHA E CONFERIDO (revisao de 08/10).
        Conferir tudo travava a celula: com a Juliana desativada numa celula
        Pessoa, acrescentar a Ana dava 422 "fora do time" -- a tela devolve
        os ids que ja estavam --, e o mesmo com uma opcao apagada numa selecao
        multipla. D8/D17: quem saiu FICA na celula, so nao e escolhido de novo.
        """
        limpos: dict[str, Any] = {}
        pessoas: set[str] = set()
        for chave, valor in valores.items():
            coluna = colunas.get(str(chave))
            if coluna is None:
                raise ValidationError(
                    "Coluna desconhecida nesta base.",
                    details={"field": "values", "column_id": str(chave)},
                )
            ja_tinha: set[str] = set()
            if coluna.type in ("select", "multi_select", "person"):
                # Ids (texto); o link guarda dicionarios e nao entra aqui.
                antes = atuais.get(str(coluna.id))
                itens = antes if isinstance(antes, list) else [antes] if antes else []
                ja_tinha = {str(v) for v in itens}
            limpo = clean_value(coluna, valor, ja_tinha=ja_tinha)
            if coluna.type == "person" and limpo:
                pessoas.update(set(limpo) - ja_tinha)
            limpos[str(coluna.id)] = limpo
        return limpos, pessoas

    async def _assert_pessoas_da_arvore(self, base: BaseTable, ids: set[str]) -> None:
        """D8: a coluna Pessoa oferece os membros ATIVOS da arvore da base. Quem
        saiu continua na celula (com o rotulo da tela), mas nao e escolhido de
        novo -- a tela nao o oferece, e o servidor confere o mesmo."""
        tenant = require_tenant()
        times = {base.team_id} | descendants(base.team_id, tenant.team_tree)
        stmt = (
            select(UserTeam.user_id)
            .join(User, User.id == UserTeam.user_id)
            .where(
                UserTeam.workspace_id == tenant.workspace_id,
                UserTeam.team_id.in_(times),
                User.is_active.is_(True),
                UserTeam.user_id.in_([uuid.UUID(i) for i in ids]),
            )
        )
        achados = {str(u) for u in (await self._session.execute(stmt)).scalars().all()}
        fora = ids - achados
        if fora:
            raise ValidationError(
                "Pessoa fora do time desta base.",
                details={"field": "values", "user_ids": sorted(fora)},
            )
