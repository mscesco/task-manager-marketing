"""Solicitacao ganha IN_PROGRESS e DONE (Spec 043, fatia D).

⚠️⚠️ ESTA MIGRATION NAO ACRESCENTA COLUNA NENHUMA -- ela mexe em TRES REGRAS
que tinham os status escritos por extenso. Sao os lugares em que "acrescentar
um estado" deixa de ser uma linha no enum e vira trabalho de banco:

  1. `solicitation_status_valid` -- o CHECK que lista os valores aceitos. Sem
     ele, gravar 'IN_PROGRESS' e erro de integridade.

  2. ⚠️ `solicitation_task_requires_approved` -- **A ARMADILHA.** Escrito
     `task_created_at IS NULL OR status = 'APPROVED'`, ele PROIBIA mover para
     "em andamento" qualquer pedido que ja tivesse tarefa marcada -- ou seja,
     exatamente aqueles em que o trabalho comecou. O erro viria do banco, no
     meio de um clique inocente, e nenhum teste de servico o veria.

  3. `solicitation_aprovadas_sem_tarefa` -- o indice PARCIAL do filtro
     "aprovadas sem tarefa". Se ele cobrisse so APPROVED enquanto a consulta
     procura os tres, o Postgres deixaria de usa-lo **em silencio**: o filtro
     continuaria certo e viraria varredura de tabela.

⚠️ NENHUMA LINHA EXISTENTE MUDA DE STATUS. Todo pedido continua onde estava; o
que muda e o que passa a ser permitido daqui para frente.

⚠️ E O `downgrade` NAO E SIMETRICO POR ESCOLHA. Ele devolve a PENDING os
pedidos que estiverem em IN_PROGRESS ou DONE -- estados que o CHECK antigo nao
aceita, e sem isso o `ALTER` falharia com o banco cheio. Voltar para PENDING e
o menos errado: mantem o pedido vivo na fila para ser triado de novo, em vez de
carimba-lo como aprovado sem que ninguem tenha aprovado. **E perda de
informacao, e esta escrito aqui para que quem rodar saiba disso antes.**
"""

from __future__ import annotations

from alembic import op

# ⚠️ CURTO POR OBRIGACAO: `alembic_version.version_num` e `varchar(32)`, e
# "0018_status_em_andamento_e_concluida" tem 36 -- a migration roda inteira e
# so entao explode ao gravar a versao.
revision: str = "0018_status_andamento_concluida"
down_revision: str | None = "0017_formulario_do_marketing"
branch_labels: str | None = None
depends_on: str | None = None

#: Os estados de um pedido ACEITO -- espelha `ACEITOS` do dominio.
_ACEITOS = "('APPROVED', 'IN_PROGRESS', 'DONE')"
_TODOS = "('PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'DONE')"


def upgrade() -> None:
    # ⚠️ SQL CRU, E NAO `op.drop_constraint`, e a razao custou uma rodada: a
    # `naming_convention` do projeto (`ck_%(table_name)s_%(constraint_name)s`)
    # e aplicada pelo Alembic ao NOME QUE SE PASSA, entao
    # `drop_constraint("solicitation_status_valid")` procurava
    # `ck_solicitation_solicitation_status_valid` -- que nao existe. As
    # constraints nasceram na 0005 em SQL cru, com o nome literal, e e assim
    # que elas tem de ser tratadas aqui. Mudar o nome agora seria pior: o CHECK
    # some do banco em producao e volta com outro nome.

    # 1. Os valores aceitos.
    op.execute(
        "ALTER TABLE public.solicitation "
        "DROP CONSTRAINT solicitation_status_valid"
    )
    op.execute(
        "ALTER TABLE public.solicitation ADD CONSTRAINT "
        f"solicitation_status_valid CHECK (status IN {_TODOS})"
    )

    # 2. ⚠️ A ARMADILHA: tarefa marcada + pedido em andamento.
    op.execute(
        "ALTER TABLE public.solicitation "
        "DROP CONSTRAINT solicitation_task_requires_approved"
    )
    op.execute(
        "ALTER TABLE public.solicitation ADD CONSTRAINT "
        "solicitation_task_requires_approved CHECK "
        f"(task_created_at IS NULL OR status IN {_ACEITOS})"
    )

    # 3. O indice parcial tem de casar com o filtro da fila.
    op.execute("DROP INDEX IF EXISTS solicitation_aprovadas_sem_tarefa")
    op.execute(
        "CREATE INDEX solicitation_aprovadas_sem_tarefa "
        "ON public.solicitation (workspace_id, created_at) "
        f"WHERE status IN {_ACEITOS} AND task_created_at IS NULL"
    )


def downgrade() -> None:
    # ⚠️ PERDA DE INFORMACAO, DECLARADA: os estados novos nao cabem no CHECK
    # antigo, entao o `ALTER` falharia com o banco cheio. Voltar a PENDING
    # mantem o pedido vivo para ser triado de novo -- carimba-lo de APPROVED
    # diria que alguem aprovou, e ninguem aprovou.
    #
    # ⚠️ E A TAREFA MARCADA TAMBEM E LIMPA, senao a linha volta violando o
    # CHECK antigo (`task_created_at IS NULL OR status = 'APPROVED'`) no
    # instante em que ele e recriado.
    op.execute(
        "UPDATE public.solicitation SET status = 'PENDING', "
        "task_created_at = NULL, task_marked_by_user_id = NULL, "
        "task_ref = NULL "
        "WHERE status IN ('IN_PROGRESS', 'DONE')"
    )

    op.execute("DROP INDEX IF EXISTS solicitation_aprovadas_sem_tarefa")
    op.execute(
        "CREATE INDEX solicitation_aprovadas_sem_tarefa "
        "ON public.solicitation (workspace_id, created_at) "
        "WHERE status = 'APPROVED' AND task_created_at IS NULL"
    )

    op.execute(
        "ALTER TABLE public.solicitation "
        "DROP CONSTRAINT solicitation_task_requires_approved"
    )
    op.execute(
        "ALTER TABLE public.solicitation ADD CONSTRAINT "
        "solicitation_task_requires_approved CHECK "
        "(task_created_at IS NULL OR status = 'APPROVED')"
    )

    op.execute(
        "ALTER TABLE public.solicitation "
        "DROP CONSTRAINT solicitation_status_valid"
    )
    op.execute(
        "ALTER TABLE public.solicitation ADD CONSTRAINT "
        "solicitation_status_valid CHECK "
        "(status IN ('PENDING', 'APPROVED', 'REJECTED'))"
    )
