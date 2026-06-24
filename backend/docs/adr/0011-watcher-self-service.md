# 0011 — Watcher é self-service; observar terceiros exige permissão

## Status

Accepted

## Contexto

Observador (watcher) e responsável (assignee) têm semânticas diferentes:
responsável vai *fazer*, observador só *acompanha*. Tratar os dois com a
mesma trava (exigir `task.assign` para qualquer watcher) seria pesado
demais — observar é uma ação de baixo risco, sem efeito sobre o trabalho.

## Decisão

**Inscrever-se a si mesmo exige apenas enxergar a tarefa; inscrever
terceiros exige `task.assign` + escopo de edição.**

- `POST /tasks/{id}/watchers` sem `user_id` (ou `user_id == eu`) →
  self-watch: passa só pelo gate de visibilidade (404 se não vê). Sem
  permissão especial. Por isso o POST de watcher **não** usa
  `require_permission` no router — a distinção self/terceiro mora no
  service.
- `user_id != eu` → mesmo gate do assignment (ADR 0010): `task.assign` +
  visível + editável, e as mesmas validações de alcance e pessoal
  monouser.
- Remover segue a mesma lógica: tirar a si mesmo exige só ver; tirar outro
  exige a permissão.

**Watcher não entra na timeline** (ver ADR 0012).

## Consequências

- Quem vê acompanha o que quiser, sem fricção — comportamento esperado de
  ferramentas de tarefa.
- O router de watcher não declara `require_permission`; um teste deve
  garantir que operador-sem-assign consegue se auto-observar (regressão
  fácil se alguém "proteger" a rota no router).
