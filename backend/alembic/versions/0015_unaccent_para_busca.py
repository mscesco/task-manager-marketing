"""extensao unaccent, para a busca do quadro ir ao servidor (Spec 042, A2)

Revision ID: 0015_unaccent_para_busca
Revises: 0014_task_due_time
Create Date: 2026-08-20

A busca do quadro roda hoje NO CLIENTE (`raizesQueCasamBusca`), varrendo a
subarvore carregada. Ela e uma das cinco coisas que obrigam o quadro a baixar
670 subtarefas para desenhar 170 cards -- e a unica que nao vira campo
agregado, porque nao ha campo que represente um termo que ainda nao foi
digitado. O proprio arquivo do front ja registrava o desfecho: *"Busca no
servidor e o conserto de verdade, e e outro tamanho."*

⚠️ A BUSCA NAO E REMOVIDA NEM REDUZIDA -- ela MELHORA. Hoje so acha o que foi
carregado, e o comentario do `raizesQueCasamBusca` avisa: subtarefa fora do
lote ou arquivada com o toggle desligado nao e encontrada. No servidor, acha
todas.

⚠️ POR QUE UMA EXTENSAO, E NAO `ILIKE` PURO. A busca do produto e SEM ACENTO:
`normalizarBusca` faz `NFD` + remove diacriticos + minuscula, para "midia"
achar "Midia Paga". `ILIKE` sozinho nao faz isso -- procurar "midia" nao
acharia "Mídia", e a busca do servidor voltaria MENOS resultado que a do
cliente que ela substitui. Regressao silenciosa, na tela mais usada.

⚠️ PRECEDENTE: a `0001_baseline_v5` ja cria `ltree` e `pgcrypto` com
`CREATE EXTENSION IF NOT EXISTS`. O usuario do banco tem o privilegio e o
padrao esta estabelecido; esta migration nao inventa nada.

⚠️ NAO CRIA INDICE, E E DE PROPOSITO. `unaccent()` e STABLE e nao IMMUTABLE,
entao um indice funcional exigiria uma funcao wrapper marcada IMMUTABLE --
mentira declarada ao planejador, que quebra se o dicionario de regras mudar. E
o seq scan e irrelevante nesta escala: 1157 linhas em `task` (producao,
19/08/2026), o mesmo argumento que o `list_stale_terminal` ja registra para a
varredura noturna. Indice aqui e peso morto mantido para sempre. Se `task`
passar da casa das centenas de milhares, a saida e `pg_trgm` com GIN -- e ai
com medicao, nao por precaucao.

⚠️⚠️ ORDEM DE DEPLOY: **MIGRATION ANTES DO CODIGO**, e isto e EXCECAO a ordem
padrao do `DEPLOY.md` (codigo antes, migration depois).

A ordem padrao vale quando o codigo NOVO nao depende do schema novo. Aqui
depende: `_casa_busca_na_subarvore` chama `unaccent()`, e se o codigo subir
primeiro, a primeira pessoa que digitar na busca do quadro toma erro de funcao
inexistente. O caminho e silencioso ate alguem buscar -- ninguem percebe no
smoke, e o defeito aparece na tela mais usada, em horario de trabalho.

Na direcao inversa nao ha risco: a extensao sozinha nao altera tabela, nao toca
dado e nao muda nada que o codigo VELHO leia -- ele simplesmente nunca chama
`unaccent()`. Entao rodar a migration antes e seguro e pode ser feito com folga,
ate em outro momento do dia.

⚠️ DIVERGENCIA CONHECIDA E ACEITA: `unaccent` e o `NFD`+strip do JavaScript
concordam em todo o conjunto do portugues (a e i o u com agudo, crase, circun-
flexo, til, trema, e o C-cedilha). Eles divergem em letras que NAO sao base +
diacritico decomponivel -- o `unaccent` mapeia coisas como o O-cortado e o
eszett, o `NFD` deixa passar. Nenhuma aparece no conteudo deste produto, e a
`/minhas-tarefas` continua buscando no cliente, entao as duas telas podem
divergir nesses casos. Medido como irrelevante, registrado para nao virar
misterio.

⚠️ REVERSIVEL: o `downgrade` derruba a extensao. Como nenhum indice nem coluna
gerada depende dela, o `DROP` nao cascateia em dado nenhum -- so faz a busca do
servidor parar de compilar, que e o estado anterior a esta fatia.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0015_unaccent_para_busca"
down_revision: str | None = "0014_task_due_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQL cru: convencao das migrations deste repo (0005, 0008, 0009, 0010,
    # 0013, 0014). `IF NOT EXISTS` deixa a migration idempotente, igual as
    # duas extensoes da baseline.
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;")


def downgrade() -> None:
    # Sem CASCADE de proposito: se um dia algum indice ou coluna gerada passar
    # a depender de `unaccent`, este DROP tem de FALHAR e obrigar quem
    # escreveu a tratar a dependencia -- e nao apagar o objeto junto em
    # silencio.
    op.execute("DROP EXTENSION IF EXISTS unaccent;")
