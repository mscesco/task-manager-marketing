"""quadro e coluna com semantica (Spec 035, ADR 0030)

Revision ID: 0008_boards_and_columns
Revises: 0007_token_version
Create Date: 2026-08-05

Cria `board` e `board_column`, e liga `task` a elas. Depois desta migration,
criar coluna nova passa a ser configuracao; hoje e mudanca de schema.

⚠️ NO DIA DO DEPLOY NINGUEM VE DIFERENCA. O quadro migrado nasce com as OITO
colunas de hoje, com os mesmos rotulos e na mesma ordem de `web/lib/status.ts`.
O quadro NOVO (spec seguinte) e que nasce com tres. Migrar para tres aqui
empurraria oito colunas de tarefas reais em tres, mudando a tela de todo mundo
de uma vez -- exatamente o que esta migracao existe para evitar.

⚠️ POR QUE `task.status` CONTINUA EXISTINDO. Onze pontos do backend perguntam
por `COMPLETED`/`CANCELLED`: a cascata de conclusao, a varredura de
arquivamento, a proporcao da checklist e o aviso de prazo. Mantido o enum como
espinha semantica, a migracao nao vira um big bang de 143 referencias e a
entrega inteira fica INVISIVEL -- portanto reversivel por rollback de imagem,
que e como esta operacao faz deploy.

⚠️ SQL CRU, e nao `op.create_table`. E a convencao das migrations deste repo
(ver 0005), e aqui ela evitou dois defeitos concretos: `sa.dialects.postgresql`
nem sempre esta disponivel sob `import sqlalchemy as sa`, e
`sa.Enum(..., create_type=False)` dentro do `create_table` tentaria criar o
tipo DE NOVO, depois do CREATE TYPE explicito. A primeira versao deste arquivo
caiu por isso, e o pytest so mostrou "CalledProcessError".

ORDEM QUE IMPORTA:
    1. tipo + tabelas + colunas NULLABLE;
    2. dados (um quadro por workspace, oito colunas, backfill das tarefas);
    3. so entao NOT NULL e as FKs compostas.
Criar ja obrigatorio quebra em qualquer banco com dados -- inclusive no dump
de producao que a suite de integracao usa.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_boards_and_columns"
down_revision: str | None = "0007_token_version"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (status, rotulo, cor, semantica, avisa_prazo, e_destino)
# ⚠️ Rotulos e cores IDENTICOS aos de web/lib/status.ts. Inventar nome aqui
# mudaria a tela no dia do deploy.
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
    # ⚠️ `notify_deadline=False` reproduz o BLOCKED cravado hoje no
    # DeadlineNotifyService ("nao ha o que agir enquanto travada").
    #
    # ⚠️ BLOCKED E O ULTIMO, e nao o sexto. `web/lib/status.ts` o desenha
    # DEPOIS de Cancelado, e `Board.tsx` renderiza na ordem daquele array --
    # entao "Bloqueado" e a ultima coluna da tela hoje. O `position` gravado
    # aqui e a ordem que a tela vai ler quando o front passar a montar as
    # colunas a partir do quadro, e naquele dia uma divergencia daqui apareceria
    # como regressao de front, num diff que nao contem a causa: a causa e dado
    # gravado em producao meses antes.
    #
    # A ordem semantica (BLOCKED junto dos outros IN_PROGRESS) veio da tabela
    # D7 da spec 035, que dizia "na ordem de hoje" e nao estava. A spec foi
    # corrigida junto -- se so a migration mudasse, a proxima leitura da spec
    # "consertaria" de volta.
    (
        "BLOCKED",
        "Bloqueado",
        "var(--status-blocked-dot)",
        "IN_PROGRESS",
        False,
        False,
    ),
]


ESTRUTURA: tuple[str, ...] = (
    """
    CREATE TYPE public.column_semantic AS ENUM (
        'OPEN',
        'IN_PROGRESS',
        'DONE',
        'CANCELLED'
    );
    """,
    """
    CREATE TABLE public.board (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL
            REFERENCES public.workspace (id) ON DELETE RESTRICT,
        team_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        -- Sustenta a FK composta de board_column e de task.
        CONSTRAINT uq_board_id_workspace UNIQUE (id, workspace_id),
        CONSTRAINT board_team
            FOREIGN KEY (team_id, workspace_id)
            REFERENCES public.team (id, workspace_id) ON DELETE RESTRICT
    );
    """,
    # ⚠️ UM quadro padrao por TIME. Sem isto, "qual e o quadro do time?" passa
    # a ter duas respostas -- e a errada nao aparece na tela: aparece na
    # tarefa que foi parar no quadro errado.
    """
    CREATE UNIQUE INDEX board_um_padrao_por_time
        ON public.board (team_id) WHERE is_default;
    """,
    """
    CREATE TABLE public.board_column (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL
            REFERENCES public.workspace (id) ON DELETE RESTRICT,
        board_id uuid NOT NULL,
        name varchar(120) NOT NULL,
        color varchar(60) NOT NULL,
        position integer NOT NULL,
        semantic public.column_semantic NOT NULL,
        notify_deadline boolean NOT NULL DEFAULT true,
        is_default_target boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        -- Sustenta a FK composta de task: (column_id, board_id).
        CONSTRAINT uq_board_column_id_board UNIQUE (id, board_id),
        CONSTRAINT board_column_board
            FOREIGN KEY (board_id, workspace_id)
            REFERENCES public.board (id, workspace_id) ON DELETE RESTRICT,
        CONSTRAINT board_column_position_non_negative CHECK (position >= 0)
    );
    """,
    # ⚠️ UMA coluna de destino por semantica, por quadro. E o que responde
    # "para onde vai a tarefa concluida?" quando existem duas colunas DONE.
    """
    CREATE UNIQUE INDEX board_column_um_destino_por_semantica
        ON public.board_column (board_id, semantic) WHERE is_default_target;
    """,
    """
    ALTER TABLE public.task
        ADD COLUMN board_id uuid,
        ADD COLUMN column_id uuid,
        ADD COLUMN terminal_since timestamptz;
    """,
    # ⚠️ Os COMMENT de `updated_at` NAO sao enfeite: o `TimestampMixin` os
    # DECLARA no model, entao sem eles aqui o `autogenerate` acusa drift para
    # sempre. Precedente do conserto errado esta na `Solicitation`, que
    # redeclara `updated_at` SEM comment porque a 0005 esqueceu de grava-lo --
    # o model foi mutilado para casar com a migration. Aqui e o contrario: a
    # documentacao vai pro banco, como no schema v5.
    """
    COMMENT ON COLUMN public.board.updated_at IS
        'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';
    """,
    """
    COMMENT ON COLUMN public.board_column.updated_at IS
        'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';
    """,
    """
    COMMENT ON COLUMN public.task.terminal_since IS
        'Spec 035: quando a tarefa ENTROU em coluna terminal. Relogio do '
        'arquivamento automatico -- editar a semantica de uma coluna passa a '
        'reiniciar a contagem em vez de arquivar tudo na madrugada seguinte.';
    """,
)


# ⚠️ SEM `SET NOT NULL` AQUI, e isso e a correcao de 05/08. A primeira versao
# travava as colunas nesta mesma migration -- mas NADA as preenche ainda: o
# service so passa a gravar `board_id`/`column_id` na fatia 3. Em banco VAZIO
# (o de teste, e o de qualquer ambiente novo) a primeira tarefa criada ja
# violava o not-null, e 196 testes cairam de uma vez.
#
# E o padrao expande/contrai: esta migration EXPANDE (coluna nova, opcional,
# com backfill); a fatia 3 passa a escrever; e so entao uma migration seguinte
# CONTRAI (SET NOT NULL), quando ja e verdade que toda tarefa tem quadro.
# Travar antes de escrever e travar contra o proprio codigo.
#
# As FKs entram AGORA de proposito: FK nao vale para valor NULL, entao elas
# ja protegem quem preenche sem atrapalhar quem ainda nao preenche.
TRAVAS: tuple[str, ...] = (
    """
    ALTER TABLE public.task
        ADD CONSTRAINT task_board
            FOREIGN KEY (board_id, workspace_id)
            REFERENCES public.board (id, workspace_id) ON DELETE RESTRICT;
    """,
    # ⚠️ A FK COMPOSTA E O PONTO, nao detalhe: ela torna impossivel NO BANCO
    # que uma tarefa aponte pra coluna de OUTRO quadro. Sem ela esse estado e
    # questao de tempo, nao aparece na tela, e entra na mesma familia de
    # `path`/`depth` -- corrupcao sem sintoma e sem conserto por deploy.
    """
    ALTER TABLE public.task
        ADD CONSTRAINT task_board_column
            FOREIGN KEY (column_id, board_id)
            REFERENCES public.board_column (id, board_id) ON DELETE RESTRICT;
    """,
)


def upgrade() -> None:
    conexao = op.get_bind()

    for stmt in ESTRUTURA:
        op.execute(stmt)

    # ---------------------------------------------------------------
    # Dados: um quadro por workspace, do time RAIZ.
    # ---------------------------------------------------------------
    workspaces = conexao.execute(
        sa.text(
            """
            SELECT w.id AS ws, t.id AS raiz
            FROM public.workspace w
            JOIN public.team t
              ON t.workspace_id = w.id AND t.parent_team_id IS NULL
            """
        )
    ).all()

    for ws_id, raiz_id in workspaces:
        quadro_id = conexao.execute(
            sa.text(
                """
                INSERT INTO public.board
                    (workspace_id, team_id, name, is_default)
                VALUES (:ws, :time, 'Quadro geral', true)
                RETURNING id
                """
            ),
            {"ws": ws_id, "time": raiz_id},
        ).scalar_one()

        for pos, (status, nome, cor, sem, avisa, destino) in enumerate(COLUNAS):
            coluna_id = conexao.execute(
                sa.text(
                    """
                    INSERT INTO public.board_column (
                        workspace_id, board_id, name, color, position,
                        semantic, notify_deadline, is_default_target
                    )
                    VALUES (
                        :ws, :quadro, :nome, :cor, :pos,
                        CAST(:sem AS public.column_semantic), :avisa, :destino
                    )
                    RETURNING id
                    """
                ),
                {
                    "ws": ws_id,
                    "quadro": quadro_id,
                    "nome": nome,
                    "cor": cor,
                    "pos": pos,
                    "sem": sem,
                    "avisa": avisa,
                    "destino": destino,
                },
            ).scalar_one()

            conexao.execute(
                sa.text(
                    """
                    UPDATE public.task
                    SET board_id = :quadro, column_id = :coluna
                    WHERE workspace_id = :ws
                      AND status = CAST(:status AS public.task_status)
                    """
                ),
                {
                    "quadro": quadro_id,
                    "coluna": coluna_id,
                    "ws": ws_id,
                    "status": status,
                },
            )

    # ⚠️ `terminal_since` reproduz EXATAMENTE o relogio que a varredura le hoje
    # (`list_stale_terminal`): COMPLETED por `completed_at`, CANCELLED por
    # `updated_at`. O conjunto que o job seleciona tem de ser IDENTICO antes e
    # depois -- e criterio de aceitacao da spec, nao expectativa.
    conexao.execute(
        sa.text(
            """
            UPDATE public.task
            SET terminal_since = CASE
                WHEN status = CAST('COMPLETED' AS public.task_status)
                    THEN COALESCE(completed_at, updated_at)
                ELSE updated_at
            END
            WHERE status IN (
                CAST('COMPLETED' AS public.task_status),
                CAST('CANCELLED' AS public.task_status)
            )
            """
        )
    )

    # ---------------------------------------------------------------
    # ⚠️ Confere o backfill, mas NAO derruba a migration. Tarefa sem quadro
    # aqui significa workspace sem time raiz -- estado que nao deveria existir
    # e que ninguem conserta no meio de um deploy. Levantar aqui deixaria o
    # banco a meio caminho; avisar deixa o rastro no log do deploy e a decisao
    # com quem esta olhando. A trava de verdade e o `SET NOT NULL` da migration
    # que CONTRAI, depois da fatia 3, e ai o numero ja tem de ser zero.
    # ---------------------------------------------------------------
    orfas = (
        conexao.execute(
            sa.text("SELECT count(*) FROM public.task WHERE board_id IS NULL")
        )
        .scalar_one()
    )
    if orfas:
        print(
            f"[0008] AVISO: {orfas} tarefa(s) sem quadro apos o backfill. "
            "Workspace sem time raiz? Conferir ANTES da migration que "
            "aplica SET NOT NULL."
        )

    for stmt in TRAVAS:
        op.execute(stmt)


def downgrade() -> None:
    # Reversivel de verdade, e nao `pass`: e o que permite voltar sem restore.
    # Nenhum dado de usuario se perde -- `task.status` nunca deixou de ser a
    # fonte, e as colunas sao reconstruidas pelo upgrade.
    op.execute(
        "ALTER TABLE public.task DROP CONSTRAINT IF EXISTS task_board_column;"
    )
    op.execute("ALTER TABLE public.task DROP CONSTRAINT IF EXISTS task_board;")
    op.execute(
        "ALTER TABLE public.task "
        "DROP COLUMN IF EXISTS terminal_since, "
        "DROP COLUMN IF EXISTS column_id, "
        "DROP COLUMN IF EXISTS board_id;"
    )
    op.execute("DROP TABLE IF EXISTS public.board_column;")
    op.execute("DROP TABLE IF EXISTS public.board;")
    op.execute("DROP TYPE IF EXISTS public.column_semantic;")
