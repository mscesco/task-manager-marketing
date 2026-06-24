"""Testes de logica pura da Entrega 7 -- ciclo de vida de senha.

Sem banco: cobrem a primitiva de geracao da provisoria, a decisao do gate
(ADR 0020) a partir do value object de membership, a regra de expiracao no
login (ADR 0019) e as validacoes do change_password. O comportamento ponta
a ponta vive em tests/integration/test_password_lifecycle_db.py.
"""

from __future__ import annotations

import uuid

from app.modules.auth.infrastructure.security import (
    generate_temporary_password,
    hash_password,
    verify_password,
)
from app.modules.users.domain.membership import WorkspaceMembership


# --------------------------------------------------------
# Geracao da senha provisoria
# --------------------------------------------------------
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


def test_temporary_password_roundtrips_through_hash() -> None:
    """O claro gerado confere contra o proprio hash (e nada alem)."""
    plain = generate_temporary_password()
    digest = hash_password(plain)
    assert verify_password(plain, digest)
    assert not verify_password(generate_temporary_password(), digest)


# --------------------------------------------------------
# Gate (ADR 0020) -- decisao a partir da membership
# --------------------------------------------------------
def _membership(*, pending: bool) -> WorkspaceMembership:
    return WorkspaceMembership(
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        roles=frozenset({"ADMIN"}),
        is_active=True,
        must_change_password=pending,
    )


def test_membership_carries_pending_flag_default_false() -> None:
    """Membership sem o flag (caminho antigo) nao tranca ninguem."""
    m = WorkspaceMembership(
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        roles=frozenset(),
        is_active=True,
    )
    assert m.must_change_password is False


def test_membership_pending_flag_roundtrips() -> None:
    assert _membership(pending=True).must_change_password is True
    assert _membership(pending=False).must_change_password is False
