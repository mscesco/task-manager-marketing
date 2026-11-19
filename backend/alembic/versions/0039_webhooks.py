"""webhook e webhook_delivery (Spec 065)

Revision ID: 0039_webhooks
Revises: 0038_chave_de_api
Create Date: 2026-11-19

Webhook de cada pessoa: time (com os subtimes), quadro opcional, eventos e o
segredo da assinatura. `webhook_delivery` guarda as ultimas entregas de cada um.
Apagar a pessoa, o time ou o quadro leva os webhooks.

Ordem do deploy: migration ANTES do codigo. Aditiva: o codigo antigo ignora.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0039_webhooks"
down_revision: str | None = "0038_chave_de_api"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.webhook (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NOT NULL,
        team_id uuid NOT NULL,
        board_id uuid,
        url character varying(500) NOT NULL,
        secret character varying(64) NOT NULL,
        events character varying(40)[] NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        consecutive_failures integer DEFAULT 0 NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    "ALTER TABLE ONLY public.webhook ADD CONSTRAINT webhook_pkey PRIMARY KEY (id);",
    """
    ALTER TABLE ONLY public.webhook
        ADD CONSTRAINT webhook_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.webhook
        ADD CONSTRAINT webhook_user FOREIGN KEY (user_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.webhook
        ADD CONSTRAINT webhook_team FOREIGN KEY (team_id, workspace_id)
        REFERENCES public.team(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.webhook
        ADD CONSTRAINT webhook_board FOREIGN KEY (board_id, workspace_id)
        REFERENCES public.board(id, workspace_id) ON DELETE CASCADE;
    """,
    "CREATE INDEX ix_webhook_workspace ON public.webhook USING btree (workspace_id);",
    "CREATE INDEX ix_webhook_user ON public.webhook USING btree (user_id);",
    """
    COMMENT ON COLUMN public.webhook.updated_at IS
        'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';
    """,
    """
    CREATE TABLE public.webhook_delivery (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        webhook_id uuid NOT NULL,
        event character varying(40) NOT NULL,
        status_code integer,
        error character varying(300),
        duration_ms integer NOT NULL,
        delivered_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    "ALTER TABLE ONLY public.webhook_delivery ADD CONSTRAINT webhook_delivery_pkey PRIMARY KEY (id);",
    """
    ALTER TABLE ONLY public.webhook_delivery
        ADD CONSTRAINT webhook_delivery_webhook_id_fkey FOREIGN KEY (webhook_id)
        REFERENCES public.webhook(id) ON DELETE CASCADE;
    """,
    """
    CREATE INDEX ix_webhook_delivery_webhook_at
        ON public.webhook_delivery USING btree (webhook_id, delivered_at);
    """,
)


def upgrade() -> None:
    for sql in STATEMENTS:
        op.execute(sql)


def downgrade() -> None:
    op.execute("DROP TABLE public.webhook_delivery;")
    op.execute("DROP TABLE public.webhook;")
