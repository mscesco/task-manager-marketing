"""deadline notification dedup flags (Spec 023, F1)

Revision ID: 0003_deadline_notif_flags
Revises: 0002_notifications
Create Date: 2026-07-01

Adiciona em `task` duas colunas de dedup do aviso de prazo:
  - due_soon_notified_for date -- due_date pra qual o aviso "2 dias" ja saiu;
  - overdue_notified_for  date -- due_date pra qual o aviso "atrasou" ja saiu.

O job de notificacao (Spec 023) so dispara se a coluna DIFERE do due_date atual
-> troca de prazo reabilita sozinho (self-healing). So o job escreve aqui.

BACKFILL ANTI-FLOOD (D4): seta as duas colunas = due_date pra TODAS as tasks
que ja tem due_date. Sem isso, a 1a execucao do job dispararia retroativo pra
toda task ja vencida/perto de vencer (enxurrada no dia do deploy). Com o
backfill, o recurso so notifica prazos cruzados DEPOIS do deploy.

DDL raw, no mesmo estilo da baseline/0002 (cada statement isolado).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_deadline_notif_flags"
down_revision: str | None = "0002_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


STATEMENTS: tuple[str, ...] = (
    """
    ALTER TABLE public.task
        ADD COLUMN due_soon_notified_for date;
    """,
    """
    ALTER TABLE public.task
        ADD COLUMN overdue_notified_for date;
    """,
    # Backfill anti-flood (D4): tasks existentes ja "avisadas" pro prazo atual.
    """
    UPDATE public.task
        SET due_soon_notified_for = due_date,
            overdue_notified_for = due_date
        WHERE due_date IS NOT NULL;
    """,
    """
    COMMENT ON COLUMN public.task.due_soon_notified_for IS
        'Spec 023: due_date pra qual o aviso de "2 dias" ja saiu (dedup). Difere do due_date atual => reabilita.';
    """,
    """
    COMMENT ON COLUMN public.task.overdue_notified_for IS
        'Spec 023: due_date pra qual o aviso de atraso ja saiu (dedup). Difere do due_date atual => reabilita.';
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("ALTER TABLE public.task DROP COLUMN IF EXISTS overdue_notified_for;")
    op.execute("ALTER TABLE public.task DROP COLUMN IF EXISTS due_soon_notified_for;")
