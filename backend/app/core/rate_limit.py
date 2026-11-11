"""Freios de tentativa: formulario publico, coletor de erros, login e troca
de senha.

ESCOPO (consultoria / spec rate-limit):
    Freio por IP no formulario publico e no coletor de erros, e freio por
    CONTA no login e na troca de senha. NAO e rate-limit global da app. (O
    /auth/login e o /auth/refresh tiveram freio por IP ate 21/10 e 16/10 --
    ver os comentarios no lugar onde eles moravam, la embaixo.)

ESTRATEGIA:
    - Janela DESLIZANTE (sliding window): conta as tentativas dentro da
      janela. Evita o "burst de borda" do fixed-window (2x no limiar).
    - Contagem NO BANCO (`rate_limit_hit`, auditoria de 11/11, item 10). Ate
      11/11 ela morava na memoria de cada processo, e producao sobe
      `uvicorn --workers 2`: o limite real era ate o dobro, o corte dependia
      de qual worker atendia, e todo deploy zerava. A escolha dela foi manter
      os dois workers (sem fila atras de um export) e contar num lugar so.
    - ⚠️ O FREIO CONFIRMA (commit) SOZINHO -- excecao a regra "so o Unit of
      Work faz commit". A tentativa que ele conta e justamente a que FALHA, e
      a falha desfaz a transacao da requisicao: sem o commit aqui, a senha
      errada nunca seria registrada. O freio so grava antes de qualquer
      escrita da requisicao (ou no lugar dela), entao nao confirma nada alheio.
    - Registrar trava a chave (`pg_advisory_xact_lock`) ate o commit: dois
      workers no mesmo balde nao contam a mesma vaga duas vezes.
    - Relogio do banco (`clock_timestamp()`), e nao o de cada processo.

IP REAL ATRAS DO TRAEFIK (decisao da spec, opcao A):
    A app so e alcancada via Traefik (nao expoe porta no host). O IP do
    cliente vem do X-Forwarded-For. Pega-se o ULTIMO item da lista, nao o
    primeiro: o primeiro e controlado pelo cliente (forjavel pra furar o
    limite rodando IPs falsos); o ultimo e o que o Traefik (borda confiavel)
    carimba. Sem XFF, cai no request.client.host.
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
    """Resultado de uma tentativa contra o limitador.

    allowed     : a tentativa cabe na janela?
    retry_after : se bloqueada, segundos ate liberar (0 se allowed).
    """

    allowed: bool
    retry_after: float


class RateLimiter:
    """Janela deslizante de `max_hits` tentativas por `window_seconds`, por
    chave, num balde (`bucket`) da tabela `rate_limit_hit`.

    `hit` decide e registra no mesmo passo (rotas publicas: toda tentativa
    conta). O trio `check`/`record`/`reset` separa decidir de registrar, para
    o freio por CONTA (Spec 030, D5): so FALHA conta, e o acerto zera.
    Uma tentativa bloqueada NAO e registrada (nao estende a janela).
    """

    def __init__(self, *, bucket: str, max_hits: int, window_seconds: float) -> None:
        if max_hits < 1:
            raise ValueError("max_hits deve ser >= 1")
        self.bucket = bucket
        self._max = max_hits
        self._window = float(window_seconds)

    async def check(self, session: AsyncSession, key: str) -> RateLimitDecision:
        """Avalia a `key` SEM registrar tentativa."""
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
        """Registra uma ocorrencia da `key` (no login por conta: uma FALHA)."""
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


def rate_limit(limiter: RateLimiter):
    """Fabrica de dependency: aplica `limiter` por IP na rota.

    Uso::

        @router.post("/", dependencies=[Depends(rate_limit(public_form_limiter))])

    Lanca RateLimitError (-> 429 + Retry-After) quando o IP estoura.
    """

    async def _guard(request: Request, session: SessionDep) -> None:
        decision = await limiter.hit(session, client_ip(request))
        if not decision.allowed:
            raise RateLimitError(retry_after=math.ceil(decision.retry_after))

    return _guard


# Limitadores singleton, um por rota-alvo (baldes separados). Numeros vem da
# config (env).
#
# ⚠️ O `/auth/login` NAO TEM FREIO POR IP DESDE 21/10 (auditoria): contava os
# ACERTOS, e a instituicao inteira sai por um IP -- a 11a pessoa a entrar no
# minuto levava 429 com a senha certa. Forca bruta fica com o freio POR CONTA
# (`account_login_limiter`, abaixo), que so conta falha.
# ⚠️ O `/auth/refresh` NAO TEM FREIO POR IP DESDE 16/10 (auditoria). A
# instituicao sai toda pelo MESMO IP (NAT), e cada aba renova a cada 15 min:
# na chegada da manha, o 11o refresh do minuto levava 429 e o front deslogava
# gente com sessao valida. E nao ha o que adivinhar ali -- a rota exige um
# token ASSINADO, sem bcrypt nem senha.
# Formulario publico de solicitacoes (FazAe): balde proprio, janela mais
# longa -- envio de formulario e raro por natureza, ao contrario de login.
public_form_limiter = RateLimiter(
    bucket="public_form",
    max_hits=settings.public_form_rate_limit_max,
    window_seconds=settings.public_form_rate_limit_window_seconds,
)
# Coletor de erros do front: publico, sem auth, e cada requisicao vira LINHA DE
# LOG. Ver o bloco em `config.py`.
client_error_limiter = RateLimiter(
    bucket="client_error",
    max_hits=settings.client_error_rate_limit_max,
    window_seconds=settings.client_error_rate_limit_window_seconds,
)
# Spec 030 (D5): freio por CONTA no login. Chave = e-mail + workspace, nao
# IP -- o balde por IP nao ve o atacante que distribui as tentativas por
# varios enderecos, que e como forca bruta de senha acontece de verdade.
#
# Usa o trio check/record/reset (nao `hit`): so FALHA registra, e o acerto
# zera. Sem isso, quem digita a senha certa dez vezes num dia se trancaria.
#
# Janela DESLIZANTE, sem bloqueio permanente: quem souber o e-mail de
# alguem consegue trancar essa pessoa por, no maximo, a janela. Um bloqueio
# que so um humano destrava seria pior -- viraria negacao de servico
# permanente contra qualquer pessoa de e-mail conhecido.
account_login_limiter = RateLimiter(
    bucket="account_login",
    max_hits=settings.account_login_limit_max,
    window_seconds=settings.account_login_limit_window_seconds,
)
# Auditoria de 16/10: o mesmo freio, na SENHA ATUAL da troca de senha (chave =
# id da pessoa). Balde proprio: errar a senha atual nao tranca o login.
change_password_limiter = RateLimiter(
    bucket="change_password",
    max_hits=settings.account_login_limit_max,
    window_seconds=settings.account_login_limit_window_seconds,
)


def account_key(*, email: str, workspace_slug: str) -> str:
    """Chave do balde por conta.

    ⚠️ NORMALIZA o e-mail (strip + lower). Sem isso `Fulano@x.com` e
    `fulano@x.com` caem em baldes diferentes e o freio vira decorativo --
    basta alternar a caixa das letras para multiplicar o teto.
    """
    return f"{email.strip().lower()}|{workspace_slug.strip().lower()}"
