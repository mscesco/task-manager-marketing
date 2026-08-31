"""A solicitacao aponta para a TAREFA de verdade (Spec 043, fatia E).

⚠️ `task_ref` FICA, e nao e indecisao. Ele e texto livre e guarda o que os
triadores escreveram durante meses -- "quadro do Design", uma URL, as vezes so
"feito". Nao ha como converter isso em id, e apagar a coluna perderia o unico
rastro que aquelas solicitacoes tem. Os dois convivem: `task_id` para o que
nasce daqui em diante, `task_ref` como registro do que ja foi marcado.

⚠️ FK COMPOSTA COM `workspace_id`, como o resto do schema -- sem ela alguem
poderia pendurar uma solicitacao numa tarefa de outro cliente. Ela exige o
`uq_task_id_workspace`, que ja existe desde a 0001.

⚠️ `ON DELETE SET NULL` E NAO `CASCADE`: apagar a tarefa nao pode apagar o
pedido. O pedido e o registro de que alguem pediu, e sobrevive a tarefa que
dele nasceu -- volta a ser "aceito sem tarefa", que e exatamente o que o filtro
da fila existe para achar.

⚠️ E NENHUMA LINHA EXISTENTE E TOCADA. Toda solicitacao ja marcada continua com
o `task_ref` que tinha e com `task_id` nulo; a tela mostra os dois.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "0019_solicitacao_task_id"
down_revision: str | None = "0018_status_andamento_concluida"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "solicitation",
        sa.Column("task_id", PG_UUID(as_uuid=True), nullable=True),
    )
    # ⚠️ SQL CRU PELO MESMO MOTIVO DA 0018: a `naming_convention` do projeto e
    # aplicada ao nome que se PASSA, e as constraints desta tabela nasceram na
    # 0005 com nome literal. `solicitation_task` segue a familia
    # (`solicitation_reviewed_by`, `solicitation_task_marked_by`).
    op.execute(
        "ALTER TABLE public.solicitation "
        "ADD CONSTRAINT solicitation_task "
        "FOREIGN KEY (task_id, workspace_id) "
        "REFERENCES public.task (id, workspace_id) "
        "ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.solicitation DROP CONSTRAINT solicitation_task"
    )
    op.drop_column("solicitation", "task_id")
