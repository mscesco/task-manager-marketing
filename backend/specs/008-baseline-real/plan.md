# Plano 008 — sequência de implementação

> **Status:** Proposed. Stub da `0001` neste pacote (estrutura, sem o DDL
> preenchido). O DDL completo entra **após o OK**.

## Princípio

A nova `0001` não é "inventada": o DDL é **extraído do `schema_v5.sql`** (que
o passo zero provou fiel à produção) e reorganizado na ordem correta de
criação. **Nada de autogenerate** — autogenerate contra banco vivo cospe
lixo e não captura função/trigger/índice GIST.

## Ordem de implementação

1. **Reescrever `alembic/versions/0001_baseline_v5.py`.** `revision` e
   `down_revision` inalterados (`0001_baseline_v5` / `None`) — manter o id
   estável simplifica o re-stamp. `upgrade()` cria, em ordem de dependência:
   1. extensões (`ltree`, `pgcrypto`);
   2. enums (`priority_level`, `project_status`, `task_status`,
      `user_team_role`);
   3. tabelas, na ordem que respeita as FKs (users/workspace/team primeiro,
      depois project, task, collaboration, history);
   4. FKs compostas, CHECKs, índices (inclusive o GIST de ltree);
   5. função `prevent_task_history_mutation` + trigger
      `trg_task_history_immutable`.
   `downgrade()` permanece deliberadamente vazio (reverter baseline =
   destruir o schema; operação manual consciente).

2. **Apagar 0002–0007.** Conferir que `alembic heads` retorna só
   `0001_baseline_v5` e `alembic history` é linear de um nó.

3. **`include_object` em `alembic/env.py`** vira filtro real: retornar
   `False` para a função/trigger de imutabilidade e para as extensões
   (`type_ == "table"` não afeta; tratar `type_` de função/trigger e nomes
   de extensão). Objetivo: o autogenerate da Entrega 9 não emitir `DROP`
   desses objetos.

4. **`docker-compose.yml` (db-test)** para de montar
   `schema/schema_v5.sql` como `01_schema_v5.sql`. Mantém só
   `00_test_extensions.sql` (as extensões precisam existir antes do
   `upgrade`). O banco de teste passa a nascer vazio.

5. **`conftest.py`** passa a rodar `alembic upgrade head` no setup do
   `db-test` (em vez de `stamp SCHEMA_BASE_REVISION`). A constante
   `SCHEMA_BASE_REVISION` é **removida** ou rebaixada a comentário — não há
   mais "base sobre a qual aplicar deltas"; a base é `head`.

6. **`entrypoint.sh`** remove a linha `alembic upgrade head`. Mantém só o
   `exec uvicorn`. (Migration passa a ser passo manual de deploy — ver
   runbook abaixo.)

7. **Harness de validação (Portão 1)** — script novo
   `scripts/validate_baseline.ps1` (roda em container): sobe Postgres vazio →
   `alembic upgrade head` → `pg_dump --schema-only --no-owner
   --no-privileges` → normaliza (remove `\restrict`/`\unrestrict`, `\r`) →
   `diff` contra `schema/schema_v5.sql` normalizado. Exit 0 só com diff
   vazio. É o portão de aprovação E o guardião de regressão das próximas
   entregas.

8. **Docs**: ADR 0022 (supersede 0016); 0016 ganha `Superseded by 0022` no
   topo (sem reescrever o corpo — convenção do projeto). README §5
   reescrito. `.env.example` 5432→15432.

## Runbook do re-stamp em produção (ida à VPS)

> Roda **uma vez**, no deploy desta entrega. Túnel SSH aberto.

```
# 1. onde a produção está (esperado: 0007_password_lifecycle)
docker compose run --rm api-dev alembic current

# 2. dump de segurança ANTES de qualquer stamp (rede de segurança)
#    (mesmo comando do passo zero, para um arquivo datado)

# 3. deploy do código novo (0001 reescrita, 0002-0007 apagadas)

# 4. realinha o carimbo — 0001 agora é o head
docker compose run --rm api-dev alembic stamp 0001_baseline_v5 --purge

# 5. confirma
docker compose run --rm api-dev alembic current   # -> 0001_baseline_v5
docker compose run --rm api-dev alembic upgrade head   # -> no-op
```

**Por que `--purge`:** zera a `alembic_version` antes de gravar, evitando o
risco de duas linhas de versão. **Por que é seguro:** o DDL da 0001 é
idêntico ao schema já em produção (passo zero provou) — stamp é metadado,
não toca tabela.

## Validação local (antes da VPS)

```
# Portão 1 — fidelidade
bash scripts/validate_baseline.ps1        # diff vazio = OK

# Portão 2 — regressão
docker compose rm -sf db-test
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest
# esperado: 146 passed
```

## Risco concentrado (onde isto trava, se travar)

Fidelidade exata do DDL transcrito. Pontos historicamente traiçoeiros:
nomes auto-gerados de constraint/índice pelo Postgres, `DEFAULT` de enums e
de `gen_random_uuid()`, `server_default` vs default de aplicação, ordem de
colunas, `COMMENT ON`. O Portão 1 pega tudo isso — por isso ele roda
**antes** dos testes. Se o diff insistir em divergir num detalhe cosmético
(ex.: ordem de `SET`), normalizar no harness, não maquiar a 0001.

## Smoke manual (após implementar)

| # | Operação | Esperado |
|---|----------|----------|
| 1 | banco vazio + `alembic upgrade head` | sucesso, sem erro de objeto duplicado |
| 2 | `scripts/validate_baseline.ps1` | diff vazio (Portão 1) |
| 3 | suíte completa com db-test reconstruído | 146 passed (Portão 2) |
| 4 | `alembic history` | linha única, raiz = head = 0001 |
| 5 | inserir linha em `task_history` e tentar `UPDATE` | bloqueado pela trigger (imutabilidade preservada no banco reconstruído) |
| 6 | (VPS) runbook do re-stamp | `alembic current` = 0001; `upgrade head` no-op |
