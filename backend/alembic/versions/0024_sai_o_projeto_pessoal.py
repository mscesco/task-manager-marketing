"""Sai o projeto pessoal -- `project.is_personal` (reverte a ADR 0001).

O QUE ELA FAZ, em quatro passos:

    1. apaga os projetos pessoais;
    2. derruba o indice parcial `project_personal_per_user`;
    3. recria o CHECK `project_team_required_when_common` sem o `is_personal OR`;
    4. derruba a coluna `is_personal`.

⚠️⚠️ E ELA E DE SCHEMA, ao contrario da tentativa de backfill de quadro que a
Camila cortou no mesmo dia. A coluna existe em producao, a ADR 0001 foi
implementada de verdade, e nenhum ambiente novo deve nascer com ela. Migration
de DADO para uma linha de dev e query no Adminer; migration de SCHEMA que muda
o que todo ambiente tem e migration.

⚠️⚠️ O PASSO 1 APAGA LINHA, e a medicao e o que o torna aceitavel: em 10/09,
`SELECT count(t.id) ... WHERE p.is_personal` devolveu **29 projetos pessoais,
todos com ZERO tarefas**, e nunca existiu tela que os expusesse (a rota
`GET /me/personal-project` existia e o front nunca a chamava). E um `DELETE`
sem perda de trabalho de ninguem.

⚠️ E o `DELETE` e FISICO, e nao soft. Soft-delete deixaria 29 linhas com
`team_id NULL` no banco, e o CHECK novo as toleraria pelo ramo do `deleted_at`
-- ou seja, sobreviveriam justamente as linhas que a spec veio dizer que nao
podem existir. Elas nao carregam historico: sem tarefa, nao houve trabalho.

⚠️ ORDEM IMPORTA, e errar produz falha de deploy: o CHECK novo exige
`team_id IS NOT NULL` para linha viva, e projeto pessoal tem `team_id` NULO.
Recriar o CHECK antes de apagar os pessoais faria o `ALTER TABLE ... ADD
CONSTRAINT` recusar, com a tabela ja no meio da migration.

⚠️ O `downgrade` DEVOLVE A COLUNA E O SCHEMA, e nao os dados. Os 29 pessoais
nao voltam -- eles estavam vazios, e adivinhar quais existiam seria inventar
dado. Descer e voltar a poder criar pessoal, nao ressuscitar os antigos.
"""

from __future__ import annotations

from alembic import op

revision: str = "0024_sai_o_projeto_pessoal"
down_revision: str | None = "0023_varias_areas"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # 1) Os pessoais saem. Ver o cabecalho: medidos vazios em 10/09.
    #
    # ⚠️ `task` primeiro, e nao por precaucao: `task.project_id` tem FK, e uma
    # tarefa que tivesse escapado da medicao bloquearia o DELETE com
    # `ForeignKeyViolation` no meio do deploy. Zero linhas hoje; a linha existe
    # para o dia em que alguem rodar esta migration num banco que nao e o que
    # eu medi.
    op.execute(
        """
        DELETE FROM task
         WHERE project_id IN (SELECT id FROM project WHERE is_personal);
        """
    )
    op.execute("DELETE FROM project WHERE is_personal;")

    # 2) O indice parcial que garantia um pessoal por pessoa.
    op.execute("DROP INDEX IF EXISTS public.project_personal_per_user;")

    # 3) O CHECK, sem o ramo do pessoal.
    #
    # ⚠️ O NOME FICA IGUAL de proposito. Ele nomeia a invariante ("projeto
    # comum exige time"), nao a formula -- e trocar o nome faria o portao de
    # drift acusar divergencia entre o model e o banco.
    op.execute(
        "ALTER TABLE project DROP CONSTRAINT IF EXISTS "
        "project_team_required_when_common;"
    )
    op.execute(
        """
        ALTER TABLE project ADD CONSTRAINT project_team_required_when_common
            CHECK (team_id IS NOT NULL OR deleted_at IS NOT NULL);
        """
    )

    # 4) A coluna.
    op.execute("ALTER TABLE project DROP COLUMN is_personal;")


def downgrade() -> None:
    # A coluna volta com o mesmo default da `0002`, que e o que permitia a
    # linha pre-existente conviver com ela.
    op.execute(
        "ALTER TABLE project ADD COLUMN is_personal boolean NOT NULL "
        "DEFAULT false;"
    )
    op.execute(
        "ALTER TABLE project DROP CONSTRAINT IF EXISTS "
        "project_team_required_when_common;"
    )
    op.execute(
        """
        ALTER TABLE project ADD CONSTRAINT project_team_required_when_common
            CHECK (is_personal OR team_id IS NOT NULL OR deleted_at IS NOT NULL);
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX project_personal_per_user
            ON public.project USING btree (workspace_id, created_by)
            WHERE (is_personal = true);
        """
    )
