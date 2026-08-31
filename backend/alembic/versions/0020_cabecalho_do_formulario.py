"""O cabecalho do formulario deixa de ser fixo (Spec 043, fatia G).

⚠️⚠️ CINCO CAMPOS DE IDENTIFICACAO ESTAVAM ESCRITOS NO CODIGO do front, todos
obrigatorios, e tres deles sao vocabulario da FECAF -- "Polo" nao significa
nada num formulario de TI. A Camila viu isso ao criar o segundo formulario:
*"nao e todo formulario que chama fazae tambem e tals, muitas variaveis ai"*.

Esta migration faz duas coisas:

  1. **`solicitation_form` ganha tres rotulos.** ⚠️ CADA COLUNA GUARDA O NOME,
     e nao um booleano "pede" ao lado de um texto "como chama": `NULL` =
     **nao pergunta**, texto = "pergunta com este nome". Duas colunas por campo
     deixariam existir o estado sem sentido `pede=False, label='Polo'`.

     ⚠️ E O `server_default` MANTEM O QUE JA EXISTE -- todo formulario ja
     criado continua pedindo os cinco campos com os nomes de sempre.

  2. **`solicitation.requester_{phone,department,polo}` deixam de ser NOT
     NULL.** `NULL` passa a significar "este formulario nao perguntou", que e
     diferente de "" ("perguntou e ficou em branco").

     ⚠️ `requester_name` E `requester_email` CONTINUAM OBRIGATORIOS. A fila e
     organizada por quem pediu, e a resposta automatica de mudanca de status
     (fatia F) so existe se houver endereco -- torna-los opcionais quebraria a
     funcionalidade seguinte.

⚠️ NENHUMA LINHA EXISTENTE E TOCADA: soltar um NOT NULL nao reescreve nada, e
os valores que ja estao la continuam la.

⚠️ O `downgrade` PODE FALHAR, E ISSO E CORRETO. Se ja houver solicitacao com
telefone/area/polo nulos -- ou seja, se algum formulario ja tiver sido
publicado sem esses campos --, voltar o NOT NULL e impossivel sem inventar
dado. Preencher com "" faria a fila mostrar campos vazios como se a pessoa
tivesse deixado em branco, o que e mentira. Melhor o `ALTER` recusar e quem
estiver revertendo decidir na hora.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0020_cabecalho_do_formulario"
down_revision: str | None = "0019_solicitacao_task_id"
branch_labels: str | None = None
depends_on: str | None = None

_ROTULOS = (
    ("phone_label", "Telefone", 60),
    ("department_label", "Área / Departamento", 60),
    ("polo_label", "Polo", 60),
)
_OPCIONAIS = ("requester_phone", "requester_department", "requester_polo")


def upgrade() -> None:
    for coluna, padrao, tamanho in _ROTULOS:
        op.add_column(
            "solicitation_form",
            sa.Column(
                coluna,
                sa.String(length=tamanho),
                nullable=True,
                server_default=padrao,
            ),
        )

    for coluna in _OPCIONAIS:
        op.alter_column("solicitation", coluna, nullable=True)


def downgrade() -> None:
    # ⚠️ ESTE `ALTER` FALHA se algum pedido ja tiver chegado sem os campos --
    # e falhar e o certo. Ver o aviso no topo do arquivo.
    for coluna in _OPCIONAIS:
        op.alter_column("solicitation", coluna, nullable=False)

    for coluna, _padrao, _tamanho in _ROTULOS:
        op.drop_column("solicitation_form", coluna)
