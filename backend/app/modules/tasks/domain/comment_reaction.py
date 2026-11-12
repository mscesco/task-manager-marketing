"""Regras puras das reacoes: validar o emoji e agrupar a fileira."""

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
    """Valida que `raw` e exatamente um emoji e devolve a forma a gravar.

    Texto, dois emojis ou espaco em volta -> ValidationError (422). Normaliza
    (`demojize` -> `emojize`) para `❤` e `❤️` nao virarem duas pilulas, e exige
    fully-qualified depois (tom de pele sozinho passa em `is_emoji`).
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

    `rows` ja vem ordenado e a ordem e preservada: a pilula nao pula de lugar a cada clique.
    """
    por_emoji: dict[str, list[uuid.UUID]] = {}
    for emoji, user_id in rows:
        por_emoji.setdefault(emoji, []).append(user_id)
    return tuple(
        ReactionSummary(emoji=emoji, user_ids=tuple(user_ids))
        for emoji, user_ids in por_emoji.items()
    )
