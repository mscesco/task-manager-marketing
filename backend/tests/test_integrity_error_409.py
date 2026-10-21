"""Auditoria de 21/10 -- `IntegrityError` cru vira 409, e nao 500.

Dois pedidos iguais ao mesmo tempo passam na consulta "ja existe?" e o
segundo estoura no indice unico. Nao e defeito do servidor; e conflito.
"""

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError

from app.api.errors import register_exception_handlers


async def test_integrity_error_vira_409_com_code() -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise IntegrityError("INSERT ...", {}, Exception("duplicate key"))

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/boom")

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"
