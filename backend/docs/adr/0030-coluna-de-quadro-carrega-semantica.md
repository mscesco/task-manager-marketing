# 0030 — Coluna de quadro carrega semântica

## Status

Accepted — refinada pela **0032** e pela **0033**.

> A fatia 1 da Spec 035 (migration `0008`) subiu para produção em 06/08/2026:
> `board`, `board_column`, semântica, destino marcado e `terminal_since`
> existem no banco. O que ainda não existe é escrita (fatia 3) e o front lendo
> colunas do quadro.
>
> ⚠️ **O item 1 da §Migração deste ADR ("um quadro padrão por time existente")
> está CANCELADO** — contradizia a §Decisão deste mesmo arquivo ("um por
> workspace") e foi a origem da contradição resolvida pela `0032`. Vale a
> §Decisão.
>
> ⚠️ **Os nomes de campo aqui estão em português; o código está em inglês.**
> Tabela de correspondência na `0032`. O código está certo.
>
> ⚠️ **A DERIVAÇÃO ESTÁ INVERTIDA POR ORA (0033).** Este ADR decide que
> `task.status` é derivado da coluna. Está certo, mas cedo: com quatro
> semânticas para oito colunas, derivar nessa direção apaga `PLANNED`,
> `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED`. Até o front ler as colunas do
> banco, a coluna é derivada do STATUS. Ordem completa e motivo na `0033`.

## Contexto

A demanda é quadro personalizável por time e por subtime: colunas com
nome, cor e ordem próprios, como Trello ou Runrun.it. Hoje "coluna" não
existe como entidade — a coluna **é** o `task.status`, um ENUM **nativo**
do Postgres com sete valores (`BACKLOG`, `PLANNED`, `IN_PROGRESS`,
`IN_REVIEW`, `BLOCKED`, `COMPLETED`, `CANCELLED`).

A conta de referências é grande mas não é o problema: 39 ocorrências em
9 arquivos do backend, 104 em 16 do front. Trabalho braçal.

**O problema é que quatro subsistemas dependem do SIGNIFICADO do status,
não do rótulo:**

1. **Cascata de conclusão** (`TaskService.update` → `complete_descendants`)
   — concluir o pai conclui a subárvore. Precisa saber o que é "concluída".
2. **Varredura de arquivamento** (`archive_stale`, agendada no n8n) —
   arquiva o que é terminal e está parado há N dias. Precisa saber o que é
   "terminal".
3. **Checklist e proporção** no `TaskDetail` — "3 de 7 concluídas" conta
   concluídas e ignora canceladas. As duas semânticas **não** são
   intercambiáveis.
4. **Aviso de prazo** (`DeadlineNotifyService`) — não avisa sobre
   concluída, cancelada **nem bloqueada**. Este último é uma quinta
   informação que hoje mora no nome do status: "não há o que cobrar
   enquanto travada".

Onze pontos do backend perguntam explicitamente por `COMPLETED` ou
`CANCELLED`. Se a coluna virar texto livre, esses onze pontos param de
funcionar **em silêncio**: o job arquiva errado, a proporção mente, o
aviso de prazo não dispara. Nada disso levanta exceção nem aparece em
teste — é a assinatura de defeito que esta base já produziu três vezes
em uma única sessão.

O Trello pode ter listas burras porque nada depende delas. Aqui, depende.

## Decisão

**A coluna é uma entidade de primeira classe e DECLARA o que significa.**
O `task.status` continua existindo como espinha semântica e passa a ser
**derivado** da coluna.

### Modelo

**`board`** — pertence a um time (`team_id`). **Só existem dois tipos:**

- **O quadro geral**, do time raiz. **Um por workspace.** É onde vivem as
  tarefas de todos os times, incluindo as internas de cada subtime.
- **Quadros personalizados**, criados por um subtime para se organizar
  por dentro.

⚠️ **O "quadro do subtime" NÃO é um quadro.** Hoje ele já é o quadro geral
com a lente do subtime aplicada (`<Board subteamId={...} />` filtra a mesma
lista). Isso continua igual, e é uma decisão, não um detalhe de
implementação: se cada subtime tivesse um quadro próprio espelhando as
colunas do geral, existiriam oito cópias das mesmas colunas para manter
sincronizadas, e elas divergiriam. Um conjunto de colunas, oito lentes.

Consequência direta: **o quadro padrão do subtime não é personalizável** —
não há o que personalizar, as colunas são as do geral. Quem quer colunas
próprias cria um quadro personalizado.

**`board_column`** — pertence a um quadro:

| campo | papel |
|---|---|
| `name`, `color`, `position` | o que a pessoa vê e configura |
| `semantica` | ENUM novo: `ABERTA`, `EM_ANDAMENTO`, `CONCLUIDA`, `CANCELADA` |
| `avisa_prazo` | bool, default `true` — desliga o aviso de prazo naquela coluna |

**`task`** ganha `board_id` e `column_id`, os dois `NOT NULL`, com **FK
composta** `(column_id, board_id) → board_column(id, board_id)`. É a mesma
técnica que o schema já usa para tenancy, e é o que impede no BANCO que
uma tarefa aponte para coluna de outro quadro. Sem isso, essa
inconsistência é inevitável e só aparece na tela.

`task.status` **nunca mais é escrito pelo cliente**. Move-se a tarefa de
coluna; o serviço grava o status a partir de `column.semantica`
(`ABERTA→BACKLOG`, `EM_ANDAMENTO→IN_PROGRESS`, `CONCLUIDA→COMPLETED`,
`CANCELADA→CANCELLED`). Os onze pontos que perguntam pela semântica
continuam funcionando sem saber que colunas existem.

### `avisa_prazo` em vez de uma quinta semântica

`BLOCKED` hoje carrega comportamento (não recebe aviso de prazo). Virar
semântica `BLOQUEADA` resolveria só esse caso. A flag por coluna resolve o
caso geral: o time cria "Aguardando cliente" e desliga o aviso ali. É
mais barato e entrega mais.

### Quem configura e quem enxerga

**O quadro geral é estruturado só pelo time raiz.** Configurar colunas
exige `team.manage`, que pertence a ADMIN e MANAGER — e, pela invariante
da Spec 024, **esses dois papéis só existem no time raiz**. A regra sai de
graça: nenhuma permissão nova, nenhuma checagem de nível a mais.

**Quadro personalizado é criado pelo SUPERVISOR do subtime.** Permissão
nova `board.manage.subteam`, seguindo o precedente literal de
`member.manage.subteam` (Spec 028): o mapa de permissões diz **o quê**, a
trava de escopo mora no serviço, que é quem tem o `team_id` do alvo.
ADMIN e MANAGER também criam, por já administrarem a subárvore inteira.

**O quadro pertence ao TIME, não à pessoa.** Supervisor sai, quadro fica.

⚠️ **Visibilidade de quadro deriva do TIME, não do quadro.** Não existe
permissão por quadro neste produto, e este ADR não cria uma. Pela lente
atual (`team_scope.visible_team_ids`):

- ADMIN vê tudo; MANAGER da raiz vê a raiz e todos os descendentes —
  portanto **vê os quadros personalizados dos subtimes**;
- SUPERVISOR/OPERATOR de X vê X e a raiz — portanto vê o quadro geral e
  os quadros do próprio subtime, e não vê os de outro subtime.

Isso já é exatamente a regra pedida, sem código de permissão novo. Mas
registre a parte que costuma surpreender: **o quadro "interno" do Design é
visível para o gestor do time raiz.** Fazer o contrário exigiria permissão
por quadro, que colide com a lente e com o conceito de "Interna" fechado
no §8 (confidencialidade é entre times, não contra a própria gestão).

### Sem teto de quadros — o risco não é a quantidade

Nenhum limite de quadros por subtime. Um teto arbitrário (3? 5?) seria
uma recusa que ninguém sabe explicar, e o número nunca foi o problema.

Os dois problemas reais de muitos quadros, e o que os resolve:

**Quadro abandonado.** Resolve-se **arquivando quadro**, não limitando.
⚠️ E arquivar, nunca apagar: pela decisão B a tarefa vive num quadro só,
então apagar quadro apagaria trabalho. Apagar quadro com tarefa dentro
segue a mesma regra da coluna — ou é bloqueado, ou exige destino.

**Tarefa que some do mundo.** Consequência direta da decisão B: quanto
mais quadros, mais fácil uma tarefa existir num lugar que ninguém abre.

**A busca continua sendo POR QUADRO** (decisão de 05/08): quem busca já
sabe em que quadro a coisa está, e uma busca global devolveria resultado
de contexto que a pessoa não pediu. Quem atravessa quadros é **"Minhas
tarefas"**, que filtra por responsável e não por quadro — e isso já é o
comportamento dela hoje, de graça.

Com responsável obrigatório na criação, toda tarefa aparece na tela de
alguém, e o buraco praticamente fecha. ⚠️ **Praticamente:** a D14 (04/08)
deixou aberta de propósito a porta de criar **subtarefa sem responsável**,
com aviso na tela. Uma subtarefa sem responsável, num quadro personalizado
que ninguém abre, não aparece em "Minhas tarefas" de ninguém e só é
encontrada por quem já sabe o quadro. É um buraco estreito e nomeado, não
um motivo para tornar a busca global.

Saída barata, se incomodar: quando a busca **não achar nada** no quadro
atual, oferecer "procurar nos outros quadros" — o padrão continua o que a
pessoa espera, e o alcance maior só aparece no momento em que ela já não
achou. O texto do estado vazio do quadro é onde isso mora.

### Quadro nasce com três colunas, e a proteção é da SEMÂNTICA

O quadro é criado com **A fazer**, **Fazendo** e **Feito** — início, meio
e fim. `CANCELADA` não nasce: time que nunca cancela nada não deve
carregar uma coluna "Cancelado" vazia para sempre. Ela é uma opção na
hora de criar coluna ("esta coluna encerra sem concluir").

**Várias colunas podem ter a mesma semântica.** "Aprovação da
coordenação" e "Aprovação do cliente" são as duas `EM_ANDAMENTO`;
"Publicado" e "Entregue" são as duas `CONCLUIDA`. Isso é o que torna a
coluna de fato livre.

⚠️ **A regra protege a SEMÂNTICA, não a linha.** O quadro precisa ter
sempre **ao menos uma coluna de início** e **ao menos uma de fim que
conclui**; `EM_ANDAMENTO` e `CANCELADA` são opcionais. Proteger as três
linhas específicas seria arbitrário assim que existir mais de uma coluna
por semântica — travaria apagar "A fazer" depois de criar "Briefing"
como início, que é reorganização legítima. Sem uma coluna de início a
tarefa nova não tem onde nascer; sem uma de conclusão a cascata de
conclusão não tem destino e a varredura de arquivamento **para em
silêncio** para aquele time.

A pergunta na criação da coluna é: **"esta coluna é início, meio ou
fim?"** — e, se for fim, **"conclui ou cancela?"**. Mais o interruptor de
cobrança de prazo (`avisa_prazo`), que é ortogonal: "Aguardando cliente" é
meio e não deve cobrar prazo.

Quem só quer usar não configura nada.

### Com semântica repetida, o destino é MARCADO, não deduzido

Se duas colunas são `CONCLUIDA`, "mova para a coluna concluída" deixa de
ter resposta. Quatro lugares precisam dessa resposta:

1. onde nasce a tarefa nova;
2. para onde a **cascata de conclusão** manda cada descendente;
3. o que a ação "cancelar" faz;
4. o `status` recebido no PATCH de compatibilidade.

**Cada semântica presente no quadro tem UMA coluna marcada como destino**
(`board_column.is_destino`), garantida por índice único parcial em
`(board_id, semantica) WHERE is_destino` — a mesma técnica do
`team_unica_raiz_por_workspace`. Uma função só
(`coluna_de_destino(board, semantica)`) atende os quatro lugares; não
quatro regras parecidas espalhadas, que é como as duas buscas do produto
quase viraram duas regras diferentes.

⚠️ **REJEITADA a alternativa "a primeira daquela semântica, pela ordem".**
Parece mais barata (zero campo, zero controle) e amarra duas coisas que
não têm relação: arrastar "Entregue" para antes de "Publicado" mudaria o
destino da cascata sem que ninguém tivesse pedido isso. O conserto para
esse acoplamento seria travar a reordenação ou avisar sobre ela — ou seja,
administrar para sempre um problema que um campo booleano elimina. **A
ordem visual passa a não significar nada além de ordem visual.**

### A ordem das colunas é livre

Não há trava de "terminal não pode vir antes do meio". Com o destino
marcado, reordenar não muda comportamento nenhum — muda só o que a pessoa
vê, e gente se organiza de formas estranhas por bons motivos (uma coluna
"Cancelado" no começo, perto do olho de quem tria, é uma escolha legítima).

Travar a ordem custaria uma regra a mais para proteger algo que já está
protegido pela semântica. Avisar custaria um aviso que ninguém lê. As duas
saídas só existiriam por causa da regra rejeitada acima.

### Apagar coluna nunca apaga tarefa

Apagar uma coluna com tarefas dentro exige **escolher a coluna de
destino**, com a primeira de mesma semântica sugerida por padrão. Coluna é
organização, não conteúdo.

### O relógio do arquivamento passa a ser `terminal_desde`

`task.terminal_desde` é gravado quando a tarefa **entra** numa coluna
terminal (`CONCLUIDA` ou `CANCELADA`) e limpo quando sai. A varredura
conta a partir dele, não do `completed_at`.

⚠️ **É uma proteção, não uma refatoração.** Sem ela, marcar uma coluna
existente como terminal numa terça à tarde faz o job arquivar de
madrugada tudo que está parado ali há mais de N dias — de uma vez, sem
aviso, e é o formato do incidente das 177 emissões. Com `terminal_desde`,
mudar a semântica de uma coluna grava `now()` nas tarefas afetadas e o
relógio recomeça. A tela ainda deve mostrar a contagem antes de salvar
("isto torna 43 tarefas elegíveis para arquivamento em N dias").

### Cascata de conclusão entre quadros diferentes

Concluir o pai move cada descendente para a coluna `CONCLUIDA` **do quadro
dela**, que pode não ser o quadro do pai. Sem semântica declarada isso é
impossível de resolver; com ela é uma consulta. É o argumento mais forte
a favor deste ADR.

### Uma tarefa vive em UM quadro (decisão B, 05/08/2026)

O quadro personalizado do subtime tem **tarefas próprias**, não é outra
visão das mesmas tarefas. A tarefa nasce num quadro e vive nele.

A alternativa (a mesma tarefa aparecendo em dois quadros, em colunas
diferentes) exige uma tabela `tarefa × quadro → coluna` e faz "em que
coluna está esta tarefa" deixar de ter resposta única. Custo alto para
ganho que ninguém pediu.

**Consequência aceita:** uma tarefa interna do Design está **ou** no
quadro geral (com a lente do subtime, como hoje) **ou** no quadro
personalizado do Design, nunca nos dois, e quem cria escolhe onde. O
quadro personalizado **não** mostra as tarefas compartilhadas do geral —
se mostrasse, voltaria a ser uma segunda visão das mesmas tarefas, que é
exatamente o que foi rejeitado.

## Consequências

**Positivas.** As colunas ficam livres sem que nenhum dos quatro
subsistemas saiba disso. O ENUM nativo continua no banco, então a migração
não é um big bang de 143 referências. `avisa_prazo` entrega um controle que
hoje não existe. A FK composta torna impossível no banco o estado
inconsistente mais provável.

**Negativas.** Passam a existir duas fontes para a mesma verdade
(`column.semantica` e `task.status`), e fonte duplicada é dívida —
mitigada por `status` ser escrito **num único ponto** do serviço, nunca
pela API. O PATCH de status vira compatibilidade: `status` recebido no
PATCH é traduzido para a primeira coluna daquela semântica **no quadro da
tarefa**. Isso mantém o front antigo funcionando com o backend novo, o que
preserva a possibilidade de rebobinar só um dos dois — que é como esta
operação faz deploy.

**Custo escondido.** O front tem 104 referências a nomes de status em 16
arquivos: cores, rótulos, ordem das colunas, filtros. Tudo isso passa a
vir do quadro. É a maior parte do trabalho desta entrega, e mora quase
todo no `Board` (1218 linhas) e no `TaskDetail` (2186 linhas, **sem
nenhum teste de componente**).

## Migração

1. Criar `board` e `board_column`; um quadro padrão por time existente.
2. Criar as colunas **espelhando os sete status de hoje**, com os nomes e a
   ordem atuais, e a semântica mapeada:
   `BACKLOG→ABERTA`, `PLANNED→ABERTA`, `IN_PROGRESS→EM_ANDAMENTO`,
   `IN_REVIEW→EM_ANDAMENTO`, `BLOCKED→EM_ANDAMENTO` (com
   `avisa_prazo=false`), `COMPLETED→CONCLUIDA`, `CANCELLED→CANCELADA`.
3. `UPDATE task SET column_id = <coluna correspondente ao status>`.
4. `terminal_desde = completed_at` para quem está em coluna terminal;
   `updated_at` para as canceladas (que não têm `completed_at`).

**No dia do deploy ninguém vê diferença.** O quadro continua com as mesmas
sete colunas, com os mesmos nomes. A configurabilidade vem depois, em cima
de uma fundação já migrada.

⚠️ **O quadro migrado nasce com SETE colunas, não com as três do padrão.**
As três (A fazer / Fazendo / Feito) valem para quadro **novo**. Migrar
para elas significaria empurrar sete colunas de tarefas reais em três no
dia do deploy, mudando a tela de todo mundo de uma vez — exatamente o que
esta migração existe para evitar. Enxugar de sete para três é
reorganização, e é do time, não da migração. O mesmo vale para a coluna
`CANCELADA`: ela não nasce em quadro novo, mas **nasce na migração** de
todo quadro que já tenha tarefa cancelada, senão essas tarefas não teriam
onde pousar.

## Como medir

- `alembic revision --autogenerate` sai **vazio** depois da migration.
- Nenhuma tarefa sem coluna, e nenhuma coluna de outro quadro:
  ```sql
  SELECT count(*) FROM task WHERE column_id IS NULL AND deleted_at IS NULL;
  SELECT count(*) FROM task t JOIN board_column c ON c.id = t.column_id
  WHERE c.board_id <> t.board_id;
  ```
  As duas têm de voltar `0` — a segunda por construção (FK composta), e é
  medida assim mesmo, porque constraint que ninguém testou é promessa.
- A contagem de tarefas **por semântica** depois da migração bate com a
  contagem **por status** antes. Guardar os dois números antes de rodar.
- `pytest -m integration` com `TEST_DATABASE_URL` apontando pro `db-test`.
  ⚠️ Os testes da lente de visibilidade só rodam com essa variável; sem
  ela o comando imprime `0 failed` e pula 328 testes.

## Alternativas consideradas

- **Coluna sem semântica (texto livre, tipo Trello).** Rejeitada: quebra
  os quatro subsistemas em silêncio. É a decisão que parece mais simples
  hoje e cobra em defeito invisível depois.
- **Matar o ENUM e ter só `column_id`.** Mais limpo no papel. Rejeitada
  **por ora**: 143 referências e nenhuma rede de segurança (sem CI, sem
  E2E, `TaskDetail` sem teste). Cabe num ADR futuro, depois que a rede
  existir.
- **Tarefa em N quadros com coluna por quadro.** Rejeitada (decisão B
  acima).
- **`BLOQUEADA` como quinta semântica.** Rejeitada em favor de
  `avisa_prazo`, que cobre o mesmo caso e mais.

## Fora do escopo deste ADR

Terceiro nível de hierarquia de times (a organização acima dos
departamentos, com as três regras de `team_scope`), herança de colunas do
time pai para o subtime que não configurou o próprio quadro, e catálogo de
solicitação em dados. Cada um é um ADR próprio.
