# Contexto para continuar — task-manager-marketing

Documento de passagem de bastão. **Sucede o handoff de 18/08** (o que dizia
"Backend 807 → 846, Front 737 → 791" e "a primeira coisa a fazer é o deploy").

**Backend 846 → 860. Front 791 → 865.** ⚠️ **Migrations: `0013` → `0014`.**
ADRs backend: 43.

✅ **A SPEC 036 ESTÁ FECHADA** (só o seletor de cor ficou, adiado de propósito
para depois do redesenho). ✅ **A SPEC 038 ESTÁ FECHADA.**

⚠️ **A PRIMEIRA COISA A FAZER É UM DEPLOY.** Há **quatro entregas em `main` que
não estão em produção**. Ver §5.

---

## 1. ⚠️ O PADRÃO DOS MEUS ERROS NESTA SESSÃO

O handoff anterior dizia: *"afirmei sobre código que eu não tinha lido até o
fim, quatro vezes"*. **Isso melhorou** — passei a abrir o arquivo antes de
afirmar, e isso pegou coisas grandes (ver §4). O que apareceu no lugar foi
**outra família de erro, e ela é de PROCESSO, não de leitura.**

### a) ⚠️⚠️ CRIEI DUAS BRANCHES A PARTIR DE `main` QUANDO ELAS DEPENDIAM DE OUTRA NÃO-MERGEADA

Aconteceu **duas vezes**, e a segunda foi **uma fatia depois de eu escrever a
regra no `plan.md`**.

- **Spec 038:** a `fatia-b2` (front) saiu de `main`, que não tinha a `fatia-b1`
  (backend). Resultado na máquina dela: front mandando `due_time`, backend sem
  conhecer o campo. ⚠️ **O Pydantic descarta campo desconhecido em silêncio** —
  o `PATCH` volta **200**, sem o campo, e a hora "não salvava" sem erro nenhum.
- **Spec 036:** a `fatia-12b` saiu de `main` sem a `12a`. Só percebi porque uma
  edição de `plan.md` falhou procurando uma seção que não estava na branch.

⚠️ **E OS TESTES DO FRONT PASSARAM NAS DUAS VEZES**, porque mockam o
`@/lib/api`: eles afirmam o que a tela CHAMA, nunca o que viaja no fio.

**A regra, e ela precisa ser VERIFICADA e não só lembrada:** antes do primeiro
commit de uma branch, conferir se a fatia da qual ela depende já está em `main`.
Se não estiver, `git merge` daquela branch para dentro antes de qualquer coisa.

### b) ⚠️ DEIXEI A ÁRVORE DE TRABALHO DELA NUMA BRANCH DE DOCUMENTO

Troquei de branch para corrigir uma spec e não voltei. O servidor de
desenvolvimento dela passou a servir código sem a funcionalidade, e ela relatou
**"não achei a cápsula"** — que parecia defeito e era eu.

**A regra:** ao trocar de branch para mexer em documento, **voltar para a de
código antes de devolver a palavra**, e dizer em qual branch a árvore ficou.

### c) ⚠️ ASSUMI ASSINATURA DE FUNÇÃO SEM LER

`EntityNotFoundError(..., details={...})` — não existe. A assinatura é
`(entity, *, identifier, message)`. Virou `TypeError` → **500**, e dois testes
que afirmavam 404 caíram no `pytest` dela. O conserto foi **delegar a
`_coluna_do_quadro`, que já existia** e fazia a mesma busca.

### d) Escrevi escopo a partir da intenção, e o código desmentiu — TRÊS vezes

As três foram pegas por mim, ao abrir o arquivo antes de escrever código, e as
três estão registradas nos `plan.md`:

1. **"a armadilha de sequência"** da fatia 10 — não existia: `Board.tsx` já
   zerava o rascunho no `useEffect` de `[boardId]`;
