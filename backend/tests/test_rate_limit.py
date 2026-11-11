"""Testes PUROS do rate limit: extracao do IP e chave da conta.

O limitador em si conta no banco desde 11/11 (auditoria, item 10): os testes
dele, do 429 pela rota e do coletor de erros moraram para
`tests/integration/test_rate_limit_db.py`.
"""

from __future__ import annotations

from app.core.rate_limit import client_ip


# --------------------------------------------------------
# 1. Extracao de IP
# --------------------------------------------------------
def test_client_ip_usa_ultimo_xff():
    from starlette.requests import Request

    scope = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"1.2.3.4, 5.6.7.8")],
        "client": ("10.0.0.1", 1234),
    }
    # ultimo item = o que o Traefik carimba (confiavel); o 1o e forjavel.
    assert client_ip(Request(scope)) == "5.6.7.8"


def test_client_ip_fallback_peer_sem_xff():
    from starlette.requests import Request

    scope = {"type": "http", "headers": [], "client": ("10.0.0.1", 1234)}
    assert client_ip(Request(scope)) == "10.0.0.1"


def test_client_ip_unknown_sem_peer():
    from starlette.requests import Request

    scope = {"type": "http", "headers": [], "client": None}
    assert client_ip(Request(scope)) == "unknown"


# --------------------------------------------------------
# 2. account_key -- normalizacao da chave
# --------------------------------------------------------
def test_account_key_normaliza_caixa_e_espacos():
    """Sem normalizar, alternar a caixa das letras multiplica o teto."""
    from app.core.rate_limit import account_key

    a = account_key(email="  Fulano@X.com ", workspace_slug="UniFECAF")
    b = account_key(email="fulano@x.com", workspace_slug="unifecaf")
    assert a == b


def test_account_key_separa_workspaces():
    from app.core.rate_limit import account_key

    a = account_key(email="f@x.com", workspace_slug="ws-a")
    b = account_key(email="f@x.com", workspace_slug="ws-b")
    assert a != b
