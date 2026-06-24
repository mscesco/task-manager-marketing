# 0003 — Operações de subtree como exceção autorizada ao `_base_select()`

## Status

Accepted

## Contexto

A regra de ouro é que toda query passa por `_base_select()` (que
injeta `workspace_id = <tenant>` e `deleted_at IS NULL` automaticamente).

Duas operações da Entrega 2 precisam atualizar **uma task e toda
a subtree** em uma única transação:

- **Move:** `UPDATE` em `path` e `depth`.
- **Soft-delete cascateado (ADR 0005):** `UPDATE` em `deleted_at`.

Em ambos, o SQL eficiente usa operadores LTREE (`<@`, `subpath`,
`||`) que não têm bindings ergonômicos no ORM. Carregar em Python
e iterar seria N queries em vez de 1.

## Decisão

**Operações de subtree no módulo `tasks` podem usar SQL textual,
desde que cumpram o protocolo:**

1. Recebem `task: Task` já carregada (passou pelo `_base_select`).
2. Usam `text()` com parâmetros bind.
3. **Adicionam manualmente** `workspace_id = :tenant_id` no WHERE.
4. Têm `tenant = require_tenant()` no início.
5. São documentados como "exceção autorizada" no docstring.

Métodos cobertos:
- `TaskRepository.reparent_subtree`
- `TaskRepository.detect_cycle`
- `TaskRepository.soft_delete_subtree`

Qualquer nova exceção (no módulo ou fora) requer ADR explícita.

## Consequências

**Positivas:** atomicidade; performance com índice GIST.

**Negativas:** predicado de tenant é manual (risco de esquecer);
mitigação via docstring, code review, e RLS no PostgreSQL como
safety-net futuro.

## Alternativas rejeitadas

- Reparent via Python: N queries, lock complicado.
- Proibir subtree: limita demais.
- View materializada: overkill nesta escala.
