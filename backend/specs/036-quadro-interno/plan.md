# Plano — Spec 036 (Quadro interno de subtime)

Cinco fatias. As três primeiras são backend e **nada muda na tela**; a quarta
é o front; a quinta é a feature.

> **Estado em 10/08/2026 (fim do dia) — fatias 1, 2, 3, 4a e 4b EM PRODUÇÃO.**
> Backend **642**, front **503**.
>
> ⚠️ **A fatia 4c está BLOQUEADA por contrato — ver a seção dela.** A ordem
> deste arquivo deixou de valer: o que vem a seguir é a peça de BACKEND da
> fatia 5, não a 4c.
>
> ⚠️ **A fatia 4 são TRÊS sessões, não uma** (`sondagem-fatia-4.md`, §6), e a
> sondagem sugere renumerar em 4a/4b/4c. **Este arquivo continua numerando de
> 1 a 5** — quem for executar a 4 lê a sondagem antes e trata a numeração dela
> como detalhamento, não como concorrente. As duas numerações não coincidem
> com o roteiro antigo (F1a/F1b/F2/F3), que está morto.

⚠️ **Ordem de deploy no fim do arquivo.** A fatia 1 foi commitada JUNTO com o
código que lê `deleted_at` — a migration NÃO pode ficar para trás; a 4 e a 5
são as que mudam o que as pessoas veem.

⚠️ **Duas fatias por sessão, no máximo** — a sessão de 05/08 emendou três
"pequenas" e custou 58 testes vermelhos. A 2 e a 4 pedem sessão própria pelos
motivos escritos abaixo.

⚠️ **Cada fatia tem sabotagem própria, com string única, dizendo qual teste
deve cair** — e a sabotagem tem de **reverter a correção inteira**, não
mutilar. Mutilar um `WHERE` de forma que a consulta devolva duas linhas e o
`.first()` escolha uma pode passar verde por sorte.

---

## Fatia 1 — `board.deleted_at` (escrita em 06/08)

`0012_board_soft_delete.py`, sobre a head `0011_task_board_not_null`.

**Sobe:**
- `ALTER TABLE board ADD COLUMN deleted_at timestamp with time zone` + o
  `COMMENT`;
- `Board` ganha `SoftDeleteMixin` (`BoardColumn` **não** — E3 da spec);
- `default_board_and_column_for_status` ganha `AND b.deleted_at IS NULL`;
- a regra E2 escrita no cabeçalho do `board_repository`;
- `scripts/invariantes.sql` ganha a consulta 4.

⚠️ **Sem índice.** `board` tem uma linha em produção e poucas dezenas no pior
caso da 0034. Índice parcial aqui é custo de escrita sem ganho de leitura
mensurável — entra em migration própria quando a contagem justificar, com o
número na justificativa.

⚠️ **O texto do `COMMENT` é idêntico ao do `SoftDeleteMixin`, caractere a
caractere.** Drift de comentário é comparado por TEXTO: divergir deixa o
`autogenerate` propondo a diferença para sempre.

**Como testar:** `upgrade head`, `\d+ board` (a coluna e o comentário),
`downgrade -1`, `upgrade head` de novo, `autogenerate` vazio.

**Sabotagem:** apagar `AND b.deleted_at IS NULL` do SQL → cai
`test_quadro_apagado_nao_e_descoberto_como_quadro_geral` com `DID NOT RAISE`.

---

## Fatia 2 — `GET /api/v1/boards` (sessão própria)

Leitura só. Devolve os quadros que o usuário alcança, pela mesma lente
(`visible_team_ids`). Substitui o `/boards/current` que handoffs antigos
previam, porque agora passa a existir mais de um quadro.

**Sobe:**
- rota, schema de resposta (`id`, `name`, `team_id`, `is_default`, colunas);
- `BoardRepository` ganha a consulta de listagem, com
  `deleted_at IS NULL` **e** `workspace_id`.

⚠️ **É a primeira fatia do roteiro com superfície de API e permissão
envolvida** — o primeiro lugar onde um erro vira dado exposto. Não atacar logo
depois de uma rodada de correções.

**Testes que provam a fatia** (são o critério 4 da spec, e vêm antes do
código):
- supervisor do subtime A **não** vê o quadro interno do subtime B;
- ADMIN vê todos;
- quadro de outro workspace nunca aparece (tenant isolation);
- quadro apagado não aparece.

Os quatro precisam de dois quadros no mundo do teste — use `make_board` e
`make_task(board_id=)` do arreio, e **não** monte quadro à mão.

