# Spec 036 — Fatia 5: o quadro avulso

⚠️ **Este arquivo SUPERSEDE a seção "Fatia 5 — O quadro interno" do `plan.md`**
(linhas 447–535 do texto de 10/08), escrita sobre um modelo de produto que a
decisão de 11/08 substituiu. Aquela seção está marcada como histórica no
`plan.md`; não a apague — o portão do vazamento e o adendo de mover entre
quadros continuam válidos e estão recitados aqui.

Escrito em 11/08/2026. Decisões tomadas com a Camila nesta data.

---

## 0. ⚠️ ESTADO DAS FATIAS (conferido no `main` em 12/08/2026)

Portões verdes: **backend 714 passed**, **front 541 passed**, `tsc` 0,
`next build` compilando. Migrations `0012`. ADRs backend: 42.

| fatia | estado | testes |
|---|---|---|
| **ADR 0042** — coluna alvo por semântica | ✅ escrita | — |
| **5b-1** — os dois degraus em `column_for_status_in_board` | ✅ em produção | 657→681 |
| **5b-2** — caminhos de escrita por status | ✅ em produção | 681→685 |
| **5b-3** — permissões + `BoardService` + `POST`/`PATCH` | ✅ em produção | 685→714 |
| **5b-4** — CRUD de coluna | ⬜ não começou | — |
| **5b-5a** — `colunaEquivalente` e `rotuloDeColuna` (lib pura) | ✅ em produção | 529→541 |
| **5b-5b** — ligar as duas telas transversais | ⬜ não começou | — |
| **5b-6** — a tela do quadro avulso | ⬜ não começou | — |

⚠️ **A 5b-5 do texto original virou DUAS fatias.** A 5b-5a entregou o módulo
puro `lib/coluna.ts`; a 5b-5b é o que liga as telas, e é a que tem risco. Ver
§3.

⚠️ **Nada do que subiu mudou uma linha de comportamento em produção.** O Quadro
geral tem ponte nas 8 colunas, então o degrau 2 nunca é alcançado; e não existe
tela que crie quadro. **O primeiro quadro de produção nasce na 5b-6.**

⚠️ **`colunaEquivalente` e `rotuloDeColuna` estão SEM LEITOR de produção**
(medido em 12/08: as únicas menções fora de `lib/__tests__/` são comentários em
`TaskDetail.tsx:1039` e `app/arquivadas/page.tsx:406`). O projeto já tem a
cicatriz disso — `is_default_target` viveu sem leitor da fatia 1 até a 4c.

---

## 1. ⚠️ O QUE MUDOU DE ENTENDIMENTO EM 11/08 (leia antes de tudo)

Três coisas que o `plan.md` afirmava e que **estão erradas** sob o modelo de
produto confirmado:

**a) "O quadro do subtime nasce vazio" — não existe esse quadro.**
`/quadro/[teamId]` é **lente**, não registro (ADR 0034 §Contexto). O modelo
híbrido está implementado e **em produção** desde a fatia 4:
`Board.tsx:687-704` mostra a união de (A) tarefas da raiz com algum responsável
do subtime e (B) internas do subtime (`team_id === subteamId`). A lente nasce
cheia por construção. **A questão "migrar as tarefas existentes" não existe.**

**b) "Mexer em `default_board_and_column_for_status` é escopo OBRIGATÓRIO da
fatia 5" — é o contrário: mexer nela é DEFEITO.**
Tarefa interna de subtime nasce hoje com `board_id` do Quadro geral e `team_id`
do subtime, e é exatamente isso que a faz aparecer na lente. Mudá-la para
"o quadro do time da tarefa" tira a tarefa interna da lente.
⚠️ **`test_tarefa_de_subtime_nasce_no_quadro_da_raiz` continua CERTO e continua
VERDE.** O `plan.md` mandava reescrevê-lo; não reescreva.
Quadro avulso recebe tarefa por **`board_id` explícito no comando de criação**,
que é parâmetro, não descoberta.

**c) "ADR 0036: derivação do status pela semântica" está listada como entrega
da fatia 5 — ela já existe**, e as 0034 e 0035 também. O que falta é código,
não decisão. A decisão que faltava é a **0042**, escrita em 11/08.

