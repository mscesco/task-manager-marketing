"""Dominio das reacoes no comentario (Spec 050) -- regras PURAS, sem DB.

Concentra o que da pra testar sem banco:
    - "e exatamente um emoji?" e a forma em que ele e gravado (§4.3);
    - o agrupamento da fileira de reacoes de um comentario (§4.4).

O service so orquestra: carrega do banco e chama estas funcoes.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

import emoji as emoji_lib

from app.shared.exceptions.base import ValidationError

_FULLY_QUALIFIED = emoji_lib.STATUS["fully_qualified"]


@dataclass(frozen=True, slots=True)
class ReactionSummary:
    """Uma pilula da fileira: o emoji e quem reagiu com ele, em ordem."""

    emoji: str
    user_ids: tuple[uuid.UUID, ...]


def normalize_emoji(raw: str) -> str:
    """Valida que `raw` e EXATAMENTE um emoji e devolve a forma a gravar.

    Emoji livre (decisao da Camila, 15/09): qualquer um, e so emoji. Texto,
    dois emojis ou espaco em volta -> ValidationError (422).

    ⚠️⚠️ NORMALIZA, e isso nao e cosmetico. `❤` (sem o seletor de variacao
    U+FE0F) e `❤️` sao o mesmo coracao, e a biblioteca aceita os dois. Sem
    normalizar, eles virariam DUAS pilulas na fileira -- e qual das duas cada
    pessoa manda depende do teclado dela. O caminho e ida e volta pelo nome
    (`demojize` -> `emojize`), que devolve a forma fully-qualified; medido em
    15/09 para `❤`, `©`, `#⃣`, `☺` e a bandeira com ZWJ.

    ⚠️ E EXIGE fully-qualified DEPOIS de normalizar. Um modificador de tom de
    pele sozinho (`🏽`) passa em `is_emoji` -- ele e um *componente* -- e nao e
    reacao de ninguem.

    ⚠️ SEM `strip`: espaco em volta e recusado, e nao limpo. O cliente manda o
    que o seletor escolheu; espaco ali e defeito de quem chamou.
    """
    candidato = raw if isinstance(raw, str) else ""
    if not emoji_lib.is_emoji(candidato):
        raise ValidationError(
            "A reacao precisa ser exatamente um emoji.",
            details={"field": "emoji"},
        )
    normalizado = emoji_lib.emojize(emoji_lib.demojize(candidato))
    dados = emoji_lib.EMOJI_DATA.get(normalizado)
    if dados is None or dados.get("status") != _FULLY_QUALIFIED:
        raise ValidationError(
            "A reacao precisa ser exatamente um emoji.",
            details={"field": "emoji"},
        )
    return normalizado


def group_reactions(
    rows: Iterable[tuple[str, uuid.UUID]],
) -> tuple[ReactionSummary, ...]:
    """Agrupa `(emoji, user_id)` numa fileira de pilulas.

    ⚠️ `rows` JA VEM ORDENADO (pelo `updated_at` da reacao, desempate por id),
    e esta funcao PRESERVA essa ordem nos dois niveis: a pilula aparece na
    posicao da reacao mais antiga com aquele emoji, e as pessoas dentro dela na
    ordem em que reagiram. Ordenar por contagem faria a pilula pular de lugar a
    cada clique de outra pessoa (§4.4).
    """
    por_emoji: dict[str, list[uuid.UUID]] = {}
    for emoji, user_id in rows:
        por_emoji.setdefault(emoji, []).append(user_id)
    return tuple(
        ReactionSummary(emoji=emoji, user_ids=tuple(user_ids))
        for emoji, user_ids in por_emoji.items()
    )
