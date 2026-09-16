"""Testes de logica PURA das reacoes no comentario (Spec 050) -- sem DB.

Rodam em qualquer lugar (nao exigem TEST_DATABASE_URL).
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.tasks.domain.comment_reaction import (
    ReactionSummary,
    group_reactions,
    normalize_emoji,
)
from app.shared.exceptions.base import ValidationError


# --- emoji livre (§4.3) ---
@pytest.mark.parametrize(
    "entrada",
    ["👍", "❤️", "👍🏽", "👨‍👩‍👧", "🇧🇷", "#️⃣"],
)
def test_aceita_qualquer_emoji(entrada: str) -> None:
    assert normalize_emoji(entrada) == entrada


@pytest.mark.parametrize(
    "entrada",
    [
        "a",
        "1",
        "👍👍",  # dois emojis
        " 👍",  # espaco em volta NAO e limpo: e recusado
        "👍 ",
        "😀x",
        "",
        "🏽",  # tom de pele sozinho e componente, nao reacao
    ],
)
def test_recusa_o_que_nao_e_exatamente_um_emoji(entrada: str) -> None:
    with pytest.raises(ValidationError):
        normalize_emoji(entrada)


@pytest.mark.parametrize(
    ("entrada", "gravado"),
    [
        ("❤", "❤️"),
        ("©", "©️"),
        ("#⃣", "#️⃣"),
        ("☺", "☺️"),
    ],
)
def test_normaliza_para_a_forma_completa(entrada: str, gravado: str) -> None:
    """⚠️ Sem isto, `❤` e `❤️` viram duas pilulas para o mesmo coracao."""
    assert normalize_emoji(entrada) == gravado


# --- a fileira (§4.4) ---
def test_agrupa_preservando_a_ordem_de_chegada() -> None:
    ana, bruno, caio = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    fileira = group_reactions(
        [("❤️", ana), ("👍", bruno), ("❤️", caio)]
    )
    # ❤️ chegou primeiro e fica a esquerda -- mesmo empatado em contagem ou
    # atras dela, a pilula nao pula de lugar.
    assert fileira == (
        ReactionSummary(emoji="❤️", user_ids=(ana, caio)),
        ReactionSummary(emoji="👍", user_ids=(bruno,)),
    )


def test_sem_reacao_fileira_vazia() -> None:
    assert group_reactions([]) == ()
