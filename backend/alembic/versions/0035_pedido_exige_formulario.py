"""solicitation -- todo pedido tem formulario (form_id obrigatorio, com FK)

Revision ID: 0035_pedido_exige_formulario
Revises: 0034_indice_do_sino
Create Date: 2026-11-12

O time do pedido e o do formulario. Falha se houver pedido sem formulario ou
apontando para formulario inexistente; conferir antes do deploy.

Ordem do deploy: codigo antes da migration.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0035_pedido_exige_formulario"
down_revision: str | None = "0034_indice_do_sino"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("solicitation", "form_id", nullable=False)
    op.create_foreign_key(
        "solicitation_form_fk",
        "solicitation",
        "solicitation_form",
        ["form_id", "workspace_id"],
        ["id", "workspace_id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("solicitation_form_fk", "solicitation", type_="foreignkey")
    op.alter_column("solicitation", "form_id", nullable=True)