**d) ⚠️ ACRESCENTADO EM 12/08 — "a cor da coluna roda RGB livre (hex)"
também está superado.** O `plan.md` afirma isso perto do fim (§Ordem revisada,
parágrafo da cor), citando a ADR 0040 item 4, e manda o backend validar
`^#[0-9a-fA-F]{6}$`. **O corte de 11/08 decidiu o contrário para esta fatia:**
coluna nova nasce com cor de **token**, por rotação fixa. Ver §2, corte 2.

---

## 2. O modelo, em três linhas

| | `board.team_id` | quem edita o quadro | quem vê |
|---|---|---|---|
| **Quadro geral** (existe) | raiz | ADMIN, MANAGER | todos |
| **Avulso de subtime** (5b) | subtime | supervisor do subtime, ADMIN, MANAGER | membros do subtime + ADMIN/MANAGER |
| **Extra da raiz** (5c) | raiz | ADMIN, MANAGER | todos |

Visibilidade sai de graça do `team_scope` (ADR 0035 D3). **Nenhuma permissão
por quadro, nenhum eixo novo.**

⚠️ **O Quadro geral do Marketing NÃO SE MEXE.** 176 tarefas vivas, 8 colunas,
0 sem ponte. Nada nesta fatia toca nele. `COLUNAS_PADRAO` (8) continua sendo o
padrão do quadro **de workspace**, congelada junto com a cópia da migration
`0008` e o `test_quadro_novo_nasce_igual_ao_migrado`. `COLUNAS_BASE` (4) é
conjunto **novo**, usado só por quadro criado por pessoa. **Dois conjuntos,
ambos vivos, ambos testados** — quem editar um tem de justificar por que não
editou o outro. Os dois vivem em
`app/modules/tasks/domain/board_defaults.py`.

### As 4 colunas base (decisão de 11/08, entregue na 5b-3)

| `legacy_status` | nome | `semantic` | `notify_deadline` | `is_default_target` |
|---|---|---|---|---|
| `BACKLOG` | Backlog | `OPEN` | `True` | `True` |
| `IN_PROGRESS` | Em Andamento | `IN_PROGRESS` | `True` | `True` |
| `COMPLETED` | Concluído | `DONE` | `True` | `True` |
| `CANCELLED` | Cancelado | `CANCELLED` | `True` | `True` |

⚠️ **Gênero masculino em "Concluído" e "Cancelado"**, igual às 8 padrão
(confirmado em 11/08). Divergir aqui é duas telas do mesmo produto escrevendo a
mesma coluna de dois jeitos.
⚠️ **Uma por semântica, e as quatro marcadas como alvo** — é o que faz o
degrau 2 da ADR 0042 responder desde o primeiro dia do quadro.
⚠️ **Nascer com 4 não é o mesmo que ser obrigado a manter 4.** A pessoa pode
apagar *Em Andamento* e *Cancelado* depois (0042 D4); não pode apagar a última
`OPEN` nem a última `DONE`. Nascer com as quatro poupa quem quer cancelar de
criar coluna na primeira semana.
⚠️ **As quatro nascem COM `legacy_status`.** Coluna acrescentada por gente
nasce **sem**, e aí vale a 0041. Os dois casos convivem no mesmo quadro.

### O que fica de FORA da 5b (corte de 11/08, decidido com o custo na mesa)

1. **Apagar quadro.** Cria e renomeia; a lixeira vem depois. Custo aceito:
   quadro criado por engano fica lá, feio e inofensivo. ⚠️ A ADR 0034 item 4 e
   a confirmação digitada com contagem de **subárvore** continuam valendo — só
   não são desta fatia. **Escreva o `UPDATE` de restauração em
   `backend/scripts/` junto com a fatia que entregar a lixeira**, no mesmo
   commit: não há tela de restaurar, e quem desfaz é uma pessoa na VPS.
2. **Seletor de cor.** Coluna nova nasce com cor de **token**, por rotação fixa
   sobre os 8 existentes. Sem hex, sem `<input type="color">`, sem luminância,
   sem validação `^#[0-9a-fA-F]{6}$`. ⚠️ Isto **contradiz de propósito** o
   parágrafo da cor no `plan.md` (§1d). ⚠️ `lib/coluna.ts::corEhHex` **continua
   sem leitor** — e agora com data: ele ganha leitor na fatia do seletor de
   cor, ou o campo tem de justificar sua existência de novo.
