"""soft delete em board (ADR 0034, D9)

Revision ID: 0012_board_soft_delete
Revises: 0011_task_board_not_null
Create Date: 2026-08-06

A ADR 0034 decidiu que apagar quadro interno apaga as tarefas junto (soft
delete, ADR 0005). `board` nao tinha `deleted_at` -- so `Task`, `Project` e
`Comment` tem. Esta migration cria a coluna.

⚠️ ELA VEM ANTES DA TELA DE APAGAR, E ISSO E O PONTO. A fatia seguinte e o
`GET /api/v1/boards` -- a FATIA 2 do `plan.md` da Spec 036. Se o endpoint
nascer sem `deleted_at IS NULL`, ele lista quadro apagado a partir do dia em
que apagar existir -- defeito plantado numa fatia e colhido em outra, com a
leitura passando verde no meio. Criar a coluna agora e o que permite a fatia 2
ja nascer com o filtro E com teste que pode falhar (o teste apaga um quadro na
mao).

⚠️ NUMERACAO: o roteiro antigo chamava as entregas de F1a/F1b/F2/F3. O
`plan.md` da Spec 036 numera de 1 a 5, e ELE e a fonte da verdade. As duas
numeracoes nao coincidem -- "F3" era esta fatia 2.

⚠️ ORDEM DE DEPLOY: MIGRATION ANTES DO CODIGO. Coluna nova em model existente
(`Board`) -- o SQLAlchemy emite lista explicita de colunas, entao o codigo novo
pedindo `deleted_at` contra o schema velho quebra toda leitura de quadro pelo
ORM. Mesmo caso da `0008` e da `0010`, e a excecao esta escrita no DEPLOY.md.

⚠️ O TEXTO ACIMA JA DIZIA "esta migration pode subir sozinha e ficar parada",
E ISSO ESTAVA ERRADO NO MOMENTO EM QUE FOI ESCRITO. Valeria se nada lesse a
coluna -- mas o `board_repository` (`AND b.deleted_at IS NULL`) e o `Board`
com `SoftDeleteMixin` foram commitados NA MESMA fatia. Subir o `main` sem esta
migration quebra o `create` de tarefa de topo (`task_service.py:380`) e toda
leitura ORM de quadro. Ela nao fica parada: ela BLOQUEIA deploy ate subir.

⚠️ O TEXTO DO `COMMENT` E IDENTICO ao do `SoftDeleteMixin`, caractere a
caractere, e ao que a `0001` gravou em `comment`, `project` e `task`. O drift
de comentario e comparado por TEXTO: divergir aqui deixa o `autogenerate`
propondo a diferenca para sempre, e o portao vermelho vira ruido que as pessoas
aprendem a ignorar. O precedente do conserto ERRADO esta na `Solicitation`, que
redeclara `updated_at` SEM comment porque a `0005` esqueceu de grava-lo.

⚠️ SEM INDICE. `idx_project_active` e `idx_comment_active` existem porque
aquelas tabelas tem volume. `board` tem UMA linha em producao hoje e vai ter
poucas dezenas no pior caso da ADR 0034. Indice parcial aqui e custo de escrita
sem ganho de leitura mensuravel. Quando a contagem de quadros justificar, entra
em migration propria -- com o numero na justificativa.

⚠️ `board_column` NAO ganha `deleted_at` aqui. Apagar COLUNA e outra operacao:
pela ADR 0030 ela exige escolher a coluna de destino das tarefas e some de
verdade. Schema para uma decisao que ainda nao foi tomada e especulacao.

⚠️ CONSEQUENCIA NAO OBVIA, registrada tambem no model: o indice parcial
`board_um_padrao_por_time` e unico em `team_id WHERE is_default` e NAO sabe de
`deleted_at`. Um quadro PADRAO apagado continuaria bloqueando a criacao de um
novo padrao para aquele time. Nao ha conserto nesta migration porque nao ha
problema hoje -- quadro interno e `is_default=False`. **A F5 tem de proibir
apagar quadro padrao.**
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_board_soft_delete"
down_revision: str | None = "0011_task_board_not_null"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conexao = op.get_bind()

    # SQL cru: convencao das migrations deste repo (0005, 0008, 0009, 0010).
    op.execute(
        """
        ALTER TABLE public.board
            ADD COLUMN deleted_at timestamp with time zone;
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN public.board.deleted_at IS
            'Soft delete real. NULL = ativo. Queries operacionais filtram '
            'deleted_at IS NULL.';
        """
    )

    # ⚠️ CONFERENCIA DE QUE A COLUNA NASCEU TODA NULA -- ou seja, nenhum quadro
    # ficou apagado por acidente na propria migration. Parece obvio para um
    # `ADD COLUMN` sem default, e e: o valor desta checagem e a mensagem, que
    # diz o que fazer se um dia esta migration for editada e ganhar um backfill.
    apagados = conexao.execute(
        sa.text(
            "SELECT count(*) FROM public.board WHERE deleted_at IS NOT NULL"
        )
    ).scalar_one()
    if apagados:
        raise RuntimeError(
            f"[0012] {apagados} quadro(s) nasceram apagados. Um ADD COLUMN sem "
            "default nao faz isso -- alguem acrescentou backfill a esta "
            "migration. NAO seguir: as tarefas dentro deles sumiriam da tela "
            "sem ninguem ter pedido."
        )


def downgrade() -> None:
    """Derruba a coluna.

    ⚠️ ISTO APAGA A INFORMACAO DE QUEM FOI APAGADO. Enquanto nao existir tela
    de apagar quadro (F5), a coluna e toda NULA e o downgrade e sem perda. No
    dia em que existir, rebobinar esta migration faz todo quadro apagado voltar
    a aparecer -- com as tarefas dentro, que continuam com o proprio
    `task.deleted_at` preenchido. Ou seja: o quadro reaparece vazio.
    """
    op.execute("ALTER TABLE public.board DROP COLUMN IF EXISTS deleted_at;")
