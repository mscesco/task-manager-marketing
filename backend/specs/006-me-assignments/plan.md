# Plano 006 — sequência de implementação

> Esqueleto entregue para aprovação. Stubs marcados `NotImplementedError`
> ("Entrega 6") são preenchidos só após o OK.

## Ordem

1. **Migration `0006`** (já completa neste pacote): índices
   `(workspace_id, user_id)` em `task_assignment` e `task_watcher`.
   Idempotente.

2. **Schemas** (`api/schemas.py`): `MyTaskItem(TaskResponse)` com
   `relations: list[str]` + `out_of_scope: bool`; `MyAssignmentsResponse`
   (paginada: `items/total/page/size`). Enum `MeRelation` para o query param.

3. **Repositório** (`infrastructure/task_repository.py`): método
   `list_my_relations(params, relations) -> Page[tuple[Task, Project|None, set[str]]]`.
   Parte do `_base_select`; mantém camada (A) pessoal-alheio; **omite** (B)
   lente; recorta por `OR` das relações; computa os 3 vínculos sempre para
   preencher `relations`. Traz o `Project` no select (para o `out_of_scope`).

4. **Service** (`application/me_service.py`, novo): `MeService.list_assignments`
   — chama o repo, resolve a lente atual (`team_scope.visible_team_ids`) e
   marca `out_of_scope = not task_visible(...)` por item, reusando o guard puro.
   Ordena: in-scope primeiro, `updated_at DESC`.

5. **Router** (`api/me_router.py`): `GET /me/assignments` com `relation`
   (repetível, default três), `page`, `size`. 422 em valor inválido (validação
   do enum no FastAPI já entrega isso).

6. **Testes de integração** (`tests/integration/test_me_assignments_db.py`):
   ver lista de casos no stub. Reusa o harness da Entrega 5 (sem schema novo
   além da 0006).

## Pré-condições do harness (atenção, dívida da ADR 0016)

O `db-test` nasce do seu `schema/schema_v5.sql` e o `conftest` faz
`stamp SCHEMA_BASE_REVISION` + `upgrade head`. Com a 0006, o `upgrade head`
passa a aplicar `0005` **e** `0006`. Como ambas são idempotentes, funciona
independente de o dump estar em `0004`, `0005` ou `0006`.

> **Regra que vale lembrar:** quando você regenerar o dump após aplicar
> migrations na VPS, o `SCHEMA_BASE_REVISION` no `conftest` deve ser a head
> daquele dump. Hoje está em `0004`. Se o seu banco de produção já estiver em
> `0005`, regenere o dump e suba `SCHEMA_BASE_REVISION` para
> `0005_consolidate_history_trigger` — senão o `upgrade` tenta reaplicar o que
> já existe (a idempotência segura, mas o ideal é manter dump e revisão em
> sincronia).

## Smoke manual (após implementar)

| # | Operação | Esperado |
|---|----------|----------|
| 1 | `GET /me/assignments` (sem filtro) | 200, tasks onde sou assignee/creator/watcher |
| 2 | `GET /me/assignments?relation=assignee` | só onde sou responsável |
| 3 | admin designa B (subtime que não vejo) a mim; `GET /me/assignments` | a task vem com `out_of_scope=true` |
| 4 | `GET /me/assignments?relation=xpto` | 422 |
| 5 | task que criei E observo | 1 item, `relations` com `creator` e `watcher` |