3. **Mover tarefa entre quadros.** Fatia **5c**, curta, logo depois. A ADR 0042
   entrega o mapa que a encarecia. ⚠️ Só a versão **dentro do mesmo
   `team_id`**; atravessar time muda quem vê e continua proibido pela ADR 0034
   item 3.

---

## 3. As fatias, em ordem de execução

⚠️ **A ordem é por raio de explosão, não por tamanho.** A 5b-1 é um no-op em
produção; a 5b-5b é a primeira que um usuário enxerga.

### 5b-1 — a regra da ADR 0042 (backend, domínio puro) — ✅ ENTREGUE

**Subiu:** `semantica_do_status()` em `board_semantics.py`; o degrau 2 em
`BoardRepository.column_for_status_in_board`; a reescrita do status pela coluna
de destino (D2).

**Por que primeiro:** o Quadro geral tem ponte nas 8 colunas, então o degrau 2
**nunca é alcançado em produção**. Esta fatia subiu sem mudar uma linha de
comportamento para ninguém, e é a única do conjunto com essa propriedade.

**Portões:** `pytest`. Sem front, sem migration, sem API. 657 → 681.

⚠️ **Armadilha encontrada na execução:** `text()` devolve **STRING, não enum**.
`column_for_status_in_board` devolvia `'IN_PROGRESS'` em vez de
`TaskStatus.IN_PROGRESS` — **8 vermelhos**. Como `TaskStatus` e
`ColumnSemantic` são `StrEnum`, `==` responde certo em todo lugar do produto e
o defeito só aparece sob `is`. Todo `select` textual que traz coluna de enum
precisa de `TaskStatus(x)` / `ColumnSemantic(x)`.

**Sabotagens rodadas** (§Como medir da 0042):

| sabotagem | derruba |
|---|---|
| Inverter os degraus em `column_for_status_in_board` | **5** testes, 2 deles anteriores à ADR |
| Tirar só o `DESC NULLS LAST` do repositório | **1** — `test_coluna_sem_ponte_nao_ganha_do_casamento_exato` |
| `task.status = command.status` no update | **1** — `test_o_status_gravado_na_tarefa_e_o_da_coluna_que_recebeu` |

⚠️ **A fixture tem de separar posição de alvo.** Se a coluna
`is_default_target` for também a primeira por posição, a regra certa e a errada
dão a mesma resposta — foi assim que três sabotagens passaram verde na 4c, e
foi assim de novo na 5b-5a.

### 5b-2 — o levantamento dos caminhos que escrevem `status` — ✅ ENTREGUE

**Não é código. É uma lista, e ela é entregável.** 681 → 685.

Todo caminho que escreve `status` (e não `column_id`) passa a poder cair no
degrau 2. Levantados e cobertos, cada um com teste em quadro de 4 colunas:

- `TaskService.create` (status inicial) — seguro;
- `TaskService.update` pelo caminho `status` — seguro;
- `TaskRepository.complete_descendants` (cascata de conclusão) — ⚠️ **NÃO era
  seguro**, ver abaixo;
- duplicação de tarefa (uma vez por nó da árvore) — seguro;
- varredura de arquivamento — confirmado que **LÊ e não escreve** status;
- o que sobrou de `PATCH status` no front após a 4c — seguro.

⚠️ **EMENDA DE 11/08, ESCRITA DEPOIS DE MEDIR.** O texto original desta seção
dizia: *"a leitura de 11/08 diz que todos são seguros (`DONE`, `CANCELLED`,
`OPEN` e `IN_PROGRESS` sempre têm coluna nas 4 base)"*. **Era falso para a
cascata.** A subconsulta de `complete_descendants` é SQL puro e resolvia `DONE`
por ponte apenas — num quadro sem ponte para `COMPLETED` ela não achava coluna
nenhuma. A fatia existiu exatamente para transformar leitura em medição, e a
medição desmentiu a leitura. **Não repita a frase "é seguro por construção"
sem um teste ao lado dela.**

⚠️ **A cascata é um `UPDATE` em massa por `ltree` e não pode chamar o
repositório uma vez por linha.** É por isso que a regra da 0042 tem duas
implementações no backend, e a duplicação é deliberada. Ver §6.

### 5b-3 — `BoardService` cria e renomeia (backend) — ✅ ENTREGUE

