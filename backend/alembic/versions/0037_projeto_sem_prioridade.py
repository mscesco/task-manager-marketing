"""project -- sai a prioridade (a categoria e as tags tomam o lugar)

Revision ID: 0037_projeto_sem_prioridade
Revises: 0036_categoria_e_tag_de_projeto
Create Date: 2026-11-19

So a coluna de `project`; o tipo `priority_level` continua (a tarefa usa).

Ordem do deploy: codigo ANTES da migration (o codigo antigo le a coluna).
O `downgrade` recria a coluna com MEDIUM em todos: o valor antigo se perde
(o backup diario guarda).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0037_projeto_sem_prioridade"
down_revision: str | None = "0036_categoria_e_tag_de_projeto"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.project DROP COLUMN priority;")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.project ADD COLUMN priority public.priority_level "
        "DEFAULT 'MEDIUM'::public.priority_level NOT NULL;"
    )
