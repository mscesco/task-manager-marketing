# 0033 — A coluna é derivada do status até o front ler colunas

## Status

Accepted — **inverte a D3 da Spec 035** e adia (não cancela) a decisão
correspondente da **0030**. Sucede a 0032 na mesma linha de correções da 035.

## Contexto

A Spec 035 (D3) e a ADR 0030 decidiram que `task.status` passaria a ser
**derivado** da coluna: mover a tarefa é a operação, o status é consequência.
A tabela de derivação tem quatro linhas, uma por semântica:
`OPEN→BACKLOG`, `IN_PROGRESS→IN_PROGRESS`, `DONE→COMPLETED`,
`CANCELLED→CANCELLED`.

O enum tem **oito** valores, e o quadro migrado pela `0008` tem oito colunas.
A correspondência não é um para um:

| semântica | colunas que a compartilham |
|---|---|
| `OPEN` | Backlog, **Planejado** |
| `IN_PROGRESS` | Em Andamento, **Aprovação Interna**, **Aprovação Externa**, **Bloqueado** |
| `DONE` | Concluído |
| `CANCELLED` | Cancelado |

Derivar `status` da semântica gravaria `IN_PROGRESS` para quatro colunas
distintas. **`PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` deixariam
de ser alcançáveis.**

E há a consequência visível: `Board.tsx` monta as colunas a partir da lista de
`STATUSES` de `web/lib/status.ts`. Enquanto for assim, colapsar o status
colapsa as colunas **na tela**. Toda tarefa em Aprovação Interna, Aprovação
Externa ou Bloqueado apareceria dentro de "Em Andamento" no dia do deploy — na
entrega cujo critério 10 é *"o front não muda"* e cuja D10 é *"nada de tela"*.

O mesmo furo atinge o critério 8: um PATCH com `status=IN_REVIEW` resolveria
para a coluna de destino da semântica `IN_PROGRESS` e devolveria
`IN_PROGRESS`. O cliente manda uma coisa e recebe outra.

Decisão de produto tomada em 06/08, quando o furo foi apresentado: **as oito
colunas devem continuar existindo; o colapso do status é aceito, mas só depois
que a tela parar de depender dele.**

## Decisão

**A derivação roda de `status` para `column_id`, e não o contrário, até que o
front leia as colunas do quadro.**

| direção | relação | perde? |
|---|---|---|
| `status` → coluna | 1:1 | não |
| coluna → `status` | 8:4 | **sim** |

A ordem obrigatória, e a razão de cada passo:

1. **Fatia 3 da Spec 035** — o serviço grava `column_id` a partir do `status`.
   `status` continua sendo a fonte da verdade. Nada muda na tela.
2. **Spec do front** — o quadro passa a montar as colunas a partir do banco.
   As oito continuam lá, agora vindas de `board_column`. São 104 referências
   em 16 arquivos, quase todas no `Board` (1218 linhas) e no `TaskDetail`
   (2186, sem teste de componente).
3. **Só então** `status` vira derivado da coluna e colapsa para quatro. Não
   muda nada na tela porque a tela já não o lê.

**Pular o passo 2 é o que apaga os quatro status.** A D3 original não está
errada — está cedo.

### `legacy_status` na coluna, e ela tem data de demolição

`board_column.legacy_status` guarda de qual status a coluna veio. Preenchida
pela migration para as oito migradas, **NULL para qualquer coluna criada por
gente**, que a partir do passo 2 não precisa de status correspondente.

Rejeitada a alternativa **casar por nome**: zero schema, e quebra no dia em
que alguém renomear uma coluna — gravando a coluna errada, sem erro, sem tela.
É a mesma família de defeito que esta spec inteira existe para evitar.

A ponte morre no passo 3, e o ADR que fizer o passo 3 deve dropar a coluna.

### `BLOCKED` continua `IN_PROGRESS`

Levantado na mesma conversa: bloqueado é "em espera", não exatamente "em
andamento". Fica como está, e por três razões:

1. **Não muda comportamento nenhum hoje.** A semântica governa quatro coisas
   — onde a tarefa nova nasce, para onde a cascata de conclusão manda, o que
   conta como concluída na proporção da checklist, e quando o relógio de
   arquivamento começa. `BLOCKED` não é destino de nenhuma.
2. **Onde vai importar é contagem**, e aí `IN_PROGRESS` é a resposta certa:
   tarefa bloqueada é trabalho começado e não terminado. Tirá-la da conta faz
   o número parecer melhor do que a realidade.
3. **O "em espera" já está capturado por outro canal:** a coluna tem
   `notify_deadline = false`. O sistema não cobra prazo dela porque não há o
   que cobrar enquanto está travada. Essa é a diferença real entre bloqueado e
   em andamento, e ela já existe — foi por isso que a 0030 rejeitou uma quinta
   semântica `BLOQUEADA` em favor da flag.

**Gatilho para reabrir**, concreto: alguém pedir um relatório de "em
andamento" e reclamar que as bloqueadas estão dentro. Aí é campo novo na
coluna, não semântica nova.

## Consequências

- A fatia 3 fica **maior** do que o handoff previa: além de gravar a coluna e
  travar `NOT NULL`, precisa da migration que cria e preenche `legacy_status`.
- Passa a existir uma coluna de banco com prazo de validade. Dívida assumida
  em voz alta, com o ADR do passo 3 responsável por quitá-la.
- `task.status` continua sendo escrito pelo cliente até o passo 3 — ou seja, a
  parte "um ponto de escrita só" da D3 original ainda não vale. Vale a metade
  dela: a derivação `status → coluna` mora num lugar do serviço, não espalhada
  por rota.
- O passo 2 (front) deixa de ser "o resto do trabalho" e vira **pré-requisito
  de correção**, não só de acabamento. Isso muda a prioridade dele.

## Como medir

Depois da fatia 3, em produção:

```sql
-- toda tarefa num quadro e numa coluna
SELECT count(*) FROM task WHERE board_id IS NULL OR column_id IS NULL;  -- 0

-- e na coluna CERTA: o status da tarefa bate com o da coluna
SELECT count(*) FROM task t
JOIN board_column c ON c.id = t.column_id
WHERE c.legacy_status IS DISTINCT FROM t.status;                        -- 0
```

A segunda é a que importa: ela é a prova de que nenhum dos oito status foi
colapsado no caminho. Vale rodar de novo depois do passo 2, antes do passo 3 —
é o último instante em que ela ainda faz sentido.
