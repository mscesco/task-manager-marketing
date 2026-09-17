"""notification.updated_at + indice da juncao de avisos (Spec 053, fatia C)

Revision ID: 0027_juncao_de_avisos
Revises: 0026_anexo_de_projeto_e_tarefa
Create Date: 2026-09-17

A juncao de avisos (Spec 053, D18): avisos do mesmo autor, na mesma tarefa, do
mesmo tipo e para o mesmo destinatario, em ate 10 minutos e ainda NAO LIDOS,
viram UM aviso atualizado para o estado final -- ou somem, quando o estado
final e igual ao inicial (mover de A para B e de volta para A).

Duas coisas faltavam na tabela para isso:

  - `updated_at`: o aviso juntado precisa dizer QUANDO foi a ultima mudanca, e
    subir para o topo do sino. Nasce igual a `created_at` em toda linha que ja
    existe -- nenhuma notificacao antiga muda de posicao na lista.
  - o indice parcial que acha "o aviso nao lido deste autor, tarefa, tipo e
    destinatario": sem ele, cada mudanca de coluna faria uma varredura das
    notificacoes da pessoa. `WHERE read_at IS NULL` porque a juncao so olha
    as nao lidas -- e elas sao a minoria da tabela.

⚠️ O INDICE MORA SO AQUI, e nao no model: a convencao do projeto (ver
`alembic/env.py`, `include_object`) e que indice refletido sem par no model nao
gera drift. Mesma forma dos tres indices da `0002_notifications`.

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO. O codigo novo le e ordena por
`updated_at`; o velho nao sabe que a coluna existe e o `INSERT` dele cai no
DEFAULT. Rodar a migration com o codigo velho no ar e seguro.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0027_juncao_de_avisos"
down_revision: str | None = "0026_anexo_de_projeto_e_tarefa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.notification "
        "ADD COLUMN updated_at timestamp with time zone"
    )
    op.execute("UPDATE public.notification SET updated_at = created_at")
    op.execute(
        "ALTER TABLE public.notification "
        "ALTER COLUMN updated_at SET DEFAULT now(), "
        "ALTER COLUMN updated_at SET NOT NULL"
    )
    op.execute(
        """
        CREATE INDEX idx_notification_juncao
            ON public.notification
            USING btree (recipient_id, task_id, type, actor_id, updated_at)
            WHERE read_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_notification_juncao")
    op.execute("ALTER TABLE public.notification DROP COLUMN updated_at")
