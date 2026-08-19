# Plano — Spec 038, datas e horário

> Escrito em 18/08/2026, **antes de código**, para a Camila conferir. Mesmo
> formato do `plan.md` da Spec 036: uma seção por fatia, com o que sobe, os
> guardiões e as armadilhas medidas.
>
> ⚠️ **A ORDEM É A → B, e não é preferência.** A fatia A não tem migration e não
> toca em dado nenhum; a B converte 1085 linhas de produção e depende de **três
> decisões de produto** que estão em aberto (§Decisões que faltam, no `spec.md`).
> Entregar a A primeiro põe valor na tela sem gastar a janela de rollback barato.

---

## Fatia A — `start_date` na tela — ✅ ENTREGUE (18/08)

> Escopo escrito antes de código, entregue e **conferida na tela** no mesmo dia.
> **Front 801 → 813. Sem migration, sem uma linha de backend.**

⚠️ **O ESCOPO ABAIXO ESTAVA ERRADO EM DOIS PONTOS, e os dois só apareceram ao
abrir o arquivo — não ao pensar sobre ele:**

1. ⚠️ **`start_date` NÃO viajava na API do front.** Este documento afirmava
   "existe ponta a ponta menos o input", citando três linhas do `api.ts` que
   eram de **`Project`**, não de `Task`. O tipo `Task` do front não declarava o
   campo. **Era o mesmo buraco do `board_id`**, e o aviso contra ele já estava
   escrito duas linhas acima, no próprio `api.ts`.
2. ⚠️ **A validação cruzada JÁ EXISTIA e RECUSA** (`_validate_dates`, 422) —
   ver a linha corrigida em "O que sobe".

### O que entrou

| | arquivo |
|---|---|
| `start_date` no tipo `Task`, nos dois inputs **e na linha do corpo do `createTask`** | `lib/api.ts` |
| a cápsula "Datas" | `components/TaskDetail.tsx` |
| campo "Início" na criação e na edição | `components/TaskModal.tsx` |
| guardiões | `__tests__/TaskDetailDatas.test.tsx` (10, novo) e `+2` em `lib/__tests__/createTaskCorpo.test.ts` |

⚠️ **O `tsc` DERRUBOU 4 FIXTURES, e isso é o portão funcionando.** Elas são
literais completos sem `as` — e o comentário de cada uma diz por quê: foi um
`as` que escondeu o buraco do `board_id` por horas em 10/08.

### ⚠️ DUAS CORREÇÕES DA CAMILA, na tela, no mesmo dia

1. **Subtarefa TAMBÉM edita datas.** A primeira versão copiou o `ehTopo` do
   controle de **projeto** — e as duas coisas não são iguais: subtarefa **herda**
   o projeto do pai (Spec 022), por isso não o edita; **prazo é próprio**, e este
   mesmo arquivo já o desenha na checklist e já o pede na criação rápida de
   subtarefa. **Copiar a trava foi engano.** Tem teste.
2. **A pílula É o gatilho, e não texto + botão ao lado.** O desenho dela é uma
   pílula irmã de "Coluna" e "Prioridade"; clicar nela abre a edição. A primeira
   versão pôs um botão redondo ao lado, no padrão do projeto. ⚠️ **E o vazio
   virou "Sem datas", no plural** — "sem prazo" nomeia metade do que a cápsula
   edita, e a pessoa clicaria esperando um campo e acharia dois.

⚠️ **UM ERRO DE PROCESSO, e ele custou uma rodada dela:** a árvore de trabalho
ficou numa branch de DOCUMENTO depois de eu corrigir a spec, e o servidor de
desenvolvimento passou a servir código sem a cápsula. **"Não achei a cápsula"
não era defeito de código.** Ao trocar de branch para mexer em documento,
voltar para a de código antes de devolver a palavra.

### Conferência visual — ✅ FEITA EM 18/08

A cápsula, o título "Datas", o 422 mantendo o painel aberto, e a data de
subtarefa aparecendo na checklist do pai sem recarregar.

---

## Fatia A — texto de escopo (histórico, antes da entrega)

**Sem migration. Sem mudança de backend. Sem decisão pendente.**

⚠️ **O CAMPO EXISTE PONTA A PONTA MENOS O INPUT.** Está no banco
(`operational.py:279`), no tipo de resposta e no corpo do `create` e do `update`
(`api.ts:1609,1705,1716`). O que não existe é lugar de digitar. **É a doença do
`corEhHex` e do `notify_deadline`: capacidade completa sem leitor** — e desta vez
o conserto é o mais barato dos três.

### O desenho, decidido em 18/08

A cápsula **"Datas"**, com "Data de início" e "Data de entrega", aberta a partir
do chip de data no detalhe da tarefa.