**Sabotagem:** trocar o filtro pela lente por "todos os quadros do workspace"
→ cai o teste do supervisor de outro subtime.

---

## Fatia 3 — Quadro e coluna na resposta de tarefa

✅ **ESCRITA E TESTADA EM 10/08/2026.** O que este bloco descrevia **não é o
que foi entregue** — leia a §Correção abaixo antes de qualquer coisa.

A que faltava no roteiro até 06/08. Sem ela a fatia 4 não é construível: o
front recebe a lista de colunas e não sabe em qual colocar cada card.

**Subiu:**
- `board_id` e `column_id` em `TaskResponse` (`api/schemas.py`). Duas linhas.
  `TaskListItem`, `TaskDetailResponse`, `TaskDuplicateResponse` e `MyTaskItem`
  herdam e ganham os campos sem uma linha a mais;
- `tests/integration/test_task_board_no_contrato_db.py` — 4 testes;
- `scripts/invariantes.sql` ganha a consulta 7.

Sem migration, sem `JOIN` novo, sem mudança de repositório: os dois campos já
vinham no objeto ORM (`NOT NULL` desde a `0011`) e os routers montam tudo com
`model_validate(task)`.

### ⚠️ Correção de 10/08 — DUAS coisas que este plano pedia e que NÃO entraram

**1. O nome do quadro NÃO entrou, e não é esquecimento.** O plano pedia
*"`board_id`, `column_id` e o nome do quadro"* mais *"o selo de de qual quadro
veio"* da ADR 0034 (item 6). Com o `GET /boards` da fatia 2 em produção, o
front resolve `board_id` → nome no cliente, com o catálogo que ele já busca
para desenhar as colunas. Cravar o nome na task criaria um campo que
desatualiza no dia em que a fatia 5 permitir renomear quadro. **O selo sai de
graça; o campo custaria manutenção.**

**2. `semantic` e `notify_deadline` NÃO entraram, e a §4 da
`sondagem-fatia-4.md` está SUPERADA nesse ponto.** A sondagem (06/08) concluiu
que a fatia 3 estava subespecificada por faltar os dois. **A fatia 2 resolveu
isso depois de a sondagem ser escrita:** `BoardColumnResponse` já os carrega, e
o docstring dela diz explicitamente que os pôs ali por causa dessa sondagem.
O front cruza por `column_id`. Repeti-los na task criaria uma segunda fonte de
verdade para o mesmo dado, e a fatia 5 teria de invalidar as duas.

**3. O teste de alcance que este plano pedia NÃO PODE FALHAR, e por isso não
foi escrito.** O plano pedia *"o teste de que não se expõe `board_id` de
quadro fora do alcance de quem pergunta"*. Esse cenário não é alcançável:
`BoardRepository.default_board_and_column_for_status` resolve o quadro de toda
tarefa nova com `JOIN team ... AND t.parent_team_id IS NULL` (ADR 0032), então
`board.team_id` é **sempre a raiz** — que todo mundo alcança. Quem enxerga a
tarefa enxerga o quadro.

O que substitui esse teste são dois que afirmam **por que** não há vazamento, e
portanto podem falhar quando o porquê deixar de valer:
- `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` — passa pelo `TaskService`
  e lê `board.team_id` do banco;
- `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` —
  cruza `GET /tasks/{id}` com `GET /boards`. É o único teste do repositório que
  liga as duas superfícies.

Mais a **consulta 7** do `invariantes.sql`, que prende a mesma afirmação no
DADO — o teste passaria mesmo que alguém gravasse `board_id` à mão no banco.

⚠️ **A consulta 7 mediu `0` em produção em 10/08, e esse zero é AUSÊNCIA DE
CASO.** Há um quadro só, e ele é da raiz. Ela só vira afirmação quando a
consulta 5 mostrar um quadro de subtime. O aviso está no próprio arquivo.

**Sabotagem — MEDIDA em 10/08, não prevista:** apagar as **duas** linhas
`board_id: uuid.UUID` e `column_id: uuid.UUID` do `TaskResponse` derruba
**três** testes, todos com `KeyError: 'board_id'`: detalhe, listagem **e** o
cruzado. Sobra verde só o `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`,
que lê o banco e nunca toca a resposta HTTP.

⚠️ **A previsão escrita antes de rodar dizia DOIS, e estava errada** — o teste
cruzado lê o `board_id` da resposta da task antes de comparar com o `/boards`.
Mesmo viés (para menos) já registrado no handoff de 10/08, §1(f).

