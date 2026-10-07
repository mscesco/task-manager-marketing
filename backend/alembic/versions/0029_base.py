"""base, base_column, base_row, base_view, base_change -- a Base (Spec 056, fatia B)

Revision ID: 0029_base
Revises: 0028_preferencias_de_notificacao
Create Date: 2026-10-07

A tabela que a equipe monta, como a base "Calendario geral" do Notion da
equipe de midia social. As CINCO tabelas entram aqui de uma vez, embora a
fatia B so de rota a base e a coluna: o deploy sobe a migration ANTES do
codigo, e uma migration por fatia seriam cinco deploys com ordem a lembrar.

    base          -- pertence a um TIME RAIZ (D6); `deleted_at` = 10 dias (D5)
    base_column   -- tipo numa lista fechada; opcoes em JSONB (Spec 025, D10)
    base_row      -- valores em JSONB POR ID DE COLUNA, nunca pelo nome
    base_view     -- visoes compartilhadas; uma `is_default` por base (D25)
    base_change   -- o diario do desfazer (D27): a acao, com o valor de antes

⚠️ OS NOMES DE UNIQUE E DE INDICE SAO OS DO MODELO (`app/db/models/bases.py`),
letra por letra: o portao de drift os compara pelo nome.

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO. As tabelas sao novas e o codigo
velho nunca as consulta -- subir a migration com o velho no ar e seguro.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0029_base"
down_revision: str | None = "0028_preferencias_de_notificacao"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TIPOS_DE_COLUNA = (
    "'title', 'text', 'number', 'date', 'select', 'multi_select', "
    "'person', 'link', 'checkbox'"
)


def _tenant(tabela: str) -> str:
    return f"""
    ALTER TABLE ONLY public.{tabela}
        ADD CONSTRAINT fk_{tabela}_workspace_id
        FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """


def _da_base(tabela: str) -> str:
    return f"""
    ALTER TABLE ONLY public.{tabela}
        ADD CONSTRAINT fk_{tabela}_base
        FOREIGN KEY (base_id, workspace_id)
        REFERENCES public.base(id, workspace_id) ON DELETE CASCADE;
    """


UPGRADE: tuple[str, ...] = (
    # ------------------------------------------------------------- base
    """
    CREATE TABLE public.base (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        team_id uuid NOT NULL,
        name character varying(120) NOT NULL,
        description text DEFAULT ''::text NOT NULL,
        created_by uuid NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        deleted_at timestamp with time zone,
        deleted_by uuid,
        CONSTRAINT pk_base PRIMARY KEY (id),
        CONSTRAINT uq_base_id_workspace UNIQUE (id, workspace_id)
    );
    """,
    _tenant("base"),
    """
    ALTER TABLE ONLY public.base
        ADD CONSTRAINT fk_base_team
        FOREIGN KEY (team_id, workspace_id)
        REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.base
        ADD CONSTRAINT fk_base_created_by
        FOREIGN KEY (created_by, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;
    """,
    "CREATE INDEX ix_base_workspace_team ON public.base (workspace_id, team_id);",
    # ------------------------------------------------------------- base_column
    f"""
    CREATE TABLE public.base_column (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        base_id uuid NOT NULL,
        name character varying(120) NOT NULL,
        type character varying(20) NOT NULL,
        options jsonb DEFAULT '[]'::jsonb NOT NULL,
        position integer NOT NULL,
        width integer,
        version integer DEFAULT 1 NOT NULL,
        deleted_at timestamp with time zone,
        deleted_by uuid,
        CONSTRAINT pk_base_column PRIMARY KEY (id),
        CONSTRAINT uq_base_column_id_workspace UNIQUE (id, workspace_id),
        CONSTRAINT ck_base_column_type CHECK (type IN ({TIPOS_DE_COLUNA}))
    );
    """,
    _tenant("base_column"),
    _da_base("base_column"),
    "CREATE INDEX ix_base_column_base ON public.base_column (base_id);",
    # ------------------------------------------------------------- base_row
    """
    CREATE TABLE public.base_row (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        base_id uuid NOT NULL,
        "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
        version integer DEFAULT 1 NOT NULL,
        created_by uuid NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        deleted_at timestamp with time zone,
        deleted_by uuid,
        CONSTRAINT pk_base_row PRIMARY KEY (id),
        CONSTRAINT uq_base_row_id_workspace UNIQUE (id, workspace_id)
    );
    """,
    _tenant("base_row"),
    _da_base("base_row"),
    """
    ALTER TABLE ONLY public.base_row
        ADD CONSTRAINT fk_base_row_created_by
        FOREIGN KEY (created_by, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;
    """,
    "CREATE INDEX ix_base_row_base ON public.base_row (base_id);",
    # ------------------------------------------------------------- base_view
    """
    CREATE TABLE public.base_view (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        base_id uuid NOT NULL,
        name character varying(120) NOT NULL,
        layout character varying(10) NOT NULL,
        config jsonb DEFAULT '{}'::jsonb NOT NULL,
        position integer NOT NULL,
        is_default boolean DEFAULT false NOT NULL,
        CONSTRAINT pk_base_view PRIMARY KEY (id),
        CONSTRAINT ck_base_view_layout CHECK (layout IN ('table', 'calendar', 'board'))
    );
    """,
    _tenant("base_view"),
    _da_base("base_view"),
    "CREATE INDEX ix_base_view_base ON public.base_view (base_id);",
    # ⚠️ D25: a visao padrao nao se apaga -- e so existe uma por base.
    """
    CREATE UNIQUE INDEX uq_base_view_um_padrao
        ON public.base_view (base_id) WHERE is_default;
    """,
    # ------------------------------------------------------------- base_change
    """
    CREATE TABLE public.base_change (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        base_id uuid NOT NULL,
        actor_id uuid NOT NULL,
        kind character varying(30) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        undone_at timestamp with time zone,
        CONSTRAINT pk_base_change PRIMARY KEY (id)
    );
    """,
    _tenant("base_change"),
    _da_base("base_change"),
    """
    ALTER TABLE ONLY public.base_change
        ADD CONSTRAINT fk_base_change_actor
        FOREIGN KEY (actor_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    CREATE INDEX ix_base_change_pilha
        ON public.base_change (base_id, actor_id, created_at);
    """,
)


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    # Os filhos antes da base: as FKs deles apontam para ela.
    for tabela in ("base_change", "base_view", "base_row", "base_column", "base"):
        op.execute(f"DROP TABLE IF EXISTS public.{tabela};")
