# Plan 013 — Auto-arquivamento de tarefas terminais

Entrega multi-fatia (backend + front + n8n). Cada fatia é testável sozinha.

## Fatia 1 — Núcleo da varredura (backend, SEM endpoint)
Objetivo: dado um workspace ativo (tenant_scope) e um relógio, encontrar as
tarefas elegíveis e arquivá-las, gravando histórico atribuído a um ator.

Arquivos:
- `app/core/config.py` — `stale_archive_days: int = 20`.
- `app/modules/tasks/domain/archival.py` (NOVO) — `is_stale_terminal(...)`,
  predicado PURO (sem DB), espelha a regra SQL. Unit-testável.
- `app/modules/tasks/domain/history.py` — `build_archived_entry` ganha
  `automated`/`reason` opcionais (backward-compatible: chamada sem args
  permanece idêntica).
- `app/modules/tasks/infrastructure/task_repository.py` — `list_stale_terminal(
  now, days)`: query sobre `_base_select` (tenant + soft-delete já filtrados)
  + `is_archived=false` + a regra de elegibilidade.
- `app/modules/tasks/application/task_service.py` — `archive_stale(now,
  actor_user_id, days=None)`: lista elegíveis, marca `is_archived`, grava
  histórico `automated`, retorna a contagem. `now`/`actor` injetados (testável).

Testes:
- `tests/test_archival.py` (unit, roda em qualquer lugar): predicado —
  COMPLETED por `completed_at`, CANCELLED por `updated_at`, não-terminal nunca,
  borda exata do cutoff, COMPLETED sem `completed_at` não elegível.
- `tests/integration/test_archival_db.py` (Postgres): a varredura arquiva só
  os elegíveis, grava 1 linha ARCHIVED `automated` por task, é idempotente
  (2ª rodada arquiva 0), e respeita o escopo de tenant.

## Fatia 2 — Endpoint trancado + iteração de workspaces
- Dependency `require_system_token` (header `X-System-Token` vs `SYSTEM_API_TOKEN`).
- `app/modules/tasks/api/system_router.py` (NOVO) — `POST /system/tasks/
  archive-stale`. Itera workspaces, resolve admin de cada, `tenant_scope`,
  chama `archive_stale`, commita por workspace, agrega contagem.
- Resolver admin do workspace (papel ADMIN, pick determinístico).
- Testes integração: token ausente/errado → 401/403; token certo → arquiva e
  retorna contagem; idempotência.

## Fatia 3 — Filtro `archived_only` na listagem
- `TaskFilters` + repo + router ganham `archived_only: bool`.
- Teste: lista só arquivadas quando ligado.

## Fatia 4 — Tela de arquivadas (front)
- `lib/api.ts`: `listArchivedTasks` (usa `archived_only`), `reactivateTask`
  (unarchive + PATCH status=BACKLOG, ou endpoint dedicado se preferível).
- Página nova `/arquivadas` + link no AppShell.
- Typecheck isolado antes da entrega.

## Fatia 5 — Workflow n8n
- Schedule diário → HTTP Request no endpoint com header `X-System-Token`.
- Usa a skill de n8n. Config, não código do repo.

## Ordem e dependências
1 → 2 → (3, 4 em paralelo) → 5. A Fatia 5 só faz sentido com 1+2 no ar.