---

## Fatia 4a — ✅ EM PRODUÇÃO (10/08) — a semântica da coluna no front

Decisões na **ADR 0040**. Nenhuma linha de tela mudou: a fatia é ADITIVA de
propósito, porque trocar as assinaturas de uma vez deixaria o `tsc` vermelho
entre fatias.

**Subiu:**
- `lib/coluna.ts` — `type Coluna`, `terminal`, `avisaPrazo`, `pararEhNoticia`,
  `deadlineTonePorColuna`, `diasParadoPorColuna`, `colunasPadraoMinhasTarefas`,
  `corDaColuna`, `corEhHex`;
- `lib/plural.ts` — `plural` saiu da gaveta que o `lib/status.ts` tinha virado;
- `lib/status.ts` — `deadlineDays` exportada (reuso da MESMA aritmética de
  data), e o bloco das funções por status marcado com data de demolição;
- `lib/__tests__/paridadeColuna.test.ts` — **61 testes**.

⚠️ **DUAS IMPLEMENTAÇÕES DA MESMA REGRA CONVIVEM**, e é o defeito que a fatia
existe para matar. O que autoriza a convivência é o teste de paridade, que
compara as duas caso a caso contra as 8 colunas padrão. **Ele morre junto com
o bloco antigo, na 4c.** Se você está lendo isto depois da 4c e o bloco antigo
ainda existe, a migração ficou pela metade.

⚠️ **A tabela das 8 colunas no teste de paridade é CÓPIA MANUAL do
`board_defaults.py`.** Nenhum portão liga os dois. Ao mexer em `COLUNAS_PADRAO`
lá, mexa aqui.

⚠️ **O ponto não-óbvio, e está na ADR 0040:** `diasParado` NÃO traduz por
`semantic` sozinho. BLOCKED tem semântica `IN_PROGRESS` e passaria a ganhar o
selo "parada há X dias", que a D6 excluiu de propósito. A regra é
`semantic === "IN_PROGRESS" && avisaPrazo(coluna)` — e isso **funde dois
conceitos**, deliberadamente.

**Sabotagem MEDIDA:** trocar o corpo de `pararEhNoticia` por
`return coluna.semantic === "IN_PROGRESS";` derruba **dois** —
`BLOCKED: parada há muito responde igual` e `o selo de parada sai só nas três
colunas de trabalho ativo`.

---

## Fatia 4b — ✅ EM PRODUÇÃO (10/08) — `/minhas-tarefas` pela API

**Subiu:**
- `lib/api.ts`: `type Quadro`, `listBoards()`, `colunasDoQuadroGeral()` — e o
  tipo `Task` ganhou `board_id`/`column_id`, **que a fatia 3 tinha esquecido**;
- `lib/__tests__/quadros.test.ts` — 8 testes;
- `app/minhas-tarefas/page.tsx`: as três constantes de escopo de módulo
  (`STATUS_LABEL`, `STATUS_COLOR`, `TODOS_STATUS`) sumiram; o filtro padrão
  saiu do inicializador de `useState`; chips, rótulos e cores vêm de
  `coluna.name`/`coluna.color`; o filtro casa por `t.column_id`;
- `components/__tests__/minhasTarefas.test.tsx` — 7 testes (era 5).

⚠️ **NADA MUDOU VISUALMENTE, e é o resultado certo.** Produção tem um quadro
com as 8 colunas padrão, cujos nomes e cores são exatamente os que estavam
cravados no `STATUSES`. A tela mudou de FONTE, não de conteúdo. O que dá para
observar: uma requisição a mais (`GET /api/v1/boards`) ao abrir a tela.

⚠️ **O KANBAN DESTA TELA NÃO FOI MIGRADO** — ver o bloqueio na 4c. Dois mundos
convivem no arquivo: a vista de LISTA lê a API, a de QUADRO lê `STATUSES`. Há
15 linhas de comentário no `porStatus` explicando por quê.

**Conferência visual da 4b** (não estava prevista neste arquivo, e deveria):
chips com os 8 nomes reais, Concluído escondido ao abrir, Cancelado aparecendo,
"Todos" religando, e a vista de Quadro ainda arrastando.

---

## Fatia 4c — ✅ DESBLOQUEADA em 10/08, e a 4c-1 está ENTREGUE