**Subiu:** `COLUNAS_BASE`; `BoardService.criar_quadro(team_id, name)` e
`renomear_quadro`; as permissões; `POST /api/v1/boards` e `PATCH /boards/{id}`.
685 → 714.

⚠️ **DUAS permissões, não uma:** `board.manage.subteam` e `board.manage.root`.
Uma só significa ou supervisor editando o Quadro geral, ou ADMIN sem editar
nada.
⚠️ **Cada uma entra nos conjuntos de TODOS os papéis que a exercem** — não há
hierarquia em `permissions.py`, são listas literais. `board.manage.subteam` vai
em `SUPERVISOR`, `MANAGER` e `ADMIN`.
⚠️ **A trava de ESCOPO mora no serviço** (`BoardService._assert_pode_gerir`),
com o `team_id` do alvo — precedente literal de `member.manage.subteam`
(Spec 028). O mapa diz *o quê*; o serviço diz *sobre quem*.
⚠️ **Nenhuma migration.** O índice parcial `board_um_padrao_por_time` protege
"um PADRÃO por time"; quadro avulso é não-padrão e o schema já o comporta
(ADR 0034 item 5). Conferido antes de escrever migration por reflexo.

⚠️ **A armadilha que custou 11 vermelhos:** as duas rotas de escrita **não**
têm `require_permission` — decisão certa, a autorização depende do alvo — mas
`require_permission` fazia DUAS coisas, e a segunda era
`Depends(get_tenant_context)`. **`_: TenantContextDep` parece não usado e não
é.** `set_tenant` roda num lugar só do produto e não há middleware; sem a
dependência a rota quebra em **100% das requisições em produção**, com os 17
testes de serviço verdes o tempo todo. Está escrito no cabeçalho do
`boards_router.py`.

⚠️ **404 antes de 403 no `PATCH /boards`, e é o certo.** A permissão depende do
`team_id` do quadro, então ele é buscado primeiro; um 403 confirmaria que o
quadro existe.

**Sabotagens rodadas:**

| sabotagem | derruba |
|---|---|
| Tirar a trava de escopo do supervisor | **2** |
| Tirar a saída por `board.manage.root` | **3** (ADMIN, MANAGER, e um pelo setup) |
| Tirar `_: TenantContextDep` do `POST` | **7**, e zero do `PATCH` |
| Router grava direto (com `workspace_id` certo) | **6** — os quatro 403 viram 201 |

⚠️ **Três travas têm UM guardião só.** Apagar aquele teste devolve o defeito ao
silêncio completo.
⚠️ **`test_admin_cria_na_raiz_e_no_subtime` é o teste fraco do conjunto** —
continuou verde com o router gravando direto, porque só confere 201. Vale
porque está pareado com os recusados.

### 5b-4 — CRUD de coluna (backend) — ⬜ NÃO COMEÇOU

**Sobe:** criar, renomear, reordenar e apagar coluna dentro de um quadro
avulso.

⚠️ **Duas travas diferentes, e confundi-las é o defeito clássico aqui:**

- **"para onde vão estas tarefas?" (0042 D5).** Apagar coluna com tarefas abre
  aviso com o número e um selector: *para qual coluna?*. Coluna vazia some sem
  perguntar. O selector oferece **todas** as outras colunas do quadro. Destino
  terminal (`Concluído`/`Cancelado`) muda o texto do aviso, porque não é mover
  — é concluir ou cancelar o lote, com cascata de subtarefas, `terminal_since`
  ligando e avisos de prazo morrendo. O status de cada tarefa é reescrito pela
  coluna escolhida (D2) e cada uma gera linha em `task_history`.
- **"o quadro continua funcionando depois?" (0042 D4).** Recusa `422` ao apagar
  a **última coluna `OPEN`** ou a **última `DONE`** — as duas semânticas que o
  sistema escreve sozinho (criação e cascata de conclusão). *Em Andamento* e
  *Cancelado* **podem** ser apagadas: quadro de 3 colunas é válido.

⚠️ **O selector não substitui a recusa.** Nada impede alguém de apagar a última
`DONE` escolhendo *Backlog* como destino — e a quebra só aparece na semana
seguinte, quando outra pessoa concluir uma tarefa-mãe cuja subtarefa mora aqui.
⚠️ **Coluna criada por gente nasce sem `legacy_status`.** Não invente um: é o
que faz a 0041 valer para ela.
⚠️ **Não deixar apagar coluna do Quadro geral por este caminho** enquanto a
5c não existir. A 8ª coluna sumir do quadro de 176 tarefas não é o risco desta
fatia. ⚠️ É essa recusa que segura `default_board_and_column_for_status`, que
ficou de FORA da ADR 0042 de propósito.

