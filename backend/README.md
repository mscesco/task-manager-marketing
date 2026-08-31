# Task Manager — Backend

Backend do sistema de gestão de demandas/tarefas multi-tenant.
Modular Monolith com FastAPI, SQLAlchemy 2.0 async e PostgreSQL.

⚠️ **ESTE ARQUIVO DESCREVE A ESTRUTURA E AS REGRAS QUE ATRAVESSAM TODOS OS
MÓDULOS.** Ele não conta o que cada feature faz — isso mora nas `specs/`, e o
porquê das escolhas amplas mora nos `docs/adr/`. O processo de trabalho
(portões, branches, armadilhas) mora no [`AGENTS.md`](../AGENTS.md) da raiz.

⚠️ Ele dizia, até 27/08/2026, *"ainda não há features de negócio implementadas
— apenas a fundação"*. Isso ficou errado por uns 40 specs e ninguém corrigiu,
porque nada quebra quando um README mente. Se você encontrar outra afirmação
velha aqui, **corrija na hora** em vez de contorná-la.

---

## Sumário

1. Arquitetura
2. Estrutura de diretórios
3. Decisões arquiteturais
4. Como rodar (desenvolvimento)
5. Migrations (Alembic) — incluindo o schema v5 já existente
6. Convenções de código
7. Como adicionar um novo módulo

---

## 1. Arquitetura

Estilo: **Modular Monolith** com **DDD pragmático** e
**Clean Architecture leve**. Quatro camadas, com a regra de
dependência apontando sempre para dentro (api → application →
domain; infrastructure serve a todas):

- **api** — routers FastAPI. Só request/response, validação,
  DI e status code. **Nenhuma regra de negócio.**
- **application** — services / casos de uso. Onde mora a
  regra de negócio. Orquestra repositories e o Unit of Work.
- **domain** — entidades e regras de domínio. Nesta foundation,
  os models ORM *são* as entidades (DDD pragmático: sem camada
  de mapeamento separada).
- **infrastructure** — detalhes técnicos: segurança/JWT,
  acesso externo, integrações.

A camada de acesso a dados (`app/db`) é compartilhada por todos
os módulos: Base ORM, mixins, Session Manager, BaseRepository e
Unit of Work.

## 2. Estrutura de diretórios

```
app/
  core/            # config, logging, tenant context, middleware, DI base
  db/              # Base ORM, mixins, session, repository, unit of work
    models/        # models ORM (1:1 com o schema v5)
  shared/          # exceptions, pagination — utilitários transversais
  api/             # router agregador, health, exception handlers
  modules/         # todos os bounded contexts, com estrutura uniforme:
    auth/          #   autenticação, JWT, permissions, guards, escopo de time
    users/         #   usuários e WorkspaceMembership
    workspaces/    #   workspace, provisionamento
    tasks/         #   tarefas, projetos, quadros, colunas, comentários
    notifications/ #   notificações e menções
    solicitations/ #   formulário público, fila de triagem, formulários
alembic/           # migrations
tests/             # unitários na raiz; `tests/integration/` exige Postgres
docker/  scripts/
```

Cada módulo em `app/modules/<contexto>/` repete as quatro
camadas: `domain/`, `application/`, `infrastructure/`, `api/`.

## 3. Decisões arquiteturais

Estas decisões foram tomadas na fundação do projeto, **continuam valendo** e
moldam todo módulo novo. Elas não estão nos ADRs por serem anteriores a eles —
se alguma for revista, o ADR nasce e este trecho passa a apontar para ele.

**Isolamento multi-tenant — ContextVar + asserção explícita.**
O `TenantContext` vive num `ContextVar` (`app/core/tenant.py`),
populado pela dependency `get_tenant_context` a partir do JWT
+ banco. Carrega `workspace_id`, `user_id`, `roles` e
`permissions`. Routers e services nunca recebem `workspace_id`
como parâmetro. O `BaseRepository` chama `require_tenant()`
antes de qualquer query — sem contexto, a aplicação **falha
alto** (`MissingTenantContextError`) em vez de vazar dados.

**Autorização — papéis e permissões, sem RBAC em tabela.**
`roles` são os papéis do usuário nas equipes do workspace
(enum `user_team_role` do schema v5). `permissions` são
derivadas dos papéis por um mapa estático
(`app/modules/auth/domain/permissions.py`) — não há tabela de
RBAC. Rotas protegem-se por permissão com
`require_permission("task.create")`. É um ponto de partida
pragmático; trocar o mapa por consulta ao banco no futuro não
quebra o `TenantContext` nem os guards.