2. **"`start_date` já viaja na API"** — eram três linhas de **`Project`**, não
   de `Task`. E **"a validação cruzada não existe"** — existia, e recusa com 422;
3. **"trocar o alvo no Quadro geral muda onde toda tarefa nova aparece"** — não
   muda: o degrau 1 (`legacy_status`) ganha sempre lá.

⚠️ **A lição não é "leia mais". É: escopo escrito antes de abrir o arquivo é
palpite com formatação de documento.**

### O que a Camila pegou na tela, e os portões não

- **A cápsula de datas não era o que ela desenhou** (era texto + botão ao lado;
  o desenho é a pílula sendo o gatilho), e **faltava o título "Datas"**.
- **Subtarefa não editava datas** — copiei o `ehTopo` do controle de PROJETO
  sem pensar. Projeto de subtarefa é herdado; **prazo é próprio**.
- **O rótulo do prazo não acompanhou a cor**: card VERMELHO dizendo "Vence
  hoje". Eu tinha feito o `deadlineTone` ciente da hora e esquecido o
  `deadlineLabel`.
- **Não havia como limpar a hora** — o `<input type="time">` tem "x" nativo em
  alguns navegadores e nenhum em outros.

---

## 2. Como me tratar (Camila)

Tudo dos handoffs anteriores continua valendo. O que esta sessão acrescentou:

- ⚠️ **ELA CONFERE NA TELA, E A TELA GANHA.** Continua verdade, e nesta sessão
  ela achou **quatro** coisas que os três portões não pegam.
- ⚠️ **DIGA EM QUAL BRANCH A ÁRVORE FICOU**, sempre que trocar. Ela roda o
  `next dev` e o `api-dev` locais.
- ⚠️ **QUERY DE BANCO EM SQL PURO** — ela roda no **Adminer**, não no
  `docker exec`. A exceção é o `invariantes.sql`, que é arquivo do repo.
- **Ela responde decisão de produto rápido e bem**, com opções numeradas e
  custo. Nesta sessão decidiu: dropdown antes do deploy, horário **opcional**,
  fuso **fixo de Brasília**, limite de coluna **60**, alvo **no lote**, e o
  selo virando controle.
- ⚠️ **ELA MUDA DE IDEIA COM ARGUMENTO, E ISSO VALE DEVOLVER O CUSTO.** Ela
  pediu "fuso de quem olha"; ao ouvir que **o job de prazo não tem espectador**,
  escolheu o fixo. **Devolver o custo é mais útil que obedecer.**
- ⚠️ **`gh` NÃO ESTÁ INSTALADO.** Eu só consigo **empurrar branch** — PR é ela
  quem abre. Não diga "o PR está lá"; diga "empurrei, o PR é seu" e mande o
  link de compare.
- **Ela roda backend a ~1,5 min e front a ~12 s.** **O backend eu NÃO consigo
  rodar** — não há Postgres. Isso obriga a dividir fatia de backend em duas
  entregas (12a/12b, B1/B2), e **funcionou bem**: os erros que sobraram foram
  de assinatura, não de lógica.

### Regras de validação (não negociáveis)

- Front: `npx tsc --noEmit`, `npm test`, `npx next build`. **865 passed.**
- ⚠️ **E `TZ=UTC npm test` TAMBÉM** — o CI roda em UTC, e um defeito de fuso
  passou verde na máquina dela e reprovou no CI. Ver §7.
- Backend: `docker compose run --rm -e TEST_DATABASE_URL=... api-dev pytest`.
  **860 passed.**
- ⚠️ **Depois de mexer no backend: `docker compose up -d --build api-dev`.**

---

## 3. ESTADO

**Backend: 860.** **Front: 865.** **Migrations: `0014`.** **ADRs: 43.**

