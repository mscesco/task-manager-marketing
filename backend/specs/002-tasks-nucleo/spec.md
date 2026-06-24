# Entrega 2 — Tasks (núcleo) + history

> **Status:** Proposed (aguarda aprovação)
> **Módulo afetado:** `app/modules/tasks/`
> **ADRs relacionados:**
> - `docs/adr/0002-ltree-label-format.md`
> - `docs/adr/0003-move-task-base-select-exception.md`
> - `docs/adr/0004-task-history-granularity.md`
> - `docs/adr/0005-soft-delete-cascade.md`

---

## O que esta entrega entrega (em linguagem de produto)

Com esta entrega, o usuário consegue:

- Criar tarefas dentro de projetos (inclusive do projeto Pessoal).
- Criar subtarefas, formando uma árvore.
- Mover uma tarefa pra outro lugar — outro pai, outro projeto, ou
  ambos. A subtree inteira vai junto.
- Editar título, descrição, status, prioridade, equipe responsável, datas.
- Arquivar (guardar fora da visualização) e desarquivar.
- Apagar (soft-delete): a tarefa some, e as subtarefas dela vão junto.
- Ter histórico completo de tudo que aconteceu com cada tarefa
  (gravado no banco; endpoint pra ler vira entrega futura).

Garantias importantes:

- **Privacidade do Pessoal:** ninguém vê nem mexe em tarefas do
  Pessoal de outra pessoa (inclusive admin).
- **Histórico é imutável:** o banco bloqueia tentativa de
  editar/apagar registros do histórico via trigger.

## Escopo

- CRUD completo de task: criar, obter, listar (filtros + paginação),
  atualizar, mover, arquivar/desarquivar, soft-delete (cascateado).
- `task_history` (modelo híbrido — ADR 0004) escrito em todas as
  mutações na mesma transação.
- Privacidade do Pessoal cumprida em leitura e escrita.
- Migration `0003_task_history_safety_net` (defensiva: garante
  trigger, índice GIST e extensão LTREE).
- Logging estruturado em cada mutação.
- Plugar `tasks_router` no agregador.

## Non-goals

- **Assignments e watchers** — Entrega 3.
- **Comments** — Entrega 4.
- **Time entries** — Entrega 5.
- **Position / reorder de board** — Entrega 6.
- Endpoints `/me/tasks`, `/me/assignments` — Entrega 7.
- Attachments — Entrega 8.
- Endpoint pra ler a timeline do `task_history` — entrega curta dedicada depois.

## Decisões

### Estruturais

1. **Módulo: `app/modules/tasks/`.** `tasks_router` é o terceiro
   router (irmão de `projects_router` e `me_router`).
2. **Repository, service, schemas, router** seguem o padrão da Entrega 1.

### LTREE (ADR 0002)

3. **Formato do label LTREE: `"t" + uuid.hex`.**
4. **`path`** termina no label da própria task. Raiz: `path = <label>`.
   Filha: `path = <path_do_pai>.<label_dela>`.
5. **`depth`** = número de pontos no path (raiz tem 0).

### Move (ADR 0003)

6. **Move é exceção autorizada ao `_base_select()`.** SQL textual
   com predicado `workspace_id = :tenant_id` manual.
7. **Detecção de ciclo via LTREE** (`novo_pai.path <@ task.path`).
8. **Move pode trocar de projeto.** Subtree inteira vai junto.
9. **Move requer `task.update`**.
10. **Constraints de move:**
    - Mover pra si mesmo → 409 `BusinessRuleError`.
    - Mover criando ciclo → 409.
    - `parent_task_id` em projeto ≠ `project_id` informado → 422.
    - Pessoal alheio → 404.
    - Projeto deletado → 404.
    - Projeto arquivado → permitido.

### Status, datas, soft-delete, archive

11. **Status livre.** Transições livres. Service ajusta:
    - **para** `COMPLETED` → `completed_at = now()`;
    - **saindo** de `COMPLETED` → `completed_at = NULL`.
12. **`start_date <= due_date`** quando ambos presentes (após merge).
13. **PATCH "campo ausente = não mexer".** `parent_task_id` e
    `project_id` NÃO entram em update — usar `move`.
14. **Soft-delete e archive são independentes.**

### Cascata em soft-delete (ADR 0005)

15. **Soft-delete cascateia pra toda a subtree.** Via SQL textual
    (segunda exceção autorizada ao `_base_select`, mesma família do move).
16. **Cascata gera 1 linha em `task_history` apenas pra task raiz.**
    `event_metadata.cascade_count` = número de descendentes.
    Filhas apagadas não geram history individual.

### Privacidade do pessoal

17. **Leitura:** `list_page`/`get` filtram tasks em pessoal alheio
    via JOIN com project (`is_personal=false OR created_by=me`).
18. **Escrita:**
    - `create` com `project_id` de pessoal alheio → 404.
    - `move` pra/de pessoal alheio → 404.