**WorkspaceMembership é conceito de domínio, não tabela.**
O schema v5 não tem tabela user↔workspace, e foi declarado
maduro. Como `users.workspace_id` já é `NOT NULL` (um usuário
= um workspace), a "membership" já existe na linha de `users`.
`WorkspaceMembership` (`app/modules/users/domain/`) é um value
object montado pela camada de auth a partir de `users` +
`user_team`. Se um dia um usuário precisar de vários
workspaces, aí entra uma tabela real — sem mudar quem consome
o value object.

**BaseRepository com filtro automático.** Todo
`SELECT/UPDATE/DELETE` construído via `_base_select()` já
nasce com `WHERE workspace_id = <tenant>` e, para models com
soft delete, `AND deleted_at IS NULL`. Subclasses **nunca**
devem escrever `select(Model)` direto — sempre partir de
`_base_select()`.

**Unit of Work é o único que faz commit.** Repositories só
adicionam/consultam na sessão. A transação é confirmada pelo
UoW ao fim de um caso de uso bem-sucedido; qualquer exceção
faz rollback.

**Autenticação — JWT próprio, access + refresh.** O backend
emite os dois tipos de token desde o início. Cada token
carrega o claim `type`; um access token nunca é aceito onde
se espera refresh.

**Exceções desacopladas do framework.** Domínio e aplicação
lançam `AppError` e subclasses, sem conhecer HTTP. A tradução
para status code + JSON acontece num único lugar:
`app/api/errors.py`.

**RLS do PostgreSQL não é usado agora.** O schema está
preparado para RLS no futuro (toda tabela tem `workspace_id`),
mas o isolamento atual é por aplicação — ver o cabeçalho do
`schema_v5.sql`.

## 4. Como rodar (desenvolvimento)

Pré-requisitos: Docker e Docker Compose. O **PostgreSQL é
externo** (instância da VPS) — não sobe no compose.

1. Copie o `.env`:
   ```
   cp .env.example .env
   ```
2. Edite o `.env`:
   - `DATABASE_URL` — aponte para o Postgres da VPS, database
     `task_manager_dev`. Se o Postgres roda no host da VPS,
     use `host.docker.internal` (já mapeado no compose).
   - `JWT_SECRET_KEY` — gere com `openssl rand -hex 32`.
3. Suba o backend:
   ```
   docker compose up --build
   ```
4. Verifique:
   - `http://localhost:8000/health` → `{"status":"ok"}`
   - `http://localhost:8000/docs` → Swagger (fora de produção)

OBS: o Postgres e externo (VPS). Em dev, abra um tunel SSH para a porta
local 15432 antes de subir o backend (a `DATABASE_URL` do `.env.example`
ja aponta para `host.docker.internal:15432`):

```
ssh -L 15432:localhost:5432 <usuario>@<host-da-vps>
```

NUNCA versione host/usuario/IP reais aqui -- eles vivem na sua maquina,
fora do repo.

### Testes

⚠️ **A suíte de integração precisa do `db-test`, um Postgres efêmero do
próprio compose** — e **sem `TEST_DATABASE_URL` ela não falha: ela PULA**, com
saída zero e um "N skipped" discreto. Verde de mentira.

```
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL="postgresql+asyncpg://test:test@db-test:5432/taskmanager_test" api-dev pytest
```

Lint e tipos: `ruff check .` e `mypy app`. Os cinco portões e o número
esperado da suíte estão no [`AGENTS.md`](../AGENTS.md) §5.

## 5. Migrations (Alembic)

A URL do banco usada pelo Alembic vem do `.env` (não do `alembic.ini`).

**O schema nasce do baseline, não de um dump.** A partir da Entrega 8
(ADR 0022), a migration `0001_baseline_v5` contém o schema v5 **completo**
(extensões, enums, 12 tabelas, constraints, índices, função e trigger de
imutabilidade). Um banco novo se constrói inteiro com:

```
alembic upgrade head
```

Não há mais dump intermediário nem `alembic stamp` no caminho normal. O
arquivo `schema/schema_v5.sql` permanece apenas como **referência
congelada** para o harness de validação (`scripts/validate_baseline.ps1`),
que prova que `upgrade head` reproduz o schema esperado byte a byte.