### 5b-5a — o módulo puro (front) — ✅ ENTREGUE

**Subiu:** `lib/coluna.ts::colunaEquivalente` e `rotuloDeColuna`, com
`lib/__tests__/colunaEquivalente.test.ts`. 529 → 541.

⚠️ **A fixture original não discriminava.** No `GERAL`, `Em Andamento` é a
primeira `IN_PROGRESS` por posição **e** é o alvo — regra certa e regra errada
respondiam igual. Corrigido, e o cabeçalho do arquivo agora diz
`⚠️ a resposta NAO depende da ordem do array`. **É literalmente a armadilha que
o próprio cabeçalho já avisava.**

### 5b-5b — ligar as duas telas transversais (front) — ⬜ NÃO COMEÇOU

⚠️ **Esta fatia vem ANTES da tela do quadro, e é a ordem que importa.** No
instante em que existir uma tarefa fora do Quadro geral, ela aparece em
`/minhas-tarefas` e em `/arquivadas`. **É PRÉ-REQUISITO da 5b-6, não
sequência.**

⚠️ **É a fatia mais arriscada que sobrou.** Mexe em `app/minhas-tarefas/page.tsx`
(**1321 linhas**) e `app/arquivadas/page.tsx` (**438**).

#### As QUATRO regressões, medidas no `main` em 12/08

O texto de 11/08 dizia que "a mudança não é a tag, é o agrupamento do kanban".
**Incompleto.** São quatro caminhos, e o kanban é o **único que avisa**:

1. ⚠️ **Vista de LISTA, silenciosa e sem contador.**
   `app/minhas-tarefas/page.tsx:583` —
   `const okStatus = colunasOn === null || colunasOn.has(t.column_id);`
   `colunasOn` é populado na linha 221 com `colunasPadraoMinhasTarefas(cs)`,
   ou seja **ids das colunas do Quadro geral**. Tarefa de outro quadro nunca
   está nesse `Set` e é filtrada fora da lista. Não há `foraDaColuna` aqui.
2. **Vista de KANBAN, com contador.** `page.tsx:640-651` monta `porColuna` só
   com as colunas do geral e joga o resto em `foraDaColuna`. **Tarefa de quadro
   avulso é contada e não desenhada.** Esta é a que o texto original descrevia,
   e é a menos grave das quatro justamente porque avisa.
3. ⚠️ **O alerta de prazo morre.** `page.tsx` na linha de `dueTone`:
   `col ? deadlineTonePorColuna(col, ...) : null`. Sem coluna resolvida, sem
   alerta. O comentário justifica: *"sem coluna resolvida não há como decidir →
   sem alerta, que é o lado seguro"*. Era o lado seguro quando "sem coluna"
   significava **dado faltando**. Depois da 5b-6 significa **quadro
   diferente**, e o lado seguro passa a ser o lado que mata o aviso de prazo de
   todo quadro avulso.
4. **`todosLigados`** (`page.tsx:674`) compara `colunasOn.size` contra
   `colunas.length` do geral. Menor, mesmo pacote.

#### ⚠️ `rotuloDeColuna` não modela o caso normal da tela que vai servir

Assinatura entregue na 5b-5a:
`rotuloDeColuna(nomeDaColuna: string, nomeDoQuadro: string | null)`, onde
`null` significa **"é o quadro desta tela"**. Não existe representação para
"não sei qual quadro" nem para "não sei qual coluna".

E `/arquivadas` passa `nomeDaColuna={colunaPorId.get(t.column_id)?.name}`
(`app/arquivadas/page.tsx:225`) — **`string | undefined`**, porque a tela lista
o workspace inteiro e a coluna pode não ter vindo na página carregada. Este
arquivo chama esse caso de **normal**.

⚠️ **Decida a assinatura ANTES de abrir o `page.tsx` de 1321 linhas**, não
dentro dele. O teste atual crava `rotuloDeColuna("Backlog", "")` → `" · Backlog"`;
o backend recusa nome vazio (`BoardService._nome_valido`), então isso nunca vem
da API — mas é o valor que um front sem dado tende a passar.

