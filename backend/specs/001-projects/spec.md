# Entrega 1 — Projects

> **Status:** Proposed (aguarda aprovação)
> **Módulo afetado:** `app/modules/tasks/` (project vive aqui, junto de
> task — espelha a relação "container ↔ conteúdo" do schema v5)
> **ADR relacionado:** `docs/adr/0001-projeto-pessoal-automatico.md`

---

## Contexto

`project` é o container de `task` no schema v5. A FK `task.project_id`
é **NOT NULL** (confirmado por inspeção do banco), portanto toda task
precisa pertencer a algum projeto. Para suportar "tasks pessoais" sem
quebrar essa invariante, **todo user do workspace recebe automaticamente
um projeto pessoal** no momento do cadastro — visível e editável só pelo
dono, blindado contra exclusão/arquivamento. Detalhes em
`docs/adr/0001-projeto-pessoal-automatico.md`.

Esta entrega cobre todo o CRUD-de-casos-de-uso de project, **mais** a
infra do pessoal (flag, criação automática, proteções, backfill da
Camila, endpoint pra descobrir o id do próprio pessoal).

## Escopo

- Casos de uso de projeto: criar, obter, listar (paginação + filtros),
  atualizar, arquivar/desarquivar, soft-delete.
- **Projeto pessoal automático:** criação no provisionamento e no
  cadastro de membro, proteções, endpoint `GET /me/personal-project`,
  filtros de privacidade em list/get.
- Migration `0002_project_personal_flag` (DDL + backfill).
- Logging estruturado em cada mutação.
- Plugar `projects_router` e `me_router` no agregador.

## Non-goals

- Tasks, subtasks, LTREE, ciclos — Entrega 2.
- Endpoint admin de "ver pessoal alheio" — **non-goal explícito**.
  Privacidade do pessoal vale **inclusive contra admin**.
- Endpoint admin de "lixeira" (restaurar deletado) — futuro.
- Bulk operations — futuro.
- Auditoria estruturada (sem `project_history` no schema; logging
  cobre).
- Busca textual (`q=`) — futuro.

## Decisões

### Estruturais

1. **Módulo: `app/modules/tasks/`.** Project mora junto de task no
   código, alinhado ao schema.
2. **Routers separados.** `projects_router` em `projects_router.py`,
   `me_router` em `me_router.py` (prefix `/me`). Quando vier `tasks`,
   é o terceiro. Alinhado ao comentário já existente em
   `app/api/router.py`.

### Soft-delete vs. archive

3. **`is_archived: bool` (do `ArchivableMixin`)** — guardado, fora da
   lista ativa, reversível, permissão `project.update`. Filtro manual.
4. **`deleted_at: datetime | None` (do `SoftDeleteMixin`)** — removido,
   permissão `project.delete`. Filtro automático no `_base_select()`.

### Comportamento

5. **Status livre + auto-marcação de `completed_at`** (decisão pode ser
   diferente em task). Transição **para** `COMPLETED` →
   `completed_at = now()`; **saindo** de `COMPLETED` → `NULL`.
6. **`start_date <= due_date`** quando ambos presentes. Validação no
   service, sobre o estado RESULTANTE do PATCH.
7. **`created_by` = `TenantContext.user_id`** na criação. Nunca aceito
   na request, imutável após.
8. **Sem auditoria estruturada nesta entrega** (sem
   `project_history` no schema). Logging cobre.

### API

9. **Filtros suportados (mínimo viável):**
   - `status` (enum, opcional)
   - `priority` (enum, opcional)
   - `include_archived` (bool, default `false`)
10. **Ordenação fixa:** `created_at DESC`.
11. **Prefixo: `/api/v1/projects` e `/api/v1/me`** — multi-tenancy é
    resolvida pelo `TenantContext`, não pela URL.
12. **`description` aceita string vazia.**
13. **PATCH semântica "campo ausente = não mexer".** Sem como **limpar**
    `start_date`/`due_date` via PATCH nesta entrega (enviar `null` =
    ambíguo, evitamos).
14. **Archive/unarchive idempotentes** (no-op em estado já aplicado, **não** 409).
15. **DELETE responde 200 com body** (projeto com `deleted_at` setado). **Não** 204.

### Projeto pessoal (ADR 0001)

16. **Flag dedicada: `is_personal: bool NOT NULL DEFAULT false`** em
    `project` (migration 0002). Sem convenção por título — flag
    explícita.
17. **Unicidade:** índice parcial
    `UNIQUE (workspace_id, created_by) WHERE is_personal`. Garante 1
    pessoal por user por workspace.
18. **Criação atômica em dois fluxos:**
    - `WorkspaceProvisioningService.execute()` → cria workspace + team
      + admin **+ pessoal do admin**, tudo num UoW.
    - `MemberService.create_member()` → cria user **+ pessoal do user**,
      mesmo UoW.
