"""backfill de terminal_since (Spec 035, fatia 2a)

Revision ID: 0009_backfill_terminal_since
Revises: 0008_boards_and_columns
Create Date: 2026-08-06

Fecha a JANELA aberta pela 0008. A 0008 preencheu `terminal_since` de todas as
tarefas terminais que existiam no instante em que rodou, e nada mais escreveu
nesse campo -- porque a escrita e esta fatia. Toda tarefa concluida ou
cancelada ENTRE o deploy da 0008 e o deploy desta fatia ficou com o campo NULL.

⚠️ ORDEM DE DEPLOY: CODIGO PRIMEIRO, DEPOIS ESTA MIGRATION. E a ordem padrao do
DEPLOY.md, e aqui ela nao e formalidade -- e o que fecha a janela de vez. Se a
migration rodasse antes, tudo que fosse concluido entre ela e o `up -d`
nasceria NULL de novo, e o proximo a olhar acharia que o backfill falhou.
(A 0008 foi o caso INVERSO, e por um motivo especifico: ela acrescentava coluna
mapeada em model existente. Esta so faz UPDATE.)

⚠️ ESTA MIGRATION NAO PODE MUDAR O QUE A VARREDURA SELECIONA HOJE. A formula e
copiada da 0008, caractere por caractere: COMPLETED por `completed_at` (com
`updated_at` de reserva para a concluida sem data, que hoje o job simplesmente
nao ve), CANCELLED por `updated_at`. Medido em producao em 06/08/2026:
concluidas sem `completed_at` = 0.

Restrita a `terminal_since IS NULL`: nao toca no que a 0008 ja gravou, nem no
que o codigo novo ja escreveu. E idempotente -- rodar duas vezes nao muda nada.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_backfill_terminal_since"
down_revision: str | None = "0008_boards_and_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conexao = op.get_bind()

    # SQL cru: e a convencao das migrations deste repo (ver 0005 e 0008).
    #
    # SEM filtro de `deleted_at` ou `is_archived`, de proposito. A varredura
    # ignora as duas, mas o campo e uma propriedade da LINHA, nao da consulta:
    # uma tarefa soft-deletada pode ser restaurada, e uma arquivada pode ser
    # desarquivada trazendo o status antigo (caminho conhecido, §7 do handoff).
    # Deixar essas linhas NULL seria plantar o mesmo defeito silencioso com
    # atraso.
    conexao.execute(
        sa.text(
            """
            UPDATE public.task
            SET terminal_since = CASE
                WHEN status = CAST('COMPLETED' AS public.task_status)
                    THEN COALESCE(completed_at, updated_at)
                ELSE updated_at
            END
            WHERE terminal_since IS NULL
              AND status IN (
                    CAST('COMPLETED' AS public.task_status),
                    CAST('CANCELLED' AS public.task_status)
                  )
            """
        )
    )

    # A invariante que o `test_terminal_since_so_nas_terminais` defende, medida
    # aqui tambem: nenhuma tarefa NAO-terminal com o relogio correndo. Se
    # aparecer, alguem escreveu o campo fora dos tres pontos previstos e a
    # varredura da fatia 2b arquivaria tarefa VIVA -- o unico defeito desta
    # spec que o usuario ve na hora.
    sobrando = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM public.task
            WHERE terminal_since IS NOT NULL
              AND status NOT IN (
                    CAST('COMPLETED' AS public.task_status),
                    CAST('CANCELLED' AS public.task_status)
                  )
            """
        )
    ).scalar_one()
    if sobrando:
        raise RuntimeError(
            f"[0009] {sobrando} tarefa(s) NAO-terminal com terminal_since "
            "preenchido. A fatia 2b arquivaria tarefa viva. Investigar antes "
            "de seguir -- esta migration nao criou esse estado."
        )

    faltando = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM public.task
            WHERE terminal_since IS NULL
              AND status IN (
                    CAST('COMPLETED' AS public.task_status),
                    CAST('CANCELLED' AS public.task_status)
                  )
            """
        )
    ).scalar_one()
    if faltando:
        raise RuntimeError(
            f"[0009] {faltando} tarefa(s) terminal(is) continuam sem "
            "terminal_since depois do backfill. Nao seguir para a fatia 2b."
        )


def downgrade() -> None:
    """No-op DELIBERADO, e a alternativa e destrutiva.

    O caminho de volta obvio -- `SET terminal_since = NULL` nas terminais --
    apagaria tambem o que o codigo novo gravou legitimamente, e o que a 0008
    gravou antes desta existir. Nao ha como distinguir as tres origens depois
    do fato.

    Nada le `terminal_since` ainda (a leitura e a fatia 2b), entao deixar os
    dados no lugar nao muda comportamento nenhum. Quem quiser desfazer a coluna
    inteira faz `downgrade` ate a 0008, que a dropa.
    """
