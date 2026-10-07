"""Desfazer e refazer na Base (Spec 056, §9, D12, D13, D27).

O Ctrl+Z roda AO CONTRARIO a acao mais recente da pessoa naquela base, dentro
de 1 dia; o refazer roda de novo a ultima desfeita, enquanto ela nao fizer nada
novo (o diario apaga as desfeitas na acao seguinte -- `journal.record`).

⚠️⚠️ A REGRA DE CONFLITO (D12, opcao b): antes de desfazer, o servidor confere
se o que esta la AINDA E O QUE A PESSOA DEIXOU. Se outra pessoa mexeu depois,
recusa e avisa -- desfazer nunca apaga o trabalho de outra pessoa. Por tipo:

    cell.update     cada celula do grupo ainda tem o "depois" registrado; UMA
                    diferente recusa o grupo inteiro (desfazer metade de uma
                    colagem seria pior do que nao desfazer)
    column.retype   a coluna ainda e como ficou, E nenhuma celula dela foi
                    preenchida depois da troca
    column.update,  os campos ainda tem o "depois"
    view.update
    marcas          a coisa continua marcada (ou viva), e a base existe

⚠️ CONFLITO NAO E ERRO HTTP. A entrada SAI DA PILHA (o proximo Ctrl+Z tenta a
anterior, spec §9.3), e isso e uma gravacao: com 409 a transacao voltaria e a
entrada ficaria la, recusando para sempre. A resposta e 200 com
`conflict=True`, e a tela mostra o aviso.

⚠️ DESFAZER EXIGE O VERBO DA ACAO ORIGINAL, conferido AGORA (§9.4) -- quem
perdeu o verbo nao desfaz. Sem o verbo e 403, e a entrada fica: devolvido o
verbo, ela volta a servir.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models.bases import BaseChange, BaseColumn, BaseRow, BaseView
from app.modules.bases.application.access import require_verb, visible_base
from app.modules.bases.application.base_service import column_snapshot
from app.modules.bases.application.journal import VERB_OF_KIND
from app.modules.bases.application.view_service import view_data
from app.modules.bases.infrastructure.base_repository import (
    BaseChangeRepository,
    BaseColumnRepository,
    BaseRowRepository,
    BaseTableRepository,
    BaseViewRepository,
)
from app.modules.bases.infrastructure.live import publicar

logger = get_logger(__name__)

#: D13/D27: tudo se desfaz por 1 dia.
UNDO_WINDOW = timedelta(days=1)


@dataclass(frozen=True, slots=True)
class UndoResult:
    """`applied`: aconteceu. `conflict`: recusado porque alguem mexeu depois (a
    entrada saiu da pilha). Os dois falsos: nao havia nada a desfazer/refazer."""

    applied: bool
    conflict: bool
    kind: str | None


class _Conflito(Exception):
    """Interna: o estado de hoje nao e o que a acao deixou."""


class UndoService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._bases = BaseTableRepository(session)
        self._changes = BaseChangeRepository(session)
        self._columns = BaseColumnRepository(session)
        self._rows = BaseRowRepository(session)
        self._views = BaseViewRepository(session)

    async def undo(self, base_id: uuid.UUID) -> UndoResult:
        return await self._rodar(base_id, desfazer=True)

    async def redo(self, base_id: uuid.UUID) -> UndoResult:
        return await self._rodar(base_id, desfazer=False)

    async def _rodar(self, base_id: uuid.UUID, *, desfazer: bool) -> UndoResult:
        base = await visible_base(self._bases, base_id)
        ator = require_tenant().user_id
        desde = datetime.now(UTC) - UNDO_WINDOW
        entrada = (
            await self._changes.last_to_undo(base.id, ator, desde)
            if desfazer
            else await self._changes.last_to_redo(base.id, ator, desde)
        )
        if entrada is None:
            return UndoResult(applied=False, conflict=False, kind=None)

        require_verb(VERB_OF_KIND[entrada.kind], base.team_id)
        try:
            await self._aplicar(base.id, entrada, desfazer=desfazer)
        except _Conflito:
            logger.info(
                "base.undo.conflict",
                change_id=str(entrada.id),
                kind=entrada.kind,
                undo=desfazer,
            )
            # ⚠️ Nada foi gravado antes do conflito: cada `_aplicar` confere
            # TUDO antes de mudar qualquer coisa.
            await self._changes.remove(entrada)
            return UndoResult(applied=False, conflict=True, kind=entrada.kind)

        entrada.undone_at = datetime.now(UTC) if desfazer else None
        await self._session.flush()
        # Desfazer tambem e uma gravacao (spec §9.5): os outros sao avisados.
        await publicar(
            self._session, base.id, "undo" if desfazer else "redo", ator
        )
        return UndoResult(applied=True, conflict=False, kind=entrada.kind)

    # ------------------------------------------------------------ por tipo
    async def _aplicar(
        self, base_id: uuid.UUID, entrada: BaseChange, *, desfazer: bool
    ) -> None:
        p = entrada.payload
        kind = entrada.kind
        if kind == "cell.update":
            await self._celulas(base_id, p["cells"], desfazer=desfazer)
        elif kind in ("row.create", "row.delete"):
            # criar desfeito = apagar; apagar desfeito = trazer de volta
            marcar = (kind == "row.create") == desfazer
            await self._marca_linha(base_id, uuid.UUID(p["row"]), marcar=marcar)
        elif kind in ("column.create", "column.delete"):
            marcar = (kind == "column.create") == desfazer
            await self._marca_coluna(base_id, uuid.UUID(p["column"]), marcar=marcar)
        elif kind == "option.delete":
            await self._marca_opcao(
                base_id, uuid.UUID(p["column"]), p["option"], marcar=not desfazer
            )
        elif kind == "column.update":
            await self._campos_coluna(base_id, p, desfazer=desfazer)
        elif kind == "column.retype":
            await self._retype(base_id, p, desfazer=desfazer)
        elif kind == "view.update":
            await self._campos_visao(base_id, p, desfazer=desfazer)
        elif kind in ("view.create", "view.delete"):
            apagar = (kind == "view.create") == desfazer
            await self._existencia_visao(base_id, p, apagar=apagar)
        else:  # pragma: no cover -- `journal.record` recusa kind desconhecido
            raise _Conflito

    async def _celulas(
        self, base_id: uuid.UUID, cells: list[dict[str, Any]], *, desfazer: bool
    ) -> None:
        linhas = await self._rows.get_many(base_id, {uuid.UUID(c["row"]) for c in cells})
        alvo, esperado = ("before", "after") if desfazer else ("after", "before")
        for c in cells:
            linha = linhas.get(uuid.UUID(c["row"]))
            if linha is None or linha.values.get(c["col"]) != c[esperado]:
                raise _Conflito
        for c in cells:
            linha = linhas[uuid.UUID(c["row"])]
            novos = dict(linha.values)
            if c[alvo] is None:
                novos.pop(c["col"], None)
            else:
                novos[c["col"]] = c[alvo]
            linha.values = novos
            linha.version += 1

    async def _marca_linha(
        self, base_id: uuid.UUID, row_id: uuid.UUID, *, marcar: bool
    ) -> None:
        linha = await self._rows.get_in(base_id, row_id, include_deleted=True)
        if linha is None or (linha.deleted_at is None) != marcar:
            raise _Conflito
        _marcar(linha, marcar)

    async def _marca_coluna(
        self, base_id: uuid.UUID, column_id: uuid.UUID, *, marcar: bool
    ) -> None:
        coluna = await self._coluna(base_id, column_id)
        if (coluna.deleted_at is None) != marcar:
            raise _Conflito
        _marcar(coluna, marcar)

    async def _marca_opcao(
        self, base_id: uuid.UUID, column_id: uuid.UUID, option_id: str, *, marcar: bool
    ) -> None:
        coluna = await self._coluna(base_id, column_id)
        if coluna.deleted_at is not None:
            raise _Conflito
        opcoes = list(coluna.options)
        for i, o in enumerate(opcoes):
            if o["id"] == option_id:
                if bool(o.get("deleted_at")) == marcar:
                    raise _Conflito
                quando = datetime.now(UTC).isoformat() if marcar else None
                opcoes[i] = {**o, "deleted_at": quando}
                coluna.options = opcoes
                coluna.version += 1
                return
        raise _Conflito

    async def _campos_coluna(
        self, base_id: uuid.UUID, p: dict[str, Any], *, desfazer: bool
    ) -> None:
        coluna = await self._coluna(base_id, uuid.UUID(p["column"]))
        alvo, esperado = (p["before"], p["after"]) if desfazer else (p["after"], p["before"])
        if coluna.deleted_at is not None or column_snapshot(coluna) != esperado:
            raise _Conflito
        _aplicar_snapshot(coluna, alvo)

    async def _retype(
        self, base_id: uuid.UUID, p: dict[str, Any], *, desfazer: bool
    ) -> None:
        coluna = await self._coluna(base_id, uuid.UUID(p["column"]))
        chave = str(coluna.id)
        alvo, esperado = (p["before"], p["after"]) if desfazer else (p["after"], p["before"])
        if coluna.deleted_at is not None or column_snapshot(coluna) != esperado:
            raise _Conflito
        valores: dict[str, Any] = p["values"]
        if desfazer:
            # ⚠️ "nenhuma celula preenchida depois da troca": a coluna esta vazia
            if await self._rows.values_of_column(base_id, coluna.id):
                raise _Conflito
            linhas = await self._rows.get_many(
                base_id, {uuid.UUID(r) for r in valores}, include_deleted=True
            )
            for row_id, valor in valores.items():
                linha = linhas.get(uuid.UUID(row_id))
                if linha is not None:
                    linha.values = {**linha.values, chave: valor}
                    linha.version += 1
        else:
            # refazer = zerar de novo. Cada celula preenchida tem de ser a que o
            # desfazer devolveu -- uma editada depois e trabalho de alguem.
            atuais = await self._rows.values_of_column(base_id, coluna.id)
            if any(valores.get(r) != v for r, v in atuais.items()):
                raise _Conflito
            await self._rows.clear_column(base_id, coluna.id)
        _aplicar_snapshot(coluna, alvo)

    async def _campos_visao(
        self, base_id: uuid.UUID, p: dict[str, Any], *, desfazer: bool
    ) -> None:
        visao = await self._views.get_in(base_id, uuid.UUID(p["view"]))
        alvo, esperado = (p["before"], p["after"]) if desfazer else (p["after"], p["before"])
        if visao is None or view_data(visao) != esperado:
            raise _Conflito
        visao.name = alvo["name"]
        visao.config = alvo["config"]
        visao.position = alvo["position"]

    async def _existencia_visao(
        self, base_id: uuid.UUID, p: dict[str, Any], *, apagar: bool
    ) -> None:
        view_id = uuid.UUID(p["view"])
        visao = await self._views.get_in(base_id, view_id)
        if apagar:
            if visao is None or visao.is_default or view_data(visao) != p["data"]:
                raise _Conflito
            await self._session.delete(visao)
        else:
            if visao is not None:
                raise _Conflito
            d = p["data"]
            self._views.add(
                BaseView(
                    id=view_id,
                    base_id=base_id,
                    name=d["name"],
                    layout=d["layout"],
                    config=d["config"],
                    position=d["position"],
                    is_default=False,
                )
            )

    async def _coluna(self, base_id: uuid.UUID, column_id: uuid.UUID) -> BaseColumn:
        coluna = await self._columns.get_by_id(column_id, include_deleted=True)
        if coluna is None or coluna.base_id != base_id:
            raise _Conflito
        return coluna


def _marcar(item: BaseRow | BaseColumn, marcar: bool) -> None:
    item.deleted_at = datetime.now(UTC) if marcar else None
    item.deleted_by = require_tenant().user_id if marcar else None
    item.version += 1


def _aplicar_snapshot(coluna: BaseColumn, s: dict[str, Any]) -> None:
    coluna.name = s["name"]
    coluna.type = s["type"]
    coluna.options = s["options"]
    coluna.position = s["position"]
    coluna.width = s["width"]
    coluna.version += 1
