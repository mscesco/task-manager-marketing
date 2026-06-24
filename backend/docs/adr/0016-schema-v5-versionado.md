# 0016 — schema_v5.sql versionado como fonte de verdade reproduzível

## Status

Superseded by 0022

> Substituida pela Entrega 8: o baseline 0001 passou a conter o schema
> completo; o dump deixou de ser fonte da verdade. Ver `docs/adr/0022`.

## Contexto

O baseline (migration 0001) é vazio e documenta que o schema v5 foi
aplicado rodando `schema_v5.sql` direto via Adminer. **Esse arquivo nunca
foi versionado.** O Alembic carrega só deltas (0002→) por cima de um schema
que existe apenas na VPS. Consequência: hoje não há como reconstruir o
banco a partir do repositório — e um banco de teste descartável (ADR 0014)
não tem o que aplicar. Sem a VPS, o schema só seria recuperável a partir
dos models do ORM, que não expressam triggers, a função de imutabilidade, o
tipo LTREE, índices parciais nem vários CHECKs.

## Decisão

**Versionar o schema como `schema/schema_v5.sql`, gerado por
`pg_dump --schema-only` da VPS.** Passa a ser a base de qualquer banco novo
(teste agora; staging/CI depois). O harness de teste aplica o dump via
`initdb.d` e sobe os deltas com `alembic upgrade head`.

- O dump é tirado uma vez (estado atual da prod) e re-tirado só quando se
  quiser avançar a base; deltas futuros sobem por cima via `upgrade head`,
  minimizando manutenção.
- A constante `SCHEMA_BASE_REVISION` no harness registra em que revision o
  dump foi tirado.

## Consequências

- Schema deixa de depender exclusivamente da VPS — reprodutível e auditável.
- Custo de manutenção: re-dump ocasional (mitigado por aplicar deltas por
  cima).
- **Evolução futura (non-goal agora):** transformar o baseline 0001 numa
  migration DDL completa, tornando o schema 100% auto-construível pelo
  Alembic sem dump. Maior esforço/risco; adiado conscientemente.