O bloqueio desta seção acabou no momento em que a **fatia 5a** (backend) subiu:
o `PATCH /tasks/{id}` aceita `column_id` e deriva o status (ADR 0041). O texto
do bloqueio fica abaixo, intacto, porque explica POR QUE a ordem foi essa.

### 4c-1 — ✅ ENTREGUE (front: 503 → 514)

**Escopo:** `Board.tsx`, `TaskCard.tsx`, `lib/api.ts` e o repasse da coluna aos
cards de `/minhas-tarefas`. Os três portões verdes, `next build` compilando.

**Quatro decisões, tomadas com a Camila antes do código:**

1. **O quadro sai das TAREFAS** (`board_id`), não da flag `is_default`. Custa
   mais hoje e some com um item de dívida: continua certo no dia do quadro
   interno, sem ninguém lembrar de voltar lá. Lote vazio cai no padrão; lote
   com mais de um quadro cai no padrão e o contador de "fora da coluna"
   denuncia o resto.
2. **`coluna` é prop OBRIGATÓRIA do `TaskCard`.** O `tsc` listou os quatro usos
   de uma vez — que é exatamente o que faltou na fatia 3.
3. **Cascata otimista por coluna**, aceitando a janela de `status` velho.
   ⚠️ **Esta decisão foi CORRIGIDA no mesmo dia** — ver "o que a conferência
   manual achou", abaixo.
4. **Duas metades em vez de uma sessão.** A `STATUSES` continua existindo para
   quem ainda a consome, então o `tsc` não obriga a migrar tudo junto — o
   plano anterior dizia o contrário, e estava errado.

**Sabotagens medidas (5):** escolher o quadro por `is_default`, card lendo
`status`, contador da checklist lendo `status`, filtro de prazo lendo `status`,
apagar o contador de card fora de coluna. Cada uma derruba UM teste, pelo nome
— registradas no cabeçalho do `Board.test.tsx`.

⚠️ **DUAS DELAS PASSARAM VERDE ANTES DE O TESTE EXISTIR** (a escolha do quadro
e o filtro de prazo). Os dois portões nasceram de RODAR a sabotagem, não de
planejar. Repita o procedimento na 4c-2.

### ⚠️ O que a CONFERÊNCIA MANUAL achou, e nenhum portão achou

Três coisas, todas invisíveis para `pytest`, `tsc`, `vitest` e `next build`:

1. **O contador da checklist no card** ainda lia `status` — arrastar um pai
   para conclusão concluía a subárvore no banco e o número só mudava com F5.
2. **A proporção no DETALHE da tarefa** (`lib/subtarefas.ts::progresso`) lê
   `status` e continuou parada depois do conserto do card. **Dois números
   discordando é pior que um número velho.**
3. **O filtro de prazo** também lia `status` (achado junto, não pela tela).

O conserto de (2) foi manter coluna **e** status em sincronia na cascata
otimista — e isso NÃO é o front derivando status: a cascata só roda em coluna
de conclusão, e a do backend grava `COMPLETED` fixo. **Dívida: quem migrar
`progresso` para a coluna apaga a metade `status` do `onDragEnd`.**

### ⚠️ O que a 4c-1 NÃO validou

- **O `onDragEnd` inteiro.** Drag-and-drop não é exercitável em jsdom. A rede é
  a conferência manual, e foi ela que achou as três coisas acima.
- **O caminho de ERRO do arrastar** (403/500 → reverter card e checklist).
  Não há tarefa que a Camila não possa mover, então não deu para forçar.
  ⚠️ **Código de reversão nunca executado**, e ele MUDOU nesta fatia (passou a
  guardar dois campos). Forçável em 30s com o modo offline do devtools.

### 4c-2 — o que falta

- Kanban de `/minhas-tarefas` (`:614`, `:1040`, `:1174`) e o `onDragEnd` dela
  (`:496`).
- Os dois `<select>` de status que ESCREVEM: `TaskModal.tsx:887` e
  `TaskDetail.tsx:678`.
- `lib/subtarefas.ts::progresso` → decidir pela coluna. ⚠️ **Toca QUATRO
  telas** (quadro, minhas tarefas, `/arquivadas`, `/tarefa/[id]`), e as duas
  últimas **não carregam colunas hoje**. É o item mais caro da 4c-2, e foi o
  que impediu de resolvê-lo na 4c-1.
- Só então: apagar `STATUSES` de `lib/status.ts`, o
  `(typeof STATUSES)[number]`, os 16 tokens de cor por NOME no `globals.css` e
  o `paridadeColuna.test.ts`.

---

