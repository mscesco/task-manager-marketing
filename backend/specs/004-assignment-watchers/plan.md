# Plano — Entrega 4 (Assignment + Watchers)

> Referência: `specs/004-assignment-watchers/spec.md`
> ADRs: `0010`, `0011`, `0012`, `0013`

---

## Pré-condição operacional

**Nenhuma migration.** As tabelas e índices (`UNIQUE(task_id, user_id)`)
já existem desde o baseline v5. Antes de rodar a suite, só
`docker compose run --rm api-dev pytest` — nada de `alembic upgrade`.

Dívida técnica conhecida que NÃO entra aqui (registrada à parte): as duas
triggers de imutabilidade duplicadas no `task_history`. Não toco nelas.

---

## Mapa de arquivos (novos × editados)

Todos os caminhos relativos à raiz `task_manager_backend/`.

### Arquivos novos

```
specs/004-assignment-watchers/spec.md
specs/004-assignment-watchers/plan.md
docs/adr/0010-assignment-escopo-edicao.md
docs/adr/0011-watcher-self-service.md
docs/adr/0012-history-assignment-granularidade.md
docs/adr/0013-criador-sempre-ve.md
app/modules/tasks/application/collaboration_service.py   # CollaborationService
app/modules/tasks/infrastructure/collaboration_repository.py  # 2 repos
app/modules/tasks/api/collaboration_router.py            # 6 endpoints
tests/test_collaboration.py                              # lógica pura
```

### Arquivos editados (mudança cirúrgica — descrita abaixo)

```
app/modules/tasks/domain/history.py        # + assigned/unassigned + builders
app/modules/tasks/api/schemas.py           # + Assignee/Watcher + TaskDetailResponse
app/modules/auth/domain/permissions.py     # + task.assign no OPERATOR
app/modules/tasks/infrastructure/task_repository.py  # + created_by no OR de visibilidade
app/modules/tasks/application/task_service.py        # + created_by no gate; get_with_collaborators
app/modules/tasks/api/tasks_router.py      # GET /{id} -> TaskDetailResponse
app/api/router.py                          # include collaboration_router
```

---

## Sequência de implementação

A entrega é uma fatia só (sem fases), mas com ordem para os testes puros
caírem cedo.

1. **`permissions.py`** — adicionar `"task.assign"` ao frozenset de
   `OPERATOR`. (decisão 6) Uma linha. Teste: `permissions_for_roles`
   inclui `task.assign` para OPERATOR.

2. **`history.py`** — dois `TaskHistoryEventType` novos
   (`ASSIGNED = "assigned"`, `UNASSIGNED = "unassigned"`) +
   `build_assigned_entry(user_id, assigned_by)` e
   `build_unassigned_entry(user_id)`. Reusa `_stringify`. (ADR 0012)
   Teste: builders produzem `event_type` + metadata corretos.

3. **Visibilidade `created_by` (ADR 0013)** — mexer nos DOIS lugares
   juntos:
   - `task_repository.list_page_with_filters`: adicionar
     `Task.created_by == tenant.user_id` como mais um ramo do `or_(...)`
     do bloco (B) da lente de time. (não afeta o bloco (A) de pessoal
     alheio — esse `OR` é separado e continua barrando pessoal de outro)
   - `task_service._assert_visible_via_project`: depois dos checks de
     pessoal, antes de negar por lente, retornar se
     `task.created_by == tenant.user_id`. Posicionamento importa: vem
     **depois** do bloqueio de pessoal alheio, pra não criar exceção lá.
   Teste (lógica): casos do gate cobrindo criador-vê / não-criador-fora.

4. **`collaboration_repository.py`** — `TaskAssignmentRepository` e
   `TaskWatcherRepository`, ambos `BaseRepository[...]` (as tabelas têm
   `workspace_id`; sem `deleted_at`, o `_base_select` não filtra soft
   delete). Métodos: `list_user_ids(task_id)`, `get(task_id, user_id)`,
   `add(task_id, user_id, ...)`, `remove(task_id, user_id) -> bool`.
   Todas as queries via `_base_select()`.

5. **`collaboration_service.py`** — `CollaborationService`. Reusa o
   `TaskService` (ou helpers extraídos) para os gates de visibilidade e
   edição — **não duplica** a regra de time. Métodos:
   `add_assignee`, `remove_assignee`, `list_assignees`,
   `add_watcher`, `remove_watcher`, `list_watchers`,
   `assignee_ids_for(task)`, `watcher_ids_for(task)`. Valida alcance do
   designado (carrega memberships do alvo + `team_scope.visible_team_ids`),
   pessoal monouser, idempotência. Escreve history via
   `TaskRepository.write_history` (reuso). Commit é do UoW (router).

