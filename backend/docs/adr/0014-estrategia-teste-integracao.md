# 0014 — Estratégia de testes de integração (banco real)

## Status

Accepted

## Contexto

Desde a Entrega 2, a camada de banco (filtro de tenant, soft-delete,
hierarquia LTREE, queries de visibilidade, triggers, caminhos de erro do
assignment) só foi validada por smoke manual. Smoke não é regressão: não
roda sozinho, não trava merge, e some da memória. Precisamos de testes
automatizados contra Postgres real, repetíveis e isolados — sem tocar o
banco de produção da VPS.

## Decisão

**Container Postgres descartável + isolamento por transação revertida +
foco no nível de serviço.**

- **Banco:** serviço `db-test` no compose (`postgres:16`, dados em `tmpfs`,
  `ltree`+`pgcrypto`). É teste-only e efêmero — não fere a regra "sem
  Postgres local pra dev" (essa era sobre paridade do banco de
  desenvolvimento com a VPS; banco de teste é outra coisa).
- **Schema:** montado a partir de `schema/schema_v5.sql` (ADR 0016) via
  `initdb.d`; o harness faz `alembic stamp <base>` + `upgrade head` 1x por
  sessão (aplica 0005+ por cima). Caminho online do `env.py` (asyncpg), sem
  psycopg2.
- **Isolamento:** conexão com transação externa + `AsyncSession(...,
  join_transaction_mode="create_savepoint")`. O `UoW.commit()` do código
  vira SAVEPOINT; o rollback externo desfaz tudo ao fim de cada teste. Sem
  truncate, sem vazamento entre testes.
- **Nível:** **serviço** como núcleo (usa `tenant_scope` pra setar o
  contexto e exercita o SQL real) — é onde mora o risco não coberto. Uma
  **fatia fina de HTTP** (via httpx ASGITransport + override de deps) cobre
  só o mapeamento exceção→status do `errors.py`.
- **Marcador `integration`:** a suíte pura roda em qualquer lugar; a de
  integração é pulada sem `TEST_DATABASE_URL`.

## Consequências

- Cobertura repetível e CI-ready. O workflow de CI em si fica pra depois.
- Custo: container de teste + o passo de dump (ADR 0016).
- Escolhemos serviço sobre E2E completo: ataca a lacuna real (SQL/invariantes)
  com menos cerimônia que subir o app inteiro por teste.
