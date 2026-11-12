"""Geracao da senha provisoria. O ciclo de vida (gate, expiracao,
change_password) esta em `tests/integration/test_password_lifecycle_db.py`.
"""

from __future__ import annotations

from app.modules.auth.infrastructure.security import generate_temporary_password


def test_temporary_password_has_expected_length() -> None:
    assert len(generate_temporary_password()) == 18


def test_temporary_password_uses_unambiguous_alphabet() -> None:
    """Sem 0/O/1/l/I -- a provisoria e lida e digitada por humano."""
    forbidden = set("0O1lI")
    for _ in range(200):
        assert not (set(generate_temporary_password()) & forbidden)


def test_temporary_password_is_random() -> None:
    """Duas geracoes seguidas praticamente nunca colidem (CSPRNG)."""
    sample = {generate_temporary_password() for _ in range(500)}
    assert len(sample) == 500
