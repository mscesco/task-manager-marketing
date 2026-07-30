"""Testes do rate limit das rotas de auth.

Tres camadas, todas SEM banco:
    1. SlidingWindowRateLimiter -- puro, com relogio fake (deterministico).
    2. client_ip -- extracao do IP (ultimo X-Forwarded-For; fallback peer).
    3. ASGI -- o 429 ponta-a-ponta atraves do FastAPI (dependency -> handler
       -> JSON + header Retry-After). Dispensa DB: o 429 acontece na
       dependency, ANTES do handler que tocaria o banco.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import Depends, FastAPI

from app.api.errors import register_exception_handlers
from app.core.rate_limit import (
    SlidingWindowRateLimiter,
    client_ip,
    rate_limit,
)


class FakeClock:
    """Relogio controlavel para teste deterministico (sem sleep real)."""

    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


# --------------------------------------------------------
# 1. Limitador puro
# --------------------------------------------------------
def test_permite_ate_o_maximo():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=3, window_seconds=60, now=clock)
    for _ in range(3):
        assert limiter.hit("ip").allowed is True


def test_bloqueia_no_maximo_mais_um():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=3, window_seconds=60, now=clock)
    for _ in range(3):
        limiter.hit("ip")
    decision = limiter.hit("ip")
    assert decision.allowed is False
    # Tudo no mesmo instante: libera so quando o 1o hit sair (janela cheia).
    assert decision.retry_after == pytest.approx(60.0)


def test_libera_apos_a_janela():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    limiter.hit("ip")
    limiter.hit("ip")
    assert limiter.hit("ip").allowed is False  # cheio
    clock.advance(61)  # janela passou
    assert limiter.hit("ip").allowed is True  # liberou


def test_janela_deslizante_nao_libera_tudo_de_uma_vez():
    """Deslizante: liberar so o hit mais antigo abre exatamente 1 vaga."""
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    limiter.hit("ip")           # t=1000
    clock.advance(30)
    limiter.hit("ip")           # t=1030
    assert limiter.hit("ip").allowed is False  # cheio (2 na janela)
    clock.advance(31)           # t=1061: o de t=1000 saiu, o de t=1030 fica
    assert limiter.hit("ip").allowed is True   # 1 vaga
    assert limiter.hit("ip").allowed is False  # cheio de novo


def test_chaves_sao_independentes():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=1, window_seconds=60, now=clock)
    assert limiter.hit("ip-a").allowed is True
    assert limiter.hit("ip-a").allowed is False  # a estourou
    assert limiter.hit("ip-b").allowed is True   # b nao e afetado


def test_retry_after_diminui_com_o_tempo():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=1, window_seconds=60, now=clock)
    limiter.hit("ip")
    assert limiter.hit("ip").retry_after == pytest.approx(60.0)
    clock.advance(40)
    assert limiter.hit("ip").retry_after == pytest.approx(20.0)


def test_max_hits_invalido():
    with pytest.raises(ValueError):
        SlidingWindowRateLimiter(max_hits=0, window_seconds=60)


# --------------------------------------------------------
# 2. Extracao de IP
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
# 3. ASGI: 429 ponta-a-ponta (sem DB)
# --------------------------------------------------------
def _app_com_rota_limitada(max_hits: int) -> FastAPI:
    """App minimo: handlers de erro + 1 rota protegida pelo limitador."""
    limiter = SlidingWindowRateLimiter(max_hits=max_hits, window_seconds=60)
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/probe", dependencies=[Depends(rate_limit(limiter))])
    async def _probe() -> dict[str, bool]:
        return {"ok": True}

    return app


async def test_http_429_apos_estourar():
    app = _app_com_rota_limitada(max_hits=2)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        # Mesmo IP via XFF -> mesmo balde.
        headers = {"X-Forwarded-For": "9.9.9.9"}
        assert (await client.post("/probe", headers=headers)).status_code == 200
        assert (await client.post("/probe", headers=headers)).status_code == 200
        blocked = await client.post("/probe", headers=headers)

    assert blocked.status_code == 429
    body = blocked.json()
    assert body["error"]["code"] == "rate_limited"
    # Header padrao HTTP presente e numerico.
    assert int(blocked.headers["Retry-After"]) > 0


async def test_http_ips_diferentes_nao_compartilham_balde():
    app = _app_com_rota_limitada(max_hits=1)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        a = await client.post("/probe", headers={"X-Forwarded-For": "1.1.1.1"})
        a2 = await client.post("/probe", headers={"X-Forwarded-For": "1.1.1.1"})
        b = await client.post("/probe", headers={"X-Forwarded-For": "2.2.2.2"})

    assert a.status_code == 200
    assert a2.status_code == 429   # 1.1.1.1 estourou
    assert b.status_code == 200    # 2.2.2.2 livre


# --------------------------------------------------------
# 4. Trio check/record/reset -- freio por CONTA (Spec 030, D5)
# --------------------------------------------------------
def test_check_nao_registra_tentativa():
    """`check` so LE. Se ele registrasse, consultar viraria gastar cota."""
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    for _ in range(10):
        assert limiter.check("conta").allowed is True
    limiter.record("conta")
    limiter.record("conta")
    assert limiter.check("conta").allowed is False


def test_check_nao_cria_balde_para_chave_desconhecida():
    """Sondar mil e-mails inexistentes nao pode virar mil baldes na memoria.

    Guarda contra a volta do `self._hits[key]` (defaultdict cria no acesso)
    no lugar do `.get`.
    """
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=FakeClock())
    for i in range(1000):
        limiter.check(f"nao-existe-{i}")
    assert len(limiter._hits) == 0


def test_record_enche_e_bloqueia():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=3, window_seconds=60, now=clock)
    for _ in range(3):
        limiter.record("conta")
    d = limiter.check("conta")
    assert d.allowed is False
    assert d.retry_after > 0


def test_reset_libera_na_hora():
    """Acertar a senha zera o balde -- senao quem loga muito se trancaria."""
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    limiter.record("conta")
    limiter.record("conta")
    assert limiter.check("conta").allowed is False
    limiter.reset("conta")
    assert limiter.check("conta").allowed is True


def test_reset_de_chave_inexistente_nao_estoura():
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=FakeClock())
    limiter.reset("nunca-vista")  # nao deve lancar


def test_destrava_sozinho_ao_fim_da_janela():
    """Sem bloqueio permanente: o freio nao vira arma de negacao de servico."""
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    limiter.record("conta")
    limiter.record("conta")
    assert limiter.check("conta").allowed is False
    clock.advance(61)
    assert limiter.check("conta").allowed is True


def test_baldes_de_contas_diferentes_sao_independentes():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(max_hits=2, window_seconds=60, now=clock)
    limiter.record("a@x.com|ws")
    limiter.record("a@x.com|ws")
    assert limiter.check("a@x.com|ws").allowed is False
    assert limiter.check("b@x.com|ws").allowed is True


# --------------------------------------------------------
# 5. account_key -- normalizacao da chave
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
