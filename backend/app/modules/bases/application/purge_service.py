"""A rotina diaria da Base (Spec 056, §11) -- apaga de vez o que passou do prazo.

    base excluida ha mais de 10 dias       -> some, com tudo (CASCADE)
    linha, coluna, opcao marcadas ha 1 dia -> somem; coluna e opcao saem
                                              tambem das celulas
    diario com mais de 1 dia               -> some (o Ctrl+Z vale 1 dia)

⚠️⚠️ RODA FORA DE CONTEXTO DE TENANT, e de proposito: e uma rota de maquina
(`POST /system/bases/purge`, `X-System-Token`), chamada pelo n8n, que varre
TODOS os workspaces -- como o `archive-stale`. Por isso nao passa pelo
`BaseRepository` (que exige tenant). Ela nunca decide NADA: so apaga o que uma
pessoa ja marcou e cujo prazo de desfazer ja acabou. Nao ha dado vivo em jogo.

⚠️ OS PRAZOS SAO OS MESMOS DO DESFAZER, e a ordem importa pouco por isso: uma
marca com mais de 1 dia ja nao tem entrada no diario que a desfaca (o diario
de mais de 1 dia some na mesma passada).

Idempotente: rodar duas vezes no dia apaga nada na segunda.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.bases import BaseChange, BaseColumn, BaseRow, BaseTable
from app.modules.bases.application.base_service import RESTORE_WINDOW
from app.modules.bases.application.undo_service import UNDO_WINDOW

logger = get_logger(__name__)


class BasePurgeService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict[str, int]:
        corte_base = now - RESTORE_WINDOW
        corte = now - UNDO_WINDOW
        resultado = {
            "bases": await self._bases(corte_base),
            "columns": await self._colunas(corte),
            "rows": await self._linhas(corte),
            "options": await self._opcoes(corte),
            "changes": await self._diario(corte),
        }
        await self._session.commit()
        logger.info("base.purge.done", **resultado)
        return resultado

    async def _bases(self, corte: datetime) -> int:
        r = await self._session.execute(
            delete(BaseTable).where(
                BaseTable.deleted_at.is_not(None), BaseTable.deleted_at < corte
            )
        )
        return int(r.rowcount or 0)

    async def _colunas(self, corte: datetime) -> int:
        """Tira a chave da coluna das celulas, e entao a coluna."""
        colunas = (
            await self._session.execute(
                select(BaseColumn.id, BaseColumn.base_id).where(
                    BaseColumn.deleted_at.is_not(None), BaseColumn.deleted_at < corte
                )
            )
        ).all()
        for coluna_id, base_id in colunas:
            chave = str(coluna_id)
            await self._session.execute(
                update(BaseRow)
                .where(BaseRow.base_id == base_id, BaseRow.values.has_key(chave))
                .values(values=BaseRow.values.op("-")(chave))
                .execution_options(synchronize_session=False)
            )
        if colunas:
            await self._session.execute(
                delete(BaseColumn).where(BaseColumn.id.in_([c for c, _ in colunas]))
            )
        return len(colunas)

    async def _linhas(self, corte: datetime) -> int:
        r = await self._session.execute(
            delete(BaseRow).where(
                BaseRow.deleted_at.is_not(None), BaseRow.deleted_at < corte
            )
        )
        return int(r.rowcount or 0)

    async def _opcoes(self, corte: datetime) -> int:
        """Opcao marcada ha mais de 1 dia: sai da lista E das celulas.

        So olha colunas que tem ALGUMA opcao marcada (o filtro JSONB), e a
        data de cada uma decide no Python -- poucas colunas, poucas opcoes.
        """
        colunas = (
            await self._session.execute(
                select(BaseColumn).where(
                    BaseColumn.deleted_at.is_(None),
                    text(
                        "jsonb_path_exists(base_column.options, "
                        "'$[*] ? (@.deleted_at != null)')"
                    ),
                )
            )
        ).scalars().all()
        total = 0
        for coluna in colunas:
            vencidas = {
                o["id"]
                for o in coluna.options
                if o.get("deleted_at")
                and datetime.fromisoformat(o["deleted_at"]) < corte
            }
            if not vencidas:
                continue
            total += len(vencidas)
            coluna.options = [o for o in coluna.options if o["id"] not in vencidas]
            await self._limpar_celulas(coluna, vencidas)
        return total

    async def _limpar_celulas(self, coluna: BaseColumn, vencidas: set[str]) -> None:
        chave = str(coluna.id)
        linhas = (
            await self._session.execute(
                select(BaseRow).where(
                    BaseRow.base_id == coluna.base_id, BaseRow.values.has_key(chave)
                )
            )
        ).scalars().all()
        for linha in linhas:
            valor: Any = linha.values.get(chave)
            if isinstance(valor, list):
                novo: Any = [v for v in valor if v not in vencidas] or None
            else:
                novo = None if valor in vencidas else valor
            if novo != valor:
                valores = dict(linha.values)
                if novo is None:
                    valores.pop(chave, None)
                else:
                    valores[chave] = novo
                linha.values = valores

    async def _diario(self, corte: datetime) -> int:
        r = await self._session.execute(
            delete(BaseChange).where(BaseChange.created_at < corte)
        )
        return int(r.rowcount or 0)