**Sobe:**
- tag `Quadro · Coluna` nas **duas** vistas de `/minhas-tarefas` (lista e
  kanban) e em `/arquivadas`;
- as quatro correções acima;
- **sem seletor de quadro.** Decisão de 11/08, confirmando a ADR 0034 item 6: o
  kanban de `/minhas-tarefas` agrupa por **status**, que é o denominador comum
  entre quadros; coluna não é. Um seletor é exclusivo e esconderia carga de
  trabalho sem erro nenhum. Se um dia for preciso focar, é **filtro** — aditivo
  e visível, no padrão dos filtros de pessoa e escopo que já existem;
- **o filtro da lente passa a exigir `board_id` do Quadro geral**
  (`Board.tsx`, decisão D1 de 11/08). ⚠️ **Ainda NÃO implementado** — medido em
  12/08, `Board.tsx:693-704` filtra só por `team_id`. Uma linha, com teste.
  ⚠️ **Entra aqui e não na 5c**: sem ela, tarefa de quadro extra da raiz passa
  no filtro da lente (`team_id === rootId` + responsável do subtime), a tela
  desenha as colunas do geral, `porColuna[t.column_id]` não acha nada e **o
  card some sem erro**.

**Testes que têm de ser escritos e falhar ANTES da correção:**
- tarefa com `column_id` de outro quadro aparecendo na **lista** de
  `/minhas-tarefas`;
- a mesma tarefa **mantendo o alerta de prazo**;
- tarefa de quadro extra da raiz **não** aparecendo na lente do subtime.

⚠️ Se algum deles passar verde contra o código atual, a fixture não discrimina.

⚠️ **Por que a tag carrega as DUAS informações:** o quadro responde "onde
mora"; a coluna responde "por que este card está agrupado em Em Andamento se a
coluna dele chama outra coisa". Coluna sem ponte deriva status pela semântica
(0041) — sem o segundo pedaço, o agrupamento parece defeito.

⚠️ **`STATUSES` só morre quando esta fatia estiver no ar**, e mesmo assim
continua sendo a reserva para tarefa cuja coluna não veio na lista carregada —
caso **normal** em `/arquivadas`, que lista o workspace inteiro. O
`paridadeColuna.test.ts` (61 testes) segue válido.

⚠️ **`include` do `vitest.config.ts` é só `lib/**` e `components/**`.** Teste
de página mora em `components/__tests__/` e importa de `@/app/...`. Os que
existem hoje: `minhasTarefas.test.tsx` (10) e `ArquivadasPai.test.tsx` (4).

### 5b-6 — a tela (front) — ⬜ NÃO COMEÇOU

**Sobe:** criar e renomear quadro dentro da **tela do time** (ADR 0034 item 5 —
não no menu lateral); seletor entre os quadros daquele time; CRUD de coluna na
tela; render de quadro avulso.

⚠️ **Quadro de lente NÃO mostra afordância de editar nem apagar — ausente, não
desabilitada** (ADR 0034 item 2). Lente e quadro avulso vão conviver no mesmo
seletor: a descrição fixa da lente é *"espelho do quadro geral"*.
⚠️ **O nome do quadro tem de aparecer no modal de criar tarefa**, explícito e
não inferido pela tela. Enquanto mover entre quadros não existir, tarefa criada
no quadro errado só se conserta apagando e recriando — perdendo comentários,
histórico, subtarefas e designações. Essa linha de UI é o que separa uma dívida
de um chamado por semana.
⚠️ **A tela não pode oferecer status que o quadro não tem** (ADR 0042,
§Consequências). Se algum `<select>` ainda listar os 8 fixos, ele mente de dois
jeitos diferentes: marcar "Bloqueado" num quadro de 4 colunas tem **êxito** e
devolve `IN_PROGRESS`; cancelar num quadro sem *Cancelado* devolve **422**, que
é um erro sem explicação para quem clicou.

---

## 4. ⚠️ O portão do vazamento (recitado do `plan.md`, continua valendo)

A fatia 3 devolve `board_id` na resposta de tarefa. Ele só é seguro porque
`board.team_id` é sempre a raiz hoje. **A 5b quebra essa premissa por
desenho.**

