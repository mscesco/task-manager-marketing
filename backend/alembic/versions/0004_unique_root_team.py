"""um unico time raiz por workspace

Revision ID: 0004_unique_root_team
Revises: 0003_deadline_notif_flags
Create Date: 2026-07-22

Spec 024, D2. Transforma "time principal" de CONVENCAO em FATO ESTRUTURAL.

Ate aqui, o time principal era identificado por convencao: o seed procura
`slug='marketing' AND parent_team_id IS NULL`. Nada no banco impedia um
segundo time raiz -- e, se ele existisse, o sistema nao teria como dizer
qual dos dois manda.

Com este indice, "o time raiz" e "o time principal" viram a mesma coisa por
definicao, e o `team_scope.root_of()` que ja existe passa a devolver a
resposta certa sem ambiguidade. E o que sustenta a invariante de papeis
(ADMIN/MANAGER so na raiz).

INDICE PARCIAL: so linhas com `parent_team_id IS NULL` ocupam vaga. Subtimes
sao ilimitados. Como `team` NAO tem soft-delete (verificado: apenas
UUIDPrimaryKeyMixin + TimestampMixin), nao ha risco de linha apagada
segurando a vaga da raiz.

SEM BACKFILL: producao ja esta conforme. Verificado por query antes desta
spec -- nenhum workspace com mais de uma raiz.

ATENCAO (Spec 024, D4): este indice torna dois caminhos existentes
capazes de estourar IntegrityError:
    - TeamService.create(parent_team_id=None)
    - TeamService.move(new_parent_id=None)
A Fatia 2 adiciona a checagem de dominio ANTES do flush nos dois. Sem ela,
essas rotas respondem HTTP 500 em vez de 409.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_unique_root_team"
down_revision: str | None = "0003_deadline_notif_flags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


STATEMENTS: tuple[str, ...] = (
    """
    CREATE UNIQUE INDEX team_unica_raiz_por_workspace
        ON public.team (workspace_id)
        WHERE parent_team_id IS NULL;
    """,
    """
    COMMENT ON INDEX public.team_unica_raiz_por_workspace IS
        'Spec 024/D2: um unico time raiz por workspace. Torna "time '
        'principal" um fato estrutural, e nao convencao de slug.';
    """,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.team_unica_raiz_por_workspace;")
