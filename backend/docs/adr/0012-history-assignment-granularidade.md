# 0012 — Granularidade de history: assignment sim, watcher não

## Status

Accepted — **revogada em parte pela Spec 053 (17/09/2026)**: a parte
de watcher.

> **Nota de 17/09/2026:** entrar e sair como seguidor ("watcher" no código)
> passou a gravar histórico, sempre — decisão D13 da Spec 053. São os eventos
> `watched` e `unwatched`, com `metadata = {target_user_id, by_self, reason}`
> e `reason` em `manual`, `created_with` ou `lost_access`. Foi o caminho que
> esta ADR previu na última linha: tipos e builders novos, sem migration. A
> parte de `assigned`/`unassigned` continua valendo como está.

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
