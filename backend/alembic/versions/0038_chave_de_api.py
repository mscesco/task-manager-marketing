"""api_key: chaves de API de cada pessoa (Spec 065)

Revision ID: 0038_chave_de_api
Revises: 0037_projeto_sem_prioridade
Create Date: 2026-11-19

A chave age como quem a criou. O banco guarda só o sha256 dela (`key_hash`,
único) e o começo (`prefix`) para a tela. Apagar a pessoa leva as chaves.

Ordem do deploy: migration ANTES do codigo. Aditiva: o codigo antigo ignora.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0038_chave_de_api"
down_revision: str | None = "0037_projeto_sem_prioridade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.api_key (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NOT NULL,
        name character varying(80) NOT NULL,
        prefix character varying(16) NOT NULL,
        key_hash character varying(64) NOT NULL,
        read_only boolean NOT NULL,
        expires_at timestamp with time zone,
        last_used_at timestamp with time zone,
        revoked_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    "ALTER TABLE ONLY public.api_key ADD CONSTRAINT api_key_pkey PRIMARY KEY (id);",
    "ALTER TABLE ONLY public.api_key ADD CONSTRAINT api_key_key_hash_key UNIQUE (key_hash);",
    """
    ALTER TABLE ONLY public.api_key
        ADD CONSTRAINT api_key_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.api_key
        ADD CONSTRAINT api_key_user FOREIGN KEY (user_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    "CREATE INDEX ix_api_key_user ON public.api_key USING btree (user_id);",
)


def upgrade() -> None:
    for sql in STATEMENTS:
        op.execute(sql)


def downgrade() -> None:
    op.execute("DROP TABLE public.api_key;")