## Fatia 4c — o bloqueio original (histórico, medido em 10/08 de manhã)

**NÃO COMECE POR AQUI.** O `plan.md` original a descrevia como "os quatro
arquivos que sobraram". Aberto o código, ela não é executável antes da 5.

`Board.tsx` usa `STATUSES` em quatro lugares, e **os quatro são o kanban**:
montar as colunas (`:677`), desenhá-las (`:977`), o tipo do componente
`Coluna` (`:1101`) e o `onDragEnd` (`:405–411`), que compara
`atual.status === destino` e manda **status** para o backend.

**Não existe caminho para traduzir coluna → status no front.**
`legacy_status` NÃO é exposto pelo `GET /boards`, de propósito (ADR 0033:
expô-lo convidaria o front a se amarrar na ponte em vez da semântica). A
semântica também não resolve: QUATRO colunas padrão têm `IN_PROGRESS`.

⚠️ **Migrar o `Board.tsx` sem o endpoint quebra o arrastar, e NENHUM PORTÃO
PEGA:** `tsc` e `next build` não leem estado, e o `Board.test.tsx` registra que
drag-and-drop não é testável em jsdom.

**Sobra da 4c, sem bloqueio — RECONTADO em 10/08 (à noite):** só
`app/arquivadas/page.tsx:43` e `components/TaskDetail.tsx:66`, e os dois são
mapa de RÓTULO (leitura). Vão de carona.

⚠️ **`TaskModal` NÃO vai de carona: é caminho de ESCRITA.** O `<select>` de
`TaskModal.tsx:887` manda status, igual ao arrastar — depende do MESMO
endpoint. E `TaskDetail.tsx:678` (`updateTask(f.id, { status: destino })`)
também escreve, num arquivo de 2186 linhas sem teste de componente.

⚠️ **São QUATRO caminhos de escrita de status no front, não um.** Medido:
`Board.tsx:onDragEnd`, `app/minhas-tarefas/page.tsx:496`,
`components/TaskDetail.tsx:678` e `components/TaskModal.tsx:887`. Os quatro
migram juntos ou nenhum migra — e o `TaskDetail` nem aparecia nesta lista.
**Reestime a 4c contra esses quatro, não contra "os arquivos que sobraram".**

**O que a 4c ainda carrega quando destravar:** o `(typeof STATUSES)[number]`
usado como TIPO em `Board.tsx:1101` e `minhas-tarefas/page.tsx:1152`. Morre
junto com a const; precisa da `interface Coluna` (já existe em
`lib/coluna.ts`). **O `tsc` pega os dois de uma vez — não dá para fatiar por
arquivo.** E o quarto problema da sondagem: os 16 tokens de cor declarados por
NOME de status no `globals.css`, que coluna criada por gente não tem.

---

## Fatia 4 (texto original — mantido como registro)

Uma via de render para geral, projeto, lente e interno.

⚠️ **ANTES DELA, teste de componente em `minhas-tarefas/page.tsx`** — não no
`TaskDetail`. É onde a mudança pesa (9 usos de `STATUSES`, 1195 linhas, zero
teste) e é o arquivo onde descobrir tarde custa mais caro.

**São 8 arquivos, não 6.** Os cinco que usam `STATUSES` quebram de verdade;
os outros três entram porque `@/lib/status` vai ser partido em "puro e
síncrono" e "vindo da API".

⚠️ `STATUSES` deixa de ser `const` síncrona: estado de carregando, de erro, e
um default antes de o dado chegar. O `<select>` do `TaskModal` inicializa em
`"BACKLOG"` cravado, linha 104.

**Carona:** os tokens de cor do status de **projeto** (`projetos/page.tsx` e
`projetos/[id]/page.tsx` têm hex cravado e duplicado, fora do sistema da Spec
031, e não invertem no tema escuro). Sozinho não paga o deploy.

**Sabotagem:** devolver a lista de colunas vazia da API → o quadro tem de
mostrar estado de erro, não um quadro sem colunas.

---

## Fatia 5 — O quadro interno (provavelmente duas sessões)

**Sobe:**
- migration: quadro não-padrão e coluna sem `legacy_status` já são suportados
  pelo schema — conferir antes de escrever migration por reflexo;
- `BoardService` ganha criar/renomear/apagar quadro e CRUD de coluna;
- permissão `board.manage.subteam`, com a trava de escopo no serviço (o mapa
  diz **o quê**, o serviço tem o `team_id` do alvo — precedente literal de
  `member.manage.subteam`, Spec 028);
