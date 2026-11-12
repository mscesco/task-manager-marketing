"""Freios de tentativa: por IP (formulario publico, coletor de erros) e por
conta (login, troca de senha). Nao e rate limit global.

Janela deslizante contada no banco (`rate_limit_hit`), para valer entre os
workers. O freio faz commit sozinho, excecao ao Unit of Work: a tentativa que
ele conta e a que falha, e a falha desfaz a transacao da requisicao. So grava
antes de qualquer escrita da requisicao. A chave fica travada
(`pg_advisory_xact_lock`) ate o commit.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import SessionDep
from app.shared.exceptions.base import RateLimitError


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    """`retry_after`: segundos ate liberar (0 se `allowed`)."""

    allowed: bool
    retry_after: float


class RateLimiter:
    """Janela deslizante de `max_hits` tentativas por `window_seconds`, por
    chave, num balde (`bucket`) da tabela `rate_limit_hit`.

    `hit` decide e registra junto (toda tentativa conta). `check`/`record`/
    `reset` separam as duas coisas para o freio por conta: so falha conta, e
    o acerto zera. Tentativa bloqueada nao e registrada.
    """

    def __init__(self, *, bucket: str, max_hits: int, window_seconds: float) -> None:
        if max_hits < 1:
            raise ValueError("max_hits deve ser >= 1")
        self.bucket = bucket
        self._max = max_hits
        self._window = float(window_seconds)

    async def check(self, session: AsyncSession, key: str) -> RateLimitDecision:
        """Avalia a `key` sem registrar tentativa."""
        n, idade_do_mais_velho = (
            await session.execute(
                text(
                    "SELECT count(*), extract(epoch FROM clock_timestamp() - min(at)) "
                    "FROM rate_limit_hit WHERE bucket = :b AND key = :k "
                    "AND at > clock_timestamp() - make_interval(secs => :w)"
                ),
                {"b": self.bucket, "k": key, "w": self._window},
            )
        ).one()
        if n >= self._max:
            # Libera quando a tentativa mais antiga sair da janela.
            espera = self._window - float(idade_do_mais_velho)
            return RateLimitDecision(allowed=False, retry_after=max(0.0, espera))
        return RateLimitDecision(allowed=True, retry_after=0.0)

    async def hit(self, session: AsyncSession, key: str) -> RateLimitDecision:
        """Avalia e, se couber, registra uma tentativa da `key`."""
        await self._travar(session, key)
        decision = await self.check(session, key)
        if decision.allowed:
            await self._gravar(session, key)
        await session.commit()
        return decision

    async def record(self, session: AsyncSession, key: str) -> None:
        """Registra uma ocorrencia da `key` (no login por conta: uma falha)."""
        await self._travar(session, key)
        await self._gravar(session, key)
        await session.commit()

    async def reset(self, session: AsyncSession, key: str) -> None:
        """Esvazia o balde da `key` (no login por conta: acertou a senha)."""
        await session.execute(
            text("DELETE FROM rate_limit_hit WHERE bucket = :b AND key = :k"),
            {"b": self.bucket, "k": key},
        )
        await session.commit()

    async def _travar(self, session: AsyncSession, key: str) -> None:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:c, 0))"),
            {"c": f"rate_limit:{self.bucket}:{key}"},
        )

    async def _gravar(self, session: AsyncSession, key: str) -> None:
        # Apaga os vencidos do balde inteiro: a tabela fica do tamanho da
        # janela, inclusive sob ataque distribuido (milhares de IPs).
        await session.execute(
            text(
                "DELETE FROM rate_limit_hit WHERE bucket = :b "
                "AND at <= clock_timestamp() - make_interval(secs => :w)"
            ),
            {"b": self.bucket, "w": self._window},
        )
        await session.execute(
            text("INSERT INTO rate_limit_hit (bucket, key) VALUES (:b, :k)"),
            {"b": self.bucket, "k": key},
        )


def client_ip(request: Request) -> str:
    """IP do cliente: o ultimo item do X-Forwarded-For, que o Traefik carimba
    (o primeiro e forjavel). Sem nada, todos caem num balde so (fail closed).
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    if request.client is not None:
        return request.client.host
    return "unknown"


def rate_limit(limiter: RateLimiter):
    """Dependency que aplica `limiter` por IP; estourou, 429 com Retry-After."""

    async def _guard(request: Request, session: SessionDep) -> None:
        decision = await limiter.hit(session, client_ip(request))
        if not decision.allowed:
            raise RateLimitError(retry_after=math.ceil(decision.retry_after))

    return _guard


# Um balde por rota; numeros em `config.py`. Login e refresh nao tem freio por
# IP: a instituicao inteira sai por um IP so (NAT), e o freio barrava quem
# acertava a senha. Forca bruta fica com o freio por conta.
public_form_limiter = RateLimiter(
    bucket="public_form",
    max_hits=settings.public_form_rate_limit_max,
    window_seconds=settings.public_form_rate_limit_window_seconds,
)
public_submit_limiter = RateLimiter(
    bucket="public_submit",
    max_hits=settings.public_submit_rate_limit_max,
    window_seconds=settings.public_submit_rate_limit_window_seconds,
)
client_error_limiter = RateLimiter(
    bucket="client_error",
    max_hits=settings.client_error_rate_limit_max,
    window_seconds=settings.client_error_rate_limit_window_seconds,
)
# Login por conta (e-mail + workspace), via check/record/reset. Sem bloqueio
# permanente, para nao virar negacao de servico contra e-mail conhecido.
account_login_limiter = RateLimiter(
    bucket="account_login",
    max_hits=settings.account_login_limit_max,
    window_seconds=settings.account_login_limit_window_seconds,
)
# Senha atual na troca de senha (chave = id da pessoa); balde proprio, nao tranca o login.
change_password_limiter = RateLimiter(
    bucket="change_password",
    max_hits=settings.account_login_limit_max,
    window_seconds=settings.account_login_limit_window_seconds,
)


def account_key(*, email: str, workspace_slug: str) -> str:
    """Chave do balde por conta, normalizada: trocar a caixa nao abre balde novo."""
    return f"{email.strip().lower()}|{workspace_slug.strip().lower()}"