19. **Backfill** na migration 0002: cria pessoal pra todo user já
    existente (Camila no caso atual).
20. **Title fixo: `"Pessoal"`.** Não renomeável (consequência da
    decisão 22: pessoal é imutável via PATCH). Frontend exibe sempre
    "Pessoal" como label do container.
21. **Status inicial: `ACTIVE`. Priority: `MEDIUM`.** Pessoal nasce
    pronto pra uso.
22. **Proteções no `ProjectService`:**
    - `soft_delete` em projeto pessoal → `409 BusinessRuleError`.
    - `archive` em projeto pessoal → `409 BusinessRuleError`.
    - **`update` em projeto pessoal → `409 BusinessRuleError`.**
      Pessoal é **imutável via PATCH** — title, description, status,
      priority e datas ficam fixos. O usuário interage com o
      pessoal exclusivamente via as tasks dentro dele, não com o
      container.
    - `unarchive` em pessoal → no-op (nunca está arquivado).
    - `is_personal` e `created_by` blindados por design (nem entram
      no `UpdateProjectCommand`).
23. **Privacidade — defesa em duas camadas:**
    - **Leitura (Entrega 1):** `list_page` injeta filtro
      `is_personal=False OR created_by=tenant.user_id`. `get` faz
      o mesmo check e levanta `EntityNotFoundError` (404) — **não**
      `AuthorizationError` (403), pra não vazar existência.
    - **Escrita (Entrega 2):** task create/move com `project_id` de
      pessoal alheio devolve 404. Documentado aqui pra Entrega 2
      cumprir.
24. **Pessoal não depende de team.** Vinculado ao user, não a
    `user_team`. User sem team tem pessoal normalmente.
25. **Permissão para deletar:** Admin **e Manager** têm `project.delete`.
    Mapa em `app/modules/auth/domain/permissions.py` é editado nesta
    entrega para incluir `project.delete` em `MANAGER`.
    Independentemente disso, pessoal não é deletável por ninguém
    (decisão 22).

## Contratos públicos (HTTP)

Todos os endpoints exigem JWT válido e workspace ativo no contexto.
Todos vivem sob `/api/v1`.

| Método | Path                          | Permissão        | Status |
|--------|-------------------------------|------------------|--------|
| GET    | /projects                     | autenticado      | 200    |
| POST   | /projects                     | `project.create` | 201    |
| GET    | /projects/{id}                | autenticado      | 200    |
| PATCH  | /projects/{id}                | `project.update` | 200    |
| DELETE | /projects/{id}                | `project.delete` | 200    |
| POST   | /projects/{id}/archive        | `project.update` | 200    |
| POST   | /projects/{id}/unarchive      | `project.update` | 200    |
| GET    | /me/personal-project          | autenticado      | 200    |

### `ProjectResponse`

`id`, `workspace_id`, `title`, `description`, `status`, `priority`,
`start_date`, `due_date`, `completed_at`, `is_archived`,
**`is_personal`**, `created_by`, `created_at`, `updated_at`.

### `ProjectCreateRequest`

`title` (1..255), `description` (default `""`, max 100k),
`status` (default `PLANNING`), `priority` (default `MEDIUM`),
`start_date | None`, `due_date | None`.

`is_personal` **não** entra — pessoal não é criado via essa rota.

### `ProjectUpdateRequest`

Todos opcionais. Campos: `title`, `description`, `status`, `priority`,
`start_date`, `due_date`. `is_personal` e `created_by` ausentes por
design.

### Query params de `GET /projects`

- `page: int = 1` (≥1)
- `size: int = 20` (1..100)
- `status: ProjectStatus | None`
- `priority: PriorityLevel | None`
- `include_archived: bool = False`

Não há filtro `is_personal` na query — pessoal de outros é invisível
por padrão; pessoal próprio sempre aparece se não arquivado.

### Códigos de erro

- `422 ValidationError` — title vazio, `start > due`, enum inválido.
- `401 AuthenticationError` — token ausente/inválido/expirado, user inativo.
- `403 AuthorizationError` — permissão faltando.
- `404 EntityNotFoundError` — projeto inexistente, em outro workspace,
  ou pessoal de outro user.
- `409 ConflictError` / `BusinessRuleError` — delete/archive em pessoal.
- `422` (FastAPI) — payload mal formado.

## Regras de negócio (verificáveis)

1. `workspace_id` e `created_by` vêm sempre do `TenantContext`.
2. `title` é normalizado com `strip()`; vazio rejeitado.
3. `start_date <= due_date` quando ambos presentes (após merge no PATCH).
4. Transição **para** `COMPLETED` → `completed_at = now()`.
5. Transição **saindo** de `COMPLETED` → `completed_at = NULL`.
6. `archive` seta `is_archived = True`; idempotente.
7. `unarchive` seta `is_archived = False`; idempotente.
8. `soft_delete` seta `deleted_at = now()`. Recurso sai de get/list.
9. `get`/`list` ignoram `deleted_at IS NOT NULL` (via `_base_select`).
10. `list` com `include_archived=false` (default) esconde
    `is_archived=True`.
