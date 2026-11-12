"""Primitivas de seguranca: hashing de senha e JWT (sem FastAPI, sem banco).

Dois tipos de token, distinguidos pelo claim `type`: access (curto) e
refresh (longo, so serve para obter novo access).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import bcrypt
import jwt

from app.core.config import settings
from app.shared.exceptions.base import AuthenticationError

#: O bcrypt so le os primeiros 72 bytes, e o `bcrypt` 5 recusa senha maior:
#: cortar aqui mantem os hashes antigos validos e evita 500 em senha longa.
_BCRYPT_MAX_BYTES = 72


def _senha_em_bytes(plain_password: str) -> bytes:
    return plain_password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


# --------------------------------------------------------
# Senhas
# --------------------------------------------------------
def hash_password(plain_password: str) -> str:
    """Gera o hash bcrypt (`$2b$`, custo 12), compativel com os do `passlib`."""
    return bcrypt.hashpw(_senha_em_bytes(plain_password), bcrypt.gensalt()).decode("ascii")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Confere uma senha contra seu hash. Nunca lanca -- retorna bool."""
    try:
        return bcrypt.checkpw(_senha_em_bytes(plain_password), password_hash.encode("ascii"))
    except ValueError:  # hash que nao e bcrypt (vazio, corrompido)
        return False


# Sem caracteres ambiguos (0/O, 1/l/I): a provisoria e digitada por humano.
_TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
#: 18 chars sobre 56 simbolos => ~104 bits, acima do piso de 96.
_TEMP_PASSWORD_LENGTH = 18


def generate_temporary_password() -> str:
    """Gera uma senha provisoria aleatoria (~104 bits, via `secrets`).

    O claro e devolvido uma vez na resposta e nunca persistido.
    """
    return "".join(
        secrets.choice(_TEMP_PASSWORD_ALPHABET)
        for _ in range(_TEMP_PASSWORD_LENGTH)
    )


# --------------------------------------------------------
# JWT
# --------------------------------------------------------
def _create_token(
    *,
    subject: uuid.UUID,
    workspace_id: uuid.UUID,
    token_type: TokenType,
    expires_delta: timedelta,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Monta e assina um JWT.

    Claims: sub (usuario), ws (workspace), type, iat, exp, jti (ainda sem uso)
    e, via extra_claims, tv (token_version na emissao).
    """
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "ws": str(workspace_id),
        "type": token_type.value,
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def create_access_token(
    *, user_id: uuid.UUID, workspace_id: uuid.UUID, token_version: int = 0
) -> str:
    """Cria um access token (curta duracao), com o claim `tv`."""
    return _create_token(
        subject=user_id,
        workspace_id=workspace_id,
        token_type=TokenType.ACCESS,
        expires_delta=timedelta(minutes=settings.jwt_access_token_expire_minutes),
        extra_claims={"tv": token_version},
    )


def create_refresh_token(
    *, user_id: uuid.UUID, workspace_id: uuid.UUID, token_version: int = 0
) -> str:
    """Cria um refresh token (longa duracao)."""
    return _create_token(
        subject=user_id,
        workspace_id=workspace_id,
        token_type=TokenType.REFRESH,
        expires_delta=timedelta(days=settings.jwt_refresh_token_expire_days),
        extra_claims={"tv": token_version},
    )


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Valida assinatura, expiracao e `type`; qualquer falha vira 401."""
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Token expirado.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Token invalido.") from exc

    if payload.get("type") != expected_type.value:
        raise AuthenticationError(
            f"Tipo de token invalido (esperado: {expected_type.value})."
        )
    return payload


def token_version_of(payload: dict[str, Any]) -> int:
    """Le o claim `tv` de um payload ja decodificado; sem ele o token e invalido."""
    valor = payload.get("tv")
    if not isinstance(valor, int):
        raise AuthenticationError("Token invalido.")
    return valor
