"""Reparo de dados: path das subtarefas e tarefas de projeto apagado

Revision ID: 0032_reparo_path_projeto
Revises: 0031_admin_fora_do_time
Create Date: 2026-10-21

Dois defeitos de dado achados na auditoria de 21/10, os dois ja corrigidos no
codigo do mesmo PR. Esta migration so conserta o que eles deixaram gravado.

1. PATH REPETIDO. `reparent_subtree` cortava o path antigo um nivel cedo
   demais, e mover uma tarefa COM FILHAS repetia o rotulo dela no path de cada
   descendente (`avo.pai.pai.filha`). O `depth` saia certo. Aqui o path de
   TODA tarefa e refeito pela cadeia de `parent_task_id`, mantendo o rotulo
   proprio (o ultimo do path, que o defeito nunca trocou). Tarefa ja certa
   recebe o mesmo valor; so as tortas mudam. A consulta 12 do
   `scripts/invariantes.sql` mede antes e depois.

2. TAREFA EM PROJETO APAGADO. Apagar projeto so marcava o projeto, e as
   tarefas dele davam 404 ao abrir. O codigo novo solta as tarefas na hora;
   aqui as que ja estavam presas ficam avulsas do mesmo jeito. Os seguidores
   que perderam alcance NAO saem por esta migration: o emissor de avisos ja
   filtra quem nao ve a tarefa.

ORDEM DO DEPLOY: tanto faz. A migration so le e grava `task`, e o codigo
velho e o novo convivem com o resultado. Rodar DEPOIS do codigo evita que um
`move` do codigo velho entorte um path entre a migration e o deploy.

Sem downgrade: desfazer seria voltar a gravar dado errado.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0032_reparo_path_projeto"
down_revision: str | None = "0031_admin_fora_do_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        WITH RECURSIVE arvore AS (
            SELECT id,
                   subpath(path, nlevel(path) - 1) AS novo,
                   0 AS nivel
            FROM task
            WHERE parent_task_id IS NULL
            UNION ALL
            SELECT t.id,
                   a.novo || subpath(t.path, nlevel(t.path) - 1),
                   a.nivel + 1
            FROM task t
            JOIN arvore a ON t.parent_task_id = a.id
        )
        UPDATE task t
        SET path = a.novo,
            depth = a.nivel
        FROM arvore a
        WHERE t.id = a.id
          AND (t.path <> a.novo OR t.depth <> a.nivel)
        """
    )
    op.execute(
        """
        UPDATE task t
        SET project_id = NULL
        FROM project p
        WHERE p.id = t.project_id
          AND p.deleted_at IS NOT NULL
        """
    )


def downgrade() -> None:
    pass
