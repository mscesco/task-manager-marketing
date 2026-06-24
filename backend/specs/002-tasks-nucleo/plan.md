# Plano — Entrega 2 (Tasks núcleo + history)

> Referência: `specs/002-tasks-nucleo/spec.md`
> ADRs: `0002`, `0003`, `0004`, `0005`

---

## Sequência de implementação

1. **Migration `0003_task_history_safety_net`** — defensiva, cria
   extensão LTREE, índice GIST em `task.path` e trigger de
   imutabilidade no `task_history`. Idempotente.
2. **Domínio do history** (`app/modules/tasks/domain/history.py`) —
   enum + funções construtoras puras.
3. **Repository** (`app/modules/tasks/infrastructure/task_repository.py`).
4. **Schemas** — `Task*` adicionados em `app/modules/tasks/api/schemas.py`.
5. **Service** (`app/modules/tasks/application/task_service.py`).
6. **Router** (`app/modules/tasks/api/tasks_router.py`).
7. **Plugar no agregador** — `app/api/router.py`.
8. **Testes** (`tests/test_tasks.py`).

## Arquivos novos

```
alembic/versions/0003_task_history_safety_net.py
app/modules/tasks/domain/history.py
app/modules/tasks/application/task_service.py
app/modules/tasks/infrastructure/task_repository.py
app/modules/tasks/api/tasks_router.py
specs/002-tasks-nucleo/spec.md
specs/002-tasks-nucleo/plan.md
docs/adr/0002-ltree-label-format.md
docs/adr/0003-move-task-base-select-exception.md
docs/adr/0004-task-history-granularity.md
docs/adr/0005-soft-delete-cascade.md
tests/test_tasks.py
```

## Arquivos editados

- `app/modules/tasks/api/schemas.py` — adicionar Task*.
- `app/api/router.py` — `include_router(tasks_router)`.
- `specs/001-projects/spec.md` — corrigir `400`→`422` (correção retroativa).

## Como verificar

```
docker compose run --rm api-dev alembic upgrade head
docker compose run --rm api-dev pytest
```

Smoke manual via `/docs` documentado no README do pacote.

## Definição de pronto

- Migration aplicada.
- 8 endpoints implementados.
- `task_history` escrito conforme ADR 0004.
- Cascata de soft-delete com `cascade_count`.
- Privacidade do pessoal em leitura e escrita.
- Testes puros passam.
- Sem regressão nos 36 testes anteriores.

## Riscos

- Trigger de imutabilidade pode já existir com outro nome — verificar.
- Cascade em subtree grande: monitorar em produção.
