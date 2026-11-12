"""Todo bcrypt do login e da troca de senha roda fora do event loop.

Conferir a senha leva ~250 ms de CPU. Chamado direto na rota async, congela o
worker inteiro: um script anonimo com e-mails variados para a API para todo
mundo. Por isso `verify_password` e `hash_password` vao por `asyncio.to_thread`.
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.core.rate_limit import RateLimitDecision
from app.modules.auth.application import service as auth_service
from app.modules.auth.application.service import AuthService
from app.shared.exceptions.base import AuthenticationError, ValidationError


class _SessaoFalsa:
    """Responde cada `execute` com o proximo item da fila; `get` devolve `user`."""

    def __init__(self, *resultados, user=None) -> None:
        self._fila = list(resultados)
        self._user = user

    async def execute(self, _stmt):
        valor = self._fila.pop(0)

        class _Resultado:
            def scalar_one_or_none(self):
                return valor

        return _Resultado()

    async def get(self, _model, _id):
        return self._user


class _Freio:
    """O freio conta no banco; aqui nao ha banco."""

    def __init__(self, *, allowed: bool = True) -> None:
        self._allowed = allowed

    async def check(self, _session, _key) -> RateLimitDecision:
        return RateLimitDecision(allowed=self._allowed, retry_after=0.0)

    async def record(self, _session, _key) -> None:
        return None

    async def reset(self, _session, _key) -> None:
        return None


def _user(*, is_active: bool = True):
    return SimpleNamespace(
        id=uuid.uuid4(),
        is_active=is_active,
        password_hash="hash-qualquer",
        must_change_password=False,
        password_expires_at=None,
        token_version=0,
    )


def _espiao(retorno):
    """Sem relogio: o falso pergunta se ha um event loop rodando na thread dele.
    Dentro de `to_thread` nao ha; chamado direto na coroutine, ha."""
    chamadas: list[bool] = []

    def falso(*_args):
        try:
            asyncio.get_running_loop()
            chamadas.append(True)
        except RuntimeError:
            chamadas.append(False)
        return retorno

    return falso, chamadas


@pytest.mark.parametrize(
    ("freio_livre", "sessao"),
    [
        pytest.param(False, _SessaoFalsa(), id="conta_bloqueada"),
        pytest.param(True, _SessaoFalsa(None), id="workspace_nao_existe"),
        pytest.param(
            True, _SessaoFalsa(SimpleNamespace(id=uuid.uuid4()), None),
            id="usuario_nao_existe",
        ),
        pytest.param(
            True, _SessaoFalsa(SimpleNamespace(id=uuid.uuid4()), _user()),
            id="usuario_real_senha_errada",
        ),
    ],
)
async def test_login_confere_a_senha_SEM_parar_o_loop(
    monkeypatch, freio_livre, sessao
) -> None:
    bcrypt_falso, chamadas = _espiao(False)
    monkeypatch.setattr(auth_service, "verify_password", bcrypt_falso)
    monkeypatch.setattr(
        auth_service, "account_login_limiter", _Freio(allowed=freio_livre)
    )

    with pytest.raises(AuthenticationError):
        await AuthService(sessao).login(  # type: ignore[arg-type]
            email=f"{uuid.uuid4()}@exemplo.com",
            password="qualquer",
            workspace_slug="ws",
        )

    assert chamadas == [False], "verify_password rodou dentro do event loop"


async def test_troca_de_senha_com_a_atual_errada_SEM_parar_o_loop(monkeypatch) -> None:
    bcrypt_falso, chamadas = _espiao(False)
    monkeypatch.setattr(auth_service, "verify_password", bcrypt_falso)
    monkeypatch.setattr(auth_service, "change_password_limiter", _Freio())
    user = _user()

    with pytest.raises(ValidationError):
        await AuthService(_SessaoFalsa(user=user)).change_password(  # type: ignore[arg-type]
            user_id=user.id, current_password="errada", new_password="nova-senha-1"
        )

    assert chamadas == [False], "verify_password rodou dentro do event loop"


async def test_troca_de_senha_gera_o_hash_SEM_parar_o_loop(monkeypatch) -> None:
    confere, conferencias = _espiao(True)
    gera, hashes = _espiao("hash-novo")
    monkeypatch.setattr(auth_service, "verify_password", confere)
    monkeypatch.setattr(auth_service, "hash_password", gera)
    monkeypatch.setattr(auth_service, "change_password_limiter", _Freio())
    user = _user()

    await AuthService(_SessaoFalsa(user=user)).change_password(  # type: ignore[arg-type]
        user_id=user.id, current_password="atual", new_password="nova-senha-1"
    )

    assert user.password_hash == "hash-novo"
    assert conferencias == [False], "verify_password rodou dentro do event loop"
    assert hashes == [False], "hash_password rodou dentro do event loop"
