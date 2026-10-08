"""Spec 056, D17: a opcao apagada FICA na celula que ja a tinha, e a celula
continua editavel -- so nao se escolhe a opcao de novo (revisao de 08/10).

Antes, a selecao multipla com uma opcao apagada recusava qualquer mudanca
(422), porque a tela devolve os ids que ja estavam e o servidor conferia todos.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.modules.bases.domain.cells import clean_value
from app.shared.exceptions.base import ValidationError

OPCOES = [
    {"id": "viva", "label": "Viva"},
    {"id": "outra", "label": "Outra"},
    {"id": "morta", "label": "Morta", "deleted_at": "2026-10-08T12:00:00Z"},
]
MULTI = SimpleNamespace(id=uuid.uuid4(), type="multi_select", options=OPCOES)
UNICA = SimpleNamespace(id=uuid.uuid4(), type="select", options=OPCOES)


def test_multipla_mantem_a_apagada_que_ja_estava() -> None:
    assert clean_value(MULTI, ["morta", "viva", "outra"], ja_tinha={"morta", "viva"}) == [
        "morta", "viva", "outra"
    ]


def test_multipla_nao_escolhe_a_apagada_de_novo() -> None:
    with pytest.raises(ValidationError):
        clean_value(MULTI, ["viva", "morta"], ja_tinha={"viva"})


def test_unica_mantem_a_apagada_que_ja_estava() -> None:
    assert clean_value(UNICA, "morta", ja_tinha={"morta"}) == "morta"
    with pytest.raises(ValidationError):
        clean_value(UNICA, "morta")
