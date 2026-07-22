"""tabela de solicitacoes (lote + triagem + tarefa)

Revision ID: 0005_solicitations
Revises: 0004_unique_root_team
Create Date: 2026-07-22

Spec 025, D1. Cria `solicitation` COMPLETA numa migration so.

Historia (registrada de proposito): esta feature foi implementada antes
da spec e gerou TRES migrations em sequencia -- tabela, colunas de lote,
colunas de tarefa -- porque a cada pedido novo aparecia uma coluna que
faltava. Como nada foi commitado nem foi pra producao, as tres foram
descartadas e reescritas aqui como uma. Se voce esta lendo isso num
`git log`, nao procure as 0004/0005/0006 antigas: elas nunca existiram
fora da maquina de quem escreveu.

ESTRUTURA (espelha app/db/models/solicitations.py -- os dois mudam juntos)
    identificacao : quem pediu (sem conta no sistema)
    lote          : batch_id / batch_seq / batch_total  (D4)
    conteudo      : category / summary / answers (JSONB, D10)
    triagem       : status / review_note / reviewed_*   (D8)
    tarefa        : task_created_at / task_marked_by / task_ref (D9)

DDL raw, no mesmo estilo da baseline e das 0002-0004.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0005_solicitations"
down_revision: str | None = "0004_unique_root_team"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.solicitation (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL
            REFERENCES public.workspace (id) ON DELETE RESTRICT,

        -- quem pediu (sem conta no sistema; replicado por linha de proposito:
        -- a solicitacao precisa ser autoexplicativa na fila, sem join)
        requester_name varchar(255) NOT NULL,
        requester_email varchar(320) NOT NULL,
        requester_phone varchar(50) NOT NULL,
        requester_department varchar(255) NOT NULL,
        requester_polo varchar(255) NOT NULL,

        -- lote: uma submissao com N categorias vira N linhas irmas (D4)
        batch_id uuid NOT NULL,
        batch_seq integer NOT NULL DEFAULT 1,
        batch_total integer NOT NULL DEFAULT 1,

        -- conteudo
        category varchar(60) NOT NULL,
        summary varchar(500) NOT NULL,
        answers jsonb NOT NULL,

        -- triagem (por linha, nao por lote)
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        review_note text,
        reviewed_by_user_id uuid,
        reviewed_at timestamptz,

        -- tarefa: aprovar NAO cria tarefa; isto rastreia o passo manual (D9)
        task_created_at timestamptz,
        task_marked_by_user_id uuid,
        task_ref varchar(500),

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT solicitation_status_valid
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        -- D8: rejeicao sem motivo nao pode existir nem por caminho torto
        CONSTRAINT solicitation_reject_requires_note
            CHECK (status <> 'REJECTED' OR review_note IS NOT NULL),
        CONSTRAINT solicitation_batch_seq_valid
            CHECK (batch_seq >= 1 AND batch_seq <= batch_total),
        -- D9: tarefa so em demanda aprovada
        CONSTRAINT solicitation_task_requires_approved
            CHECK (task_created_at IS NULL OR status = 'APPROVED'),

        -- FKs COMPOSTAS com workspace_id (padrao do schema): impedem
        -- apontar usuario de outro tenant
        CONSTRAINT solicitation_reviewed_by
            FOREIGN KEY (reviewed_by_user_id, workspace_id)
            REFERENCES public.users (id, workspace_id)
            ON DELETE SET NULL,
        CONSTRAINT solicitation_task_marked_by
            FOREIGN KEY (task_marked_by_user_id, workspace_id)
            REFERENCES public.users (id, workspace_id)
            ON DELETE SET NULL
    );
    """,
    # --- indices: um por leitura real da tela ---
    # 1. a fila
    """
    CREATE INDEX solicitation_ws_status_created
        ON public.solicitation (workspace_id, status, created_at);
    """,
    # 2. abrir um envio (todas as irmas do protocolo)
    """
    CREATE INDEX solicitation_batch
        ON public.solicitation (workspace_id, batch_id);
    """,
    # 3. PARCIAL -- o filtro "aprovadas sem tarefa" (D9). Parcial porque so
    #    essas linhas interessam: indice minusculo, e a linha sai dele
    #    sozinha quando alguem marca a tarefa.
    """
    CREATE INDEX solicitation_aprovadas_sem_tarefa
        ON public.solicitation (workspace_id, created_at)
        WHERE status = 'APPROVED' AND task_created_at IS NULL;
    """,
    # o filtro de tenant do BaseRepository entra em toda query
    """
    CREATE INDEX ix_solicitation_workspace_id
        ON public.solicitation (workspace_id);
    """,
    """
    COMMENT ON TABLE public.solicitation IS
        'Spec 025: demandas do formulario publico FazAe. Uma linha por '
        'categoria escolhida; triagem e tarefa independentes por linha.';
    """,
    """
    COMMENT ON COLUMN public.solicitation.batch_id IS
        'Submissao do formulario. Irmas do mesmo envio compartilham; '
        'gera o protocolo mostrado ao solicitante.';
    """,
    """
    COMMENT ON COLUMN public.solicitation.answers IS
        'Lista JSONB de {label, value}: pergunta/resposta como exibido '
        'ao solicitante.';
    """,
    """
    COMMENT ON COLUMN public.solicitation.task_created_at IS
        'Autodeclarado pelo aprovador. Alimenta o filtro "aprovadas sem '
        'tarefa" -- o valor esta no que fica SEM marca.';
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Indices e constraints caem junto com a tabela.
    op.execute("DROP TABLE IF EXISTS public.solicitation;")
