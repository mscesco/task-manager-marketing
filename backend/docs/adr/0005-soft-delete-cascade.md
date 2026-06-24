# 0005 — Soft-delete de task cascateia pra subtree

## Status

Accepted

## Contexto

Ao apagar uma task com filhas, duas opções:
1. Não cascatear (filhas ficam órfãs).
2. Cascatear (subtree inteira é soft-deletada).

Decisão de produto: cascatear. Intuição do usuário é "apaguei o
pai → some tudo".

## Decisão

**Soft-deletar uma task cascateia pra toda a subtree.**

Implementação:
```sql
UPDATE task SET deleted_at = NOW()
WHERE path <@ <prefixo_da_task>::ltree
  AND workspace_id = :tenant_id
  AND deleted_at IS NULL
```

Segunda exceção autorizada ao `_base_select` (ADR 0003).

`task_history`:
- 1 linha apenas, na task raiz.
- `event_type = "deleted"`.
- `event_metadata = {"cascade_count": N}` (N = descendentes apagados,
  não inclui a própria).

A resposta HTTP do DELETE inclui `cascade_count`.

## Consequências

**Positivas:** comportamento intuitivo; sem órfãs no banco;
listagens e contadores corretos sem filtros especiais; 1 UPDATE
em massa.

**Negativas:** menos reversível (sem endpoint de restore nesta
entrega); granularidade do history "menos detalhada" (sem linha
individual por filha) — decisão deliberada.

## Alternativas rejeitadas

- Não cascatear: inconsistência visual ("apaguei mas continua").
- Cascade com history individual: ruído na timeline.
- FK `ON DELETE CASCADE`: não dispara em UPDATE (soft-delete é UPDATE).
- `?force=true`: cerimônia desnecessária — frontend confirma.
