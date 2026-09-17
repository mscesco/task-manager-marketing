# Plano — Entrega 3 (Modelo de Times)

> Referência: `specs/003-modelo-de-times/spec.md`
> ADRs: `0006`, `0007`, `0008`, `0009`

---

## Pré-condição operacional

Antes do `alembic upgrade head`: **excluir os projetos comuns
existentes** (não há nada ativo — confirmado). A migration adiciona
`project.team_id` obrigatório em projeto comum; projetos comuns com
`team_id` nulo fariam a constraint condicional falhar. Projetos Pessoais
ficam (são isentos).

## Sequência de implementação

A entrega é fatiada em duas fases. A Fase A já entrega valor
(visibilidade por time) sem tocar na escrita; a Fase B adiciona a trava de
edição e reestrutura a autorização.

### Fase A — estrutura e visibilidade (leitura)

1. **Migration `0004_team_scope_and_avulsa`** — defensiva/idempotente:
   - `ALTER TABLE task ALTER COLUMN project_id DROP NOT NULL` (avulsa).
   - `ALTER TABLE project ADD COLUMN team_id` (FK composta
     `(team_id, workspace_id) → team`, nullable na coluna).
   - `CHECK (is_personal OR team_id IS NOT NULL)` no project.
   - Índice em `task.team_id` e `project.team_id` (lente de time).
2. **Models** — `task.project_id` vira `nullable=True`; `Project` ganha
   `team_id`. (ADR 0006, 0007)
3. **Resolver de hierarquia de time** (`app/modules/auth/domain/team_scope.py`)
   — funções puras: dado o conjunto de vínculos `(team_id, role)` do
   usuário + a árvore de times, devolve o conjunto de times **visíveis** e
   o conjunto de times **editáveis**. Árvore resolvida via
   `parent_team_id` (sem LTREE — ADR 0009).
4. **Projects** — `schemas.py` (`ProjectResponse.team_id`), `service`
   (exige `team_id` em projeto comum; rejeita no Pessoal; valida que o
   time existe no workspace).
5. **Tasks — criação** — `CreateTaskCommand.project_id` opcional;
   `team_id` opcional com default = subtime do criador (regras 5–8 da
   spec). Validação: time da tarefa dentro da subárvore do time do projeto.
6. **Tasks — visibilidade** (`task_repository`) — `INNER JOIN` com
   `project` vira `LEFT JOIN`; aplica regra do Pessoal **e** a lente de
   time, nos dois regimes (com projeto / avulsa).
7. **Testes Fase A** — `tests/test_team_scope.py` (resolver, puro) +
   casos de criação/visibilidade em `tests/test_tasks.py`.

### Fase B — autorização por papel-de-time (escrita)

8. **`TenantContext` carrega `(team_id, role)`**
   (`app/core/tenant.py` + `app/modules/auth/api/dependencies.py`) — deixa
   de ser `frozenset` plano. O mapa role→permissão continua. (ADR 0009)
9. **Cheque de escopo nas mutações** (`task_service`) — após carregar a
   tarefa: time editável? Não-visível → 404; visível mas fora do escopo de
   edição → 403. Aplica em `update`, `move`, `archive`, `unarchive`,
   `delete`.
10. **Invariante "um subtime por usuário"** (ADR 0008) — validação no
    fluxo de membros (módulo de users/workspaces) + trigger de apoio.
    Tentativa de segundo subtime → 422.
11. **Testes Fase B** — escopo de edição por papel; 403 vs 404; invariante
    de subtime.

## Arquivos novos

```
alembic/versions/0004_team_scope_and_avulsa.py
app/modules/auth/domain/team_scope.py
specs/003-modelo-de-times/spec.md
specs/003-modelo-de-times/plan.md
docs/adr/0006-task-project-nullable-avulsa.md
docs/adr/0007-project-team-obrigatorio.md
docs/adr/0008-um-subtime-por-usuario.md
docs/adr/0009-papeis-por-time-escopo-hierarquico.md
tests/test_team_scope.py
```

## Arquivos editados

- `app/db/models/operational.py` — `task.project_id` nullable; `Project`
  ganha `team_id`.
- `app/modules/projects/api/schemas.py` — `ProjectResponse.team_id`.
- `app/modules/projects/application/*` — exigir time em projeto comum.
- `app/modules/tasks/application/task_service.py` — default de time, avulsa,
  cheque de escopo nas mutações.
- `app/modules/tasks/infrastructure/task_repository.py` — visibilidade
  (LEFT JOIN + lente de time).
- `app/modules/tasks/api/schemas.py` — `project_id` opcional na criação.
- `app/core/tenant.py` + `app/modules/auth/api/dependencies.py` —
  `TenantContext` com `(team_id, role)`.
- fluxo de membros (users/workspaces) — invariante de subtime.
- `tests/test_tasks.py` — casos novos.

> **Nota de 17/09/2026:** nunca houve módulo `app/modules/projects`. Projeto
> mora em `app/modules/tasks`: `api/projects_router.py`, `api/schemas.py`
> (onde está o `ProjectResponse`) e `application/project_service.py`.

## Como verificar

```
# excluir projetos comuns antes (pré-condição)
docker compose run --rm api-dev alembic upgrade head
docker compose run --rm api-dev pytest
```

Smoke manual via `/docs` (novos passos: criar avulsa, criar projeto com
time, conferir visibilidade como Operator/Supervisor/Manager, conferir
403 vs 404 na edição fora de escopo).

## Definição de pronto

**Fase A:**
- Migration 0004 aplicada.
- Tarefa avulsa criável; projeto comum exige time; Pessoal isento.
- Default de time = subtime do criador.
- Visibilidade por lente de time nos dois regimes; Pessoal preservado.
- Testes do resolver (puros) verdes; sem regressão nos 63 anteriores.

**Fase B:**
- `TenantContext` carrega `(team_id, role)`.
- Trava de edição por escopo (403 visível / 404 não-visível).
- Invariante de um-subtime-por-usuário.
- Testes de escopo verdes.

## Riscos

- Reestruturar `TenantContext` toca todos os leitores de papéis — Fase B
  isolada para conter o blast radius.
- `project_id` nullable rompe premissas da Entrega 2 — revisar com cuidado
  a query de visibilidade e o fluxo de criação; cobrir os dois regimes.
- Assimetria projeto vs. avulsa (regras 12–13 da spec) — confirmada na
  aprovação; documentar no frontend.
- Invariante de subtime sem constraint de banco limpa — validação +
  trigger; testar o caso.
