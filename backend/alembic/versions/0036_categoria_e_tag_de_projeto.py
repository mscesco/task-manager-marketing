"""project_category, project_tag, project_tag_link e project.category_id

Revision ID: 0036_categoria_e_tag_de_projeto
Revises: 0035_pedido_exige_formulario
Create Date: 2026-11-19

Categoria (uma por projeto) e tags (varias) do time raiz do projeto, com nome e
cor. Nome unico por time; "Evento" x "evento" e recusado no servico.

`project.category_id` com FK RESTRICT: apagar a categoria solta os projetos no
servico antes. Apagar a tag leva os vinculos (CASCADE).

Ordem do deploy: migration ANTES do codigo (o codigo novo le as tabelas).
Aditiva: o codigo antigo ignora tudo isto.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0036_categoria_e_tag_de_projeto"
down_revision: str | None = "0035_pedido_exige_formulario"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _rotulo(tabela: str) -> tuple[str, ...]:
    return (
        f"""
        CREATE TABLE public.{tabela} (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            workspace_id uuid NOT NULL,
            team_id uuid NOT NULL,
            name character varying(60) NOT NULL,
            color character varying(16) NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL
        );
        """,
        f"ALTER TABLE ONLY public.{tabela} ADD CONSTRAINT {tabela}_pkey PRIMARY KEY (id);",
        f"""
        ALTER TABLE ONLY public.{tabela}
            ADD CONSTRAINT {tabela}_workspace_id_fkey FOREIGN KEY (workspace_id)
            REFERENCES public.workspace(id) ON DELETE RESTRICT;
        """,
        f"""
        ALTER TABLE ONLY public.{tabela}
            ADD CONSTRAINT {tabela}_team FOREIGN KEY (team_id, workspace_id)
            REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;
        """,
        f"""
        ALTER TABLE ONLY public.{tabela}
            ADD CONSTRAINT uq_{tabela}_id_workspace UNIQUE (id, workspace_id);
        """,
        f"""
        ALTER TABLE ONLY public.{tabela}
            ADD CONSTRAINT uq_{tabela}_team_name UNIQUE (team_id, name);
        """,
        f"""
        COMMENT ON COLUMN public.{tabela}.updated_at IS
            'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';
        """,
    )


STATEMENTS: tuple[str, ...] = (
    *_rotulo("project_category"),
    *_rotulo("project_tag"),
    """
    CREATE TABLE public.project_tag_link (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        tag_id uuid NOT NULL
    );
    """,
    "ALTER TABLE ONLY public.project_tag_link ADD CONSTRAINT project_tag_link_pkey PRIMARY KEY (id);",
    """
    ALTER TABLE ONLY public.project_tag_link
        ADD CONSTRAINT project_tag_link_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.project_tag_link
        ADD CONSTRAINT project_tag_link_project FOREIGN KEY (project_id, workspace_id)
        REFERENCES public.project(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.project_tag_link
        ADD CONSTRAINT project_tag_link_tag FOREIGN KEY (tag_id, workspace_id)
        REFERENCES public.project_tag(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.project_tag_link
        ADD CONSTRAINT uq_project_tag_link UNIQUE (project_id, tag_id);
    """,
    "CREATE INDEX ix_project_tag_link_tag ON public.project_tag_link (tag_id);",
    "ALTER TABLE public.project ADD COLUMN category_id uuid;",
    """
    ALTER TABLE ONLY public.project
        ADD CONSTRAINT project_category_fk FOREIGN KEY (category_id, workspace_id)
        REFERENCES public.project_category(id, workspace_id) ON DELETE RESTRICT;
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("ALTER TABLE public.project DROP CONSTRAINT IF EXISTS project_category_fk;")
    op.execute("ALTER TABLE public.project DROP COLUMN IF EXISTS category_id;")
    op.execute("DROP TABLE IF EXISTS public.project_tag_link;")
    op.execute("DROP TABLE IF EXISTS public.project_tag;")
    op.execute("DROP TABLE IF EXISTS public.project_category;")