⚠️ **NÃO É PADRÃO NOVO.** Os chips `Coluna`, `Prioridade` e `Sem Projeto` já são
gatilhos que abrem painel suspenso. O chip de data é o único que **não abre
nada** hoje. Esta fatia liga o que já existe ao redor dele, e por isso não paga
custo de aprendizado.

### O que sobe

- A cápsula "Datas" no `TaskDetail`, com os dois campos.
- `start_date` no `TaskModal` (criação), ao lado do prazo — o Figma do modal
  "Nova tarefa" já desenha "Início" e "Término".
- ⚠️ **A regra "início não pode ser depois da entrega" JÁ EXISTE, E RECUSA.**
  Esta linha dizia o contrário — que a regra não existia e que era decisão
  pendente, com recomendação de "avisar e aceitar". **Falso, e achado só ao
  abrir o arquivo:** `TaskService._validate_dates` (`task_service.py:1613`)
  levanta 422 com *"Data de inicio nao pode ser posterior a data limite"*, e é
  chamada na criação (`:442`) **e** na edição (`:1118`), sobre o estado FINAL
  da tarefa.
  ⚠️ **Consequência para a tela, e ela é concreta:** mexer em UM campo pode ser
  recusado por causa do OUTRO, que a pessoa não tocou. Por isso o painel manda
  os dois sempre, e a mensagem exibida é a do backend — só ela nomeia a causa.

### Guardiões

| sabotagem | esperado |
|---|---|
| `start_date` não entra no corpo do `create` | teste de corpo (⚠️ `body: input` é seguro; campo a campo, não) |
| limpar a data manda `""` em vez de `null` | teste: o payload leva `null` |
| a cápsula fecha ao clicar dentro | teste de componente — usar o padrão do painel de filtros (`Board.tsx:252`), **não** o `useFecharAoClicarFora`, que é de modal |
| início depois da entrega passa sem nada | teste da decisão acima, qualquer que seja ela |

⚠️ **TESTE DE COMPONENTE QUE MOCKA A API NÃO É GUARDIÃO DE CORPO.** Vale a
herança da Spec 036: o corpo se prende em teste de `lib/`.

---

## Fatia B — horário no prazo — ✅ ENTREGUE (18/08)

> Entregue em duas partes, e a divisão foi por uma limitação minha e não por
> desenho: **eu não consigo rodar o `pytest`**. B1 = backend inteiro, medido
> pela Camila (**846 → 851**, migration `0014` aplicada). B2 = front
> (**813 → 836**), com os três portões rodados aqui.

### ⚠️ FUSO: `America/Sao_Paulo`, FIXO — e a pergunta foi devolvida antes

A Camila pediu primeiro **"fuso de quem olha"**. A resposta foi devolver o
custo, e ela mudou de ideia com o argumento na mão:

⚠️ **O JOB DE PRAZO NÃO TEM "QUEM OLHA".** Ele roda no servidor, num horário,
e manda para várias pessoas — precisa de UM fuso para decidir "venceu". Com
atraso por espectador, a tela de cada pessoa e a notificação diriam coisas
diferentes sobre a mesma tarefa.

⚠️ **E a decisão não fecha porta:** `date` + `time` + um fuso conhecido já é um
instante sem ambiguidade. Renderizar no fuso de quem olha, um dia, é mexer em
exibição — **sem migration**.

⚠️ **O BACKEND JÁ FAZIA ISSO DESDE A SPEC 023 (D7).** O
`DeadlineNotifyService` sempre usou `America/Sao_Paulo`; era o FRONT que usava o
fuso do navegador e **coincidia** por todo mundo estar no Brasil. Agora concordam
por construção.

### O que entrou

| | arquivo |
|---|---|
| a coluna `due_time TIME NULL` | `alembic/versions/0014_task_due_time.py` |
| modelo, schemas, router, serviço e `_validate_hora` | `tasks/` |
| **a regra de atraso**, pura e testada | `web/lib/prazo.ts` (novo) + 17 testes |
| tom e rótulo cientes da hora | `web/lib/status.ts`, `web/lib/coluna.ts` |
| campo de hora, "Limpar hora", hora na pílula | `web/components/TaskDetail.tsx` |
| o filtro "Atrasadas" | `web/components/Board.tsx` |

### ⚠️ A ARMADILHA CENTRAL, e ela é silenciosa

    "2026-08-19" < "2026-08-19 18:00"   →  true   (prefixo é MENOR)

O filtro fazia `t.due_date < hoje`. Com hora, a tarefa vencida **hoje às 09:00**
sumiria do filtro às 18:00 — sem erro, sem log, sem nada na tela. **E há um
segundo corte:** o Postgres devolve `TIME` como `"18:00:00"`, e comparado com
`"18:00"` a string mais longa vence. Os dois têm teste próprio, e o mesmo
`slice(0, 5)` é o que faz o `<input type="time">` não nascer vazio.

