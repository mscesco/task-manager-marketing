# Entrega 10 — Correção: serialização de `completed_at` (MissingGreenlet)

> **Status:** Accepted (corrigido, suíte verde: 149 passed)
> **Módulo afetado:** `app/modules/tasks/application/task_service.py`
> **ADR relacionado:** `docs/adr/0023-completed-at-datetime-aware.md`
> **Origem:** descoberto na E9-escrita (front) ao concluir tarefa pela UI.

---

## O que esta entrega entrega (em linguagem de produto)

Concluir uma tarefa (e tirar de concluída) volta a funcionar. Antes desta
correção, mudar o status de uma tarefa **para** ou **de** `COMPLETED`
devolvia **500** — a tela do usuário mostrava erro toda vez que ele
concluía algo, que é a ação mais comum num gestor de tarefas.

## O bug

Em `create` e `update`, ao entrar em `COMPLETED` o código fazia
`task.completed_at = func.now()`. `func.now()` é uma **expressão SQL não
resolvida**: o `flush` manda o UPDATE pro banco, mas o objeto Python ainda
carrega a *expressão*, não o timestamp. Quando o router serializa a
resposta (`TaskResponse.model_validate(task)`), o Pydantic lê
`.completed_at` e o SQLAlchemy async tenta resolver o valor **fora do
contexto greenlet** -> `MissingGreenlet` -> 500.

Atingia três caminhos: PATCH de status para `COMPLETED`, PATCH saindo de
`COMPLETED`, e `create` de task já `COMPLETED`. O drag pra coluna
"Concluído" no front passa pelo mesmo `update`.

### Por que passou batido até agora

A lógica do `completed_at` **era** testada — mas só no nível **puro**
(`test_tasks.py`, via `_FakeTask` stub), que verifica o flag do history
(`completed_at_changed`) e nunca serializa contra banco async. O
`MissingGreenlet` só existe no caminho async real. Faltava **teste de
integração** cobrindo a serialização. Gap de cobertura, não de lógica.

## Escopo

- Trocar os dois `func.now()` (em `create` e `update`) por
  `datetime.now(timezone.utc)` — valor concreto, sem ida tardia ao banco.
- Ajustar o import (`from datetime import date, datetime, timezone`).
- Remover o import morto `from sqlalchemy import func` se não houver outro
  uso no arquivo.
- Teste de integração `test_completed_at_db.py` cobrindo os três caminhos.

## Non-goals

- Mexer na lógica de `completed_at` (quando setar/limpar) — está correta;
  só a forma de obter o timestamp muda.
- Mudar outros usos de `func.now()` em outros módulos (fora de escopo;
  avaliar caso a caso se aparecerem).

## Decisão

Ver ADR 0023. Resumo: **`datetime.now(timezone.utc)`** em vez de
`func.now()` ou `session.refresh()`. Valor já materializado, aware/UTC
(casa com `timestamp with time zone` do schema), sem round-trip extra.

## Critérios de aceite

- [x] PATCH status -> COMPLETED → 200, `completed_at` não-nulo.
- [x] PATCH saindo de COMPLETED → 200, `completed_at` nulo.
- [x] POST task já COMPLETED → 201, `completed_at` não-nulo.
- [x] Suíte completa verde: **149 passed** (146 + 3 novos), zero regressão.
- [x] App: concluir/desconcluir pela UI sem 500.

## Riscos

- **Diferença de relógio app vs banco.** `datetime.now(timezone.utc)` usa
  o relógio do app, não o `now()` do Postgres. Para um campo de auditoria,
  a diferença (ms) é irrelevante. Se algum dia exigir o tempo do banco com
  precisão, a alternativa é `func.now()` + `await session.refresh(task,
  ["completed_at"])` — descartada agora por custo/benefício (ADR 0023).
