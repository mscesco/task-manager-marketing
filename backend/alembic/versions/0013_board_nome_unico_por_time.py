"""nome unico de quadro por time (Spec 036, fatia 9)

Revision ID: 0013_board_nome_unico_por_time
Revises: 0012_board_soft_delete
Create Date: 2026-08-18

Ate 18/08 nada impedia dois quadros de mesmo nome no mesmo time. A conferencia
visual de 17/08 mostrou TRES quadros "Quadro CRM Teste" no mesmo subtime, e o
sistema aceitou os tres sem reclamar.

⚠️ POR QUE ISTO E PRE-REQUISITO DE APAGAR QUADRO (fatia 7). Aquela fatia
confirma a exclusao pedindo que a pessoa DIGITE o nome do quadro. Com tres
quadros de mesmo nome, digitar o nome nao diz qual dos tres -- a confirmacao
vira teatro. E teatro numa operacao que apaga as tarefas de dentro e pior que
nenhuma confirmacao, porque produz a sensacao de ter conferido.

⚠️ MAIUSCULA CONTA (decisao de 18/08, com o custo na mesa). "Backlog" e
"backlog" sao nomes DIFERENTES e os dois podem existir. A alternativa era
indexar `lower(name)`, e ela foi recusada: "sao diferentes visualmente". Se um
dia isso incomodar, o conserto e uma migration propria trocando o indice por
`lower(name)` -- e ela vai FALHAR se ja existirem duas variantes gravadas.

⚠️ INDICE PARCIAL, `WHERE deleted_at IS NULL` (decisao de 18/08). Quadro
apagado NAO ocupa o nome. Sem o `WHERE`, um quadro apagado bloquearia o nome
dele para sempre e a tela diria "ja existe um quadro com esse nome" apontando
para algo que a pessoa nao consegue ver nem achar. Mesma tecnica do
`board_um_padrao_por_time`, que ja esta neste modelo.

⚠️ SO QUADRO. `board_column` NAO ganha indice, e a ausencia e decisao medida em
18/08, nao esquecimento: o modo de edicao aplica as colunas em LOTE, em quatro
etapas sequenciais (criar -> renomear -> apagar -> reordenar), cada uma com
`flush`. Um indice unico em `(board_id, name)` recusaria DUAS operacoes
legitimas no estado INTERMEDIARIO:

  - trocar duas colunas de nome entre si -- no meio da troca as duas se chamam
    igual por um instante;
  - apagar "Aprovacao" e criar outra "Aprovacao" no mesmo gesto, que e
    literalmente o caso de uso que o lote existe para permitir.

E recusaria com `IntegrityError`, que sai como **500** -- e nao como o 422 com
`code` que a tela sabe ler. A regra da coluna mora no servico
(`_assert_nomes_do_lote`), conferindo o resultado FINAL do lote, e a vigilancia
e a consulta 9 do `invariantes.sql`. **E o mesmo arranjo de
`_assert_ponte_sobrevive` e da invariante "tarefa viva em quadro apagado", as
duas ja aplicacao-com-consulta-vigiando.**

⚠️ ORDEM DE DEPLOY: MIGRATION ANTES DO CODIGO, como as anteriores. Aqui o risco
e pequeno (indice novo nao muda leitura), mas o codigo novo devolve 422 antes
de o banco recusar, e subir o codigo primeiro so significa que a regra vale
antes da garantia. Nao inverta por habito.

⚠️ ELA FALHA SE JA HOUVER DUPLICATA, E ISSO E DE PROPOSITO. Em PRODUCAO nao ha:
um quadro so ("Quadro geral"), medido pela consulta 5 do `invariantes.sql` em
10/08. Em DESENVOLVIMENTO ha -- os tres criados na conferencia de 17/08. O
conserto e RENOMEAR pela tela (o seletor de quadros ja tem "Renomear" ao lado
de cada um); apagar nao serve, porque apagar quadro ainda nao existe (fatia 7).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_board_nome_unico_por_time"
down_revision: str | None = "0012_board_soft_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conexao = op.get_bind()

    # ⚠️ CONFERE ANTES DE CRIAR, PARA DAR UMA MENSAGEM QUE RESOLVE. O
    # `CREATE UNIQUE INDEX` sozinho ja falharia, mas com um erro do Postgres
    # que diz "could not create unique index" e a chave que colidiu -- sem
    # dizer QUAIS quadros, em qual time, nem o que fazer. Quem roda isto esta
    # num terminal de deploy, e a diferenca entre as duas mensagens e entre
    # resolver em um minuto e abrir o banco na mao.
    duplicados = conexao.execute(
        sa.text(
            """
            SELECT team_id, name, count(*) AS quantos
            FROM public.board
            WHERE deleted_at IS NULL
            GROUP BY team_id, name
            HAVING count(*) > 1
            ORDER BY quantos DESC
            """
        )
    ).all()
    if duplicados:
        linhas = "; ".join(
            f"time {d.team_id} tem {d.quantos} quadros chamados {d.name!r}"
            for d in duplicados
        )
        raise RuntimeError(
            f"[0013] Ha nome de quadro repetido no mesmo time: {linhas}. "
            "RENOMEIE pela tela antes de rodar -- o seletor de quadros tem "
            "'Renomear' ao lado de cada um. Nao tente apagar: apagar quadro "
            "ainda nao existe (fatia 7 da Spec 036). Em producao isto nao "
            "acontece (um quadro so); em desenvolvimento acontece se voce "
            "criou duplicatas conferindo a fatia 6."
        )

    # SQL cru: convencao das migrations deste repo (0005, 0008, 0009, 0010).
    #
    # ⚠️ O NOME DO INDICE E COMPARADO PELO PORTAO DE DRIFT. Ele tem de ser
    # identico ao declarado em `app/db/models/boards.py`, caractere a
    # caractere, ou o `autogenerate` do CI passa a propor a diferenca para
    # sempre -- e portao vermelho permanente vira ruido que as pessoas
    # aprendem a ignorar.
    op.execute(
        """
        CREATE UNIQUE INDEX board_nome_unico_por_time
            ON public.board (team_id, name)
            WHERE deleted_at IS NULL;
        """
    )


def downgrade() -> None:
    """Derruba o indice.

    ⚠️ SEM PERDA DE DADO. O indice nao guarda nada; rebobinar so volta a
    aceitar nome repetido. O que NAO volta sozinho e a validacao do servico --
    ela e codigo, e vive com o `main` que estiver deployado.
    """
    op.execute("DROP INDEX IF EXISTS public.board_nome_unico_por_time;")