### ⚠️ TRÊS ERROS MEUS, e os três a Camila achou na tela

1. ⚠️⚠️ **A BRANCH B2 SAIU DE `main` E NÃO DA B1.** Ela **depende** da B1, que
   não estava mergeada — então a máquina dela rodava front que MANDA `due_time`
   contra backend que não sabe o que é. **O Pydantic descarta campo desconhecido
   em silêncio:** `PATCH` volta 200, sem o campo, e a hora "não salvava" sem
   erro nenhum. **Regra: fatia que depende de outra não-mergeada sai da branch
   dela, não de `main`.**
2. **O rótulo não acompanhou o tom.** `deadlineTone` ficou ciente da hora e
   `deadlineLabel` não: a tarefa ficava VERMELHA dizendo "Vence hoje". ⚠️ **Cor
   e texto discordando é o defeito que fez o `TaskDetailChecklist.test.tsx`
   existir** (o card dizia "2/2" e o detalhe "(0/2)"). Hoje os dois chamam a
   MESMA `estaAtrasada`.
3. **Não havia como limpar a hora.** O `<input type="time">` tem "x" nativo em
   alguns navegadores e nenhum em outros — "tirar a hora" dependia do navegador.
   Ganhou botão explícito.

### ⚠️ O QUE OS PORTÕES NÃO PEGARAM, e por quê

Os três erros passaram por `tsc`, `vitest` e `next build`. **Os testes de
componente mockam o `@/lib/api`** — eles afirmam o que a tela CHAMA, nunca o que
viaja no fio. É a lição do topo do `createTaskCorpo.test.ts` um nível acima:
*mock do cliente HTTP esconde campo que o cliente repassa e o servidor não
conhece.*

### ⚠️ A DIVERGÊNCIA QUE FICA, e é escolha

**A tela diz "atrasada" às 18:01; a notificação sai na execução diária
seguinte.** O job roda DIÁRIO (n8n) e compara datas — hora só muda o que a TELA
chama de atrasado. Fazer a notificação acompanhar a hora exige mudar o
agendamento, e ninguém pediu. **Se um dia incomodar, é fatia própria.**

### Conferência visual — ✅ FEITA EM 18/08

Hora passada → vermelho e no filtro "Atrasadas". Hora futura → não atrasada. Sem
hora → o comportamento de sempre. Limpar a data de uma tarefa com hora → salva.
Reabrir o painel → hora preenchida.

---

## Fatia B — texto de escopo (histórico, antes da entrega)

⬜ ESCOPO, falta UMA decisão

⚠️ **REDESENHADA EM 18/08, DEPOIS DA RESPOSTA DA CAMILA.** A versão anterior
convertia seis colunas para `timestamptz`, com backfill em 1085 linhas. Ao
responder que **horário não é obrigatório**, o desenho virou **`date` + `time`
NULO** e a migration encolheu para *uma coluna nova e nula*. O porquê está na
§Decisões do `spec.md`, com a tabela de comparação.

⚠️ **FALTA SÓ A DECISÃO DE FUSO** (recomendado: fixo, `America/Sao_Paulo`).
As outras duas foram respondidas, e uma delas deixou de existir.

### A migration

**Uma coluna nova, nula, e nada mais:**

```
task.due_time  TIME NULL
```

⚠️ **`start_date` NÃO GANHA HORA NESTA FATIA.** O pedido foi *o horário definir
se a tarefa está atrasada*, e atraso se mede contra a entrega. Dar hora ao
início dobraria a superfície sem nada consumindo o valor — a doença do
`corEhHex`. Se um dia precisar, é `start_time`, aditiva igual.

⚠️ **`project` NÃO ENTRA.** Projeto não tem "atrasado" na tela hoje.

⚠️ **`due_soon_notified_for` E `overdue_notified_for` NÃO MUDAM, e é o maior
ganho do desenho novo.** Eles guardam *o `due_date` para o qual o aviso já saiu*,
e o job só notifica quando difere. Se tivessem mudado de tipo junto com um
`due_date` convertido, a comparação viraria "sempre diferente" e **o job passaria
a notificar todo dia, todas as tarefas com prazo, para as 26 pessoas.** Com
`date` intacto, isso não pode acontecer.
⚠️ **MAS SOBRA UMA VERRUGA, e ela é conhecida:** mudar **só a hora** não muda o
`due_date`, então o dedup não rearma e o aviso não sai de novo. Ou o job passa a
comparar os dois campos, ou isso fica escrito como limitação aceita. **Decida na
fatia, não depois.**

⚠️ **ORDEM DE DEPLOY: a PADRÃO do `DEPLOY.md` (código antes, migration depois).**
Coluna nova e nula é o caso que o próprio arquivo chama de seguro: *"coluna
nullable e tabela nova que ninguém referencia não afetam o código velho, que
nunca pergunta por elas"*. **Não é** a segunda exceção — aquela é para
`mapped_column` novo em model existente, e aqui o model novo é que carrega o
campo. Escreva a ordem no cabeçalho da migration mesmo assim.

