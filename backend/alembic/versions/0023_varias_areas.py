"""Varias AREAS por workspace -- cai o indice de raiz unica (Spec 046, fatia 2).

O QUE ELA FAZ, e e so isto:

    DROP INDEX team_unica_raiz_por_workspace

O indice era UNICO e PARCIAL (`WHERE parent_team_id IS NULL`): permitia um
unico time sem pai por workspace. Sem ele, Marketing, TI e Design podem ser
irmaos, sem pai comum -- que e a decisao da Camila de 31/08/2026.

⚠️⚠️ ELA E SEGURA COM O CODIGO VELHO NO AR, e por um motivo que vale escrever:
remover um indice nao muda nenhuma linha e nao altera nenhuma leitura. O
codigo velho continua criando UMA raiz porque a checagem de dominio
(`TeamService.create`) tambem barrava -- e ela sai no mesmo commit, no
codigo. Ou seja: **a ordem padrao do DEPLOY.md vale** (`build` -> `up` ->
migration). Nao ha coluna nova em model existente, nao ha extensao, nao ha
funcao nova. Nenhuma das duas excecoes se aplica.

⚠️⚠️ MAS O `downgrade` PODE FALHAR, E ISSO E DE PROPOSITO. Recriar um indice
UNICO num workspace que ja tem duas areas e impossivel -- o Postgres recusa,
e a mensagem nomeia o indice. Se isso acontecer:

    1. NAO force. A recusa esta dizendo que existe dado que o schema antigo
       nao comporta -- exatamente o que um downgrade deveria dizer.
    2. Decida QUAL area continua sendo a unica, e mova as outras para baixo
       dela (`POST /teams/{id}/move`) ou apague-as, ANTES de descer.

Isso nao e um defeito desta migration: e a unica forma honesta de descer.
Uma versao que "desse um jeito" escolheria por conta propria qual area some.

⚠️ E HA UM CAMINHO SEM VOLTA REAL: se alguem ja tiver criado a segunda area em
producao, o downgrade so passa depois de alguem decidir o que fazer com ela.
Por isso a fatia 4 (a area vem pela URL) deve estar no ar antes de a segunda
area ser criada -- ate la, o front ainda pergunta "qual e a raiz?".
"""

from __future__ import annotations

from alembic import op

revision: str = "0023_varias_areas"
down_revision: str | None = "0022_papel_de_organizacao"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.team_unica_raiz_por_workspace;")


def downgrade() -> None:
    # ⚠️ Recria EXATAMENTE como a `0004` criou -- inclusive o COMMENT, senao o
    # portao de drift acusa divergencia entre subir e descer.
    #
    # ⚠️ FALHA DE PROPOSITO se ja houver duas areas. Ver o cabecalho.
    op.execute(
        """
        CREATE UNIQUE INDEX team_unica_raiz_por_workspace
            ON public.team (workspace_id)
            WHERE parent_team_id IS NULL;
        """
    )
    op.execute(
        """
        COMMENT ON INDEX public.team_unica_raiz_por_workspace IS
            'Spec 024/D2: um unico time raiz por workspace.';
        """
    )
