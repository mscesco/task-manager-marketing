"""O limitador de tentativas, contando no banco.

Dois workers dividem a mesma contagem
(`test_dois_processos_dividem_a_mesma_contagem`): contando em memoria, o limite
real seria o dobro e o deploy o zeraria.

O tempo anda para tras no banco (`_envelhecer`), e nao num relogio falso: o
relogio que conta e o `clock_timestamp()` do Postgres.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.api.errors import register_exception_handlers
from app.core.deps import get_db_session
from app.core.rate_limit import RateLimiter, client_error_limiter, rate_limit
from tests.integration.conftest import cliente

pytestmark = pytest.mark.integration


def _lim(max_hits: int = 3, window: float = 60, bucket: str = "teste") -> RateLimiter:
    return RateLimiter(bucket=bucket, max_hits=max_hits, window_seconds=window)


async def _envelhecer(db, segundos: float, bucket: str = "teste") -> None:
    """O tempo passa: as tentativas ja gravadas ficam `segundos` mais velhas."""
    await db.execute(
        text(
            "UPDATE rate_limit_hit SET at = at - make_interval(secs => :s) "
            "WHERE bucket = :b"
        ),
        {"s": segundos, "b": bucket},
    )


async def test_permite_ate_o_maximo_e_bloqueia_o_seguinte(db) -> None:
    lim = _lim(max_hits=3)
    for _ in range(3):
        assert (await lim.hit(db, "ip")).allowed
    bloqueado = await lim.hit(db, "ip")
    assert not bloqueado.allowed
    assert 0 < bloqueado.retry_after <= 60


async def test_dois_processos_dividem_a_mesma_contagem(db) -> None:
    """Cada worker tem o SEU objeto limitador; a contagem e uma so."""
    worker_a, worker_b = _lim(max_hits=2), _lim(max_hits=2)
    assert (await worker_a.hit(db, "ip")).allowed
    assert (await worker_b.hit(db, "ip")).allowed
    assert not (await worker_a.hit(db, "ip")).allowed
    assert not (await worker_b.hit(db, "ip")).allowed


async def test_libera_aos_poucos_quando_a_janela_desliza(db) -> None:
    lim = _lim(max_hits=2, window=60)
    await lim.hit(db, "ip")
    await _envelhecer(db, 30)
    await lim.hit(db, "ip")
    assert not (await lim.hit(db, "ip")).allowed
    await _envelhecer(db, 31)  # a primeira saiu da janela; a segunda nao
    assert (await lim.hit(db, "ip")).allowed
    assert not (await lim.hit(db, "ip")).allowed


async def test_chaves_e_baldes_sao_independentes(db) -> None:
    lim, outro = _lim(max_hits=1), _lim(max_hits=1, bucket="outro")
    assert (await lim.hit(db, "a")).allowed
    assert (await lim.hit(db, "b")).allowed
    assert (await outro.hit(db, "a")).allowed
    assert not (await lim.hit(db, "a")).allowed


async def test_bloqueada_nao_conta_e_os_vencidos_sao_apagados(db) -> None:
    lim = _lim(max_hits=1, window=60)
    await lim.hit(db, "ip")
    await lim.hit(db, "ip")  # bloqueada: nao grava
    await _envelhecer(db, 61)
    await lim.hit(db, "outro-ip")  # gravar limpa os vencidos do balde
    linhas = (
        await db.execute(text("SELECT key FROM rate_limit_hit WHERE bucket = 'teste'"))
    ).scalars().all()
    assert linhas == ["outro-ip"]


async def test_check_record_reset_do_freio_por_conta(db) -> None:
    lim = _lim(max_hits=2)
    assert (await lim.check(db, "conta")).allowed
    assert (await lim.check(db, "conta")).allowed  # check nao registra
    await lim.record(db, "conta")
    await lim.record(db, "conta")
    assert not (await lim.check(db, "conta")).allowed
    await lim.reset(db, "conta")
    assert (await lim.check(db, "conta")).allowed
    await lim.reset(db, "ninguem")  # chave sem registro nao estoura


# ------------------------------------------------------------ pela rota


def _app(db, limiter: RateLimiter) -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/probe", dependencies=[Depends(rate_limit(limiter))])
    async def _probe() -> dict[str, bool]:
        return {"ok": True}

    async def _session() -> AsyncIterator:
        yield db

    app.dependency_overrides[get_db_session] = _session
    return app


async def test_http_429_por_ip(db) -> None:
    app = _app(db, _lim(max_hits=1))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as cli:
        a = await cli.post("/probe", headers={"X-Forwarded-For": "1.1.1.1"})
        a2 = await cli.post("/probe", headers={"X-Forwarded-For": "1.1.1.1"})
        b = await cli.post("/probe", headers={"X-Forwarded-For": "2.2.2.2"})
    assert (a.status_code, b.status_code) == (200, 200)
    assert a2.status_code == 429
    assert a2.json()["error"]["code"] == "rate_limited"
    assert int(a2.headers["Retry-After"]) > 0


# `/client-errors` e a unica rota sem auth que produz uma linha de log por
# requisicao: precisa de freio por IP.
async def test_client_errors_tem_freio_por_ip_e_nao_exige_login(db) -> None:
    corpo = {"kind": "error", "message": "x"}
    headers = {"X-Forwarded-For": "203.0.113.77"}
    async with cliente(db) as cli:
        for _ in range(client_error_limiter._max):
            r = await cli.post("/api/v1/client-errors", json=corpo, headers=headers)
            assert r.status_code == 202, r.text  # sem token nenhum
        bloqueado = await cli.post("/api/v1/client-errors", json=corpo, headers=headers)
    assert bloqueado.status_code == 429
