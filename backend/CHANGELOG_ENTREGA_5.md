# Changelog — Entrega 5 (Cobertura de banco + consolidação de trigger)

> Backend `task_manager_backend`. Continua de cima da Entrega 4.
> **Entrega de saúde**, não de feature: nenhuma rota nova. **Tem migration**
> (0005, consolida trigger) e uma **pré-condição sua** (passo 0: gerar
> `schema/schema_v5.sql`). Detalhe completo em `specs/005-cobertura-banco/plan.md`.

## Resumo

Três buracos de saúde tampados:

1. **Cobertura de banco** — 30 testes de integração rodando contra um
   Postgres real (não mock), exercitando o que os testes de lógica pura não
   alcançam: isolamento de tenant, lente de time, LTREE, soft-delete em
   cascata, imutabilidade de history e os caminhos 404/403/422/409 de
   assignment/watchers — inclusive uma fatia fina de HTTP validando o
   mapeamento exceção→status.
2. **Trigger duplicada consolidada** (ADR 0015) — o schema v5 tinha **duas**
   triggers de imutabilidade em `task_history` (a do baseline manual + a da
   migration 0003). A 0005 derruba a duplicata e deixa **uma**.
3. **Schema versionado** (ADR 0016) — o schema deixou de viver só no
   Adminer. Agora há `schema/schema_v5.sql` (dump) versionado, que é o que o
   Postgres de teste consome para nascer idêntico à produção.

## O que mudou (arquivos)

| Arquivo | O quê |
|---------|-------|
| `alembic/versions/0005_consolidate_history_trigger.py` | Migration: `DROP ... IF EXISTS` da trigger/func duplicada do v5; reafirma a do 0003. Defensiva e idempotente. |
| `docs/adr/0014…0016` | Estratégia de teste de integração; consolidação da trigger; schema versionado. |
| `tests/integration/` | `conftest.py` (harness), `factories.py` e 7 arquivos de teste (30 testes). |
| `docker-compose.yml` | + serviço `db-test` (Postgres 16 efêmero, `tmpfs`, schema via `initdb.d`). |
| `pyproject.toml` | + marcador `integration` (permite `-m integration` / `-m "not integration"`). |
| `.env.example` | + nota sobre `TEST_DATABASE_URL` (opcional). |
| `schema/00_test_extensions.sql` | Extensões (`pgcrypto`, `ltree`) aplicadas antes do dump no `db-test`. |

## Migration 0005 — leia antes de aplicar

A 0005 **remove a trigger duplicada** `trg_task_history_immutable` (e a função
`prevent_task_history_mutation`) que o baseline v5 criou em paralelo à do 0003.
Usa `DROP ... IF EXISTS`, então é segura mesmo se você rodar num banco onde a
duplicata já não exista — não quebra. A imutabilidade de `task_history`
continua garantida pela trigger do 0003 (`task_history_no_update_delete`).

## Como rodar os testes

A suíte de **lógica pura** (89 testes) roda sem banco nenhum:

```
docker compose run --rm api-dev pytest -m "not integration"
```

A de **integração** (30 testes) precisa do `db-test` + do schema (passo 0):

```
# passo 0 (uma vez): gerar schema/schema_v5.sql — ver plan.md
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest -m integration
```

Sem `TEST_DATABASE_URL`, a suíte de integração é **pulada** (não falha) — a de
lógica pura roda normalmente. Isolamento por teste é via transação externa +
savepoint: cada teste reverte ao fim, sem sujar o banco.

## O que eu validei aqui (e o que fica com você)

Não estou só te entregando código que "deveria" rodar. Subi um **Postgres 16
real** no meu ambiente e rodei a suíte inteira: **119 testes passando** (89
puros + 30 de integração), lint limpo. Validei na prática o harness
(stamp `0004` → `upgrade head` aplicando a 0005), o isolamento por savepoint,
e a **consolidação da trigger** (um teste conta as triggers de `task_history`
e exige exatamente 1 depois da 0005).

**A ressalva honesta:** rodei contra um schema que **eu** reconstruí
localmente (extensões + enums + `create_all` + as duas triggers), **não** o
seu dump de produção — porque o `schema_v5.sql` é o passo 0 seu. Funcionalmente
é o mesmo (mesmas tabelas, enums, checks, triggers), mas não é byte-a-byte o
seu banco. A **validação final** é com o seu `schema_v5.sql` real no `db-test`.
Se algum teste quebrar lá, é quase certo que seja divergência entre o dump e o
que o ORM espera — me manda o erro que eu ajusto.

## Não entrou (dívida mapeada)

- `GET /me/assignments` (+ índice em `task_assignment(user_id)`) — feature, não
  saúde; fica pra uma próxima.
- Transformar o baseline `0001` (hoje vazio/stamp-only) em DDL completa — a
  ADR 0016 resolve a reprodutibilidade via dump; migrar o DDL pro Alembic é
  non-goal desta entrega.
