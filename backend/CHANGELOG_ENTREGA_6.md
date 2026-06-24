# Changelog — Entrega 6 (`GET /me/assignments`)

> Backend `task_manager_backend`. Continua de cima da Entrega 5.
> **Tem migration** (0006, índices). Sem pré-condição manual sua além das
> que já valiam para os testes de integração (db-test + dump).

## Resumo

Primeira tela de "minhas tarefas": um endpoint que devolve as tasks onde você é
**assignee**, **creator** ou **watcher**, com filtro por relação e a marcação
`out_of_scope` para o caso em que você está ligado a uma task que sua lente de
time atual não mostra (mudou de equipe, admin te designou, task foi movida).

```
GET /api/v1/me/assignments?relation=assignee&relation=creator&relation=watcher&page=1&size=20
```

`relation` é repetível; ausente = as três. Cada item traz **todas** as relações
que você tem com a task (`relations`) e o flag `out_of_scope`. Só leitura.

## O que mudou (arquivos)

| Arquivo | O quê |
|---------|-------|
| `alembic/versions/0006_me_assignments_indexes.py` | Índices `(workspace_id, user_id)` em `task_assignment` e `task_watcher`. Idempotente. |
| `app/modules/tasks/api/me_router.py` | + rota `GET /me/assignments`. |
| `app/modules/tasks/api/schemas.py` | + `MeRelation`, `MyTaskItem`, `MyAssignmentsResponse`. |
| `app/modules/tasks/application/me_service.py` | **novo** — `MeService.list_assignments`: marca `out_of_scope` via o guard puro `task_visible`. |
| `app/modules/tasks/infrastructure/task_repository.py` | + `list_my_relations`: recorte por relação, mantém pessoal-alheio (A), omite a lente (B). |
| `docs/adr/0017`, `0018` | out_of_scope sinalizado; query que pula a lente. |
| `specs/006-me-assignments/` | spec + plano + edits. |
| `tests/integration/test_me_assignments_db.py` | 13 testes (relações, filtro, out_of_scope, ordenação, HTTP). |
| `tests/integration/factories.py` | + `make_assignment`, `make_watcher`. |

## Decisão central — `out_of_scope` (ADR 0017)

O assign exige alcance no momento em que acontece (Entrega 4), mas o vínculo é
uma foto e o time muda depois. Quando diverge, a task **aparece** marcada com
`out_of_scope: true` em vez de sumir (esconder) ou aparecer crua (vazar time).
O front decide como apresentar.

## ⚠️ Inconsistência descoberta — precisa da sua decisão

Achei isto rodando os testes, e é uma decisão de produto, não um bug a esconder:

Uma task `out_of_scope` **aparece** em `GET /me/assignments`, mas se você tentar
abri-la/editá-la pelo endpoint de task (`GET`/`PATCH /tasks/{id}`) recebe
**404** — porque esses endpoints são escopados pela lente de time, e o
assignment **não** alarga a lente neles. Ou seja: a tarefa "aparece na sua
lista" mas "não existe" pelo endpoint de detalhe.

Isso é coerente com o modelo de privacidade (assignment não concede edição,
ADR 0013), mas é UX estranha: você vê na lista e leva 404 ao abrir. Duas saídas:

1. **Aceitar como está** (o que está entregue). `/me/assignments` é uma leitura
   especial; o detalhe/edição seguem presos à lente. O front trata o
   `out_of_scope` como "informativo, não abrível".
2. **Estender a leitura** (entrega futura): fazer `GET /tasks/{id}` também
   honrar "sou assignee" como visibilidade (igual ao `created_by` da ADR 0013),
   mantendo a **edição** presa à lente (403, não 404). Mais coerente, mas mexe
   no caminho de leitura mais quente e precisa de testes próprios — por isso
   **não** entrou aqui sem o seu OK.

Minha recomendação: **opção 2**, numa entrega curta dedicada. Mas é sua chamada.

## Testes

132 testes passando (89 lógica pura + 43 integração: 30 da E5 + 13 desta). Lint
limpo nos arquivos da E6 (o único aviso restante, `UP038` em `history.py`, é
pré-existente e foi conscientemente deixado desde a Entrega 5).

Como na E5, rodei a suíte completa contra um Postgres 16 real no meu ambiente,
com schema reconstruído localmente — **não** o seu dump de produção. A
validação final é com o seu `schema_v5.sql` no `db-test`:

```
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest -m integration
```

## Migration 0006

Índices **compostos** `(workspace_id, user_id)` (não só `user_id`): toda query é
escopada por workspace, então o composto resolve tenant + user de uma vez —
exatamente o acesso desta tela. `CREATE INDEX IF NOT EXISTS` (idempotente).

## Sincronia dump ↔ migrations (dívida da ADR 0016)

Com a 0006, o `upgrade head` do harness passa a aplicar 0005 **e** 0006 sobre o
dump. Como ambas são idempotentes, funciona com o dump em 0004, 0005 ou 0006.
**Regra:** ao regenerar o dump após aplicar migrations na VPS, atualize
`SCHEMA_BASE_REVISION` no `conftest` para a head daquele dump.
