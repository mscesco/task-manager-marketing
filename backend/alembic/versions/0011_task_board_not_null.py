"""quadro obrigatorio na tarefa (Spec 035 fatia 3b, ADR 0032/0033)

Revision ID: 0011_task_board_not_null
Revises: 0010_board_column_legacy_status
Create Date: 2026-08-06

Fecha a fundacao da Spec 035: toda tarefa vive num quadro e numa coluna, e o
BANCO passa a garantir isso.

⚠️ ORDEM DE DEPLOY: CODIGO PRIMEIRO, DEPOIS ESTA MIGRATION. E a ordem padrao do
DEPLOY.md, e aqui ela nao e formalidade -- e a diferenca entre funcionar e
derrubar o produto. `SET NOT NULL` antes do codigo que preenche trava a tabela
contra o proprio codigo: nenhuma tarefa nova poderia nascer. A primeira versao
da `0008` cometeu exatamente esse erro e derrubou 196 testes de uma vez; a
regra que saiu dali e expande/contrai -- coluna e backfill numa migration,
trava so DEPOIS que o codigo escreve.

⚠️ ESTA MIGRATION FALHA se sobrar tarefa sem quadro, e isso e o desejado. As
duas fontes conhecidas de linha orfa:

  1. Tarefa criada entre o deploy da `0008` (06/08, manha) e o desta fatia --
     eram DUAS em producao no meio da tarde. O codigo nao escrevia o campo
     ainda.
  2. Workspace criado depois da `0008` e antes da fatia 3a: nasceu sem quadro
     nenhum, entao suas tarefas nao tem para onde apontar. Em producao ha UM
     workspace, criado muito antes -- mas o backfill abaixo cria o quadro
     faltante em vez de assumir isso, porque assumir e como a `0008` deixou a
     lacuna para tras.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_task_board_not_null"
down_revision: str | None = "0010_board_column_legacy_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copia congelada, igual a das 0008/0010. Migration nao importa codigo de
# aplicacao: uma migration ja aplicada tem de continuar significando o que
# significava no dia em que rodou. Ha teste comparando as copias.
COLUNAS = [
    ("BACKLOG", "Backlog", "var(--status-backlog-dot)", "OPEN", True, True),
    ("PLANNED", "Planejado", "var(--status-planned-dot)", "OPEN", True, False),
    (
        "IN_PROGRESS",
        "Em Andamento",
        "var(--status-progress-dot)",
        "IN_PROGRESS",
        True,
        True,
    ),
    (
        "IN_REVIEW",
        "Aprovação Interna",
        "var(--status-review-dot)",
        "IN_PROGRESS",
        True,
        False,
    ),
    (
        "EXTERNAL_APPROVAL",
        "Aprovação Externa",
        "var(--status-external-dot)",
        "IN_PROGRESS",
        True,
        False,
    ),
    ("COMPLETED", "Concluído", "var(--status-done-dot)", "DONE", True, True),
    (
        "CANCELLED",
        "Cancelado",
        "var(--status-cancel-dot)",
        "CANCELLED",
        True,
        True,
    ),
    (
        "BLOCKED",
        "Bloqueado",
        "var(--status-blocked-dot)",
        "IN_PROGRESS",
        False,
        False,
    ),
]


def upgrade() -> None:
    conexao = op.get_bind()

    # --- 1. Workspace sem quadro ganha o seu (lacuna deixada pela 0008) -----
    sem_quadro = conexao.execute(
        sa.text(
            """
            SELECT w.id, t.id
            FROM workspace w
            JOIN team t
              ON t.workspace_id = w.id AND t.parent_team_id IS NULL
            WHERE NOT EXISTS (
                SELECT 1 FROM board b
                WHERE b.workspace_id = w.id AND b.is_default
            )
            """
        )
    ).all()

    for ws_id, team_id in sem_quadro:
        quadro_id = conexao.execute(
            sa.text(
                """
                INSERT INTO public.board (workspace_id, team_id, name,
                                          is_default)
                VALUES (:ws, :time, 'Quadro Geral', true)
                RETURNING id
                """
            ),
            {"ws": ws_id, "time": team_id},
        ).scalar_one()

        for posicao, (status, nome, cor, sem, avisa, destino) in enumerate(
            COLUNAS
        ):
            conexao.execute(
                sa.text(
                    """
                    INSERT INTO public.board_column (
                        workspace_id, board_id, name, color, position,
                        semantic, notify_deadline, is_default_target,
                        legacy_status
                    )
                    VALUES (
                        :ws, :quadro, :nome, :cor, :pos,
                        CAST(:sem AS public.column_semantic), :avisa, :destino,
                        CAST(:status AS public.task_status)
                    )
                    """
                ),
                {
                    "ws": ws_id,
                    "quadro": quadro_id,
                    "nome": nome,
                    "cor": cor,
                    "pos": posicao,
                    "sem": sem,
                    "avisa": avisa,
                    "destino": destino,
                    "status": status,
                },
            )

    # --- 2. Tarefa orfa aponta para a coluna do SEU status ------------------
    # ⚠️ Pelo `legacy_status`, e nao pela semantica. A direcao `status ->
    # coluna` e a unica 1:1 (ADR 0033); pela semantica, quatro colunas
    # dividiriam `IN_PROGRESS` e a tarefa iria para a coluna errada -- sem
    # erro, sem tela.
    # ⚠️ SEM `JOIN` DENTRO DO `FROM`, e isso nao e estilo. No Postgres a tabela
    # ALVO do UPDATE nao pode ser referenciada dentro do `ON` de um JOIN da
    # clausula FROM -- `c.legacy_status = t.status` ali devolve
    # "invalid reference to FROM-clause entry for table t". Com a lista de
    # tabelas separada por virgula e todas as condicoes no `WHERE`, o alvo e
    # alcancavel. A primeira versao desta migration caiu exatamente assim, e o
    # erro so aparece rodando `alembic upgrade head` -- o pytest mostraria
    # apenas `CalledProcessError`.
    conexao.execute(
        sa.text(
            """
            UPDATE public.task t
            SET board_id = b.id, column_id = c.id
            FROM public.board b, public.team tm, public.board_column c
            WHERE b.workspace_id = t.workspace_id
              AND b.is_default
              AND tm.id = b.team_id
              AND tm.workspace_id = b.workspace_id
              AND tm.parent_team_id IS NULL
              AND c.board_id = b.id
              AND c.legacy_status = t.status
              AND (t.board_id IS NULL OR t.column_id IS NULL)
            """
        )
    )

    # --- 3. So entao a trava ------------------------------------------------
    orfas = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM public.task
            WHERE board_id IS NULL OR column_id IS NULL
            """
        )
    ).scalar_one()
    if orfas:
        raise RuntimeError(
            f"[0011] {orfas} tarefa(s) continuam sem quadro/coluna depois do "
            "backfill. NAO travar: investigar por que o workspace delas nao "
            "tem quadro ou o status delas nao tem coluna."
        )

    # ⚠️ Medida ANTES da trava, porque depois dela nao ha mais como estar
    # errado desse jeito -- e uma FK composta so prova que a coluna e do mesmo
    # quadro, nao que e a coluna do STATUS certo.
    trocadas = conexao.execute(
        sa.text(
            """
            SELECT count(*) FROM public.task t
            JOIN public.board_column c ON c.id = t.column_id
            WHERE c.legacy_status IS DISTINCT FROM t.status
            """
        )
    ).scalar_one()
    if trocadas:
        raise RuntimeError(
            f"[0011] {trocadas} tarefa(s) na coluna de OUTRO status. Algum "
            "ponto de escrita esta derivando a coluna pela semantica em vez "
            "do legacy_status (ADR 0033)."
        )

    op.execute(
        """
        ALTER TABLE public.task
            ALTER COLUMN board_id SET NOT NULL,
            ALTER COLUMN column_id SET NOT NULL;
        """
    )


def downgrade() -> None:
    """Solta a trava. NAO apaga os dados -- eles sao corretos e o codigo os usa.

    ⚠️ Rebobinar o CODIGO desta fatia sem rodar este downgrade quebra a criacao
    de tarefa: o codigo velho nao preenche `board_id`, e a coluna esta NOT
    NULL. Se for preciso voltar a imagem, volte o schema primeiro -- e o que o
    DEPLOY.md ja manda, e aqui vale literalmente.
    """
    op.execute(
        """
        ALTER TABLE public.task
            ALTER COLUMN board_id DROP NOT NULL,
            ALTER COLUMN column_id DROP NOT NULL;
        """
    )
