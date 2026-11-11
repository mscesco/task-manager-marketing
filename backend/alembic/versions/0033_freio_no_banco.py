"""rate_limit_hit -- a contagem dos freios de tentativa sai da memoria

Revision ID: 0033_freio_no_banco
Revises: 0032_reparo_path_projeto
Create Date: 2026-11-11

Auditoria de 11/11, item 10: producao sobe dois workers, e cada um contava
os freios (login por conta, troca de senha, formulario publico, coletor de
erros) na propria memoria -- o limite real era ate o dobro, e o deploy zerava.

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO. O codigo novo grava nesta
tabela em todo login; o velho nao sabe que ela existe.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_freio_no_banco"
down_revision: str | None = "0032_reparo_path_projeto"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_hit",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("bucket", sa.String(40), nullable=False),
        sa.Column("key", sa.String(400), nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
    )
    op.create_index(
        "ix_rate_limit_hit_bucket_key_at", "rate_limit_hit", ["bucket", "key", "at"]
    )
    op.create_index("ix_rate_limit_hit_bucket_at", "rate_limit_hit", ["bucket", "at"])


def downgrade() -> None:
    op.drop_table("rate_limit_hit")
