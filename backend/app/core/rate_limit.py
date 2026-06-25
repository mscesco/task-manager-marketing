"""Rate limit em memoria para as rotas publicas de auth.

ESCOPO (consultoria / spec rate-limit):
    Freio por IP em /auth/login e /auth/refresh -- anti brute-force de senha
    e martelo de refresh. NAO e rate-limit global da app; so as duas rotas
    sem dono (publicas) que sao o alvo real.

ESTRATEGIA:
    - Janela DESLIZANTE (sliding window): guarda os timestamps das tentativas
      dentro da janela e poda os que sairam. Evita o "burst de borda" do
      fixed-window (2x no limiar). Memoria por chave limitada ao numero de
      hits dentro da janela.
    - Store EM MEMORIA, no processo. O entrypoint sobe `uvicorn` SEM
      `--workers` => processo unico, event loop unico. A checagem e
      sincrona (sem await no meio) => atomica entre corrotinas. Se um dia
      escalar pra multiplas replicas/workers, troca o store por Redis sem
      mexer no resto (a dependency continua igual).
    - Relogio via `time.monotonic` (nao afetado por ajuste de relogio de
      parede). Injetavel pra teste (fake clock).

IP REAL ATRAS DO TRAEFIK (decisao da spec, opcao A):
    A app so e alcancada via Traefik (nao expoe porta no host). O IP do
    cliente vem do X-Forwarded-For. Pega-se o ULTIMO item da lista, nao o
    primeiro: o primeiro e controlado pelo cliente (forjavel pra furar o
    limite rodando IPs falsos); o ultimo e o que o Traefik (borda confiavel)
    carimba. Sem XFF, cai no request.client.host.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request

from app.core.config import settings
from app.shared.exceptions.base import RateLimitError


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    """Resultado de uma tentativa contra o limitador.

    allowed     : a tentativa cabe na janela?
    retry_after : se bloqueada, segundos ate liberar (0 se allowed).
    """

    allowed: bool
    retry_after: float


class SlidingWindowRateLimiter:
    """Limitador de janela deslizante, em memoria. Puro -- nao conhece HTTP.

    `max_hits` tentativas por `window_seconds`, por chave. A chamada `hit`
    registra a tentativa SE couber; uma tentativa bloqueada NAO e registrada
    (nao estende a janela -- padrao). Testavel isolado com `now` fake.
    """

    def __init__(
        self,
        *,
        max_hits: int,
        window_seconds: float,
        now: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        if max_hits < 1:
            raise ValueError("max_hits deve ser >= 1")
        self._max = max_hits
        self._window = float(window_seconds)
        self._now = now
        self._max_keys = max_keys
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, bucket: deque[float], now: float) -> None:
        """Remove timestamps que ja sairam da janela."""
        limit = now - self._window
        while bucket and bucket[0] <= limit:
            bucket.popleft()

    def _sweep(self) -> None:
        """Limpeza preguicosa: se o store cresceu demais (muitos IPs), dropa
        as chaves sem hit recente. Evita crescimento ilimitado sob ataque
        distribuido. Barato e raro (so quando passa do teto de chaves).
        """
        if len(self._hits) <= self._max_keys:
            return
        now = self._now()
        for key in list(self._hits.keys()):
            self._prune(self._hits[key], now)
            if not self._hits[key]:
                del self._hits[key]

    def hit(self, key: str) -> RateLimitDecision:
        """Registra/avalia uma tentativa da `key`. Sincrona e atomica."""
        now = self._now()
        bucket = self._hits[key]
        self._prune(bucket, now)

        if len(bucket) >= self._max:
            # Bloqueada: libera quando o hit mais antigo sair da janela.
            retry_after = self._window - (now - bucket[0])
            return RateLimitDecision(
                allowed=False, retry_after=max(0.0, retry_after)
            )

        bucket.append(now)
        self._sweep()
        return RateLimitDecision(allowed=True, retry_after=0.0)


def client_ip(request: Request) -> str:
    """IP do cliente, confiando no ULTIMO item do X-Forwarded-For.

    Ver docstring do modulo: o ultimo e o que a borda (Traefik) carimba; o
    primeiro e forjavel pelo cliente. Sem XFF, usa o peer direto. Sem nem
    isso (cliente desconhecido), cai num rotulo fixo -- todos no mesmo balde,
    falha fechado (mais restritivo), nao aberto.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    if request.client is not None:
        return request.client.host
    return "unknown"


def rate_limit(limiter: SlidingWindowRateLimiter) -> Callable[[Request], None]:
    """Fabrica de dependency: aplica `limiter` por IP na rota.

    Uso::

        @router.post("/login", dependencies=[Depends(rate_limit(login_limiter))])

    Lanca RateLimitError (-> 429 + Retry-After) quando o IP estoura.
    """

    def _guard(request: Request) -> None:
        decision = limiter.hit(client_ip(request))
        if not decision.allowed:
            raise RateLimitError(retry_after=math.ceil(decision.retry_after))

    return _guard


# Limitadores singleton, um por rota-alvo (baldes separados). Numeros vem da
# config (env). login e refresh nao compartilham contador.
login_limiter = SlidingWindowRateLimiter(
    max_hits=settings.auth_rate_limit_max,
    window_seconds=settings.auth_rate_limit_window_seconds,
)
refresh_limiter = SlidingWindowRateLimiter(
    max_hits=settings.auth_rate_limit_max,
    window_seconds=settings.auth_rate_limit_window_seconds,
)
