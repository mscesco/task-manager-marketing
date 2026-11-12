"""O bcrypt do login roda fora do event loop.

Conferir a senha leva ~250 ms de CPU. Chamado direto na rota async, congela o
worker inteiro: um script anonimo com e-mails variados para a API para todo
mundo. Por isso `verify_password` vai por `asyncio.to_thread`.
"""

import asyncio
import uuid

import pytest

from app.core.rate_limit import RateLimitDecision
from app.modules.auth.application import service as auth_service
from app.modules.auth.application.service import AuthService
from app.shared.exceptions.base import AuthenticationError


class _SemWorkspace:
    """Sessao falsa: nenhum workspace com o slug pedido."""

    async def execute(self, _stmt):
        class _Resultado:
            def scalar_one_or_none(self):
                return None

        return _Resultado()


class _FreioLivre:
    """O freio por conta conta no banco; aqui nao ha banco."""

    async def check(self, _session, _key) -> RateLimitDecision:
        return RateLimitDecision(allowed=True, retry_after=0.0)

    async def record(self, _session, _key) -> None:
        return None


async def test_login_confere_a_senha_SEM_parar_o_loop(monkeypatch) -> None:
    """Sem relogio: o falso pergunta se ha um event loop rodando na thread dele.
    Dentro de `to_thread` nao ha; chamado direto na coroutine, ha."""
    chamadas: list[bool] = []

    def bcrypt_falso(*_args) -> bool:
        try:
            asyncio.get_running_loop()
            chamadas.append(True)
        except RuntimeError:
            chamadas.append(False)
        return False

    monkeypatch.setattr(auth_service, "verify_password", bcrypt_falso)
    monkeypatch.setattr(auth_service, "account_login_limiter", _FreioLivre())

    with pytest.raises(AuthenticationError):
        await AuthService(_SemWorkspace()).login(  # type: ignore[arg-type]
            email=f"{uuid.uuid4()}@exemplo.com",
            password="qualquer",
            workspace_slug="nao-existe",
        )

    assert chamadas == [False], "verify_password rodou dentro do event loop"
