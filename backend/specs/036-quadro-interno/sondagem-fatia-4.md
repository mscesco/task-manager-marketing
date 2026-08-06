# Sondagem da fatia 4 — medição, não plano

> Medido no repositório em 06/08/2026, no estado do `main`. Nenhuma linha de
> código foi escrita. Este arquivo existe para substituir o chute
> *"fatia 4 = sessão própria"* por um número.
>
> Destino sugerido: `backend/specs/036-quadro-interno/sondagem-fatia-4.md`

---

## 1. Os 8 arquivos não são 8

`grep -rln "@/lib/status"` devolve 8 arquivos de produção. **Três deles não
têm nada a ver com quadro:**

| arquivo | o que importa | custo da fatia 4 |
|---|---|---|
| `lib/exclusao.ts` | só `plural` | mover `plural` para outro módulo — 1 linha |
| `app/projetos/[id]/page.tsx` | só `PRIORITY_LABEL` | zero |
| `components/TaskCard.tsx` | `deadlineTone`, `diasParado`, `paradaLabel`, cores | zero **direto** — mas ver §4 |

`lib/exclusao.ts` importando `plural` de `@/lib/status` é a evidência de que
esse módulo já virou gaveta: uma função de pluralização de contador mora no
arquivo de status porque foi ali que ela nasceu.

**Cinco arquivos usam `STATUSES`**, e é neles que a fatia mora:

| arquivo | linhas | usos de `STATUSES` | teste de componente |
|---|---|---|---|
| `app/minhas-tarefas/page.tsx` | 1195 | 7 | **nenhum** |
| `components/TaskDetail.tsx` | 2186 | 2 | **nenhum** |
| `components/Board.tsx` | 1218 | 3 | sim (`Board.test.tsx`) |
| `components/TaskModal.tsx` | 1045 | 1 | parcial (`TaskModalDuplicar.test.tsx`) |
| `app/arquivadas/page.tsx` | 404 | 2 | parcial (`ArquivadasPai.test.tsx`) |

---

## 2. O trabalho não é "trocar import". É tirar código do escopo de módulo.

Três arquivos derivam constantes **no topo do arquivo**, fora de qualquer
componente. Elas são calculadas no `import`, antes do primeiro render:

| arquivo | linha | constante |
|---|---|---|
| `app/minhas-tarefas/page.tsx` | 55 | `STATUS_LABEL` |
| `app/minhas-tarefas/page.tsx` | 58 | `STATUS_COLOR` |
| `app/minhas-tarefas/page.tsx` | 75 | `TODOS_STATUS` |
| `components/TaskDetail.tsx` | 65 | `STATUS_LABEL` |
| `app/arquivadas/page.tsx` | 42 | `STATUS_LABEL` |

Não existe `await` em escopo de módulo. Cada uma dessas cinco vira `useMemo`
**dentro** do componente, e **todo call-site** de `STATUS_LABEL[x]` /
`STATUS_COLOR[x]` passa a exigir estar dentro da função do componente.

⚠️ **Isso é movimentação de código, não substituição de linha.** Em arquivos
de 1195 e 2186 linhas sem teste de componente, é onde o custo real está.

---

## 3. `STATUSES` também é usado como TIPO

```
components/Board.tsx:1101        status: (typeof STATUSES)[number];
app/minhas-tarefas/page.tsx:1110 status: (typeof STATUSES)[number];
```

Com `STATUSES` virando dado de runtime, essa derivação morre. Precisa de uma
`interface Coluna` explícita, declarada num lugar só, e os dois arquivos mudam
juntos. O `tsc` pega — mas pega os dois de uma vez, então não dá para fatiar
por arquivo.

---

## 4. ⚠️ O achado que muda o roteiro: três taxonomias de status cravadas em
## funções que parecem puras

`lib/status.ts` tem três conjuntos de status escritos à mão, e os três são
**semântica de coluna**, não rótulo:

| onde | conjunto | função que usa |
|---|---|---|
| `STATUS_OCULTOS_POR_PADRAO` | `{COMPLETED}` | `statusPadraoMinhasTarefas()` |
| `STATUS_QUE_PARAM` | `{IN_PROGRESS, IN_REVIEW, EXTERNAL_APPROVAL}` | `diasParado()` |
| corpo de `deadlineTone()` | `COMPLETED \|\| CANCELLED \|\| BLOCKED` | `deadlineTone()` |

