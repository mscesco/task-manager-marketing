# 0002 — Formato de label LTREE no `task.path`

## Status

Accepted

## Contexto

LTREE só aceita labels com caracteres `[A-Za-z0-9_]`. UUID com
hífen é inválido como label. Precisamos de um formato estável,
1:1 com `task.id`.

## Decisão

**Label = `"t" + task.id.hex`.**

Exemplo: task `f81d4fae-7dec-11d0-a765-00a0c91e6bf6` vira label
`tf81d4fae7dec11d0a76500a0c91e6bf6`.

Raiz: `path = <label_dela>`.
Filha: `path = <path_do_pai>.<label_dela>`.

Helper `TaskService._label_for(task_id)` centraliza o cálculo.

## Consequências

**Positivas:** bijeção id ↔ label sem tabela auxiliar; queries
de hierarquia triviais (`path <@ X.path`); ciclo detectável em
uma query.

**Negativas:** 33 chars por nível (limite LTREE é 65535, longe);
path não é legível pra humano (debug usa join com `task.id`).

## Alternativas rejeitadas

- `uuid.hex` puro: convenção desencoraja label começando com dígito.
- Inteiro sequencial: nova coluna, mapping, perde correlação.
- Mapping table: JOIN em toda query de hierarquia.
