# 0025 — Listagem de tasks traz assignees em lote

## Status

Accepted (supera a "decisão 9" da spec 004 quanto à listagem)

## Contexto

A Entrega 10 mostra o **responsável no card do quadro** (bolinha de iniciais).
Para isso, o front precisa dos `assignee_ids` de **cada** task da página.

O `GET /tasks` (listagem) foi deliberadamente deixado **sem** colaboradores na
Entrega 4 ("decisão 9": manter a query enxuta e evitar N+1). Só o detalhe
(`GET /tasks/{id}`) trazia `assignee_ids`/`watcher_ids`. Mas o front evita o
detalhe por causa do bug E6 (ADR 0002 do web) e, mesmo sem isso, buscar 1 por
card seria N+1 — inviável num quadro.

## Decisão

A listagem passa a trazer `assignee_ids` por item, carregados em **lote**:
após paginar as tasks, uma única query
(`task_assignment WHERE task_id IN (...)`) agrupa os responsáveis por task. A
página inteira custa **+1 query**, independente da quantidade de cards — sem
N+1. O motivo original da decisão 9 (query enxuta) fica honrado: não há join
que infle linhas nem busca por card.

Detalhes do contrato:

- Novo schema `TaskListItem(TaskResponse)` com `assignee_ids: list[uuid] = []`.
  A `TaskListResponse.items` passa a ser `list[TaskListItem]`.
- **`watcher_ids` continua FORA da listagem** — só o detalhe os traz. O quadro
  não mostra observadores; trazê-los seria peso sem uso.
- As respostas de **mutação** (`POST`/`PATCH`/`/move`/`/archive`) seguem
  devolvendo `TaskResponse` puro, **sem** `assignee_ids`. Isso é proposital:
  evita que uma mutação devolva `assignee_ids=[]` e o front zere o selo ao
  mover/editar. No front, `assignee_ids` é opcional e **preservado no merge**.

## Consequências

- O selo do card tem fonte de dados sem N+1.
- Custo da listagem: 1 query extra fixa por página (aceitável; medida contra a
  alternativa de 1 query por card).
- A "decisão 9" continua valendo para `watcher_ids` e para as mutações; só a
  listagem de assignees foi revertida.
- Front: o estado local NÃO pode sobrescrever `assignee_ids` com `undefined` ao
  aplicar o retorno de uma mutação (regra de merge documentada no quadro).

## Alternativas descartadas

- **1 fetch de assignees por card (N+1).** Funciona no dev com poucas tasks,
  degrada linearmente. Rejeitada.
- **Join de task_assignment na query da listagem.** Infla linhas (uma por
  responsável) e complica count/paginação. O lote em query separada é mais
  simples e previsível.
- **Selo só no detalhe (sem mudar a listagem).** Não atende o objetivo de ver
  o responsável de relance no quadro (decisão de produto da Camila).
