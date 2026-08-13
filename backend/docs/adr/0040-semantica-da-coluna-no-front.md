# 0040 — A semântica da coluna substitui a taxonomia de status no front

## Status

Accepted — 10/08/2026. Decisão da **fatia 4a** da Spec 036. Não supersede
nenhuma ADR: implementa no front o que a **0030**, a **0033** e a **0036** já
decidiram no backend.

## Contexto

`web/lib/status.ts` reimplementa à mão o significado das colunas, em três
conjuntos de status cravados:

| onde | conjunto | função |
|---|---|---|
| `STATUS_QUE_PARAM` | `{IN_PROGRESS, IN_REVIEW, EXTERNAL_APPROVAL}` | `diasParado()` |
| corpo de `deadlineTone()` | `COMPLETED \|\| CANCELLED \|\| BLOCKED` | `deadlineTone()` |
| `STATUS_OCULTOS_POR_PADRAO` | `{COMPLETED}` | `statusPadraoMinhasTarefas()` |

⚠️ **As três passam em 296 linhas de teste** (`lib/__tests__/status.test.ts`).
É teste correto para o mundo de hoje e cego para o de amanhã: ele afirma as
funções contra a lista fixa de 8 status.

**O que quebra no dia do primeiro quadro interno (fatia 5):** coluna criada por
gente nasce com `legacy_status` NULL (ADR 0033/0036) e um `status` que não está
em nenhum dos conjuntos. Consequências, todas silenciosas:

- uma tarefa em *"Aguardando cliente"* **alerta prazo**, porque `deadlineTone`
  só silencia três status literais. O backend já sabe que não deve cobrar
  (`notify_deadline`), e o front cobra assim mesmo;
- `diasParado` não marca nada: nenhum status novo está em `STATUS_QUE_PARAM`.
  O selo some sem erro;
- `statusPadraoMinhasTarefas()` não sabe o que esconder ao abrir a tela.

⚠️ **E `deadlineTone`/`diasParado` PARECEM PURAS** — recebem string, devolvem
valor, sem I/O. A divisão que o `plan.md` propõe (`lib/status.ts` parte em
"puro e síncrono" × "vindo da API") as jogaria para o lado "puro" por inércia,
levando o defeito junto. É por isso que esta ADR existe antes do código.

## O mapa medido (10/08/2026)

Lido de `backend/app/modules/tasks/domain/board_defaults.py`, as 8 colunas que
todo quadro recebe ao nascer:

| `legacy_status` | `semantic` | `notify_deadline` |
|---|---|---|
| BACKLOG | OPEN | `true` |
| PLANNED | OPEN | `true` |
| IN_PROGRESS | IN_PROGRESS | `true` |
| IN_REVIEW | IN_PROGRESS | `true` |
| EXTERNAL_APPROVAL | IN_PROGRESS | `true` |
| COMPLETED | DONE | `true` |
| CANCELLED | CANCELLED | `true` |
| **BLOCKED** | **IN_PROGRESS** | **`false`** |

`ColumnSemantic` tem quatro valores: `OPEN`, `IN_PROGRESS`, `DONE`,
`CANCELLED`. Terminais são `DONE` e `CANCELLED` (`TERMINAL_SEMANTICS`).

## Decisão

**1. As funções passam a receber a COLUNA, não o status.**

```
deadlineTone(coluna, dueDate, isArchived)
diasParado(coluna, updatedAt, isArchived)
```

Some `STATUS_QUE_PARAM`. Some o `COMPLETED || CANCELLED || BLOCKED` cravado.

**2. `deadlineTone` usa o predicado que o backend já tem, e a paridade é
EXATA.**

    avisaPrazo(coluna) = terminal(coluna) ? false : coluna.notify_deadline

É a tradução literal de `board_semantics.avisa_prazo`. Confira contra o mapa
acima: COMPLETED → DONE (terminal) → silencia. CANCELLED → CANCELLED
(terminal) → silencia. BLOCKED → `IN_PROGRESS` mas `notify_deadline = false` →
silencia. **Os três status que o código de hoje lista à mão, e só eles.**

**3. ⚠️ `diasParado` NÃO traduz por `semantic` sozinho, e este é o ponto
delicado desta ADR.**

A tradução óbvia — `semantic === "IN_PROGRESS"` — **mudaria o comportamento**:
o BLOCKED tem semântica `IN_PROGRESS` e passaria a ganhar o selo "parada há X
dias". A D6 da Spec 031 o excluiu de propósito: *"bloqueio é estado declarado,
alguém já sabe"*.

A regra que preserva o comportamento é:

    parar_e_noticia(coluna) = coluna.semantic === "IN_PROGRESS"
                              && avisaPrazo(coluna)

⚠️ **ISSO FUNDE DOIS CONCEITOS QUE NASCERAM SEPARADOS**, e a fusão é a
decisão — não um detalhe de implementação. `notify_deadline` significa "esta
coluna cobra prazo"; aqui ele passa a significar também "parar aqui é
notícia".