- ADR 0035: `team_id` do TIME DO QUADRO, e designar para fora recusado no
  serviço;
- ADR 0036: derivação do status pela semântica, num lugar só, com teste
  comparando as duas regras;
- ADR 0034: apagar leva as tarefas, aviso com o número, **e a trava do E4**
  (quadro padrão não se apaga);
- rota e tela, com a troca de quadro **dentro da tela do time**.

### ⚠️ O PORTÃO DO VAZAMENTO DE QUADRO MORA AQUI (acrescentado em 10/08)

A fatia 3 passou a devolver `board_id` na resposta de tarefa. Ele só é seguro
de devolver porque `board.team_id` é **sempre a raiz** hoje, e a raiz todo
mundo alcança. **Esta fatia é a que quebra essa premissa por desenho.**

No dia em que uma tarefa nascer no quadro do próprio subtime, três coisas
ficam vermelhas ou deixam de valer, e **as três são o alarme, não o defeito**:

1. `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` falha
   (`tests/integration/test_task_board_no_contrato_db.py`). **Não apague este
   teste para a fatia passar** — reescreva-o junto com a decisão nova;
2. `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` passa
   a ser o teste que importa: ele afirma que todo `board_id` devolvido está no
   `GET /boards` de quem perguntou. Se ele ficar vermelho, **há vazamento**;
3. a **consulta 7** do `invariantes.sql` deixa de ser `0`, e aí ela sai de
   "ausência de caso" e vira medição de verdade.

⚠️ **Não existe trava de schema, constraint ou gate de rota protegendo isso.**
O `board_id` sai na resposta sem passar por lente nenhuma — não precisava
passar. A decisão de qual quadro uma tarefa nova recebe é de
`BoardRepository.default_board_and_column_for_status`, e é lá que a pergunta
"quem alcança a tarefa alcança o quadro?" precisa ser respondida de novo, em
vez de continuar valendo por acidente.

**Sabotagem:** reverter a herança de `team_id` (voltar ao `default_team_id`)
→ cai o teste de ADMIN criando tarefa no quadro interno.

### ⚠️ DECISÃO DE 10/08: O QUADRO DO SUBTIME NASCE VAZIO

Decisão de produto, tomada com quem pediu a funcionalidade. **O quadro novo
não recebe nenhuma tarefa existente.** As tarefas de hoje (832, todas no
`Quadro geral`) continuam onde estão.

**Por que isso é decisão e não preguiça — medido em 10/08:** *não existe
caminho no código para mover uma tarefa de quadro.* `task.board_id` é escrito
no `create` e em mais um lugar só (`task_service.py:423`, subtarefa herdando o
quadro do pai). Nenhuma rota, nenhum serviço, nenhum script. Fazer o quadro
novo nascer cheio exigiria escrever essa operação primeiro.

⚠️ **NASCER vazio é a decisão. CONTINUAR vazio é DEFEITO — e é o padrão do
código hoje.** `BoardRepository.default_board_and_column_for_status` procura
explicitamente o time SEM PAI (`JOIN team ... AND t.parent_team_id IS NULL`,
ADR 0032). Enquanto ela não mudar, **tarefa NOVA de subtime também é gravada
no quadro da raiz**, e o quadro interno fica vazio para sempre. Mexer nela é
escopo OBRIGATÓRIO desta fatia, não item opcional.

O alarme já está montado: `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`
fica vermelho no momento em que essa função mudar. **Esse vermelho é o sinal
de que a fatia funcionou** — reescreva o teste junto com a decisão nova, não
o apague (ver o portão do vazamento, acima).

### Adendo — mover tarefa entre quadros (NÃO priorizado em 10/08)

Pedido reconhecido, adiado por escolha: há coisas antes. Registrado aqui para
não ser redescoberto como surpresa no dia em que alguém abrir o quadro novo e
perguntar "cadê minhas tarefas?". Três saídas, com o custo medido em 10/08:

1. **Só tarefas novas entram** — custo zero. É o estado de hoje e o que foi
   decidido. O quadro leva semanas para ficar útil.
2. **Migração única, rodada na VPS** — ~meio dia, sem tela. Move as tarefas de
   um time para o quadro dele de uma vez. ⚠️ Exige `pg_dump` antes: na
   prática é irreversível.
3. **Mover pela tela** — entrega própria, do tamanho desta fatia inteira
   (mexe em coluna, permissão e histórico ao mesmo tempo).

