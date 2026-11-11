"""Contagem dos freios de tentativa (auditoria de 11/11, item 10).

Os freios moravam na memoria de cada processo, e producao sobe DOIS workers:
cada um contava sozinho, o limite real era ate o dobro do configurado, e todo
deploy zerava a contagem. Aqui a contagem e uma so, no banco.

Uma linha por tentativa que conta, como os timestamps da janela deslizante
em memoria. SEM tenant: a chave ja carrega o que separa (e-mail + workspace,
id da pessoa ou IP), e as rotas publicas nem tem workspace. A tabela fica do
tamanho da janela -- cada registro novo apaga os vencidos do mesmo balde.
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
