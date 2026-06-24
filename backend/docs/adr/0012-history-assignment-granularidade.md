# 0012 — Granularidade de history: assignment sim, watcher não

## Status

Accepted

## Contexto

O `task_history` é a timeline auditável e imutável da tarefa (modelo
híbrido, ADR 0004). A Entrega 4 cria quatro eventos candidatos: designar,
desatribuir, observar, deixar de observar. Registrar todos polui a
timeline com ruído de baixa sinalização (quem entrou/saiu da plateia).

## Decisão

**`assigned` e `unassigned` viram evento; watcher add/remove não.**

- Dois `TaskHistoryEventType` novos: `ASSIGNED = "assigned"`,
  `UNASSIGNED = "unassigned"`. Como `task_history.event_type` é
  `String(80)` livre, não há alteração de schema.
- Metadata: `{"user_id": <designado>, "assigned_by": <ator>}` no
  `assigned`; `{"user_id": <removido>}` no `unassigned`.
- Builders puros em `domain/history.py` (`build_assigned_entry`,
  `build_unassigned_entry`), seguindo o padrão dos demais; persistidos via
  `TaskRepository.write_history` no mesmo UoW da mutação.
- No-op idempotente (re-designar quem já é responsável) **não** gera linha.
- Watcher: nenhuma escrita em history.

## Consequências

- A timeline conta a história do *trabalho* (quem ficou responsável,
  quando), não da audiência.
- Reversível: se um dia watcher precisar de auditoria, basta adicionar os
  tipos e builders — sem migration.