**Por que aceitamos a fusão:** as duas perguntas são a mesma vista de dois
ângulos — *"a tarefa deveria estar avançando nesta coluna?"*. Uma coluna onde
não se cobra prazo é uma coluna onde ficar parado não é abandono. Quem criar
*"Aguardando cliente"* com `notify_deadline = false` não quer nem alerta de
prazo nem selo de parada, e vai receber os dois comportamentos certos de uma
decisão só.

**Por que NÃO criamos um campo novo** (`is_stall_tracked` ou parecido): seria
uma terceira caixa no formulário de criar coluna para uma distinção que
ninguém pediu, e cujo único caso hoje (o BLOCKED) já é resolvido pela flag
existente. **Se algum dia alguém quiser cobrar prazo sem rastrear parada, o
campo se cria então, com o caso na mão.**

**4. A cor sai da coluna, e o front aceita DOIS formatos.**

`BoardColumn.color` já existe (`String(60)`) e já viaja no `GET /boards`. O
front para de olhar o nome do status para escolher token.

⚠️ **O campo não guarda uma cor hoje — guarda `"var(--status-backlog-dot)"`.**
Coluna criada por gente vai guardar hex (`"#7C3AED"`), decidido em 10/08. O
front trata os dois: começa com `var(` → usa direto; começa com `#` → é hex.

**Não migramos as 8 padrão para hex.** Elas funcionam bem hoje *porque* o
token inverte com o tema — trocar seria piorar o que todo mundo usa para
servir o que ainda não existe.

**5. `statusPadraoMinhasTarefas()` esconde por SEMÂNTICA TERMINAL.**

Hoje esconde `{COMPLETED}` por nome. Passa a esconder as colunas com
`semantic === "DONE"`.

⚠️ **Isso muda o comportamento, de propósito, e é a única mudança visível
desta fatia:** a coluna Cancelado (`semantic = CANCELLED`, também terminal)
**continua aparecendo**, porque é o que acontece hoje. Esconder as duas seria
uma decisão de produto que ninguém tomou. Se quiser mudar, é outra ADR.

## Consequências

- **Todo call-site precisa ter a coluna em mãos**, e hoje eles têm só a string
  de status. Toca `TaskCard`, `TaskDetail`, `minhas-tarefas` e `Board` — é o
  que faz a 4a valer uma sessão inteira em vez de ser troca de import.
- ⚠️ **As 296 linhas de `status.test.ts` são REESCRITAS, não ajustadas.** Elas
  afirmam as funções contra a lista fixa de 8 status. A reescrita é onde
  aparece se a tradução ficou certa — e o teste novo tem de conter **a tabela
  de paridade acima**, caso a caso, senão ninguém consegue provar que o
  comportamento não mudou.
- **`plural` sai de `lib/status.ts`.** A sondagem mediu que `lib/exclusao.ts` o
  importa de lá só por ele ter nascido ali — evidência de que o módulo virou
  gaveta. Uma linha.
- ⚠️ **`STATUSES` deixa de ser `const` síncrona e morre como TIPO.**
  `Board.tsx:1101` e `minhas-tarefas/page.tsx:1110` usam
  `(typeof STATUSES)[number]`. Precisa de uma `interface Coluna` explícita,
  declarada num lugar só. **O `tsc` pega os dois de uma vez, então não dá para
  fatiar por arquivo** — os dois mudam na mesma entrega (fatia 4c).
- **A tela não renderiza até as colunas chegarem** (decidido em 10/08). O
  portão já existe: `minhas-tarefas/page.tsx:582`,
  `if (!items) return <div>Carregando…</div>`. A 4b acrescenta uma condição a
  esse `if` — **não é tela nova**, ao contrário do que a §5 da
  a §Fatia 4 do `plan.md` da Spec 036 afirma (era o `sondagem-fatia-4.md`,
  absorvido em 13/08).

## Como medir

Depois da 4c, com um quadro interno criado à mão em produção (ou na fatia 5):

1. coluna com `notify_deadline = false` → tarefa vencida nela **não** fica
   laranja nem vermelha, e **não** ganha selo de parada;
2. coluna com `semantic = DONE` criada por gente → some do padrão de
   `/minhas-tarefas`, e volta no "Todos";
3. coluna com cor hex → a bolinha usa o hex, e as 8 padrão continuam
   invertendo com o tema.

Nenhuma das três é coberta por portão. São conferência visual.

## Alternativas consideradas

**Manter `deadlineTone`/`diasParado` recebendo `status` e traduzir num mapa.**
Rejeitada: mais barata, e mantém a mentira viva. O mapa só tem entrada para os
8 status legados; coluna criada por gente cai no `default` e volta ao mesmo
defeito, agora escondido atrás de uma indireção.

**Um campo novo para "parar é notícia".** Adiada — ver §Decisão, item 3.

**Migrar as 8 colunas padrão para hex, unificando o formato de `color`.**
Rejeitada: perde a inversão de tema no que 100% das tarefas de produção usam
hoje (802 tarefas, um quadro), para simplificar um `if` de duas linhas.

**Esconder também `CANCELLED` no padrão de `/minhas-tarefas`.** Rejeitada
nesta fatia: é mudança de produto disfarçada de refatoração. Hoje a coluna
Cancelado aparece; se deve parar de aparecer, decide-se com o usuário, não
dentro de uma conversão de módulo.