| entrega | testes |
|---|---|
| **fatia 10** seletor vira dropdown; renomear/apagar no modo de edição | 791→801 |
| **limite 60 + truncar** cabeçalho de coluna | 801→802 |
| **038 fatia A** data de início na tela | 802→813 |
| **038 fatia B** hora no prazo (B1 backend, B2 front) | 846→860 / 813→838 |
| **fatia 11** aviso na queda para a lente | 838→846 |
| **fatia 12** alvo da semântica (12a backend, 12b front) | 851→860 / 846→858 |
| **fatia 5c** quadro extra da raiz | 858→865 |

**Arquivos novos:** `components/AcoesDoQuadro.tsx`, `lib/prazo.ts`,
`alembic/versions/0014_task_due_time.py`, `.github/pull_request_template.md`,
`backend/specs/038-datas-e-horario/`.

---

## 4. ⚠️ O QUE MUDOU DE MODELO NESTA SESSÃO

### A hora do prazo, e o desenho que a resposta dela destravou

`due_date` continua `date`. Entrou **`due_time TIME NULL`** — "sem hora" é o
`NULL`, não um valor especial.

⚠️ **A ALTERNATIVA (`timestamptz`) FOI RECUSADA POR UM MOTIVO CONCRETO:** um
timestamp único **não distingue** "vence dia 19" de "vence dia 19 à meia-noite".
E ela custaria backfill em 1085 linhas (com `00:00` pondo toda tarefa de hoje em
atraso de manhã) mais a troca de tipo dos DOIS campos de dedup — e se eles
divergissem de `due_date`, **o job passaria a notificar todo dia, todas as
tarefas com prazo, para as 26 pessoas**.

⚠️⚠️ **A TELA E A NOTIFICAÇÃO DIVERGEM POR ATÉ UM DIA, E ISSO É ESCOLHA.** A
tela diz "atrasada" às 18:01; o job roda **diário** (n8n) e compara **datas**.
Fazer a notificação acompanhar a hora exige mudar o agendamento. **Está
registrado no `plan.md` da 038 e ninguém pediu para mudar.**

### O alvo de uma semântica agora se troca — e isso destravou apagar coluna

O `board_service.py` registrava como consequência aceita: *"com duas colunas
OPEN, a que é ALVO continua sem poder ser apagada, mesmo havendo outra"*. Agora
o alvo se move, **no lote, numa etapa que roda ANTES de apagar** — e é essa
ordem que permite "trocar o alvo e apagar a coluna antiga" num gesto só.

### A raiz pode ter quadro extra (5c), e isso mudou o Quadro geral

⚠️ **O QUADRO GERAL PAROU DE ADIVINHAR PELO LOTE.** Era
`quadroPedido ?? quadroDoLote ?? padrão`; com um quadro extra da raiz, se todas
as tarefas carregadas estivessem nele, a tela do geral desenharia as colunas do
**outro** quadro. **A heurística sobrou só no modo PROJETO**, que atravessa
quadros por desenho.

⚠️ **E `/quadro` ganhou uma guarda:** só mostra tarefa cujo `board_id` é o do
geral. Sem isso, as tarefas do quadro extra passariam (o `team_id` é o mesmo!) e
cairiam em `foraDaColuna` — **contadas e invisíveis**.

---

## 5. ⚠️ PRIMEIRA COISA A FAZER: O DEPLOY

**Quatro entregas estão em `main` e NÃO em produção:**

1. `notify_deadline` documentado (só comentário, zero comportamento)
2. **fatia 11** — aviso na queda para a lente
3. **fatia 12** — trocar o alvo da semântica
4. **fatia 5c** — quadro extra da raiz

⚠️ **NÃO HÁ MIGRATION NOVA** — a `0014` já está em produção. Então a ordem é a
padrão e o risco é baixo.

O roteiro está no `DEPLOY.md` e na §Ordem de deploy do `plan.md` da 036. O
resumo: `git status --porcelain` na VPS (esperado vazio) → `git pull` →
`invariantes.sql` antes → **taguear as imagens (passo 0.b)** → `build` →
`up -d` → `invariantes.sql` depois.

