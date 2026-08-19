"""hora opcional no prazo da tarefa (Spec 038, fatia B)

Revision ID: 0014_task_due_time
Revises: 0013_board_nome_unico_por_time
Create Date: 2026-08-18

Ate aqui o prazo era `date` puro: a coluna nao tinha onde guardar hora. O
pedido da Camila em 18/08 foi que o HORARIO decida se a tarefa esta atrasada.

⚠️ COLUNA NOVA E NULA, E NAO TROCA DE TIPO EM `due_date`. A primeira versao
deste escopo convertia `task.due_date`, `task.start_date`, os dois campos de
`project` e os DOIS de dedup para `timestamptz` -- seis colunas. Ao responder
que **horario nao e obrigatorio**, o desenho caiu para isto aqui, e o motivo e
que um timestamp unico NAO distingue "vence dia 19" de "vence dia 19 a
meia-noite". Sao dois estados de produto; `NULL` e o primeiro.

⚠️ O QUE ISSO EVITOU, e nao e pouco:

  - **backfill em 1085 linhas** (a consulta 5 do `invariantes.sql`, 18/08).
    Hoje uma tarefa com prazo "19/08" so atrasa DEPOIS que o dia 19 acaba. Um
    backfill com `00:00` poria toda tarefa com prazo hoje em atraso de manha, e
    daria um dia de atraso a todo prazo passado;
  - ⚠️⚠️ **a troca de tipo de `due_soon_notified_for` e `overdue_notified_for`.**
    Eles guardam o `due_date` para o qual o aviso JA saiu, e o
    `DeadlineNotifyService` so dispara quando DIFEREM do atual. Se um virasse
    timestamp e o outro nao, a comparacao seria "sempre diferente" e o job
    passaria a notificar TODO DIA, TODAS as tarefas com prazo, para as 26
    pessoas. Com `due_date` intacto isso nao pode acontecer.

⚠️ ORDEM DE DEPLOY: A PADRAO (codigo antes, migration depois). O `DEPLOY.md`
diz na §Atualizacao que "coluna nullable e tabela nova que ninguem referencia
nao afetam o codigo velho, que nunca pergunta por elas" -- e uma coluna nova e
nula e exatamente esse caso. **NAO e a segunda excecao** daquele arquivo:
aquela vale para `mapped_column` novo em model que o codigo velho JA le, o que
faz o SELECT pedir coluna inexistente. Aqui o model novo e que carrega o campo,
e o codigo velho segue sem saber dele.

⚠️ O JOB DE PRAZO NAO MUDA NESTA MIGRATION, E ISSO E ESCOLHA. Ele roda DIARIO
(n8n) e compara datas; hora so muda o que a TELA chama de atrasado. Ver a nota
sobre a divergencia no `plan.md` da Spec 038.

⚠️ REVERSIVEL SEM PERDA DE DADO RELEVANTE: o `downgrade` derruba a coluna, e
com ela as horas digitadas -- o prazo em DIA continua intacto, porque nunca
saiu de `due_date`. Voltar devolve exatamente o comportamento de hoje.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_task_due_time"
down_revision: str | None = "0013_board_nome_unico_por_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQL cru: convencao das migrations deste repo (0005, 0008, 0009, 0010,
    # 0013).
    #
    # ⚠️ SEM `server_default`, E DE PROPOSITO. Um default poria hora em toda
    # linha existente -- que e exatamente o backfill que este desenho existe
    # para nao fazer. `NULL` significa "vence no dia", e todas as 1085 linhas
    # ja significam isso.
    op.execute(
        """
        ALTER TABLE public.task
            ADD COLUMN due_time TIME NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.task
            DROP COLUMN due_time;
        """
    )
