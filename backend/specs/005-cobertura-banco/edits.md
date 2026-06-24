# Edições nos arquivos existentes — Entrega 5

## `docker-compose.yml` (+ serviço db-test)

Serviço novo (Postgres descartável, só pra teste; dados em `tmpfs`, some a
cada `down`). As extensões e o schema entram via `initdb.d` na primeira
subida:

```yaml
  # -----------------------------------------------------
  # db-test -- Postgres EFEMERO para a suite de integracao.
  # Nao e o banco de dev/prod (esse e a VPS externa). Dados
  # em tmpfs -- zera a cada subida. Aplica extensoes + dump
  # do schema via initdb.d.
  # -----------------------------------------------------
  db-test:
    image: postgres:16
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: taskmanager_test
    tmpfs:
      - /var/lib/postgresql/data
    volumes:
      - ./schema/00_test_extensions.sql:/docker-entrypoint-initdb.d/00_test_extensions.sql:ro
      - ./schema/schema_v5.sql:/docker-entrypoint-initdb.d/01_schema_v5.sql:ro
    # Sem ports expostos: so a rede interna do compose acessa.
```

> O `api-dev` e o `db-test` ficam na mesma rede default do compose, então
> `db-test:5432` resolve de dentro do `api-dev`. Use
> `docker compose up -d db-test` antes do `pytest -m integration`.

## `pyproject.toml` (+ marker integration)

No bloco `[tool.pytest.ini_options]`, registrar o marcador (evita warning e
permite `-m integration` / `-m "not integration"`):

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
testpaths = ["tests"]
pythonpath = ["."]
markers = [
    "integration: requer Postgres de teste (TEST_DATABASE_URL); pulado sem ele",
]
```

## `.env.example` (+ nota sobre TEST_DATABASE_URL)

Comentário ao fim, deixando claro que é só pra teste e aponta pro db-test:

```
# --- Testes de integracao (opcional) ---
# Apontado para o container db-test do compose. Quando ausente, a suite
# de integracao e PULADA (a de logica pura roda normalmente).
# TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test
```