**Smoke do que sobe:** o aviso da queda (há um quadro apagado em produção para
testar), o "tornar padrão" no modo de edição, e o seletor no `/quadro`.

---

## 6. ⚠️ LACUNAS CONHECIDAS (medidas, não suspeitas)

- ⚠️ **O ARRASTE (`onDragEnd`) NÃO TEM GUARDIÃO E NUNCA VAI TER.** Não roda em
  jsdom. Continua sendo olho humano.
- ⚠️⚠️ **O TETO DE CARREGAMENTO, E A CAUSA NÃO É O ARQUIVAMENTO.** O job **roda**
  (confirmado pela Camila; ela configura o n8n). Mesmo assim o quadro carregava
  **817 de 1000** — e **578 daqueles 817 eram SUBTAREFA**, que gastam teto sem
  desenhar card. **Achado dela.** O conserto real é agregar a contagem de
  subtarefa no backend, no modelo do `assignee_ids_for_tasks` (ADR 0025), e
  **não** mexer no job nem no teto.
- ⚠️ **`corEhHex` continua sem leitor** — é o seletor de cor, adiado de
  propósito para depois do redesenho (o Figma refaz o cabeçalho da coluna).
- ⚠️ **`notify_deadline` é lido e exposto, mas NÃO TEM ESCRITOR.** Coluna nova
  nasce cobrando prazo. Decisão de 13/08 mantida; agora está **documentado** no
  `BoardColumnCreateRequest`, e os três textos que prometiam o contrário foram
  corrigidos.
- **`--text-faint` reprova AA no tema CLARO.** Decisão de design.
- **Zero responsivo. Sem `KeyboardSensor`. Sem índice em `task.column_id`.**
- **As classes CSS não têm guardião** — o `include` do vitest é só `lib/**` e
  `components/**`.

---

## 7. Armadilhas

### Novas desta sessão

⚠️⚠️ **FUSO DO AMBIENTE NÃO PODE DECIDIR REGRA DE PRODUTO.** `deadlineDays`
usava a meia-noite **local** e `estaAtrasada` passou a usar `America/Sao_Paulo`
— duas fontes de verdade para "que dia é hoje". **Concordavam na máquina da
equipe (todo mundo em BRT) e divergiam no runner do CI (UTC), só entre 00:00 e
03:00.** Consertado; hoje tudo passa por `lib/prazo.ts`. **Rode `TZ=UTC npm
test`.**

⚠️ **COMPARAÇÃO DE STRING COM PREFIXO MENTE:** `"2026-08-19" < "2026-08-19
18:00"` é `true` — a mais curta perde. Era o filtro "Atrasadas". E o Postgres
devolve `TIME` como `"18:00:00"`, que comparado com `"18:00"` inverte de novo.

⚠️ **`useSearchParams` EM ROTA ESTÁTICA DERRUBA O `next build`** com "missing
suspense boundary" — **e o `npm run dev` não reclama**. `/quadro` é estática;
`/quadro/[teamId]` é dinâmica e passa sem `Suspense`. As duas usam o mesmo hook.

⚠️ **CORPO MONTADO CAMPO A CAMPO PRECISA DE `*Corpo.test.ts`.** `createTask` e
`aplicarLoteDeColunas` montam campo a campo; `updateTask` manda `body: input`.
**Campo novo no primeiro tipo é descartado em silêncio** — foi assim que o
`board_id` ficou fora por um mês. Os testes de corpo usam `toEqual` sobre o
objeto INTEIRO **de propósito**: eles caem quando um campo entra, e é assim que
lembram alguém de pôr a linha.

⚠️ **ÍNDICE PARCIAL NÃO É `DEFERRABLE`.** Trocar o alvo passa por um estado com
dois alvos; a ordem `tirar → flush() → pôr` é obrigatória, senão sai **500**.