⚠️ **Nenhuma das três está construída.** Se a opção 1 se mostrar insuficiente
depois do lançamento, o custo de trocar para a 2 ou a 3 é o mesmo de hoje —
não fica mais barato por esperar.

---

## Ordem de deploy

⚠️ **ESTA ORDEM ESTÁ SUPERADA — ver a §Ordem revisada logo abaixo.**

1. **Fatia 1 sozinha, e a migration vai ANTES do código — obrigatoriamente.**
   ⚠️ O texto anterior aqui dizia que ela *"pode ficar parada"*. Era verdade
   enquanto nada lia a coluna, e deixou de ser no MESMO commit: o
   `board_repository` roda `AND b.deleted_at IS NULL` em SQL cru, e `Board`
   tem `deleted_at` mapeado (o ORM emite lista explícita de colunas). Subir o
   `main` sem a `0012` quebra o `create` de tarefa de topo
   (`task_service.py:380`) e toda leitura ORM de quadro.
   ✅ **A `0012` ESTÁ EM PRODUÇÃO DESDE 10/08/2026** (`invariantes.sql`, que só
   roda a consulta 4 com ela aplicada). Enquanto ela não estava, não havia
   caminho de hotfix — qualquer deploy, inclusive um de front, arrastava esse
   código junto. **Esse intervalo acabou.** Medido em 06/08: produção tem UM
   quadro (`Quadro geral`, time raiz, 8 colunas, 0 sem ponte, 696 tarefas).
2. **Fatia 2 sozinha.** É permissão. Depois dela, os critérios 4 e 5 da spec.
   ✅ **Em produção.**
3. **Fatia 3** junto ou logo depois da 2 — reusa a mesma lente.
   ✅ **EM PRODUÇÃO desde 10/08.** (Este item dizia "commitada, ainda NÃO em
   produção" depois de a fatia já ter subido — e as 4a e 4b, que vieram
   depois, dependem dela. Estado de fatia se escreve no commit que sobe, não
   na sessão seguinte.)
4. **Fatia 4** quando houver sessão limpa para o front.
5. **Fatia 5**, e só depois da 4 estar **no ar**. Criar quadro sem o front ler
   colunas não muda a tela de ninguém.

⚠️ **Não emendar 2 com 4.** Uma é API com permissão, a outra é front. Nada em
comum além do assunto.

⚠️ **Migration já em PRODUÇÃO deixa de ser editável.** Vale da `0008` à
`0012`.

⚠️ **CI verde antes de tocar na VPS** — e "verde" quer dizer que o job
`backend` chegou a executar o passo `pytest`. Um X vindo do `Set up job` é o
GitHub caindo, não o seu código, e na lista de runs os dois são
indistinguíveis.

---

## ⚠️ Ordem revisada (10/08/2026, depois de medir o `Board.tsx`)

1–3, 4a, 4b: ✅ **em produção.**

4. **A peça de BACKEND da fatia 5, e ela vem AGORA:** `PATCH /tasks/{id}`
   aceitando `column_id`, validando que a coluna pertence ao quadro da tarefa.
   Meia sessão. Destrava, de uma vez: o `Board.tsx`, o kanban de
   `/minhas-tarefas` e o CRUD de coluna.

   ⚠️ **Não é escopo furando fila.** É a mesma classe de descoberta da fatia 3
   ("a que faltava no roteiro até 06/08"): este plano foi escrito antes de
   alguém abrir o `onDragEnd`. O backend hoje resolve coluna A PARTIR do
   status em dois pontos (`task_service.py:824` e `:838`); aceitar `column_id`
   direto é inverter essa direção, que é o que a ADR 0033 promete para o fim
   da ponte.

   ### ⚠️ TRÊS COISAS A DECIDIR ANTES DE ESCREVER A PRIMEIRA LINHA (10/08, noite)

   **1. A derivação pela SEMÂNTICA, sozinha, PERDE STATUS — não a implemente
   como está escrita na fatia 5.** A semântica é 8:4 nas colunas padrão
   (`Em Andamento`, `Aprovação Interna`, `Aprovação Externa` e `Bloqueado` são
   todas `IN_PROGRESS`). Derivar status a partir dela colapsa os quatro em
   `IN_PROGRESS`, e o comentário de `app/db/models/boards.py:191-196` já diz
   exatamente isso, com os nomes. **A regra que preserva o quadro de hoje:
   `legacy_status` quando a coluna tiver um; semântica SÓ quando for `NULL`
   (coluna criada por gente).** Isso é ADR, e vem antes do código —
   ⚠️ **nenhum portão pega o erro**, porque o status derivado errado ainda é um
   status VÁLIDO: só aparece como card pulando de coluna na tela de todo mundo.

   **2. `task.column_id` está gravado DENTRO do `if` de status.** Em
   `TaskService.update`, a atribuição vive dentro de
   `if command.status is not None and command.status != task.status`. No dia em
   que existirem duas colunas de mesma semântica **sem** `legacy_status` (ou
   seja: na fatia 5, por desenho), mover uma tarefa entre elas não muda o
   status → o bloco não roda → **a tarefa não sai da coluna, e não há erro**.
   A gravação por `column_id` tem de sair de dentro daquele bloco.
   **Sabotagem:** devolver a atribuição para dentro do `if` e nomear o teste
   que cai.

   **3. `column_id` e `status` no MESMO payload.** Hoje o PATCH aceita `status`.
   Decida no schema: precedência de um sobre o outro, ou 422 quando vierem os
   dois. Deixar implícito é entregar dois donos para o mesmo campo.

   **Rastro:** `_diff_for_update` gera `STATUS_CHANGED`. Movimentação entre
   colunas de MESMO status não deixa linha nenhuma em `task_history` — mesmo
   buraco que já existe em designação. Decida agora se entra ou se fica
   escrito como dívida.

