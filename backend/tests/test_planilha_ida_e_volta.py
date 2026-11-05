"""Auditoria de 21/10 -- itens 7 e 13 da planilha da Base.

7: exportar em CSV e importar de volta multiplicava decimais por mil, porque a
   importacao le "2.125" como milhar.
13: ano com dois digitos sempre virava 20xx (15/03/85 -> 2085).
"""

from types import SimpleNamespace

import pytest

from app.modules.bases.application.export_service import _celula
from app.modules.bases.domain.spreadsheet import to_date, to_number

_NUMERO = SimpleNamespace(type="number")


@pytest.mark.parametrize("valor", [2.125, 0.125, 1234.5, 7])
def test_numero_exportado_em_csv_volta_igual(valor) -> None:
    # `str` e o que o `csv.writer` faz com a celula; a importacao le texto.
    assert to_number(str(_celula(_NUMERO, valor, {}, "csv"))) == valor


def test_no_excel_o_numero_continua_numero() -> None:
    assert _celula(_NUMERO, 2.125, {}, "xlsx") == 2.125


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("15/03/85", "1985-03-15"),
        ("15/03/30", "1930-03-15"),
        ("15/03/29", "2029-03-15"),
        ("14/10/26", "2026-10-14"),
        ("14/10/2026", "2026-10-14"),
    ],
)
def test_ano_com_dois_digitos_segue_o_corte_do_excel(texto, esperado) -> None:
    assert to_date(texto) == esperado
