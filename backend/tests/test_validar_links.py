"""Spec 052, fatia B -- a validacao dos links, pura (sem banco)."""

from __future__ import annotations

import pytest

from app.modules.tasks.application.link_service import (
    MAX_LINKS,
    TITULO_MAXIMO,
    validar_links,
)
from app.shared.exceptions.base import ValidationError


def test_link_valido_sai_aparado():
    (link,) = validar_links([("  Pasta principal ", " https://drive.google.com/x ")])
    assert link.title == "Pasta principal"
    assert link.url == "https://drive.google.com/x"


def test_http_tambem_vale():
    assert validar_links([("Site", "http://exemplo.com")])[0].url == "http://exemplo.com"


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",  # ⚠️ o motivo da trava no servidor
        "data:text/html,oi",
        "drive.google.com/x",  # sem esquema: a TELA poe https://, o servidor nao adivinha
        "https://",
        "https://com espaco",
        "ftp://arquivo",
        "",
    ],
)
def test_url_fora_de_http_https_e_recusada_apontando_o_item(url):
    with pytest.raises(ValidationError) as erro:
        validar_links([("Ok", "https://ok.com"), ("Ruim", url)])
    assert erro.value.details["field"] == "links[1].url"


def test_nome_vazio_depois_de_aparar_e_recusado():
    with pytest.raises(ValidationError) as erro:
        validar_links([("   ", "https://ok.com")])
    assert erro.value.details["field"] == "links[0].title"


def test_nome_acima_do_teto_e_recusado():
    with pytest.raises(ValidationError):
        validar_links([("a" * (TITULO_MAXIMO + 1), "https://ok.com")])


def test_mais_de_vinte_links_e_recusado():
    itens = [(f"L{i}", f"https://ok.com/{i}") for i in range(MAX_LINKS + 1)]
    with pytest.raises(ValidationError) as erro:
        validar_links(itens)
    assert erro.value.details["field"] == "links"
    # E exatamente o teto passa.
    assert len(validar_links(itens[:MAX_LINKS])) == MAX_LINKS


def test_lista_vazia_e_valida_e_o_jeito_de_tirar_todos():
    assert validar_links([]) == []
