# 0003 — Detalhe e navegação de subtarefa reusam a lista do quadro

## Status

**Accepted, EMENDADA em 20/08/2026 (Spec 042, B1).** A metade sobre os
**filhos** caiu; o resto continua valendo. Ver §Emenda no fim.

## Contexto

A Entrega 10 trouxe um painel de **detalhe** (estilo Trello) que abre ao
clicar no card, com uma **sublista de subtarefas** navegável: clicar numa
subtarefa troca o foco do painel pra ela (com "voltar"), e isso pode
descer vários níveis.

O caminho "natural" seria, a cada abertura/navegação, buscar o detalhe
(`GET /tasks/{id}`) e os filhos (`GET /tasks?parent_task_id=X`). Numa
navegação pai → filho → neto isso vira uma cascata de chamadas. Pior: o
`GET /tasks/{id}` esbarra no **bug E6** (tasks `out_of_scope` dão 404 no
detalhe) — o mesmo motivo que levou o ADR 0002 a evitar o endpoint na
edição.

O quadro já carrega **todas** as tasks planas via `GET /tasks` (o
`TaskResponse` traz `parent_task_id` e `depth`), e a listagem agora também
traz `assignee_ids` em lote (backend ADR 0025).

## Decisão

**O painel de detalhe não busca nada por conta própria.** A tarefa focada
e os filhos diretos saem da lista que o quadro já tem em memória,
filtrados client-side por `id` e `parent_task_id`. A pilha de navegação
("voltar") e a fonte de tarefas moram **no quadro**; o `TaskDetail` só
renderiza a tarefa focada que recebe por prop.

As mutações continuam sendo as chamadas que já existem: `PATCH /tasks/{id}`
(editar, concluir-rápido), `POST /tasks` com `parent_task_id` (criar
subtarefa), `POST`/`DELETE .../assignees` (responsáveis). A resposta de
cada mutação faz **upsert in-place** no estado do quadro.

## Consequências

**Positivas:** zero `GET /tasks/{id}` e zero `GET` de filhos — navegação
instantânea, sem cascata; passa longe do bug E6 sem depender de correção;
um único estado (a lista do quadro) é a fonte da verdade pra card, selo,
sublista e badge ao mesmo tempo.

**Negativas:** o detalhe mostra o snapshot do momento do `GET /tasks` —
se outra pessoa mexeu na mesma task no meio tempo, pode estar levemente
stale (mesmo trade-off do ADR 0002, aceitável no tráfego atual). O upsert
das mutações precisa **preservar `assignee_ids`** ao substituir uma task,
porque o `PATCH`/`updateTask` não retorna esse campo (ADR 0025) — sem isso,
concluir-rápido zerava os responsáveis da subtarefa. Está tratado no
`aoUpsert` do quadro.

**Como medir:** abrir um card, navegar pai → filho → neto e voltar **não**
deve gerar nenhum `GET` na aba de Rede — só as mutações quando você
realmente muda algo.

## Alternativas consideradas

- **Buscar detalhe + filhos a cada navegação.** Mais "fresco", mas
  cascata de chamadas e exposto ao E6. Rejeitada.
- **Empilhar um modal por nível** (em vez de trocar o foco de um painel
  só). Estado duplicado e várias camadas de overlay. Rejeitada em favor de
  um painel único com pilha de navegação no quadro.

## Relacionados

- Estende o **0002** (edição reusa o objeto da lista) para o detalhe e a
  navegação de subtarefa.
- Depende do backend **0025** (listagem traz `assignee_ids` em lote).

---

## Emenda — 20/08/2026 (Spec 042, B1)

⚠️ **O painel PASSOU a buscar os filhos.** `TaskDetail` chama
`listarFilhas(task.id)` (que é `GET /tasks?parent_task_id=X`) num `useEffect`
por tarefa focada. A frase "o painel de detalhe não busca nada por conta
própria" **deixou de valer para os filhos**.

### O que expirou, e não foi o raciocínio — foi a premissa

A decisão original se apoiava numa frase do §Contexto: *"o quadro já carrega
**todas** as tasks planas"*. **É exatamente essa premissa que a Spec 042
remove.** Medido em 19/08/2026: o quadro baixava **917 tarefas — 670 delas
subtarefa — para desenhar 170 cards**, contra um teto de 1000. Enquanto o
painel dependesse da lista do quadro, o quadro não podia parar de carregar a
subárvore.

⚠️ E a decisão original **já não descrevia o código** quando foi emendada:
três dos quatro chamadores (`/tarefa/[id]`, `/arquivadas`, `/minhas-tarefas`)
buscavam os próprios filhos desde 05/08, cada um do seu jeito, porque a lista
que tinham em memória não bastava. Só o quadro seguia a ADR. A B1 não inventou
o padrão; ela o unificou dentro do componente.

### O que CONTINUA valendo

- **A tarefa focada** ainda sai da lista de quem chama (prop `task`), e a
  **pilha de navegação** ("voltar") continua morando fora do `TaskDetail`.
- **O upsert in-place** das mutações continua sendo o mecanismo, com a ressalva
  de sempre: preservar `assignee_ids`, que o `PATCH` não devolve (ADR 0025).
  A B1 acrescentou que o upsert tem de bater **também** na lista interna de
  filhos (`upsertFilhaLocal`) — senão marcar a caixinha não muda a tela.
- ⚠️ **A defesa contra o bug E6 continua de pé**, e por sorte de desenho: o que
  o painel chama é a **listagem** (`GET /tasks?parent_task_id=`), e não o
  `GET /tasks/{id}` que dá 404 em tarefa `out_of_scope`. A alternativa
  rejeitada em 2026 ("buscar detalhe + filhos") continua rejeitada na metade do
  *detalhe*.

### O "como medir" está desatualizado

A frase *"navegar pai → filho → neto não deve gerar nenhum GET"* **inverteu**:
agora gera **um `GET` por nível**, e é isso que se espera ver. O que continua
valendo como medida é a ausência de `GET /tasks/{id}`.

### Consequência nova, aceita

Cascata de chamadas na navegação profunda — exatamente o custo que a decisão de
2026 evitava. Aceito porque o outro lado da balança mudou de tamanho: era
"algumas chamadas a mais" contra "917 tarefas em toda carga do quadro".
