# Plano — Entrega 1 (Projects)

> Referência: `specs/001-projects/spec.md`
> ADR: `docs/adr/0001-projeto-pessoal-automatico.md`
> **Status:** Proposed (aguarda aprovação junto da spec)

---

## Sequência de implementação

Ordem escolhida pra reduzir retrabalho: schema/model primeiro
(senão o resto não compila), depois infra, depois domínio, depois
exposição HTTP. Cada item gera commit verificável; testes do que é
pura lógica nascem junto.

### 1. Migration `0002_project_personal_flag`

**Arquivo:** `alembic/versions/0002_project_personal_flag.py`

DDL:
```
ALTER TABLE project ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX project_personal_per_user
  ON project (workspace_id, created_by)
  WHERE is_personal = true;
```

Backfill:
```
INSERT INTO project (workspace_id, title, description, status,
                     priority, created_by, is_personal)
SELECT workspace_id, 'Pessoal', '', 'ACTIVE', 'MEDIUM', id, true
FROM users
WHERE NOT EXISTS (
    SELECT 1 FROM project p
    WHERE p.created_by = users.id AND p.is_personal = true
);
```

Downgrade reverte índice e coluna. Backfill **não** é desfeito no
downgrade (linhas criadas ficam — perda controlada de informação
em rollback, comum em backfills).

### 2. Atualizar o model

**Arquivo editado:** `app/db/models/operational.py`

Adicionar `is_personal: Mapped[bool]` em `Project`, mapeado com
`server_default="false"`.

### 3. Repository

**Arquivo:** `app/modules/tasks/infrastructure/project_repository.py`

Subclasse de `BaseRepository[Project]`. Adicionar um método:
- `get_personal_by_user(user_id)` — retorna o pessoal do user no
  workspace corrente, ou `None`. Parte do `_base_select()` com filtro
  `is_personal=true AND created_by=user_id`.

`list_page` herdado já basta (recebe `filters` extras).

### 4. Schemas

**Arquivo:** `app/modules/tasks/api/schemas.py`

`ProjectResponse` ganha `is_personal: bool`. `Create`/`Update` **não**
expõem `is_personal` nem `created_by` — blindagem por design.
Validação cruzada de datas continua no service.

### 5. Service

**Arquivo:** `app/modules/tasks/application/project_service.py`

Commands: `CreateProjectCommand`, `UpdateProjectCommand`,
`ProjectFilters`.

Métodos:
- `create`, `get`, `list_page`, `update`, `archive`, `unarchive`,
  `soft_delete` (regras de proteção a pessoal aplicadas).
- **`create_personal_for(user_id)`** — usado por
  `MemberService.create_member` e `WorkspaceProvisioningService`.
  Cria com `is_personal=true`, `title="Pessoal"`, `status=ACTIVE`.
  Idempotente: se pessoal já existe (índice único parcial), retorna
  o existente em vez de estourar.
- **`get_personal_for_current_user()`** — usado pelo endpoint
  `GET /me/personal-project`.

Helpers privados:
- `_assert_not_personal(project, *, operation)` — 409 em
  delete/archive de pessoal.
- `_assert_visible_to_current_user(project)` — 404 em pessoal
  alheio (privacy-preserving).
- `_validate_dates(start, due)` — pura, `staticmethod`, testável
  sem DB.

Filtros de privacidade aplicados em:
- `list_page`: injeta predicado `is_personal=False OR
  created_by=tenant.user_id` no `filters` antes de chamar o repo.
- `get`/`update`/`archive`/`unarchive`/`soft_delete`: depois do
  `get_by_id_or_raise`, chamam `_assert_visible_to_current_user`.

### 6. Provisionamento e cadastro de membro

**Arquivos editados:**
- `app/modules/workspaces/application/provisioning_service.py`
- `app/modules/users/application/member_service.py`

Em ambos, após criar o user e o flush, chamar
`ProjectService.create_personal_for(user.id)`. Tudo no mesmo UoW
(átomo: ou cria user + pessoal, ou nada).

### 7. Router de projects

**Arquivo:** `app/modules/tasks/api/projects_router.py`

Sete endpoints da tabela em `spec.md § Contratos públicos`.

### 8. Router de `/me`

**Arquivo:** `app/modules/tasks/api/me_router.py`

Um endpoint: `GET /me/personal-project` → `ProjectResponse`. Mora no
módulo `tasks` porque o conteúdo retornado é projeto. Quando vierem
`/me/tasks` etc., entram aqui.

### 9. Plugar no agregador

**Arquivo editado:** `app/api/router.py`

```
from app.modules.tasks.api.projects_router import router as projects_router
from app.modules.tasks.api.me_router import router as me_router

api_v1_router.include_router(projects_router)
api_v1_router.include_router(me_router)
```

