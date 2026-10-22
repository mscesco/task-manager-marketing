"""Auditoria de 21/10 -- teto de corpo na API (`BodySizeLimitMiddleware`).

Sem ele, o POST anonimo do formulario publico era lido e decodificado inteiro
antes do freio por IP e dos `max_length`: 1 GB de JSON ocupava um worker.
"""

from collections.abc import AsyncIterator

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.errors import register_exception_handlers
from app.core.middleware import BodySizeLimitMiddleware
from app.main import create_app


def _app(max_bytes: int) -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=max_bytes)

    @app.post("/eco")
    async def eco(payload: dict) -> dict:
        return payload

    return app


async def _post(app: FastAPI, **kwargs):
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post("/eco", **kwargs)


async def test_corpo_dentro_do_teto_passa() -> None:
    r = await _post(_app(100), json={"a": "x" * 50})
    assert r.status_code == 200


async def test_corpo_acima_do_teto_e_413() -> None:
    r = await _post(_app(100), json={"a": "x" * 200})
    assert r.status_code == 413


async def test_corpo_chunked_sem_content_length_tambem_e_413() -> None:
    """⚠️ O caso que um teto pelo cabecalho `Content-Length` deixaria passar."""

    async def pedacos() -> AsyncIterator[bytes]:
        yield b'{"a": "'
        for _ in range(10):
            yield b"x" * 50
        yield b'"}'

    r = await _post(_app(100), content=pedacos())
    assert r.status_code == 413


def test_a_app_de_verdade_tem_o_teto() -> None:
    classes = [m.cls for m in create_app().user_middleware]
    assert BodySizeLimitMiddleware in classes