**Nova migration (evolução do schema):**

```
alembic revision --autogenerate -m "descricao"
# REVISE o arquivo gerado a mao -- autogenerate nao captura tudo
# (triggers, indices parciais/GIST, funcoes). O include_object filtra a
# trigger/funcao de imutabilidade e as extensoes, mas indices ainda
# precisam de revisao humana.
alembic upgrade head
```

**Migration em produção é passo MANUAL de deploy.** O `entrypoint.sh` **não**
roda mais `alembic upgrade head` no boot (ADR 0022) — fazê-lo era arriscar a
produção a cada restart. Após o deploy do código:

```
docker compose run --rm api alembic upgrade head
```

> A trigger de imutabilidade de `task_history` (`task_history_immutable` /
> `task_history_no_update_delete`) e as extensões (`ltree`, `pgcrypto`) são
> criadas pelo baseline 0001 e ignoradas pelo autogenerate via
> `include_object`.

## 6. Convenções de código

- **Lint e formatação:** `ruff` (config no `pyproject.toml`).
  Rodar `ruff check .` e `ruff format .` antes de commitar.
- **Tipagem:** `mypy --strict`. Todo código novo é tipado;
  use `Mapped[...]` nos models (estilo SQLAlchemy 2.0).
- **Nomes:** `snake_case` para funções/variáveis, `PascalCase`
  para classes. Tabelas e colunas seguem o `schema_v5.sql`.
- **Routers não têm regra de negócio.** Se um router está
  fazendo mais que validar entrada e chamar um service, a
  lógica está no lugar errado.
- **Acesso a dados passa pelo repository.** Services não
  montam `select()` solto; usam repositories. O único service
  autorizado a consultar fora do `BaseRepository` é o
  `AuthService` — porque o login roda antes de existir tenant.
- **Exceções:** lance `AppError`/subclasses (de
  `app/shared/exceptions`). Nunca devolva `HTTPException`
  direto das camadas de domínio/aplicação.
- **Logging:** use `get_logger(__name__)`; logue eventos com
  nome estável (`"task.created"`) e dados como kwargs, não
  interpolados na mensagem.
- **Imports:** primeira parte do arquivo
  `from __future__ import annotations`.

## 6b. Provisionar um workspace

Não há cadastro público. Um workspace nasce por
**provisionamento** — uma operação administrativa que cria,
de forma atômica, o workspace + sua equipe inicial + o
usuário admin.

A regra vive no `WorkspaceProvisioningService`
(`app/modules/workspaces/application/`). O script
`scripts/provision_workspace.py` é só o gatilho — se um dia
o provisionamento virar um painel admin, ele chamará o mesmo
service.

Para provisionar (precisa do banco acessível e com o schema
já criado):

```
docker compose run --rm api-dev python -m scripts.provision_workspace \
    --workspace-name "UniFECAF" \
    --workspace-slug "unifecaf" \
    --team-name "Marketing" \
    --team-slug "marketing" \
    --admin-name "Nome do Admin" \
    --admin-email "admin@unifecaf.com.br"
```

A senha do admin é solicitada interativamente (não fica no
histórico do shell). Depois disso, o admin entra pelo
`POST /api/v1/auth/login` e passa a cadastrar os demais
membros via `POST /api/v1/members`.

## 7. Como adicionar um novo módulo

Exemplo: módulo `projects`.

1. Crie `app/modules/projects/` com `domain/`, `application/`,
   `infrastructure/`, `api/` (cada um com `__init__.py`).
2. Se precisar de queries específicas, crie um
   `ProjectRepository(BaseRepository[Project])` em
   `infrastructure/` — definindo `model = Project` e partindo
   sempre de `_base_select()`.
3. Coloque a regra de negócio num service em `application/`,
   recebendo o Unit of Work.
4. Crie schemas Pydantic (request/response) e o router em
   `api/`. O router só valida e delega ao service.
5. Inclua o router em `app/api/router.py`
   (`api_v1_router.include_router(...)`).
6. Escreva testes. Para regra de negócio, espelhe um vizinho em
   `tests/`; para qualquer coisa que dependa do banco (constraint, índice,
   filtro de tenant), o lugar é `tests/integration/` — ver §4.

O model ORM, se for uma tabela nova, vai em `app/db/models/` e
deve ser exportado em `app/db/models/__init__.py` — senão o
Alembic não o enxerga.