### 10. Testes

**Arquivo:** `tests/test_projects.py`

Padrão de `tests/test_workspaces.py`: unit no que é puro, smoke
manual no que precisa de DB. Cobertura mínima:

- Validações de comando (title vazio, `start > due`).
- Lógica pura de transição de status (`completed_at` set/clear).
- Idempotência de archive/unarchive (estado do objeto, sem DB).
- `_assert_not_personal` e `_assert_visible_to_current_user`
  (puros — recebem mock de Project com `is_personal`/`created_by`).

Smoke manual documentado em `spec.md`.

---

## Arquivos novos

```
alembic/versions/
└── 0002_project_personal_flag.py          # NEW

app/modules/tasks/
├── application/
│   └── project_service.py                 # NEW
├── infrastructure/
│   └── project_repository.py              # NEW
└── api/
    ├── projects_router.py                 # NEW
    ├── me_router.py                       # NEW
    └── schemas.py                         # NEW

specs/001-projects/
├── spec.md                                # NEW (este pacote)
└── plan.md                                # NEW (este pacote)

docs/adr/
├── README.md                              # NEW (convenção)
└── 0001-projeto-pessoal-automatico.md    # NEW (primeira ADR real)

tests/
└── test_projects.py                       # NEW
```

## Arquivos editados

- `app/db/models/operational.py` — adicionar `is_personal` em `Project`.
- `app/modules/workspaces/application/provisioning_service.py` —
  chamar `ProjectService.create_personal_for(admin.id)`.
- `app/modules/users/application/member_service.py` — chamar
  `ProjectService.create_personal_for(user.id)`.
- `app/modules/auth/domain/permissions.py` — adicionar
  `project.delete` à role `MANAGER`. Diff esperado:

  ```python
  UserTeamRole.MANAGER: frozenset(
      {
          "team.manage",
          "project.create",
          "project.update",
          "project.delete",   # <-- novo
          "task.create",
          "task.update",
          "task.delete",
          "task.assign",
      }
  ),
  ```

- `app/api/router.py` — `include_router(projects_router)` e
  `include_router(me_router)`.

## Como verificar localmente

```
# Migration
docker compose run --rm api-dev alembic upgrade head

# Verificar que Camila ganhou pessoal
# (via Adminer ou psql no túnel):
#   SELECT id, title, is_personal, created_by FROM project
#   WHERE is_personal = true;

# Suite de testes
docker compose run --rm api-dev pytest

# Smoke manual via /docs com JWT da Camila:
# 1. GET /api/v1/me/personal-project → 200 com o pessoal dela
# 2. POST /api/v1/projects (status=ACTIVE) → 201, is_personal=false
# 3. GET /api/v1/projects → 200 com 2 itens (pessoal + novo)
# 4. POST /api/v1/projects/{id_normal}/archive → 200
# 5. GET /api/v1/projects → 200 sem o arquivado
# 6. GET /api/v1/projects?include_archived=true → inclui arquivado
# 7. POST /api/v1/projects/{id_pessoal}/archive → 409 (proteção)
# 8. DELETE /api/v1/projects/{id_pessoal} → 409 (proteção)
# 9. DELETE /api/v1/projects/{id_normal} → 200, deleted_at setado
# 10. GET /api/v1/projects/{id_normal} → 404
```

Cadastrar um membro novo (B) via `POST /api/v1/members`, logar como B,
e verificar:

```
# 11. GET /api/v1/me/personal-project (como B) → 200, distinto do
#     pessoal da Camila
# 12. GET /api/v1/projects/{id_pessoal_camila} (como B) → 404
# 13. GET /api/v1/projects (como B) → não inclui pessoal da Camila
```

## Definição de pronto

- Migration 0002 aplicada; Camila tem pessoal.
- Sete endpoints de projects + endpoint `/me/personal-project`
  implementados e cobertos por teste ou smoke.
- `MemberService.create_member` e `WorkspaceProvisioningService.execute`
  criam pessoal no mesmo UoW.
- Logging estruturado em cada mutação.
- Todos os critérios de aceite da spec verificados.
- Sem regressão nos 23 testes existentes
  (`docker compose run --rm api-dev pytest`).

## Riscos

- **Backfill da migration roda em produção.** Em dev é só Camila;
  em prod (quando houver) o `INSERT ... SELECT` pode ser maior.
  Está protegido por `NOT EXISTS` — idempotente, seguro re-rodar.
- **Ordem da migration vs. cadastro de membro.** Se alguém criar
  membro com a 0002 aplicada mas o código novo não deployado, vai
  faltar o pessoal. Mitigação: deploy do código junto da migration;
  o `create_personal_for` é idempotente, então re-rodar manualmente
  conserta sem dor.