**Isso é exatamente `column.semantic` e `column.notify_deadline`** — os campos
que o backend criou na Spec 035 e que o §10 do handoff lista como *"continuam
sem leitor"*. O leitor deles é aqui.

O que quebra no dia do primeiro quadro interno:

- coluna criada por gente tem `legacy_status` **NULL** (ADR 0033/0036). As três
  funções recebem um `status` que não está em nenhum dos conjuntos;
- uma tarefa numa coluna *"Aguardando cliente"* vai **alertar prazo**, porque
  `deadlineTone` só silencia `COMPLETED/CANCELLED/BLOCKED`. `notify_deadline`
  foi criado no backend justamente para desligar essa cobrança —
  `DeadlineNotifyService` já respeita, e o front não;
- `diasParado` não marca nada, porque nenhum status novo está em
  `STATUS_QUE_PARAM`. O selo some em silêncio;
- `statusPadraoMinhasTarefas()` não sabe o que esconder ao abrir.

⚠️ **E as três passam nos testes.** `lib/__tests__/status.test.ts` tem 296
linhas cobrindo `deadlineTone`, `diasParado`, `statusPadraoMinhasTarefas` e os
tokens — todas contra a lista fixa de 8 status. É teste correto para o mundo de
hoje e cego para o de amanhã.

⚠️ **A divisão proposta no `plan.md` põe essas três do lado errado.** O plano
diz que `@/lib/status` parte em *"puro e síncrono"* e *"vindo da API"*.
`deadlineTone` e `diasParado` **parecem** puras — recebem string, devolvem
valor, sem I/O — e dependem da taxonomia. Elas vão para o lado "puro" por
inércia e levam o defeito junto.

### Consequência direta: a fatia 3 está subespecificada

A fatia 3 promete `board_id`, `column_id` e o nome do quadro na resposta de
tarefa. **Falta `semantic` e `notify_deadline` da coluna da tarefa** — sem
eles, as três funções acima não têm como funcionar com coluna criada por gente,
e a fatia 4 não é construível de novo, pelo mesmo motivo que o achado (c) da
sessão de 06/08 já tinha detectado uma vez.

---

## 5. O ponto mais duro, em uma linha

`app/minhas-tarefas/page.tsx:117`

```
() => new Set(statusPadraoMinhasTarefas())
```

Inicializador de `useState`. Roda no **primeiro render**, antes de qualquer
`fetch`. O filtro padrão da tela depende da lista de colunas, que passa a
chegar depois. Não há solução barata: ou a tela nasce sem filtro e aplica
quando o dado chega (e a lista pisca), ou ela não renderiza até chegar (e a
tela mais usada do produto ganha um estado de carregando que não tinha).

**Essa é uma decisão de produto, não de código.** Precisa de resposta antes de
alguém abrir o arquivo.

---

## 6. Veredito

**Três sessões, não uma.** E a primeira delas não é front.

| sessão | o quê | por que separada |
|---|---|---|
| **4a** | ADR da semântica no front + `semantic`/`notify_deadline` na resposta da fatia 3 + partir `lib/status.ts` | é decisão + contrato de API. Não é a mesma coisa que mexer em tela. |
| **4b** | teste de componente de `minhas-tarefas` + converter o arquivo | 1195 linhas, zero teste, 7 usos, e o `useState` do §5 |
| **4c** | `Board.tsx`, `TaskDetail.tsx`, `arquivadas`, `TaskModal` | os quatro dependem da 4a estar pronta |

**O que isso faz com o roteiro:** a Spec 036 passa de 5 fatias para 7, e a
fatia 5 (o quadro interno, já orçada em ~2 sessões) fica a 5 sessões de
distância, não 2.

---

## 7. O que esta sondagem NÃO mediu

- **Nada foi executado.** É leitura de arquivo e contagem. Nenhum `tsc`,
  nenhum `npm test`, nenhum navegador.
- **Não olhei `lib/api.ts`** — quem vai buscar as colunas, com que cache, e se
  já existe um padrão de fetch compartilhado nesse projeto. É o primeiro
  arquivo a abrir na sessão 4a.
- **Não olhei o CSS.** Os tokens `--status-*-dot` / `--status-*-text` estão
  declarados em `app/globals.css` por NOME de status. Coluna criada por gente
  não tem token. Isso é um quarto problema e não está contado acima.
- **Não medi o custo da carona** (tokens de cor do status de PROJETO em
  `projetos/page.tsx` e `projetos/[id]/page.tsx`).
