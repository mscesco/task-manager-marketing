"""user_team_role sem ADMIN -- o papel de time ADMIN deixa de existir

Revision ID: 0031_admin_fora_do_time
Revises: 0030_secao_repetivel
Create Date: 2026-10-19

ADMIN e papel de ORGANIZACAO desde a Spec 045 (`users.org_role`, migration
0022). O valor continuou no tipo `user_team_role` porque producao ainda tinha
vinculos ADMIN em `user_team`; em 16/10/2026 a contagem deu zero, e o codigo
parou de ler essa fonte.

O Postgres nao tem `ALTER TYPE ... DROP VALUE`, entao o tipo e TROCADO: o
velho e renomeado, o novo nasce com os tres papeis, a coluna converte pelo
texto e o velho e apagado. Nada mais depende do tipo (nenhum indice, trigger
ou CHECK cita `user_team.role`).

⚠️ ORDEM DO DEPLOY: CODIGO ANTES DA MIGRATION. O codigo velho compara
`user_team.role` com 'ADMIN' em SQL (o fallback do job de arquivamento), e
essa comparacao da erro de valor invalido no tipo novo. O codigo novo nao cita
ADMIN e convive com o tipo velho.

⚠️ SE SOBROU ALGUM VINCULO ADMIN, a migration PARA com a contagem, antes de
mexer em qualquer coisa -- sem ela, o erro seria o do cast, que nao diz qual
linha nem o que fazer.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0031_admin_fora_do_time"
down_revision: str | None = "0030_secao_repetivel"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE n integer;
        BEGIN
            SELECT count(*) INTO n FROM user_team WHERE role = 'ADMIN';
            IF n > 0 THEN
                RAISE EXCEPTION
                    'user_team tem % vinculo(s) ADMIN. Passe a pessoa para '
                    'users.org_role = ''ADMIN'' e apague o vinculo antes.', n;
            END IF;
        END $$;
        """
    )
    op.execute("ALTER TYPE user_team_role RENAME TO user_team_role_old")
    op.execute(
        "CREATE TYPE user_team_role AS ENUM ('MANAGER', 'SUPERVISOR', 'OPERATOR')"
    )
    op.execute(
        "ALTER TABLE user_team ALTER COLUMN role TYPE user_team_role "
        "USING role::text::user_team_role"
    )
    op.execute("DROP TYPE user_team_role_old")


def downgrade() -> None:
    op.execute("ALTER TYPE user_team_role RENAME TO user_team_role_old")
    op.execute(
        "CREATE TYPE user_team_role AS ENUM "
        "('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')"
    )
    op.execute(
        "ALTER TABLE user_team ALTER COLUMN role TYPE user_team_role "
        "USING role::text::user_team_role"
    )
    op.execute("DROP TYPE user_team_role_old")
