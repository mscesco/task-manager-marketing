# Changelog — Entrega 8: Baseline real (colapso)

> **Renumeração:** esta é a Entrega 8. O Google SSO passa a ser a Entrega 9.
> Decisões em `specs/008-baseline-real/` e `docs/adr/0022`.

## Resumo

A migration `0001` deixou de ser vazia e passou a conter o schema v5
**completo**. As migrations 0002–0007 foram apagadas (colapso). O schema
agora se constrói inteiro por `alembic upgrade head` sobre um banco vazio —
sem dump intermediário, sem `alembic stamp` no caminho normal. Acaba a
dependência do `schema_v5.sql` (e do ritual `regen_schema.ps1`) em toda
entrega que toca o banco.

## Validação (rodada de verdade, não declarada)

Contra **PostgreSQL 16.14** (mesma versão da produção):

- **Portão 1 — fidelidade de schema:** banco vazio → `alembic upgrade head`
  → `pg_dump --schema-only` → **diff vazio** contra `schema/schema_v5.sql`
  (descontado nonce `\restrict`, banner de versão e CRLF). 766 linhas
  idênticas. Validado tanto via `psql -f` quanto via execução
  statement-a-statement (o mecanismo do `op.execute`).
- **Portão 2 — regressão:** **146 passed** (95 lógica pura + 51 integração),
  com o `db-test` reconstruído a partir das migrations (não do dump).

## Mudanças

- `alembic/versions/0001_baseline_v5.py` — reescrita: schema v5 completo
  (2 extensões, 4 enums, 12 tabelas, PKs/UNIQUEs/CHECKs, 27 índices incl.
  GIST de ltree, função `task_history_immutable` + trigger
  `task_history_no_update_delete`, 34 FKs compostas). DDL extraído de
  `schema_v5.sql` e aplicado statement-a-statement. `alembic_version` não é
  criada aqui (o Alembic a gerencia). Raiz e head.
- `alembic/versions/0002..0007_*.py` — **removidas** (colapso).
- `alembic/env.py` — `include_object` agora filtra de verdade a
  função/trigger de imutabilidade e as extensões (antes era stub que
  retornava `True`). Evita `DROP` espúrio no autogenerate da Entrega 9.
- `tests/integration/conftest.py` — bootstrap passou a só `alembic upgrade
  head` (sem `stamp`, sem dump). `SCHEMA_BASE_REVISION` aposentada.
- `docker-compose.yml` — `db-test` não monta mais `schema_v5.sql`; nasce
  vazio (mantém só `00_test_extensions.sql`).
- `scripts/entrypoint.sh` — **removido** o `alembic upgrade head` automático
  no boot. Migration vira passo manual de deploy (ADR 0022).
- `scripts/validate_baseline.ps1` — **novo.** Harness do Portão 1 (Docker):
  sobe Postgres efêmero, `upgrade head`, dump, diff contra a referência.
- `.env.example` — porta `5432` → `15432` (alinha com o túnel SSH de dev).
- `README.md` — seção 5 (Migrations) reescrita; removidos IP/usuário root
  hardcoded (exposição); túnel parametrizado.
- `docs/adr/0016` — marcada `Superseded by 0022`.
- `docs/adr/0022` — nova: a decisão do colapso.

## Pendências deixadas conscientemente (fora do escopo desta entrega)

- README seções 1 e 2 ainda descrevem o repo como "foundation sem features"
  — desatualização ampla, tarefa de doc separada.
- `schema/schema_v5.sql` e `scripts/regen_schema.ps1` mantidos como
  referência/legado; remover de vez após algumas entregas estáveis.
- Higiene de empacotamento (.pyc/.pytest_cache não devem ir no zip) —
  processo de build, não código.
- Divergência de índices entre ORM e banco (duplicados de 0004/0006) não é
  resolvida; autogenerate ainda exige revisão humana.

## Ação obrigatória em produção (ida à VPS)

Produção está carimbada em `0007`. Após o deploy desta entrega, **um**
re-stamp realinha a `alembic_version` (ver `specs/008-baseline-real/plan.md`
→ Runbook):

```
alembic current                              # confirma: 0007_password_lifecycle
# (dump de seguranca do schema ANTES)
alembic stamp 0001_baseline_v5 --purge
alembic current                              # confirma: 0001_baseline_v5
alembic upgrade head                         # no-op
```
