"""Testes da trava X-System-Token (puros, sem DB)."""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.modules.tasks.api.system_router import require_system_token
from app.shared.exceptions.base import AuthenticationError

TOKEN = "segredo-de-sistema-1234567890"


def test_token_correto_passa(monkeypatch):
    monkeypatch.setattr(settings, "system_api_token", TOKEN)
    # Nao levanta -> ok.
    assert require_system_token(x_system_token=TOKEN) is None


def test_token_errado_rejeita(monkeypatch):
    monkeypatch.setattr(settings, "system_api_token", TOKEN)
    with pytest.raises(AuthenticationError):
        require_system_token(x_system_token="errado")


def test_token_ausente_rejeita(monkeypatch):
    monkeypatch.setattr(settings, "system_api_token", TOKEN)
    with pytest.raises(AuthenticationError):
        require_system_token(x_system_token=None)


def test_sem_token_configurado_rejeita_tudo(monkeypatch):
    # Fail closed: SYSTEM_API_TOKEN vazio -> endpoint desligado.
    monkeypatch.setattr(settings, "system_api_token", "")
    with pytest.raises(AuthenticationError):
        require_system_token(x_system_token="qualquer")
    # E nao casa vazio-com-vazio.
    with pytest.raises(AuthenticationError):
        require_system_token(x_system_token="")
