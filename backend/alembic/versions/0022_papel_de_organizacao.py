"""Papel de ORGANIZACAO -- `users.org_role` (Spec 045, fatia B).

⚠️⚠️ ESTA E A UNICA MIGRATION DO PROJETO QUE ENCOSTA EM QUEM ADMINISTRA O
SISTEMA. Leia o paragrafo abaixo antes de rodar.

O QUE ELA FAZ -- e so isto:

  1. cria o tipo `org_role` (ADMIN, GESTOR);
  2. acrescenta `users.org_role`, NULL-avel;
  3. PREENCHE `org_role = 'ADMIN'` para quem hoje tem uma linha ADMIN em
     `user_team`.

⚠️⚠️ O QUE ELA **NAO** FAZ, DE PROPOSITO: ela nao remove nem rebaixa vinculo
nenhum. Depois dela, quem era ADMIN continua ADMIN em `user_team` **e** passa a
ser ADMIN de organizacao -- duas fontes dizendo a mesma coisa, de proposito.

    O codigo desta fatia aceita as DUAS. Se a migration tirasse os vinculos,
    existiria uma janela entre o `alembic upgrade` e o container novo subir em
    que o codigo VELHO le `user_team`, nao acha ADMIN nenhum, e o workspace
    fica sem quem administre. A invariante que esta fatia inventa ("a
    organizacao nunca fica sem ADMIN") vale para o deploy tambem.

    A limpeza e passo 2, MANUAL, depois de o novo estar no ar e conferido --
    decisao da Camila em 02/09. Sao duas linhas no Adminer:

        -- a conta de administracao sai de time nenhum
        DELETE FROM user_team WHERE user_id = <admin> ;
        -- a chefe deixa de ser admin e vira gestora da arvore
        UPDATE user_team SET role = 'MANAGER' WHERE user_id = <chefe> ;
        UPDATE users SET org_role = NULL WHERE id = <chefe> ;

    Uma fatia posterior remove do CODIGO a fonte velha, quando o dado ja
    estiver limpo. Enquanto as duas existirem, `is_admin` responde `True` para
    qualquer uma -- ver `team_scope.is_admin`.

⚠️ MEDIDO EM 02/09: sao DOIS admins em producao (a Camila e a chefe dela), e o
acordo entre as duas ja esta feito -- a Camila fica como unica ADMIN, sem time;
a chefe vira MANAGER da raiz. A migration nao decide isso, so garante que
nenhuma das duas perca acesso no caminho.

⚠️ `GESTOR` nasce no enum e SEM NINGUEM. O papel existe para a tela da Spec 047
poder atribui-lo; ninguem e gestor hoje.

⚠️ O `downgrade` apaga a coluna e o tipo. Ele NAO restaura vinculo nenhum --
nao precisa, porque esta migration nao removeu nenhum. Se a limpeza manual (o
passo 2) ja tiver rodado, **descer daqui deixa o workspace sem ADMIN**, e e por
isso que o passo 2 so acontece depois de a fatia estar confirmada no ar.
"""

from __future__ import annotations

from alembic import op

revision: str = "0022_papel_de_organizacao"
down_revision: str | None = "0021_slug_de_secao_unico"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TYPE public.org_role AS ENUM ('ADMIN', 'GESTOR');
        """
    )
    op.execute(
        """
        ALTER TABLE public.users
            ADD COLUMN org_role public.org_role;
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN public.users.org_role IS
        'Papel na ORGANIZACAO (sem time). NULL = nenhum. Spec 045, fatia B.';
        """
    )
    # ⚠️ O BACKFILL E ADITIVO E IDEMPOTENTE. Ele nao toca em `user_team`; so
    # espelha para o nivel novo quem ja administra hoje. `DISTINCT` porque a
    # pessoa pode -- em teoria -- ter mais de um vinculo ADMIN.
    op.execute(
        """
        UPDATE public.users u
           SET org_role = 'ADMIN'
         WHERE EXISTS (
                   SELECT 1
                     FROM public.user_team ut
                    WHERE ut.user_id = u.id
                      AND ut.workspace_id = u.workspace_id
                      AND ut.role = 'ADMIN'
               );
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.users DROP COLUMN IF EXISTS org_role;")
    op.execute("DROP TYPE IF EXISTS public.org_role;")
