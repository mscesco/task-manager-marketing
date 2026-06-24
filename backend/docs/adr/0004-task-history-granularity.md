# 0004 — Granularidade do `task_history`: modelo híbrido

## Status

Accepted

## Contexto

`task_history` tem colunas `event_type`, `field_name`, `old_value`,
`new_value`, `metadata` (atributo Python `event_metadata`). A pergunta
é: granularidade por operação, por campo, ou híbrida?

## Decisão

**Híbrida:**

| Operação        | event_type        | field_name | old/new_value         | metadata                            |
|-----------------|-------------------|------------|-----------------------|-------------------------------------|
| Create          | `created`         | NULL       | NULL                  | `{title, project_id, parent_task_id}` |
| Update 1 campo  | `updated`         | nome       | antigo / novo         | NULL                                |
| Update N campos | `updated` × N     | nome       | antigo / novo         | NULL (1 linha por campo)            |
| Update status   | `status_changed`  | `"status"` | antigo / novo         | `{completed_at_changed}`            |
| Move            | `moved`           | NULL       | NULL                  | `{old/new project_id, old/new parent}` |
| Archive         | `archived`        | NULL       | NULL                  | NULL                                |
| Unarchive       | `unarchived`      | NULL       | NULL                  | NULL                                |
| Soft-delete     | `deleted`         | NULL       | NULL                  | `{cascade_count}` (ADR 0005)        |

Princípios:
- Status sempre é evento dedicado.
- Updates sem mudança real → 0 linhas.
- Atômico no mesmo UoW.
- Cascade de delete: 1 linha apenas pra raiz.

## Consequências

**Positivas:** timeline natural ("o que aconteceu"); busca por
event_type trivial; diff campo-a-campo para auditoria.

**Negativas:** PATCH pesado gera N linhas (ok no uso normal);
frontend precisa entender 2 estilos.

## Alternativas rejeitadas

- Por operação: `field_name`/`old`/`new` viram quase sempre NULL.
- Puramente por campo: forçaria create/move em formato esquisito.