1. `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta`
   passa a ser **o teste que importa**. Vermelho ali = vazamento;
2. a **consulta 7** do `invariantes.sql` deixa de ser `0` por ausência de caso
   e vira medição de verdade;
3. ⚠️ **`test_tarefa_de_subtime_nasce_no_quadro_da_raiz` continua VERDE** —
   ao contrário do que o `plan.md` dizia. Se ele ficar vermelho nesta fatia,
   alguém mexeu em `default_board_and_column_for_status`, e isso é defeito
   (§1b).

Os três furos do "só o subtime vê" continuam abertos **por desenho** (ADR 0035
§Consequências): criador sempre vê; relações furam a lente; designação alcança
quem foi designado. **A resposta continua sendo não** — fechar qualquer um
exige permissão por quadro, que colide com a lente inteira.

---

## 5. Conferência visual obrigatória

Nenhum portão pega nada desta lista. A conferência manual achou **cinco**
defeitos na 4c que `pytest`, `tsc`, `vitest` e `next build` não acharam.

1. Criar quadro avulso num subtime → ele nasce com as 4 colunas, nomes e cores
   certos, na ordem certa.
2. Criar tarefa dentro dele → **o modal diz em qual quadro ela vai nascer**.
3. Arrastar entre as 4 colunas → status muda, e **o caminho de ERRO** (modo
   offline do devtools) devolve o card ao lugar. ⚠️ Esse caminho **nunca foi
   executado** e mudou duas vezes na 4c.
4. Acrescentar uma 5ª coluna sem ponte → arrastar para ela → conferir o status
   derivado pela semântica, e a tag em `/minhas-tarefas`.
5. Apagar a 5ª coluna com tarefa dentro → o aviso mostra o número certo, o
   selector oferece as outras colunas, e as tarefas vão para **a escolhida** —
   não para outra. O número na tela bate com o banco.
6. Repetir escolhendo *Concluído* como destino → **o aviso muda de texto** e
   diz o que vai disparar. Depois: a proporção da checklist mudou, o prazo
   parou de cobrar, e a varredura passa a contar essas tarefas.
7. Apagar *Cancelado* e *Em Andamento* → **passa**, e sobra um quadro de duas
   colunas funcional. Criar tarefa nele → nasce em *Backlog*. Concluir →
   funciona.
8. Tentar apagar *Concluído* (última `DONE`) → **recusa com mensagem que
   explica**, não erro genérico. Confirmar o motivo de verdade: concluir uma
   tarefa-mãe cuja subtarefa vive neste quadro continua funcionando.
9. Num quadro sem *Cancelado*, a tela **não oferece cancelar**.
10. A mesma tarefa em `/minhas-tarefas`, `/arquivadas` e no quadro → **os três
    lugares concordam**. ⚠️ Dois números discordando sobre a mesma coisa é pior
    que um número velho.
11. ⚠️ **A tarefa de quadro avulso aparece na LISTA de `/minhas-tarefas`, e não
    só no kanban** (§3, regressão 1) — e **com o alerta de prazo**
    (regressão 3). Nenhum portão pega estas duas.
12. Abrir a lente de um subtime → as tarefas compartilhadas e internas
    continuam lá, **exatamente como hoje**, e nada do quadro avulso aparece.
13. Abrir o Quadro geral → 176 tarefas, 8 colunas, **idêntico ao print de
    11/08**.

---

## 6. ⚠️ A ADR 0042 vive em TRÊS lugares, e isso é deliberado

**Regra:** status sem coluna no quadro cai na coluna `is_default_target` da sua
**semântica**, e **o status é reescrito pela coluna que recebeu** (D2). Ponte
primeiro, semântica depois, `ValidationError` no terceiro degrau.

1. `BoardRepository.column_for_status_in_board` — Python + SQL, uma query,
   `ORDER BY ... DESC NULLS LAST`;
2. a subconsulta de `TaskRepository.complete_descendants` — SQL puro. ⚠️ **A
   cascata é um `UPDATE` em massa por `ltree` e não pode chamar o repositório
   uma vez por linha.** Era o furo da 5b-2;
3. `lib/coluna.ts::colunaEquivalente` — front, para as telas que atravessam
   quadros com um conjunto só de colunas.

