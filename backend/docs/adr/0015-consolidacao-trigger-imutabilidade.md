# 0015 — Consolidação das triggers de imutabilidade de task_history

## Status

Accepted

## Contexto

Existem duas triggers fazendo a mesma coisa (bloquear UPDATE/DELETE em
`task_history`):

- `trg_task_history_immutable` / função `prevent_task_history_mutation` —
  do schema v5 aplicado via Adminer (não versionado em migration).
- `task_history_no_update_delete` / função `task_history_immutable` —
  criada pela migration 0003 (versionada).

Duas triggers redundantes confundem (qual é a fonte de verdade?), dobram a
manutenção e a primeira não está versionada.

## Decisão

**Manter a versionada (0003) e remover a duplicata do v5, numa migration
defensiva (`0005`).**

- `DROP TRIGGER IF EXISTS trg_task_history_immutable` +
  `DROP FUNCTION IF EXISTS prevent_task_history_mutation()` (sem CASCADE —
  queremos falhar alto se algo ainda depender da função).
- Reafirma (idempotente) a trigger/função da 0003.
- Tudo `IF EXISTS`/`OR REPLACE`: roda sem erro em qualquer estado do banco.
- Um teste de integração consulta `pg_trigger` e garante **uma** trigger
  BEFORE UPDATE/DELETE em `task_history` após `upgrade head`, além de
  verificar que UPDATE/DELETE diretos levantam exceção.

## Consequências

- Uma fonte de verdade versionada pra imutabilidade.
- `downgrade` é no-op (não recriamos a duplicata; imutabilidade não deve
  ser revertida por engano).
