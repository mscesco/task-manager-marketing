"""notification table (Spec 018, F1)

Revision ID: 0002_notifications
Revises: 0001_baseline_v5
Create Date: 2026-06-26

Cria a tabela `notification` (notificacoes in-app pessoais).

DDL raw, no mesmo estilo da baseline (cada statement roda isolado).
Decisoes (Spec 018):
  - `type` character varying(40) -- String, nao enum (tipo novo no futuro
    nao exige ALTER TYPE);
  - `payload` jsonb -- snapshot de exibicao capturado na emissao (D1);
  - FK rigida SO em recipient (composta id, workspace_id -> users) e em
    workspace; task_id/comment_id/actor_id ficam SEM FK de proposito --
    a notificacao e registro historico que sobrevive a task/comentario
    sumir (D2);
  - indices: (recipient_id, read_at) p/ contagem de nao-lidas e
    (recipient_id, created_at DESC) p/ o feed.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_notifications"
down_revision: str | None = "0001_baseline_v5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Cada statement isolado (mesma estrategia da baseline: o caminho online
# com asyncpg roda um comando por execute).
STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.notification (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        recipient_id uuid NOT NULL,
        actor_id uuid,
        type character varying(40) NOT NULL,
        task_id uuid,
        comment_id uuid,
        payload jsonb,
        read_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    """
    ALTER TABLE ONLY public.notification
        ADD CONSTRAINT notification_pkey PRIMARY KEY (id);
    """,
    """
    ALTER TABLE ONLY public.notification
        ADD CONSTRAINT fk_notification_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.notification
        ADD CONSTRAINT fk_notification_recipient
        FOREIGN KEY (recipient_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    CREATE INDEX idx_notification_recipient_unread
        ON public.notification USING btree (recipient_id, read_at);
    """,
    """
    CREATE INDEX idx_notification_recipient_created
        ON public.notification USING btree (recipient_id, created_at DESC);
    """,
    """
    CREATE INDEX idx_notification_workspace
        ON public.notification USING btree (workspace_id);
    """,
    """
    COMMENT ON TABLE public.notification IS
        'Notificacoes in-app pessoais (Spec 018). type via String; payload JSONB com snapshot de exibicao; task_id/comment_id/actor_id sem FK (registro historico que sobrevive a task/comentario sumir).';
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.notification;")
