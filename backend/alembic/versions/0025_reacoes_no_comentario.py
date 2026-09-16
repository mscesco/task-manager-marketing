"""comment_reaction -- reacoes no comentario (Spec 050, fatia A)

Revision ID: 0025_reacoes_no_comentario
Revises: 0024_sai_o_projeto_pessoal
Create Date: 2026-09-15

Cria a tabela `comment_reaction`: uma reacao por pessoa por comentario.

DDL raw, no mesmo estilo da `0002` (cada statement roda isolado).

Decisoes (spec 050):
  - `UNIQUE (comment_id, user_id)` -- "uma por pessoa" mora no BANCO (§4.2).
    O nome e citado pelo `ON CONFLICT` do repository; trocar aqui quebra la.
    Ele tambem cobre a busca por `comment_id` (coluna da esquerda), entao nao
    ha indice separado.
  - FKs COMPOSTAS com `workspace_id`, `ON DELETE CASCADE` para comentario e
    pessoa -- mesmo desenho do `task_watcher`.
  - SEM `deleted_at`: as reacoes seguem a marca do comentario (§4.6).
  - `emoji character varying(16)`: o maior emoji da biblioteca tem 10 code
    points, e o `varchar` conta caractere.
  - ⚠️ O COMMENT de `updated_at` e o do `TimestampMixin`, caractere a
    caractere. Sem ele, o portao de drift acusa divergencia entre o model e o
    banco.

⚠️ Aditiva: tabela nova, nenhuma linha existente muda. O `downgrade` derruba a
tabela -- e com ela as reacoes, que nao tem para onde voltar.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0025_reacoes_no_comentario"
down_revision: str | None = "0024_sai_o_projeto_pessoal"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.comment_reaction (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        comment_id uuid NOT NULL,
        user_id uuid NOT NULL,
        emoji character varying(16) NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    """
    ALTER TABLE ONLY public.comment_reaction
        ADD CONSTRAINT comment_reaction_pkey PRIMARY KEY (id);
    """,
    """
    ALTER TABLE ONLY public.comment_reaction
        ADD CONSTRAINT comment_reaction_workspace_id_fkey
        FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.comment_reaction
        ADD CONSTRAINT comment_reaction_comment
        FOREIGN KEY (comment_id, workspace_id)
        REFERENCES public.comment(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.comment_reaction
        ADD CONSTRAINT comment_reaction_user
        FOREIGN KEY (user_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.comment_reaction
        ADD CONSTRAINT uq_comment_reaction_comment_user
        UNIQUE (comment_id, user_id);
    """,
    """
    COMMENT ON COLUMN public.comment_reaction.updated_at IS
        'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.comment_reaction;")
