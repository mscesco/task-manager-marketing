"""O diario de acoes da Base (Spec 056, §9, D27) -- a parte que GRAVA.

⚠️⚠️ A BASE NAO GUARDA COPIAS DE SI MESMA. Guarda o que cada pessoa fez, com o
minimo para fazer o contrario -- e "o contrario" precisa do valor de ANTES: o
contrario de "Status virou Cancelado" e "Status virou Publicado". A ideia e
dela (06/10). Dezenas de bytes por edicao; a rotina diaria apaga o que passou
de 1 dia.

Os `kind` e o que cada `payload` carrega (a tabela da spec §9.2):

    cell.update     {"cells": [{"row", "col", "before", "after"}]}
    row.create      {"row"}
    row.delete      {"row"}
    column.create   {"column"}
    column.update   {"column", "before": {campos}, "after": {campos}}
                    -- nome, posicao, largura e OPCOES (criar, renomear,
                       recolorir e reordenar opcao cabem aqui)
    column.retype   {"column", "before": {"type", "options"},
                     "after": {"type", "options"}, "values": {linha: valor}}
    column.delete   {"column"}
    option.delete   {"column", "option"}
    view.create     {"view", "data"}
    view.update     {"view", "before", "after"}
    view.delete     {"view", "data"}

⚠️ `None` em "before"/"after" de celula = celula vazia (a chave ausente).

Acao nova apaga o que a pessoa tinha DESFEITO naquela base: refazer so existe
enquanto ela nao fez nada depois de desfazer, como em qualquer editor.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.bases import BaseChange
from app.modules.bases.infrastructure.base_repository import BaseChangeRepository
from app.modules.bases.infrastructure.live import publicar

#: O verbo que DESFAZER (e refazer) cada acao exige, conferido de novo na hora
#: (spec §9.4): quem perdeu o verbo entre agir e desfazer nao desfaz.
VERB_OF_KIND: dict[str, str] = {
    "cell.update": "base_row.update",
    "row.create": "base_row.create",
    "row.delete": "base_row.delete",
    "column.create": "base_column.create",
    "column.update": "base_column.update",
    "column.retype": "base_column.update",
    "column.delete": "base_column.delete",
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
    repo.add(BaseChange(base_id=base_id, actor_id=actor, kind=kind, payload=payload))
    await session.flush()
    # Fatia G: toda acao do diario e tambem um aviso ao vivo -- e sai no MESMO
    # commit. Um lugar so, para nenhuma acao esquecer de avisar.
    await publicar(session, base_id, kind, actor)


def ids(payload: dict[str, Any]) -> dict[str, Any]:
    """Os uuids do payload como texto -- JSONB nao guarda `uuid.UUID`."""
    return {k: str(v) if isinstance(v, uuid.UUID) else v for k, v in payload.items()}