### task_history (ADR 0004)

19. **Modelo híbrido:**
    - Atômicos (`created`, `moved`, `archived`, `unarchived`, `deleted`) → 1 linha sem `field_name`, com `event_metadata`.
    - Update (`updated`) → 1 linha por campo.
    - Status (`status_changed`) → 1 linha dedicada.
20. **Escrita atômica no mesmo UoW da mutação.**
21. **`user_id`** vem de `TenantContext.user_id`.

### API

22. **Filtros em `GET /tasks`:**
    - `project_id`, `parent_task_id`, `status`, `priority`, `team_id`, `created_by` (todos opcionais).
    - `root_only` (bool) — filtra tasks sem pai.
    - `include_archived` (bool, default `false`).
23. **Ordenação fixa:** `created_at DESC`.
24. **Prefixo:** `/api/v1/tasks`.

## Contratos públicos (HTTP)

| Método | Path                       | Permissão     | Status |
|--------|----------------------------|---------------|--------|
| GET    | /tasks                     | autenticado   | 200    |
| POST   | /tasks                     | `task.create` | 201    |
| GET    | /tasks/{id}                | autenticado   | 200    |
| PATCH  | /tasks/{id}                | `task.update` | 200    |
| POST   | /tasks/{id}/move           | `task.update` | 200    |
| POST   | /tasks/{id}/archive        | `task.update` | 200    |
| POST   | /tasks/{id}/unarchive      | `task.update` | 200    |
| DELETE | /tasks/{id}                | `task.delete` | 200    |

### `TaskResponse`

`id`, `workspace_id`, `project_id`, `parent_task_id`, `team_id`,
`title`, `description`, `status`, `priority`, `position`, `depth`,
`path`, `start_date`, `due_date`, `completed_at`, `is_archived`,
`created_by`, `created_at`, `updated_at`.

### `DeleteTaskResponse`

Estende `TaskResponse` com `cascade_count: int` (número de filhas
apagadas junto; pode ser 0).

### Códigos de erro

- `404 EntityNotFoundError` — inexistente, outro workspace, ou pessoal alheio.
- `409 BusinessRuleError` / `ConflictError` — ciclo, mover pra si mesmo, etc.
- `422 ValidationError` — title vazio, `start > due`, `parent_task_id` em projeto diferente.
- `403 AuthorizationError` — permissão faltando.
- `401 AuthenticationError` — token ausente/inválido/expirado.

## Critérios de aceite

**Criação:**
- [ ] Criar raiz → 201; `path=label`, `depth=0`; 1 linha em history (`created`).
- [ ] Criar subtask com pai válido → 201; `path`/`depth` derivados.
- [ ] Criar com pai em projeto diferente → 422.
- [ ] Criar com projeto de pessoal alheio → 404.
- [ ] Criar com `title="  "` → 422.
- [ ] Criar com `start > due` → 422.
- [ ] Criar sem `task.create` → 403.

**Update:**
- [ ] PATCH title → reflete; 1 linha em history.
- [ ] PATCH status pra COMPLETED → `completed_at` setado; 1 linha (`status_changed`).
- [ ] PATCH status saindo de COMPLETED → `completed_at=null`.
- [ ] PATCH 2 campos → 2 linhas.
- [ ] PATCH sem mudança real → 0 linhas.

**Move:**
- [ ] Move trocando só de pai (mesmo projeto) → `path`/`depth` da subtree atualizados; 1 linha (`moved`).
- [ ] Move trocando só de projeto → vira raiz; subtree atualizada.
- [ ] Move pai+projeto consistentes → ok.
- [ ] Move com pai em projeto ≠ → 422.
- [ ] Move pra si mesmo → 409.
- [ ] Move criando ciclo → 409.
- [ ] Move pra pessoal alheio → 404.
- [ ] Move pra projeto deletado → 404.
- [ ] Move pra projeto arquivado → 200.
- [ ] Move "vazio" → 200 sem history.

**Soft-delete (cascata) e archive:**
- [ ] DELETE task sem filhas → 200, `cascade_count=0`.
- [ ] DELETE com 3 filhas → 200, `cascade_count=3`; GET nas filhas → 404; 1 linha em history só na raiz.
- [ ] DELETE com subtree 2 níveis → cascade_count cobre tudo.
- [ ] Archive idempotente; history só se mudou.
- [ ] DELETE sem `task.delete` → 403.

**Listagem e privacidade:**
- [ ] Filtros funcionando.
- [ ] `root_only=true` retorna só sem pai.
- [ ] Lista esconde arquivadas por default.
- [ ] Lista não retorna tasks em pessoal alheio.
- [ ] Get em pessoal alheio → 404.

## Riscos

- **Cascata é menos reversível.** Sem endpoint de restore. Mitigação: frontend avisa antes.
- **Subtree grande no move/delete.** Não preocupa no caso de uso atual.
- **Concorrência em move/delete.** Não tratada nesta entrega (low-traffic).
