"""Spec 056, fatia J: a celula de link guarda VARIOS links, com nome opcional.

A forma antiga (um texto so) continua aceita e vira lista de um -- e por isso
que as celulas gravadas antes da fatia nao precisaram de migration.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.modules.bases.domain.cells import LINKS_MAX, clean_value
from app.shared.exceptions.base import ValidationError

COLUNA = SimpleNamespace(id=uuid.uuid4(), type="link", options=[])


def test_texto_antigo_vira_lista_de_um_sem_nome() -> None:
    assert clean_value(COLUNA, " https://instagram.com/p/x ") == [
        {"title": "", "url": "https://instagram.com/p/x"}
    ]


def test_varios_links_com_nome_aparado() -> None:
    valor = [
        {"title": " Post ", "url": "https://instagram.com/p/x"},
        {"url": "https://drive.google.com/a"},
    ]
    assert clean_value(COLUNA, valor) == [
        {"title": "Post", "url": "https://instagram.com/p/x"},
        {"title": "", "url": "https://drive.google.com/a"},
    ]


def test_lista_vazia_esvazia_a_celula() -> None:
    assert clean_value(COLUNA, []) is None


@pytest.mark.parametrize(
    "valor",
    [
        "javascript:alert(1)",
        [{"url": "ftp://x.com"}],
        [{"title": "sem url"}],
        ["https://solto.com"],
        [{"title": "x" * 121, "url": "https://a.com"}],
        [{"url": f"https://a.com/{i}"} for i in range(LINKS_MAX + 1)],
        42,
    ],
)
def test_recusa(valor) -> None:
    with pytest.raises(ValidationError):
        clean_value(COLUNA, valor)