6. **`schemas.py`** — `AssigneeCreateRequest {user_id}`,
   `WatcherCreateRequest {user_id: UUID | None}`,
   `CollaboratorListResponse {task_id, user_ids: list[UUID]}`,
   `TaskDetailResponse(TaskResponse)` + `assignee_ids` + `watcher_ids`.

7. **`collaboration_router.py`** — 6 rotas. POST/DELETE protegidas pelo
   gate certo: assignees e watcher-de-terceiro com
   `require_permission("task.assign")`; self-watch sem permissão (a
   distinção self/terceiro é resolvida no service, então o POST de watcher
   **não** usa `require_permission` no router — o service decide). GET sem
   permissão, só `TenantContextDep`. UoW nas mutações.

8. **`tasks_router.py`** — `get_task` passa a montar `TaskDetailResponse`
   via `CollaborationService.assignee_ids_for/watcher_ids_for`.
   `list_tasks` **intocado**.

9. **`router.py`** — incluir `collaboration_router` no `api_v1_router`.

10. **`tests/test_collaboration.py`** — lógica pura: regras de idempotência
    (no-op vs criar), seleção self vs terceiro, alcance do designado
    (resolver puro), pessoal monouser, builders de history. A escrita real
    no Postgres (inserts, history, cascade de FK no delete da task) valida
    no smoke via `/docs`.

---

## Pontos de atenção (onde isto pode quebrar)

- **Gate sem duplicação.** A tentação é recopiar a lógica de time no
  `CollaborationService`. Não. Extrair de `TaskService` um par de helpers
  reusáveis (`assert_visible`, `assert_editable`) ou injetar o
  `TaskService`. Decisão de implementação a confirmar no review do
  esqueleto: extrair helpers puros vs. compor o `TaskService`.
- **Alcance do designado custa um query.** Carregar os memberships do
  `user_id` alvo (não do ator) para rodar `visible_team_ids`. É a única
  consulta extra "não óbvia" da entrega. Reusa `MembershipRepository`.
- **`assigned_by` é o ator, não o alvo.** Erro fácil de inverter.
- **Self-watch não passa por `require_permission` no router.** Se passar,
  operador-sem-assign não consegue se auto-observar — bug. A distinção
  mora no service.
- **Cascade no DELETE da task.** `task_assignment`/`task_watcher` têm FK
  `ondelete=CASCADE` para `task`. Mas a task usa **soft-delete**
  (`deleted_at`), não DELETE físico — então as linhas de colaboração
  **permanecem** após soft-delete da task. Decisão: deixar como está
  (consistente com soft-delete; ao "reviver" a task os responsáveis
  voltam). Documentar no ADR 0010; não limpar na cascata de soft-delete.

---

## Smoke manual via `/docs` (após implementação)

Pré: Camila autenticada; 1 projeto comum do Marketing (`PROJ_A`,
`team_id = Marketing`); 1 subtime irmão (ex.: Copy) com 1 membro `USER_B`;
1 task `TASK_1` em `PROJ_A`.

| # | Operação | Esperado |
|---|----------|----------|
| 1 | `POST /tasks/{TASK_1}/assignees {user_id: USER_B}` | 201; `assigned_by` = eu |
| 2 | repetir #1 | 200 no-op; sem 2ª linha de history |
| 3 | `GET /tasks/{TASK_1}` | 200; `assignee_ids` contém `USER_B` |
| 4 | `POST /tasks/{TASK_1}/assignees {user_id: <inexistente>}` | 422 |
| 5 | `POST /tasks/{TASK_1}/watchers {}` (self) | 201; sem history |
| 6 | `DELETE /tasks/{TASK_1}/assignees/{USER_B}` | 200/204; history `unassigned` |
| 7 | `DELETE /tasks/{TASK_1}/assignees/{USER_B}` de novo | 404 |
| 8 | task em pessoal: `POST .../assignees {user_id: <outro>}` | 409 |
| 9 | como OPERATOR no quadro geral: `POST .../assignees` | 201 (tem task.assign agora) |
| 10 | criar avulsa `team=Copy` e `GET /tasks` como criador | aparece (created_by vê) |
| 11 | como criador, `PATCH` nessa avulsa `team=Copy` | 403 (vê mas não edita) |

`task_history` no Adminer deve mostrar `assigned`/`unassigned` com
`metadata.user_id` e `metadata.assigned_by`; nenhuma linha de watcher.
