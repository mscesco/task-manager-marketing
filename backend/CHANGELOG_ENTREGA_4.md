# Changelog — Entrega 4 (Assignment + Watchers)

> Backend `task_manager_backend`. Continua de cima da Entrega 3.
> **Sem migration de schema** (tabelas e índices já existem desde o
> baseline v5). Você só cria o `.env`; nada de `alembic upgrade` para
> esta entrega.

## Resumo

Tarefas agora têm **gente**: responsáveis (assignees, N:N) e observadores
(watchers). Seis endpoints novos, escopo de time reaproveitado da Entrega
3 (sem duplicar regra), e duas mudanças de leitura/permissão acordadas.

## Endpoints novos (sob `/api/v1/tasks/{task_id}`)

| Método | Rota | Quem | Resultado |
|--------|------|------|-----------|
| GET | `/assignees` | quem vê a task | 200 lista de IDs |
| POST | `/assignees` | `task.assign` + edição | 201 novo / 200 no-op |
| DELETE | `/assignees/{user_id}` | `task.assign` + edição | 200 (404 se ausente) |
| GET | `/watchers` | quem vê a task | 200 lista de IDs |
| POST | `/watchers` | self: vê / terceiro: `task.assign`+edição | 201 / 200 |
| DELETE | `/watchers/{user_id}` | self: vê / terceiro: `task.assign`+edição | 200 (404 se ausente) |

`GET /tasks/{id}` passou a responder `TaskDetailResponse` (= `TaskResponse`
+ `assignee_ids` + `watcher_ids`, só UUIDs). `GET /tasks` (listagem) ficou
**intocado** — sem inline, sem N+1.

## Regras aplicadas (decisões fechadas)

- **Assignment reusa a trava de edição e NÃO concede edição** (ADR 0010):
  quem mexe em responsáveis precisa de `task.assign` + ver (404) + editar
  (403). Quem edita a task segue sendo função do **time** dela — assignee
  e criador não editam por isso.
- **Designado precisa alcançar a task** (lente dele) → 422 senão.
- **Watcher self-service** (ADR 0011): inscrever-se exige só ver; inscrever
  terceiro exige `task.assign` + edição.
- **`assigned`/`unassigned` na timeline; watcher fora** (ADR 0012).
- **Idempotente**: re-adicionar → 200 no-op (sem 2ª linha de history);
  remover inexistente → 404.
- **Pessoal é monouser**: só o dono; outro `user_id` → 409.
- **`OPERATOR` ganhou `task.assign`** — distribui no quadro geral e no seu
  subtime.
- **Criador sempre vê** (ADR 0013): `created_by == eu` enxerga a task que
  criou mesmo fora da lente de time (leitura), mas **continua sem editar**.

## Arquivos

### Novos
```
app/modules/tasks/application/task_guards.py            # gates de escopo reusáveis (puros + DB)
app/modules/tasks/application/collaboration_service.py  # CollaborationService
app/modules/tasks/infrastructure/collaboration_repository.py  # Assignment/Watcher repos
app/modules/tasks/api/collaboration_router.py           # 6 endpoints
tests/test_collaboration.py                             # 13 testes de lógica pura
specs/004-assignment-watchers/{spec,plan,edits}.md
docs/adr/0010..0013-*.md                                # marcados Accepted
```

### Editados
```
app/modules/auth/domain/permissions.py        # + task.assign no OPERATOR
app/modules/tasks/domain/history.py            # + ASSIGNED/UNASSIGNED + builders
app/modules/tasks/api/schemas.py               # + Assignee/Watcher + TaskDetailResponse
app/modules/tasks/infrastructure/task_repository.py  # + created_by no OR de visibilidade
app/modules/tasks/application/task_service.py  # gates delegam a task_guards (inclui ADR 0013)
app/modules/tasks/api/tasks_router.py          # GET /{id} -> TaskDetailResponse
app/api/router.py                              # include collaboration_router
```

## Decisões de implementação (as 3 confirmadas)

1. **Gate sem duplicação:** extraí `task_visible` / `task_editable`
   (puros) + `TaskScopeGuards` (DB) para `task_guards.py`. O `TaskService`
   agora delega seus dois gates a ele; o `CollaborationService` usa o
   mesmo. A regra de time vive num lugar só.
2. **Soft-delete não limpa colaboração:** as FKs `CASCADE` só disparam em
   DELETE físico; como a task é soft-deletada, `task_assignment`/
   `task_watcher` permanecem (revivendo a task, voltam). Mantido.
3. **DELETE responde 200** com a lista atual (não 204).

## Testes

`89 passed` na suite completa (76 da E3 + 13 novos de colaboração).
Os 13 novos são lógica pura: permissões, builders de history, e a matriz
`task_visible`/`task_editable` (pessoal próprio×alheio, criador-vê-mas-não-
edita, lente comum/avulsa, admin). Escrita real no Postgres (inserts,
history, idempotência, 404/409/422 ponta a ponta) valida no smoke `/docs`.

Comando (PowerShell, linha única):
```
docker compose run --rm api-dev pytest
```

## Smoke manual

Roteiro completo em `specs/004-assignment-watchers/plan.md` (seção "Smoke
manual via /docs"). Pontos-chave: no-op idempotente, 422 de assignee que
não alcança, 409 do pessoal monouser, operador designando no quadro geral,
e o criador vendo (mas não editando) a avulsa de subtime irmão.

## Próximo passo

Entrega 5 — candidatos já documentados como dívida/non-goal:
`/me/assignments` (+ índice `task_assignment(user_id)`), timeline de
leitura do `task_history`, notificações para watchers, e a consolidação
das duas triggers de imutabilidade duplicadas.