### O que sobe no front

- ⚠️ **A comparação de atraso ganha um SEGUNDO caminho, e o primeiro fica
  intacto.** Hoje é `t.due_date < hoje`, string contra string
  (`Board.tsx:82,1315`), e o comentário do `hojeISO` **proíbe**
  `new Date(due_date)` por escorregar um dia. **Sem hora, isso continua valendo
  e não se toca** — é 100% do dado existente. **Com hora**, compara instante.
  ⚠️ **A regra mora em `lib/`, pura e testada**, e não dentro do `Board.tsx`.
- O seletor de hora na cápsula "Datas" da fatia A, **opcional e limpável**:
  tirar a hora tem de devolver a tarefa ao comportamento de "vence no dia".
- `lib/status.ts` — a decisão 4 do `spec.md` ("Atrasada 2 dias" vira "há 5
  horas"?). ⚠️ **Só afeta tarefa com hora.**

### Guardiões

| sabotagem | esperado |
|---|---|
| a regra some para tarefa SEM hora | teste de `lib/`: prazo ontem, sem hora ⇒ atrasada (o caminho antigo, intacto) |
| `new Date(due_date)` no lugar da comparação certa | teste com fuso negativo: prazo 19/08 23:00 não pode virar 20/08 |
| tarefa COM hora usa a comparação de string | ⚠️ **o teste central:** prazo hoje 09:00, agora 18:00 ⇒ **atrasada**. Com `string < string` isto passa despercebido |
| limpar a hora não volta ao comportamento de dia | teste: `due_time = null` ⇒ só atrasa depois que o dia acaba |
| `due_time` vira `NOT NULL` ou ganha default | teste de migration: coluna nova nasce nula nas 1085 linhas |
| tarefa sem prazo entra no filtro | continua aparecendo em todos (decisão da Camila, já valendo) |

⚠️ **ORDENAR POR PRAZO PRECISA DE `NULLS LAST`.** Duas colunas lidas juntas:
`ORDER BY due_date, due_time NULLS LAST`. É o preço do desenho, e é barato.

### O que sobe no front

- ⚠️ **A comparação de atraso deixa de ser `string < string`.** Hoje é
  `t.due_date < hoje` com `hojeISO()` (`Board.tsx:82,1315`), e o comentário do
  `hojeISO` **proíbe** `new Date(due_date)` por escorregar um dia. A fatia tem de
  resolver as duas coisas de uma vez: comparar instantes, e não escorregar fuso.
  **Isto mora em `lib/`, puro e testado** — não dentro do `Board.tsx`.
- O seletor de hora na cápsula "Datas" da fatia A.
- `lib/status.ts` — as duas funções que **zeram a hora de propósito** para contar
  dias (`:183-185` e `:215-217`). "Atrasada 2 dias" continua sendo em dias, ou
  passa a ser "atrasada há 5 horas"? **Decisão de produto, e ela não está na
  lista das três.**

### Guardiões

| sabotagem | esperado |
|---|---|
| a comparação continua sendo `string < string` | teste de `lib/`: prazo hoje às 09:00, agora 18:00 ⇒ **atrasada** (é o caso que falha em silêncio hoje) |
| `new Date(due_date)` no lugar da comparação certa | teste com fuso negativo: prazo 19/08 23:00 não pode virar 20/08 |
| o backfill escreve `00:00` | teste de migration: linha com `date` 19/08 vira 19/08 **23:59** |
| os dedup ficam `date` | ⚠️ **teste que roda o job DUAS vezes** e afirma que a segunda não notifica. Sem ele, este defeito chega em produção como 26 pessoas recebendo aviso repetido |
| tarefa sem prazo entra no filtro | continua aparecendo em todos (decisão da Camila, já valendo) |

⚠️ **O TESTE DO DEDUP É O MAIS IMPORTANTE DA FATIA**, e é o menos óbvio: ele não
testa a tela nem o tipo, testa **o job rodando duas vezes**.

---

## Fatias que NÃO são desta spec

| pedido | onde vai |
|---|---|
| reações em comentário (joia, coração) | spec própria. Tabela `comment_reaction` com `UNIQUE (comment_id, user_id, emoji)`. ⚠️ **FK composta carregando `workspace_id`**, como faz o `Comment` — tabela nova que não siga isso fura o isolamento entre workspaces |
| paginação do quadro | Spec 039 (redesenho), junto com o teto de carregamento |
| contagem de subtarefa agregada no backend | o conserto real do teto — achado da Camila em 18/08. Modelo: `assignee_ids_for_tasks` (ADR 0025), uma query em lote para a página inteira |
