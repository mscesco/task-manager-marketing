"""notification -- o indice do sino segue a ordenacao de verdade

Revision ID: 0034_indice_do_sino
Revises: 0033_freio_no_banco
Create Date: 2026-11-11

Auditoria de 11/11, item 17: o sino e a pagina "Todas" ordenam por
`(updated_at DESC, id DESC)` desde a Spec 053, mas o indice continuava em
`(recipient_id, created_at DESC)`, e nenhuma leitura ordena por `created_at`.
Troca um pelo outro.

Ordem do deploy: indiferente. O codigo nao depende do indice, so fica mais
rapido com ele.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0034_indice_do_sino"
down_revision: str | None = "0033_freio_no_banco"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX ix_notification_recipient_updated "
        "ON notification (recipient_id, updated_at DESC, id DESC)"
    )
    op.execute("DROP INDEX idx_notification_recipient_created")


def downgrade() -> None:
    op.execute(
        "CREATE INDEX idx_notification_recipient_created "
        "ON notification (recipient_id, created_at DESC)"
    )
    op.execute("DROP INDEX ix_notification_recipient_updated")