5. **4c**, que depois disso vira execução mecânica — ⚠️ **contra os QUATRO
   caminhos de escrita** listados na seção da 4c, não contra dois arquivos.
6. **O resto da fatia 5** (criar/renomear/apagar quadro, CRUD de coluna,
   seletor de cor).

⚠️ **A permissão `board.manage.subteam` tem de entrar nos TRÊS conjuntos**
(`ADMIN`, `MANAGER`, `SUPERVISOR`) em `permissions.py`. Não há hierarquia
entre papéis — são listas literais. Se entrar só no SUPERVISOR, o supervisor
cria quadro e o ADMIN não consegue. A trava de escopo mora no serviço
(precedente literal: `member.manage.subteam`, Spec 028).

⚠️ **A cor da coluna foi decidida em 10/08: roda RGB livre (hex).** Ver ADR
0040 item 4. Consequências que precisam de desenho na fatia 5: o campo `color`
passa a ter DOIS formatos (`var(...)` nas 8 padrão, hex nas novas — e as
padrão **não** migram, porque token inverte com o tema e hex não); o texto por
cima precisa sair da luminância; e **o backend TEM de validar
`^#[0-9a-fA-F]{6}$`**, porque `color` vira entrada de usuário indo parar num
`style`, e o campo é `String(60)`.

---

## Conferência visual (obrigatória)

Nenhum portão cobre isto. Nas fatias 1 a 3, o teste é que **nada muda**:

1. O quadro geral continua com as oito colunas, nomes e ordem iguais.
2. Arrastar tarefa entre colunas continua funcionando e persiste.
3. Concluir um pai com subtarefas continua concluindo a checklist inteira.
4. `/minhas-tarefas` e `/arquivadas` continuam listando o mesmo.

Nas fatias 4 e 5:

5. O quadro de **lente** não mostra afordância de editar nem de apagar (ADR
   0034, item 2). Lixeira que não funciona é lixeira em que alguém clica.
6. Os dois objetos "quadro" têm nomes distinguíveis no seletor.
7. O aviso de apagar quadro **diz o número de tarefas**.

---

## O que esta entrega NÃO valida

- **Desempenho com workspace grande.** Herdado: 2 queries por membro, parede
  por volta de 150–200 contas. Nada aqui foi medido e nada tem índice
  dedicado.
- **Responsivo.** Um `@media` no produto todo.
- **E2E.** Não existe.
- **Que apagar quadro apaga as tarefas junto** — isso é a fatia 5. Os testes
  da fatia 1 provam só que a coluna existe e que a descoberta respeita o
  filtro.
- ⚠️ **`semantic` JÁ TEM LEITOR desde a Spec 037** — a correção é de 10/08.
  `TaskRepository.bloqueios_por_perda_de_alcance` deriva o que é terminal de
  `TERMINAL_SEMANTICS`, e não de uma lista de status escrita à mão. Ele também
  viaja no `GET /boards` desde a fatia 2. **`is_default_target` continua sem
  leitor** até a fatia 5, e esse é o campo a citar quando o assunto voltar.
- **A migração contra o volume de produção.** `board` tem uma linha; se isso
  mudar antes da fatia 5, medir de novo.
