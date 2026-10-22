"""Auditoria de 21/10 -- o bcrypt do login nao trava o servidor.

Conferir a senha leva ~250 ms de CPU. Chamado direto na rota async, ele
congelava o worker inteiro: com o freio por IP fora (PR #118), um script
anonimo com e-mails variados parava a API para todo mundo. Agora roda em
`asyncio.to_thread`, e o loop segue atendendo enquanto a senha e conferida.
"""

import asyncio
import time
import uuid

import pytest

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


async def test_login_confere_a_senha_SEM_parar_o_loop(monkeypatch) -> None:
    def bcrypt_lento(*_args) -> bool:
        time.sleep(0.3)
        return False

    monkeypatch.setattr(auth_service, "verify_password", bcrypt_lento)

    batidas = 0

    async def relogio() -> None:
        nonlocal batidas
        while True:
            await asyncio.sleep(0.01)
            batidas += 1

    tarefa = asyncio.create_task(relogio())
    try:
        with pytest.raises(AuthenticationError):
            await AuthService(_SemWorkspace()).login(  # type: ignore[arg-type]
                email=f"{uuid.uuid4()}@exemplo.com",
                password="qualquer",
                workspace_slug="nao-existe",
            )
    finally:
        tarefa.cancel()

    # Bloqueando, o relogio nao bate nenhuma vez durante os 300 ms.
    assert batidas >= 10
