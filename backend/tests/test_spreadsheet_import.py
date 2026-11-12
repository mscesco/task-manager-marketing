"""Leitura de planilha para importar na Base: funcoes puras, sem banco."""

from __future__ import annotations

import pytest

from app.modules.bases.application.import_service import BaseImportService
from app.modules.bases.domain.spreadsheet import (
    MAX_RAW_ROWS,
    read_table,
    split_many,
    suggest_type,
)
from app.shared.exceptions.base import ValidationError

CSV = (
    b"Tarefa;Plataforma;Data;Alcance;Feito;Responsavel\n"
    b"Post 1;Instagram;14/10/2026;1.200;sim;Ana\n"
    b"Post 2;TikTok;15/10/2026;300,5;nao;\n"
    b"Post 3;Instagram;31/02/2026;10;sim;Fulano\n"
)


def test_a_previa_sugere_os_tipos() -> None:
    p = BaseImportService.preview(CSV, "posts.csv", sheet=None, header_row=1)
    assert p.total_rows == 3
    tipos = {c.name: c.suggested_type for c in p.columns}
    assert tipos["Alcance"] == "number"
    assert tipos["Feito"] == "checkbox"
    assert tipos["Plataforma"] == "select"
    # a 31/02 nao e data, entao a coluna inteira nao "parece data"
    assert tipos["Data"] == "text"


def test_selecao_multipla_do_google_planilhas_separa_por_virgula() -> None:
    """O Planilhas exporta os chips como "Formulario, Import, Site"."""
    assert split_many("Formulário, Import, Site") == ["Formulário", "Import", "Site"]
    assert suggest_type(["Formulário, Import", "Import, Sydle", "Site"]) == "multi_select"
    # frase com virgula continua texto
    assert suggest_type(["Revisar a landing da pós, ajustar o texto do banner principal"]) == "text"


def test_csv_do_excel_brasileiro_le_travessao_e_aspas_curvas() -> None:
    """O Excel em portugues grava cp1252; lido como latin-1, o travessao e as
    aspas curvas virariam caracteres de controle."""
    texto = "\u201cReunião\u201d \u2013 14h"  # aspas curvas e travessao
    t = read_table(f"Tarefa\n{texto}\n".encode("cp1252"), "a.csv")
    assert t.rows == [[texto]]


def test_planilha_grande_demais_e_recusada_antes_de_ler_o_resto() -> None:
    with pytest.raises(ValidationError, match="passa de 3 linhas"):
        read_table(b"T\na\nb\nc\nd\n", "a.csv", max_rows=3)
    # linha em branco nao conta para o teto da base, mas conta para o de leitura
    assert len(read_table(b"T\na\n\n\nb\n", "a.csv", max_rows=2).rows) == 2
    with pytest.raises(ValidationError, match="contando as em branco"):
        read_table(b"T\n" + b";\n" * (MAX_RAW_ROWS + 1), "a.csv")


def test_csv_com_aspas_sem_fechar_e_422_e_nao_500() -> None:
    with pytest.raises(ValidationError, match="aspas"):
        read_table(b'T\n"' + b"x" * 200_000 + b"\n", "a.csv")
