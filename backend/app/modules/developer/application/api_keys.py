"""Chaves de API (Spec 065): criar, listar, revogar e reconhecer na requisição.

A chave age como a pessoa que a criou: quem a reconhece é o `get_tenant_context`,
que depois aplica as mesmas regras do login (ativa, no workspace, permissões).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import TenantContext
from app.db.models import ApiKey
from app.shared.exceptions.base import (
    AuthenticationError,
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)

PREFIXO = "tm_"
MAX_ATIVAS = 10
#: Dias de validade aceitos; `None` = sem validade.
VALIDADES: frozenset[int | None] = frozenset({30, 90, 365, None})
#: De quanto em quanto tempo o "usada por último" se grava (não a cada chamada).
_INTERVALO_DO_USO = timedelta(minutes=1)


def hash_da(chave: str) -> str:
    """sha256 basta: a chave tem 256 bits aleatórios, não é senha."""
    return hashlib.sha256(chave.encode()).hexdigest()


def _ativa(agora: datetime):
    return (ApiKey.revoked_at.is_(None)) & (
        ApiKey.expires_at.is_(None) | (ApiKey.expires_at > agora)
    )


async def listar(session: AsyncSession, ctx: TenantContext) -> list[ApiKey]:
    """As chaves não revogadas da pessoa (as expiradas aparecem, marcadas pela data)."""
    r = await session.execute(
        select(ApiKey)
        .where(
            ApiKey.workspace_id == ctx.workspace_id,
            ApiKey.user_id == ctx.user_id,
            ApiKey.revoked_at.is_(None),
        )
        .order_by(ApiKey.created_at.desc())
    )
    return list(r.scalars())


async def criar(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    name: str,
    read_only: bool,
    days: int | None,
) -> tuple[ApiKey, str]:
    """Cria e devolve a chave em claro, que não se guarda nem se mostra de novo."""
    nome = name.strip()
    if not nome:
        raise ValidationError("Dê um nome à chave.")
    if days not in VALIDADES:
        raise ValidationError("Validade inválida: 30, 90 ou 365 dias, ou sem validade.")
    agora = datetime.now(UTC)
    ativas = await session.scalar(
        select(func.count()).select_from(ApiKey).where(
            ApiKey.user_id == ctx.user_id, _ativa(agora)
        )
    )
    if (ativas or 0) >= MAX_ATIVAS:
        raise BusinessRuleError(
            f"Você já tem {MAX_ATIVAS} chaves ativas. Revogue uma para criar outra."
        )
    chave = PREFIXO + secrets.token_urlsafe(32)
    registro = ApiKey(
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        name=nome,
        prefix=chave[:10],
        key_hash=hash_da(chave),
        read_only=read_only,
        expires_at=agora + timedelta(days=days) if days else None,
    )
    session.add(registro)
    await session.flush()
    await session.refresh(registro)
    return registro, chave


async def revogar(session: AsyncSession, ctx: TenantContext, key_id: uuid.UUID) -> None:
    """Só a dona revoga. Chave de outra pessoa responde como inexistente."""
    registro = await session.scalar(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == ctx.user_id,
            ApiKey.workspace_id == ctx.workspace_id,
            ApiKey.revoked_at.is_(None),
        )
    )
    if registro is None:
        raise EntityNotFoundError("Chave de API", identifier=key_id)
    registro.revoked_at = datetime.now(UTC)
    await session.flush()


@dataclass(frozen=True, slots=True)
class ChaveReconhecida:
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    read_only: bool


async def reconhecer(session: AsyncSession, chave: str) -> ChaveReconhecida:
    """A chave do cabeçalho, se vale. Revogada, expirada ou desconhecida: 401 igual."""
    agora = datetime.now(UTC)
    registro = await session.scalar(
        select(ApiKey).where(ApiKey.key_hash == hash_da(chave), _ativa(agora))
    )
    if registro is None:
        raise AuthenticationError("Chave de API inválida, revogada ou expirada.")
    # Lido antes do commit: depois dele o objeto expira e reler seria outra ida ao banco.
    reconhecida = ChaveReconhecida(registro.user_id, registro.workspace_id, registro.read_only)
    if registro.last_used_at is None or agora - registro.last_used_at > _INTERVALO_DO_USO:
        # A sessão ainda está limpa (nada da rota rodou): gravar aqui não leva carona.
        await session.execute(
            update(ApiKey).where(ApiKey.id == registro.id).values(last_used_at=agora)
        )
        await session.commit()
    return reconhecida
