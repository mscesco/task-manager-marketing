"""Contagem dos freios de tentativa (`core/rate_limit.py`), no banco para
valer entre os workers.

Uma linha por tentativa. Sem tenant: a chave ja separa (e-mail + workspace,
id da pessoa ou IP). Cada registro novo apaga os vencidos do balde.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RateLimitHit(Base):
    """Uma tentativa registrada num balde (`bucket`) para uma `key`."""

    __tablename__ = "rate_limit_hit"
    __table_args__ = (
        Index("ix_rate_limit_hit_bucket_key_at", "bucket", "key", "at"),
        Index("ix_rate_limit_hit_bucket_at", "bucket", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    bucket: Mapped[str] = mapped_column(String(40), nullable=False)
    key: Mapped[str] = mapped_column(String(400), nullable=False)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("clock_timestamp()")
    )
