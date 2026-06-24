"""Health checks.

/health        : liveness -- a app esta de pe? (sem tocar no banco)
/health/ready  : readiness -- a app consegue falar com o banco?

Sao rotas PUBLICAS (sem autenticacao), usadas por Docker
healthcheck, load balancer e monitoracao.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import text

from app.core.deps import SessionDep

router = APIRouter(tags=["health"])


@router.get("/health", status_code=status.HTTP_200_OK)
async def liveness() -> dict[str, str]:
    """Liveness probe -- responde se o processo esta vivo."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(session: SessionDep) -> dict[str, str]:
    """Readiness probe -- confirma conectividade com o Postgres."""
    await session.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}
