# Plan — Entrega 10 (Hierarquia + responsáveis no quadro)

Sequência seguida. Backend-first (a herança de time é o único risco de
regra; o resto é front sobre contrato estável). Cada passo é commit isolado.

## 0. Pré-flight

- Túnel SSH aberto; `db-test` de pé.
- Suíte verde **com a env** (provar o baseline, não confiar no número):
  ```
  docker compose up -d db-test
  docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest
  ```
- `git status` limpo.

## 1. Backend — herança de `team_id` do pai  *(único passo de backend)*

- `task_service.py`: no ramo com `parent`, quando não veio `team_id`
  explícito, `team_id = parent.team_id` **antes** do fallback por
  `default_team_id`. Ordem final: explícito → pai → default.
- Testes de integração: subtarefa sem `team_id` herda o do pai; com
  `team_id` divergente segue a validação de hoje.
- Migration: nenhuma. ADR `backend/docs/adr/0024`.
- Commit: `feat(tasks): subtarefa herda team_id do pai`.

## 2. Backend — `assignee_ids` em lote na listagem

- `collaboration_repository.list_user_ids_for_tasks` (1 query) +
  `collaboration_service.assignee_ids_for_tasks`.
- `schemas.TaskListItem(TaskResponse)` com `assignee_ids`; injetado no
  `tasks_router` só na **listagem**. Mutações seguem `TaskResponse` puro.
- Teste de integração do bulk. ADR `backend/docs/adr/0025`.
- Commit: `feat(tasks): listagem traz assignee_ids em lote`.

## 3. Front — superfície de cliente (`web/lib/api.ts`)

- Tipo `Member`; `listMembers()` memoizado (limpo em `clearTokens`).
- `listAssignees` / `addAssignee` / `removeAssignee` (retornam `user_ids`).
- `assignee_ids?: string[]` em `Task` (opcional — só a listagem traz).
- `createSubtask(parentId, title)` — sem `team_id` (herda do pai).
- Helpers `web/lib/people.ts`: `nomeCurto`, `iniciais`, `corAvatar`.

## 4. Front — display (`TaskCard` + quadro)

- Quadro filtra `depth === 0`; busca membros; conta filhos diretos.
- `TaskCard`: selo de responsáveis (2 + "+N") + badge de subtarefas.
- Merge-preserve de `assignee_ids` no drag e no salvar.

## 5. Front — detalhe (3 fatias)

- **Fatia 1:** casca do painel (leitura + Editar + fechar), reusa objeto da
  lista (ADR front 0003).
- **Fatia 2:** Responsáveis — dropdown "Designar" (bolinhas sempre visíveis),
  busca + checkbox, otimista/revert, avisa o quadro pro selo refletir.
- **Fatia 3:** Subtarefas — criar ("+ Subtarefa"), concluir-rápido na linha,
  navegar pra dentro (pilha de "voltar" no quadro). `aoUpsert` preserva
  `assignee_ids`.
- Commit: `feat(web): painel de detalhe com responsaveis e subtarefas`.

## 6. Fecho

- ADRs front `0003`, `0004`. Esta spec.
- Smoke dos casos chatos (ver `spec.md`).