⚠️ **Se alguém "unificar", quebra a cascata.** O que mantém as três honestas
são `test_coluna_para_status_db.py`,
`test_cascata_em_quadro_de_quatro_colunas_db.py` e `colunaEquivalente.test.ts`.

| sabotagem | derruba |
|---|---|
| Tirar só o `DESC NULLS LAST` da cascata | **1** — `test_a_cascata_nao_come_a_ponte_quando_as_duas_existem` |

---

## 7. O que esta fatia NÃO valida

- **Desempenho.** O `Board.tsx` filtra client-side sobre a lista inteira; agora
  com mais um quadro por time. Nada medido. 26 contas, parede estimada em
  150–200. `listBoards` sem memoização, uma requisição por tela.
- **Responsivo.** Um `@media` no produto todo, e a tela de quadro ganha um
  seletor novo.
- **Apagar quadro** — fatia própria, com a lixeira e o script de restauração.
- **Mover tarefa entre quadros** — fatia 5c.
- **Cor livre e contraste AA** — fatia do seletor de cor.
- **Os dois `onDragEnd`** — nunca serão testáveis em jsdom. Conferência manual,
  sempre.
- ⚠️ **Nenhum quadro não-padrão jamais existiu em produção.** Tudo o que a 5b-1
  a 5b-3 entregaram é regra para um mundo que ainda não aconteceu.

---

## 8. Ordem de deploy

1. **5b-1** — ✅ subiu sozinha, no-op em produção.
2. **5b-2** — ✅ testes, sem deploy próprio.
3. **5b-3** e **5b-4** — backend com API, sem front que as alcance. ⚠️ **Não
   crie nenhum quadro em produção ainda.** A 5b-3 já subiu; a 5b-4 não.
4. **5b-5b** — a tag e as quatro correções, antes de existir qualquer tarefa
   fora do Quadro geral.
5. **5b-6** — a tela. **O primeiro quadro de produção nasce aqui.** Rode o
   `invariantes.sql` no mesmo dia: a consulta 7 sai de "ausência de caso" e a 5
   passa a listar mais de um quadro.
6. ⚠️ **Anote o contador de tarefas da consulta 5.** É o único contador de
   produção escrito em algum lugar. Série: 696 (06/08) → 802 → 832 (10/08).

---

## 9. Números de produção (11/08)

- **176 tarefas vivas no Quadro geral**: Backlog 20, Planejado 18, Em Andamento
  42, Aprovação Interna 4, Aprovação Externa 1, Concluído 87, Cancelado 0,
  Bloqueado não medido.
- ⚠️ **87 de 176 são Concluído.** Metade do quadro é trabalho terminado
  esperando a varredura. Não é defeito — é a janela do `terminal_since`. Mas
  vira "o sistema tá pesado" na boca do usuário. **Vale rever o prazo da
  varredura em horário calmo.**
- **71% das tarefas vivas estão na RAIZ** (155 de 219, 10/08).
- Medição que sustenta as 4 colunas base (D2): `Aprovação Interna` **4**,
  `Aprovação Externa` **1**, `Cancelado` **0** — cinco cards em 176, contra 42
  em `Em Andamento` e 87 em `Concluído`.

---

## 10. Commits

```
docs(adr): coluna alvo por semantica quando o status nao tem coluna (BE-0042, Spec 036)
feat(boards): column_for_status_in_board cai no is_default_target da semantica (Spec 036, fatia 5b-1)
test(boards): caminhos de escrita por status em quadro de 4 colunas (Spec 036, fatia 5b-2)
feat(perms): board.manage.subteam e board.manage.root (Spec 036, fatia 5b-3)
feat(boards): BoardService cria e renomeia quadro avulso com as 4 colunas base (Spec 036, fatia 5b-3)
feat(front): colunaEquivalente e rotuloDeColuna em lib/coluna (Spec 036, fatia 5b-5a)
feat(boards): CRUD de coluna com trava de coluna alvo de semantica (Spec 036, fatia 5b-4)
feat(front): tag de quadro e coluna nas telas transversais (Spec 036, fatia 5b-5b)
feat(front): lente de subtime filtra pelo quadro geral (Spec 036, fatia 5b-5b)
feat(front): tela de quadro avulso dentro do time (Spec 036, fatia 5b-6)
```

Para este arquivo:

```
docs(spec): plan da fatia 5 do quadro avulso, supersede a secao do plan.md (Spec 036)
```
