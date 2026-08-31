# Plano — Entrega 5 (Cobertura de banco + consolidação de trigger)

> Referência: `specs/005-cobertura-banco/spec.md`
> ADRs: `0014`, `0015`, `0016`

---

## Passo 0 — pré-condição SUA (gerar o schema versionado)

Antes de qualquer coisa, e **antes de aplicar a migration 0005**, gere o
dump do schema atual da VPS (estado no revision `0004`, com as duas
triggers ainda presentes).

A string de conexão é a **própria `DATABASE_URL` do seu `.env`**, só
trocando `postgresql+asyncpg://` por `postgresql://` (o `pg_dump` não
entende o driver `+asyncpg`). Com o túnel SSH aberto, rode (PowerShell,
linha única):

```
docker run --rm -v ${PWD}:/work postgres:16 pg_dump --schema-only --no-owner --no-privileges --file=/work/schema/schema_v5.sql "postgresql://app_user:CHANGE_ME@host.docker.internal:15432/task_manager_dev"
```

> Três detalhes que evitam dor de cabeça:
> 1. Use `--file=...` (não `> arquivo`): o redirecionamento do PowerShell
>    grava em UTF-16 e corrompe o dump.
> 2. `host.docker.internal:15432` faz o container enxergar o seu túnel SSH
>    no host (loopback). Ajuste a porta se seu túnel usa outra.
> 3. Confirme com `alembic current` que o banco está em
>    `0004_team_scope_and_avulsa` no momento do dump (é o que o
> harness assume em `SCHEMA_BASE_REVISION`).

Depois disso, a ordem de aplicação na VPS:
1. dump gerado e commitado (acima);
2. aplicar a entrega (código + migration 0005);
3. `docker compose run --rm api-dev alembic upgrade head` → aplica a 0005,
   prod passa a ter **uma** trigger.

## Mapa de arquivos

### Novos
```
schema/schema_v5.sql                         # VOCE gera (passo 0)
schema/00_test_extensions.sql                # extensoes p/ o db-test (initdb)
alembic/versions/0005_consolidate_history_trigger.py
tests/integration/__init__.py
tests/integration/conftest.py                # harness (engine/conn/db/acting_as)
tests/integration/factories.py               # helpers de criacao de linhas
tests/integration/test_tenant_isolation_db.py
tests/integration/test_visibility_db.py
tests/integration/test_hierarchy_db.py
tests/integration/test_soft_delete_db.py
tests/integration/test_history_db.py
tests/integration/test_collaboration_db.py
tests/integration/test_http_status_db.py
specs/005-cobertura-banco/{spec,plan}.md
docs/adr/0014..0016-*.md
```

### Editados
```
docker-compose.yml      # + servico db-test
pyproject.toml          # + marker `integration`
.env.example            # + comentario sobre TEST_DATABASE_URL
```

## Sequência de implementação

1. **`schema/schema_v5.sql`** — passo 0 (você).
2. **Migration `0005`** — consolida a trigger (já escrita no esqueleto).
3. **Compose `db-test`** + **`pyproject` marker** + **`.env.example`**.
4. **`conftest.py`** — harness: bootstrap 1x/sessão (`alembic stamp 0004`
   + `upgrade head` com `DATABASE_URL=TEST_DATABASE_URL`), conexão com
   transação externa, sessão com `create_savepoint`, helper `acting_as`.
5. **`factories.py`** — helpers mínimos (workspace/user/team/membership/
   project/task) inserindo na sessão do teste.
6. **Arquivos de teste** — preencher os corpos do mapa de casos (spec).
7. **Rodar** contra o `db-test` e ajustar.

## Como rodar (PowerShell, linha única)

```
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest -m integration
```

A suíte de lógica pura segue rodando sem banco:
```
docker compose run --rm api-dev pytest -m "not integration"
```

## Pontos de atenção (onde isto pode quebrar)

- **`SCHEMA_BASE_REVISION` tem que casar com o revision do dump.** O dump é
  tirado em `0004`; o harness faz `stamp 0004` + `upgrade head` (aplica
  0005 → 1 trigger). Se você tirar o dump *depois* de aplicar a 0005,
  ajuste a constante pra `0005...` (aí o `upgrade head` vira no-op e o dump
  já vem com 1 trigger — o teste de contagem continua válido).
- **Savepoint vs commit.** `join_transaction_mode="create_savepoint"` faz o
  `UoW.commit()` do código virar SAVEPOINT; o rollback da transação externa
  desfaz tudo. Se algum código fizer DDL (não faz hoje), DDL não é
  transacional e vazaria — atenção se isso mudar.
- **Bootstrap via subprocess `alembic`.** Usa o caminho online do `env.py`
  (asyncpg); não precisa de psycopg2. Roda 1x por sessão de teste.
- **`db-test` é efêmero (`tmpfs`).** Cada `up` começa limpo e reaplica o
  dump via initdb. Não persiste — de propósito.
- **Atualizar o dump** quando uma migration futura mudar o schema base, OU
  manter `SCHEMA_BASE_REVISION` atrás e deixar o `upgrade head` aplicar os
  deltas por cima (preferível — menos manutenção). Documentado no ADR 0016.

## Validação no meu lado (honestidade)

Vou **tentar** subir um Postgres efêmero local pra rodar a suíte de
integração de verdade antes de te entregar. Se a rede/sandbox não deixar,
entrego com o parse limpo + a suíte de lógica pura verde, e você roda a de
integração via `db-test` (o harness é o mesmo).
