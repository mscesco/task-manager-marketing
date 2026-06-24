# 0003 — Detalhe e navegação de subtarefa reusam a lista do quadro

## Status

Accepted

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
