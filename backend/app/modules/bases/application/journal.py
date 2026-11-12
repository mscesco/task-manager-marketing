"""O diario de acoes da Base: a parte que grava.

A base nao guarda copias de si mesma; guarda o que cada pessoa fez, com o
valor de antes, o minimo para fazer o contrario.

Os `kind` e o que cada `payload` carrega:

    cell.update     {"cells": [{"row", "col", "before", "after"}]}
    row.create      {"row"}
    row.delete      {"row"}
    column.create   {"column"}
    column.update   {"column", "before": {campos}, "after": {campos}}
                    -- nome, posicao, largura e opcoes
    rows.import     {"rows": [ids], "columns": [ids]} -- linhas e colunas
                    criadas pela planilha importada
    column.move     {"column", "from", "to"} -- as do caminho andam uma casa
    column.retype   {"column", "before": {"type", "options"},
                     "after": {"type", "options"}, "values": {linha: valor}}
    column.delete   {"column"}
    column.title    {"from", "to"} -- a coluna principal passou de "from" para
                    "to": as duas trocam tipo e posicao
    option.delete   {"column", "option"}
    view.create     {"view", "data"}
    view.update     {"view", "before", "after"}
    view.delete     {"view", "data"}

`None` em "before"/"after" de celula = celula vazia (a chave ausente).

Acao nova apaga o que a pessoa tinha desfeito naquela base, como em qualquer
editor.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.bases import BaseChange
from app.modules.bases.infrastructure.base_repository import BaseChangeRepository
from app.modules.bases.infrastructure.live import publicar

#: O verbo que desfazer (e refazer) cada acao exige, conferido de novo na hora.
VERB_OF_KIND: dict[str, str] = {
    "cell.update": "base_row.update",
    "row.create": "base_row.create",
    "row.delete": "base_row.delete",
    "rows.import": "base_row.create",
    "column.create": "base_column.create",
    "column.update": "base_column.update",
    "column.retype": "base_column.update",
    "column.move": "base_column.update",
    "column.delete": "base_column.delete",
    "column.title": "base_column.update",
    "option.delete": "base_column.delete",
    "view.create": "base_view.create",
    "view.update": "base_view.update",
    "view.delete": "base_view.delete",
}


async def record(
    session: AsyncSession, base_id: uuid.UUID, kind: str, payload: dict[str, Any]
) -> None:
    """Grava uma acao da pessoa corrente no diario daquela base."""
    if kind not in VERB_OF_KIND:
        raise ValueError(f"kind desconhecido no diario: {kind}")
    repo = BaseChangeRepository(session)
    actor = require_tenant().user_id
    await repo.drop_undone(base_id, actor)
    # Horario do Python, nao `now()` do banco: o `now()` e o da transacao, e
    # duas acoes no mesmo pedido empatariam na ordem da pilha de desfazer.
    repo.add(
        BaseChange(
            base_id=base_id,
            actor_id=actor,
            kind=kind,
            payload=payload,
            created_at=datetime.now(UTC),
        )
    )
    await session.flush()
    # Toda acao do diario e tambem um aviso ao vivo, no mesmo commit.
    await publicar(session, base_id, kind, actor)


def ids(payload: dict[str, Any]) -> dict[str, Any]:
    """Os uuids do payload como texto -- JSONB nao guarda `uuid.UUID`."""
    return {k: str(v) if isinstance(v, uuid.UUID) else v for k, v in payload.items()}