⚠️ **`EntityNotFoundError` NÃO ACEITA `details=`** — é
`(entity, *, identifier, message)`.

⚠️ **A CONSULTA 5 DO `invariantes.sql` LISTA QUADRO APAGADO** — agora com a
coluna `apagado`, porque um quadro apagado passou por existente e custou uma
investigação inteira. **E a consulta 7 virou CONTEXTO**: ela era invariante
enquanto toda tarefa vivia no quadro da raiz; a fatia 5 tornou "tarefa em quadro
de subtime" um estado normal.

### Herdadas, ainda válidas

⚠️ **o `api-dev` NÃO recarrega sozinho** · **dois `useDroppable` com o mesmo id
se sobrescrevem** · **`useDraggable({ disabled })` não desregistra o nó** ·
**teste de serviço não sabe se a rota existe — rota nova leva teste HTTP** ·
**`ColumnSemantic` é `StrEnum` e a string compara igual** · **`NOW()` no
Postgres é o instante da TRANSAÇÃO** · **`quadroPedidoNaUrl` derrubava
`?quadro=` em silêncio — a fatia 11 acabou com isso** · **`str.replace` falha
calado** · **`@model_validator` devolve 500** · **o quadro só desenha
`depth === 0`**.

---

## 8. O QUE VEM DEPOIS

Em ordem, e **decidida com a Camila**:

1. ⚠️ **O DEPLOY das quatro entregas** (§5).
2. **Spec 039 — redesenho de layout.** Ela tem os wireframes no Figma: sidebar
   de ícones colapsável, cápsula "Datas", painel de filtros, detalhe da tarefa
   como painel grande, e ⚠️ **paginação no rodapé** — que ataca o teto de
   carregamento junto com a contagem agregada de subtarefa (§6).
3. **Spec 040 — múltiplos times raiz.** ⚠️ **É maior do que parece:** o backend
   já suporta (`parent_team_id is None` por time), mas **o front trata a raiz
   como singleton em dois lugares** — `lens.ts` e `getRootTeamId()`, este
   **memoizado**. E `api.ts` faz `team_id ?? await getRootTeamId()` ao criar
   tarefa: com duas raízes, **a tarefa vai para a organização errada em
   silêncio**. O `soRaiz` do quadro também depende do singleton.
4. **Spec 041 — reações em comentário** (joia, coração). Tabela nova
   `comment_reaction`. ⚠️ **FK composta carregando `workspace_id`**, como faz o
   `Comment` — tabela nova que não siga isso fura o isolamento entre workspaces.
5. **Seletor de cor** — depois do 039, porque o redesenho refaz o cabeçalho da
   coluna.

---

## 9. Números de produção (18/08)

- **1157 tarefas** na consulta 5 (conta apagadas e arquivadas).
- **817 é o que o quadro carrega**, contra o teto de 1000 — e **578 disso é
  subtarefa**, que não desenha card.
- **239 cards** (`depth = 0`), sendo **125 em Concluído**.
- **Três quadros:** "Quadro geral" (raiz, 8 colunas), "Quadro teste do
  GOATzinho" (CRM, 19 colunas, quadro de teste do smoke) e "Cobertura e
  captações" (Mídias Sociais, **apagado**).
- ⚠️ **O "Quadro teste do GOATzinho" ainda está vivo em produção**, com nomes de
  teste. Se não for usar, apagar limpa o dado.

---

## 10. O que NUNCA foi validado

1. **Desempenho.** `Board.tsx` passou de 2000 linhas e o quadro carrega 817
   tarefas em 9 requisições.
2. **Responsivo.**
3. **Os `onDragEnd`.**
4. **O desfazer do lote de colunas** (a bancada não alcança o rollback).
5. ⚠️ **O rollback de imagem do `DEPLOY.md` nunca foi executado de verdade** —
   e o próprio arquivo diz que procedimento de emergência não testado é ficção.
