"""Primitivas de seguranca: hashing de senha e JWT.

Este modulo e PURO -- nao conhece FastAPI, nao toca no
banco. So criptografia e tokens. Fica facil de testar e de
reaproveitar (ex. em um worker que precise validar token).

JWT: a foundation emite DOIS tipos de token desde o inicio:
    - access  : curto (minutos). Vai em toda requisicao.
    - refresh : longo (dias). So serve para obter novo access.
Cada token carrega um claim `type` -- um access token NUNCA
e aceito onde se espera refresh, e vice-versa.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.shared.exceptions.base import AuthenticationError

# bcrypt: padrao solido para hashing de senha.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


# --------------------------------------------------------
# Senhas
# --------------------------------------------------------
def hash_password(plain_password: str) -> str:
    """Gera o hash bcrypt de uma senha em texto puro."""
    return _pwd_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Confere uma senha contra seu hash. Nunca lanca -- retorna bool."""
    return _pwd_context.verify(plain_password, password_hash)


# Alfabeto sem caracteres ambiguos (sem 0/O, 1/l/I) -- a provisoria
# e lida e digitada por humano na entrega manual (ADR 0019/0021).
_TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
#: 14 chars sobre 56 simbolos => log2(56)*14 ~= 81 bits. Aumentado para
#: 18 chars => ~104 bits, acima do piso de 96 bits exigido na spec.
_TEMP_PASSWORD_LENGTH = 18


def generate_temporary_password() -> str:
    """Gera uma senha provisoria aleatoria de alta entropia (~104 bits).

    Usa `secrets` (CSPRNG), nunca `random`. Alfabeto sem caracteres
    ambiguos. Retorna o claro -- quem chama hasheia com hash_password e
    devolve o claro UMA vez na resposta (ADR 0021). O claro nunca e
    persistido.
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

    Claims padrao:
        sub  : id do usuario
        ws   : id do workspace (tenant) -- usado pelo middleware
        type : access | refresh
        iat  : emitido em
        exp  : expira em
        jti  : id unico do token (permite revogacao futura)
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
    *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> str:
    """Cria um access token (curta duracao)."""
    return _create_token(
        subject=user_id,
        workspace_id=workspace_id,
        token_type=TokenType.ACCESS,
        expires_delta=timedelta(minutes=settings.jwt_access_token_expire_minutes),
    )


def create_refresh_token(
    *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> str:
    """Cria um refresh token (longa duracao)."""
    return _create_token(
        subject=user_id,
        workspace_id=workspace_id,
        token_type=TokenType.REFRESH,
        expires_delta=timedelta(days=settings.jwt_refresh_token_expire_days),
    )


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Decodifica e valida um JWT.

    Verifica assinatura, expiracao e o claim `type`. Qualquer
    falha vira AuthenticationError -- a camada de API traduz
    para HTTP 401.
    """
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
