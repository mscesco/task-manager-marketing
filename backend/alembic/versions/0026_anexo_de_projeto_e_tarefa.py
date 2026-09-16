"""attachment -- anexo de PROJETO e de TAREFA, link ou arquivo (Spec 052, fatia B)

Revision ID: 0026_anexo_de_projeto_e_tarefa
Revises: 0025_reacoes_no_comentario
Create Date: 2026-09-16

⚠️⚠️ REFORMA A TABELA `attachment`, E NAO CRIA OUTRA -- decisao da Camila
(16/09, *"nao da pra usar attachments?"*). A tabela veio do schema v5 para
"anexo de arquivo de tarefa" e NUNCA foi usada: nenhuma rota, servico ou tela
lia ou gravava nela. Medido por ela no Adminer de producao em 16/09:
`SELECT count(*) FROM attachment` = **0**.

Do jeito que estava, nao servia para link: `task_id`, `mime_type`,
`file_size` e `storage_key` obrigatorios, sem `project_id` e sem ordem. Esta
migration a transforma em ANEXO GENERICO:

  - dono: `task_id` OU `project_id`, exatamente um (CHECK);
  - `kind`: `LINK` ou `FILE` (CHECK) -- hoje so LINK e gravado; FILE fica com
    as colunas de arquivo, para o dia do upload cair na mesma lista;
  - `file_name` vira `title` (o nome que aparece);
  - `url` nova, ate 2048; obrigatoria para LINK (CHECK);
  - colunas de arquivo passam a opcionais, obrigatorias para FILE (CHECK);
  - `position` nova (a ordem da lista);
  - FKs de dono com `ON DELETE CASCADE` (a da tarefa era RESTRICT): o anexo
    segue o dono. Tarefa e projeto sao soft-delete; o cascade so vale para
    apagar DE VERDADE, e ai o anexo nao pode segurar a linha.

⚠️⚠️ A TRAVA DE TABELA VAZIA. Tornar colunas opcionais e renomear so e barato
porque nao ha linha nenhuma. O primeiro statement recusa subir se houver --
com a mensagem dizendo por que -- em vez de reformar dado que ninguem conferiu.

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO. O codigo novo le a tabela
reformada (links do projeto e da tarefa); o velho nunca a consulta, entao
rodar a migration com o velho no ar e seguro. Escrito no DEPLOY.md.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0026_anexo_de_projeto_e_tarefa"
down_revision: str | None = "0025_reacoes_no_comentario"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _trava_de_tabela_vazia(mensagem: str) -> str:
    """Recusa seguir se `attachment` tiver qualquer linha, dizendo por que."""
    return f"""
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM public.attachment) THEN
            RAISE EXCEPTION '{mensagem}';
        END IF;
    END $$;
    """


UPGRADE: tuple[str, ...] = (
    _trava_de_tabela_vazia(
        "A tabela attachment tem linhas, e a 0026 so reforma a tabela vazia "
        "(renomeia file_name e afrouxa as colunas de arquivo). Confira de onde "
        "vieram antes de subir."
    ),
    # --- o dono: tarefa OU projeto
    "ALTER TABLE public.attachment ALTER COLUMN task_id DROP NOT NULL;",
    "ALTER TABLE public.attachment ADD COLUMN project_id uuid;",
    "ALTER TABLE public.attachment DROP CONSTRAINT fk_attachment_task;",
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT fk_attachment_task
        FOREIGN KEY (task_id, workspace_id)
        REFERENCES public.task(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT fk_attachment_project
        FOREIGN KEY (project_id, workspace_id)
        REFERENCES public.project(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT chk_attachment_um_dono
        CHECK ((task_id IS NULL) <> (project_id IS NULL));
    """,
    """
    CREATE INDEX idx_attachment_project
        ON public.attachment USING btree (workspace_id, project_id);
    """,
    # --- link ou arquivo
    "ALTER TABLE public.attachment RENAME COLUMN file_name TO title;",
    "ALTER TABLE public.attachment ADD COLUMN kind character varying(10) NOT NULL;",
    "ALTER TABLE public.attachment ADD COLUMN url character varying(2048);",
    "ALTER TABLE public.attachment ALTER COLUMN storage_key DROP NOT NULL;",
    "ALTER TABLE public.attachment ALTER COLUMN mime_type DROP NOT NULL;",
    "ALTER TABLE public.attachment ALTER COLUMN file_size DROP NOT NULL;",
    "ALTER TABLE public.attachment ADD COLUMN position integer DEFAULT 0 NOT NULL;",
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT chk_attachment_kind
        CHECK (kind IN ('LINK', 'FILE'));
    """,
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT chk_attachment_campos_do_tipo
        CHECK (
            (kind = 'LINK' AND url IS NOT NULL AND storage_key IS NULL)
            OR
            (kind = 'FILE' AND url IS NULL AND storage_key IS NOT NULL
             AND mime_type IS NOT NULL AND file_size IS NOT NULL)
        );
    """,
)


DOWNGRADE: tuple[str, ...] = (
    # ⚠️ A mesma trava na descida: voltar ao formato antigo com LINKs gravados
    # os perderia (link nao tem `storage_key`, e ela volta a ser obrigatoria).
    _trava_de_tabela_vazia(
        "A tabela attachment tem linhas, e descer a 0026 perderia os links "
        "(link nao tem storage_key). Resolva os anexos antes de descer."
    ),
    "ALTER TABLE public.attachment DROP CONSTRAINT chk_attachment_campos_do_tipo;",
    "ALTER TABLE public.attachment DROP CONSTRAINT chk_attachment_kind;",
    "ALTER TABLE public.attachment DROP COLUMN position;",
    "ALTER TABLE public.attachment ALTER COLUMN file_size SET NOT NULL;",
    "ALTER TABLE public.attachment ALTER COLUMN mime_type SET NOT NULL;",
    "ALTER TABLE public.attachment ALTER COLUMN storage_key SET NOT NULL;",
    "ALTER TABLE public.attachment DROP COLUMN url;",
    "ALTER TABLE public.attachment DROP COLUMN kind;",
    "ALTER TABLE public.attachment RENAME COLUMN title TO file_name;",
    "DROP INDEX public.idx_attachment_project;",
    "ALTER TABLE public.attachment DROP CONSTRAINT chk_attachment_um_dono;",
    "ALTER TABLE public.attachment DROP CONSTRAINT fk_attachment_project;",
    "ALTER TABLE public.attachment DROP CONSTRAINT fk_attachment_task;",
    """
    ALTER TABLE ONLY public.attachment
        ADD CONSTRAINT fk_attachment_task
        FOREIGN KEY (task_id, workspace_id)
        REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;
    """,
    "ALTER TABLE public.attachment DROP COLUMN project_id;",
    "ALTER TABLE public.attachment ALTER COLUMN task_id SET NOT NULL;",
)


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
