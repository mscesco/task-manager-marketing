"""solicitation_section.repeatable e repeat_label -- secao repetivel (Spec 059)

Revision ID: 0030_secao_repetivel
Revises: 0029_base
Create Date: 2026-10-15

Uma secao que a pessoa preenche MAIS DE UMA VEZ no mesmo envio (varios
eventos, por exemplo). Cada repeticao vira uma solicitacao propria no lote.

    repeatable    -- a secao aceita repeticao (padrao: nao)
    repeat_label  -- o que o botao diz: "+ Adicionar outro <repeat_label>"

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO. As duas colunas tem default, e o
codigo velho nunca as le -- subir a migration com o velho no ar e seguro.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_secao_repetivel"
down_revision: str | None = "0029_base"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "solicitation_section",
        sa.Column(
            "repeatable", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "solicitation_section",
        sa.Column("repeat_label", sa.String(length=60), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("solicitation_section", "repeat_label")
    op.drop_column("solicitation_section", "repeatable")
