"""Planilha da Base: leitura de numero, data e caixa, e a ida e volta CSV.

Exportar em CSV e importar de volta nao pode multiplicar decimais por mil (a
importacao le "2.125" como milhar), e ano com dois digitos segue o corte do
Excel em vez de virar sempre 20xx.
"""

from types import SimpleNamespace

import pytest

from app.modules.bases.application.export_service import _celula
from app.modules.bases.domain.spreadsheet import to_checkbox, to_date, to_number

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


def test_numero_no_formato_brasileiro() -> None:
    assert to_number("1.200") == 1200  # milhar, e nao 1,2
    assert to_number("1.234,5") == 1234.5
    assert to_number("300,5") == 300.5
    assert to_number("1234.5") == 1234.5
    assert to_number("R$ 10,00") == 10
    # en-US (Sheets em ingles): o ultimo separador e o decimal.
    assert to_number("1,234.56") == 1234.56
    assert to_number("12,345,678.9") == 12345678.9


def test_caixa_vazia_do_csv_e_None_e_nao_Nao() -> None:
    """No CSV a celula em branco chega como "", que esta no conjunto de 'nao':
    sem o caso vazio, importar uma exportacao enche a coluna de "Nao"."""
    assert to_checkbox("") is None
    assert to_checkbox("   ") is None
    assert to_checkbox(None) is None
    assert to_checkbox("nao") is False
    assert to_checkbox("sim") is True