11. Cross-tenant → 404.
12. **Pessoal: não pode ser soft-deletado.** Tentativa → 409.
13. **Pessoal: não pode ser arquivado.** Tentativa → 409.
14. **Pessoal: `is_personal` é imutável** (não entra no
    `UpdateProjectCommand` — blindado por design).
15. **Pessoal: `created_by` é imutável** (idem).
16. **Pessoal alheio é invisível em list/get.** Tentativa de acessar
    pessoal de outro user → 404 (não 403).
17. **Pessoal próprio é sempre listável** (respeitando outros filtros).
18. Todo user criado via `MemberService.create_member` recebe um
    pessoal no mesmo UoW.
19. O admin do workspace criado via `WorkspaceProvisioningService`
    também recebe um pessoal no mesmo UoW.
20. Migration 0002 cria pessoal pra cada user pré-existente (backfill).
21. Existem no máximo `count(users)` projetos pessoais por workspace
    (garantido pelo índice único parcial).

## Critérios de aceite

Cada bullet exige cobertura por teste ou smoke documentado:

**Comportamento básico de project (sem pessoal):**

- [ ] Criar com payload válido → 201; `created_by` e `workspace_id` do
      contexto; `is_personal=false`.
- [ ] Criar com `title="   "` → 422, `details.field == "title"`.
- [ ] Criar com `start > due` → 422, `details.field == "due_date"`.
- [ ] Criar sem `project.create` (ex. OPERATOR) → 403.
- [ ] Listar devolve só do workspace, arquivados fora, deletados fora.
- [ ] `include_archived=true` inclui arquivados, exclui deletados.
- [ ] `status=ACTIVE` filtra corretamente.
- [ ] Get em outro workspace → 404.
- [ ] PATCH title → reflete; `updated_at` avança (via mixin onupdate).
- [ ] PATCH status → COMPLETED seta `completed_at`.
- [ ] PATCH status COMPLETED → ACTIVE limpa `completed_at`.
- [ ] Archive marca `is_archived=true`; no-op em estado já aplicado.
- [ ] Unarchive marca `is_archived=false`; no-op em estado já aplicado.
- [ ] DELETE responde 200 com `deleted_at` setado; GET seguinte → 404.
- [ ] DELETE sem `project.delete` → 403.
- [ ] DELETE como Manager (que agora tem `project.delete`) → 200.

**Projeto pessoal:**

- [ ] Após `WorkspaceProvisioningService.execute()`, o admin tem
      exatamente 1 pessoal (`is_personal=true`, title `"Pessoal"`,
      `status=ACTIVE`).
- [ ] Após `MemberService.create_member()`, o novo user tem
      exatamente 1 pessoal.
- [ ] Migration 0002 criou pessoal pra Camila (backfill rodou).
- [ ] `GET /me/personal-project` retorna o pessoal do user logado.
- [ ] User A não vê o pessoal do user B no `GET /projects`.
- [ ] `GET /projects/{id_pessoal_de_B}` por A → 404.
- [ ] User A vê o próprio pessoal em `GET /projects` (não tem como
      esconder via filtro).
- [ ] Admin não consegue acessar pessoal de outro user (404), mesmo
      tendo `workspace.manage`.
- [ ] DELETE no próprio pessoal → 409 `BusinessRuleError`.
- [ ] Archive no próprio pessoal → 409 `BusinessRuleError`.
- [ ] PATCH no próprio pessoal (em qualquer campo) → 409
      `BusinessRuleError`. Pessoal é imutável via API; usuário
      interage só pelas tasks dentro dele.
- [ ] Tentar criar 2 pessoais pro mesmo user → falha por índice único
      parcial (cenário só atingível por bug; teste cobre via SQL direto).

## Decisões antecipadas para Entrega 2

Documentadas aqui para não esquecer (ficam fora do escopo desta
entrega, mas dependem do que decidimos aqui):

- **Pessoal é monouser por construção.** Tasks em projeto pessoal só
  podem ter o **dono do pessoal** como assignee e como watcher.
  `TaskService` (Entrega 2) rejeita `task.assign` e `task.watch`
  com user ≠ `project.created_by` quando `project.is_personal=true`.
- **Tentativa de criar/mover task com `project_id` de pessoal alheio
  → 404** (cumpre a "defesa em duas camadas" da decisão 23).

## Riscos

- **Backfill em prod (futuro).** Em dev é só a Camila; em prod, o
  `INSERT ... SELECT` pode varrer N users. Protegido por `NOT EXISTS`
  — idempotente, seguro re-rodar.
- **Inconsistência transitória se a 0002 subir sem o código novo
  deployado.** Mitigada pelo `create_personal_for` idempotente —
  re-rodar manualmente conserta sem perda.
