"""O slug da secao e unico dentro do formulario (Spec 043, achado do review).

⚠️⚠️ O SLUG DA SECAO E CHAVE DE DADO, e nada garantia que fosse unico. Ele
viaja gravado em cada pedido (`solicitation_item.category`), e duas secoes com
o mesmo slug tornam o pedido AMBIGUO: a fila monta o dicionario de rotulos por
`(form_id, slug)` e a segunda linha SOBRESCREVE a primeira, entao o pedido
aparece com o titulo e o emoji da secao ERRADA. Sem erro em lugar nenhum.

⚠️ E A FATIA C2 PROTEGEU O LADO ERRADO: la esta escrito, com todas as letras,
que o slug da secao NAO PODE MUDAR porque fica gravado no pedido -- e nunca se
impediu que dois nascessem iguais. Os dois quebram a mesma coisa.

⚠️ O INDICE E PARCIAL (`WHERE deleted_at IS NULL`), como o do formulario:
reaproveitar o slug de uma secao apagada e legitimo.

⚠️⚠️ E ELE PODE FALHAR NUM BANCO QUE JA TENHA DUPLICATA -- por isso a
migration CONFERE ANTES e levanta com os slugs NOMEADOS. Um
`UniqueViolation` cru do Postgres nao diz qual formulario nem qual endereco
esta repetido, e quem estiver fazendo o deploy as 22h precisa saber onde
mexer. Se isto explodir, a saida e renomear ou apagar a secao duplicada e
rodar de novo.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0021_slug_de_secao_unico"
down_revision: str | None = "0020_cabecalho_do_formulario"
branch_labels: str | None = None
depends_on: str | None = None

_INDICE = "solicitation_section_slug_unico"


def upgrade() -> None:
    conn = op.get_bind()

    # ⚠️ A CONFERENCIA VEM ANTES, e ela existe para a mensagem. Ver o topo.
    duplicadas = conn.execute(
        sa.text(
            "SELECT form_id, slug, count(*) AS n "
            "FROM solicitation_section "
            "WHERE deleted_at IS NULL "
            "GROUP BY form_id, slug HAVING count(*) > 1"
        )
    ).all()
    if duplicadas:
        detalhe = "; ".join(
            f"formulario {linha.form_id} tem {linha.n} secoes com o "
            f"endereco '{linha.slug}'"
            for linha in duplicadas
        )
        raise RuntimeError(
            "Ha secoes com endereco repetido no mesmo formulario, e o indice "
            "unico nao pode ser criado enquanto existirem. Renomeie ou apague "
            f"as duplicadas e rode de novo. {detalhe}"
        )

    op.execute(
        f"CREATE UNIQUE INDEX {_INDICE} "
        "ON public.solicitation_section (form_id, slug) "
        "WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_INDICE}")
