"""legacy_status na coluna do quadro (Spec 035 fatia 3a, ADR 0033)

Revision ID: 0010_board_column_legacy_status
Revises: 0009_backfill_terminal_since
Create Date: 2026-08-06

Guarda de qual `task.status` cada coluna migrada veio. E a ponte que torna a
derivacao `status -> coluna` possivel sem perda, enquanto o front ainda desenha
o quadro pela lista de `web/lib/status.ts`.

⚠️ POR QUE NAO O CONTRARIO. A D3 original da spec mandava derivar `status` da
SEMANTICA da coluna. Sao quatro semanticas para oito colunas: quatro colunas
compartilham `IN_PROGRESS` e duas compartilham `OPEN`. Naquela direcao,
`PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` deixariam de existir --
e como `Board.tsx` monta as colunas pela lista de status, as tarefas dessas
colunas apareceriam dentro de "Em Andamento" na tela de todo mundo, numa
entrega cujo criterio 10 e "o front nao muda". Inversao registrada na ADR 0033.

⚠️ ORDEM DE DEPLOY: MIGRATION ANTES DO CODIGO. Coluna nova em model existente
(`BoardColumn`) -- o SQLAlchemy emite lista explicita de colunas, entao o
codigo novo pedindo `legacy_status` contra o schema velho quebra toda leitura
de coluna. Mesmo caso da `0008`, e a excecao esta escrita no DEPLOY.md. O
sentido inverso e seguro: coluna nullable que ninguem le nao afeta o codigo
velho.

⚠️ ESTA MIGRATION E DE PONTE, E TEM DATA DE DEMOLICAO. Quando o front passar a
ler as colunas do banco, `status` vira derivado da coluna, `legacy_status` para
de ter uso e o ADR daquele passo DROPA a coluna. Ela nao e fundacao.

O casamento e por `position`, e nao por nome: a `0008` gravou as oito colunas
em ordem conhecida e travada (a mesma de `web/lib/status.ts`), enquanto nome e
o campo que a spec seguinte torna editavel. Casar por nome funcionaria hoje e
quebraria em silencio no primeiro rename.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_board_column_legacy_status"
down_revision: str | None = "0009_backfill_terminal_since"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# position -> status, exatamente como a `0008` gravou. NAO derivar de
# `app.modules.tasks.domain.board_defaults`: migration que importa codigo de
# aplicacao muda de significado quando o codigo muda, e uma migration ja
# aplicada tem de continuar significando o que significava no dia em que rodou.
# A duplicacao e o preco, e ha teste comparando as duas listas.
POSICAO_PARA_STATUS = (
    (0, "BACKLOG"),
    (1, "PLANNED"),
    (2, "IN_PROGRESS"),
    (3, "IN_REVIEW"),
    (4, "EXTERNAL_APPROVAL"),
    (5, "COMPLETED"),
    (6, "CANCELLED"),
    (7, "BLOCKED"),
)


def upgrade() -> None:
    conexao = op.get_bind()

    # SQL cru: convencao das migrations deste repo (0005, 0008, 0009).
    op.execute(
        """
        ALTER TABLE public.board_column
            ADD COLUMN legacy_status public.task_status;
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN public.board_column.legacy_status IS
            'ADR 0033: de qual task.status esta coluna veio. PONTE -- enquanto '
            'o front desenha o quadro por status, a coluna e derivada do '
            'status (1:1). NULL em coluna criada por gente. Some quando o '
            'front passar a ler colunas do banco.';
        """
    )

    # ⚠️ SO nas colunas que a `0008` criou: as oito, com `position` 0..7 num
    # quadro `is_default`. Quadro criado depois disto ja nasce com o campo
    # preenchido pelo servico.
    for posicao, status in POSICAO_PARA_STATUS:
        conexao.execute(
            sa.text(
                """
                UPDATE public.board_column c
                SET legacy_status = CAST(:status AS public.task_status)
                FROM public.board b
                WHERE c.board_id = b.id
                  AND b.is_default
                  AND c.position = :posicao
                  AND c.legacy_status IS NULL
                """
            ),
            {"status": status, "posicao": posicao},
        )

    # A invariante que a fatia 3b vai depender: dentro de um quadro, dois
    # status iguais tornariam "qual e a coluna deste status?" ambigua, e a
    # tarefa iria parar na coluna errada -- sem erro, sem tela.
    # ⚠️ ANTES do indice, de proposito: o `CREATE UNIQUE INDEX` abaixo tambem
    # falharia com dado sujo, mas com uma mensagem do Postgres que nao diz o
    # que fazer. Esta aqui e a que explica.
    duplicadas = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM (
                SELECT board_id, legacy_status
                FROM public.board_column
                WHERE legacy_status IS NOT NULL
                GROUP BY board_id, legacy_status
                HAVING count(*) > 1
            ) AS d
            """
        )
    ).scalar_one()
    if duplicadas:
        raise RuntimeError(
            f"[0010] {duplicadas} par(es) (quadro, status) com mais de uma "
            "coluna. A fatia 3b nao teria como escolher a coluna da tarefa."
        )

    # ⚠️ INDICE PARCIAL, e nao so a checagem abaixo. A checagem vale UMA vez,
    # no dia em que esta migration roda; o indice vale para sempre. Sem ele, o
    # CRUD de coluna da spec seguinte pode criar uma segunda coluna com o mesmo
    # `legacy_status` e o `BoardRepository` passaria a escolher UMA DAS DUAS em
    # silencio -- a tarefa iria para a coluna errada, sem erro e sem tela.
    # Mesma tecnica do `board_um_padrao_por_time` e do
    # `team_unica_raiz_por_workspace`.
    #
    # ⚠️ PARCIAL (`WHERE legacy_status IS NOT NULL`) porque coluna criada por
    # gente tem o campo NULL, e varias delas coexistem no mesmo quadro. Indice
    # unico simples recusaria a segunda coluna nova de qualquer quadro.
    op.execute(
        """
        CREATE UNIQUE INDEX board_column_um_status_por_quadro
            ON public.board_column (board_id, legacy_status)
            WHERE legacy_status IS NOT NULL;
        """
    )

    # Todo quadro padrao tem de ter as oito preenchidas. Se faltar, a fatia 3b
    # criaria tarefa sem coluna para aquele status.
    incompletos = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM public.board b
            WHERE b.is_default
              AND (
                SELECT count(*) FROM public.board_column c
                WHERE c.board_id = b.id AND c.legacy_status IS NOT NULL
              ) <> 8
            """
        )
    ).scalar_one()
    if incompletos:
        raise RuntimeError(
            f"[0010] {incompletos} quadro(s) padrao sem as 8 colunas com "
            "legacy_status. Investigar antes da fatia 3b."
        )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.board_column DROP COLUMN IF EXISTS legacy_status;"
    )
