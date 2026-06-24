# Entrega 5 — Cobertura de banco + consolidação de trigger (saúde)

> **Status:** Accepted
> **Tipo:** dívida técnica / saúde do código (não é feature de produto)
> **Módulos afetados:** `tests/` (novo `tests/integration/`), `alembic/`,
> `schema/` (novo), `docker-compose.yml`, `pyproject.toml`
> **ADRs:** `0014` (estratégia de teste de integração), `0015`
> (consolidação da trigger), `0016` (schema versionado).

---

## O problema que esta entrega resolve

Desde a Entrega 2, **toda a camada de banco é validada só por smoke
manual**. Smoke não é regressão: ninguém vai revalidar à mão os 404/409/422
do assignment daqui a três entregas. Os invariantes mais perigosos do
sistema — isolamento de tenant, privacidade do pessoal, lente de time,
cascata de soft-delete, hierarquia LTREE, imutabilidade do histórico —
estão sem rede. Um refactor pode quebrar a privacidade do pessoal e nenhum
teste pega.

Ao montar o harness, apareceu uma dívida ainda mais grave: **o schema não
é reproduzível a partir do repositório.** O `schema_v5.sql` é citado como
fonte de verdade no baseline, mas não está versionado; o Alembic só carrega
deltas por cima de um schema aplicado à mão na VPS. Hoje, sem a VPS, não dá
pra reconstruir o banco. Isso bloqueia a própria cobertura.

E há a dívida menor já registrada: **duas triggers de imutabilidade
duplicadas** em `task_history`.

## O que esta entrega entrega

1. **Schema versionado e reprodutível** (`schema/schema_v5.sql`), gerado
   uma vez por `pg_dump --schema-only` da VPS. Passa a ser a base de
   qualquer banco novo (teste hoje; staging/CI amanhã). (ADR 0016)
2. **Trigger de imutabilidade consolidada** numa migration defensiva
   (`0005`): remove a duplicata do v5, mantém a versionada (0003). (ADR 0015)
3. **Suíte de testes de integração** contra Postgres real, num container
   descartável, cobrindo os invariantes acumulados das Entregas 1–4 que
   hoje só o smoke validava. (ADR 0014)

## Escopo da cobertura (must-have)

Nível de **serviço** (núcleo) — usa `tenant_scope` pra setar o contexto e
exercita o SQL real:

- **Isolamento de tenant**: `_base_select` filtra por workspace; `add()`
  rejeita workspace alheio; soft-deletado some por padrão.
- **Visibilidade de tasks** (query *e* gate concordando): pessoal
  dono×alheio (404); projeto comum visível pelo time do projeto; avulsa
  pela lente do time; `created_by` vê fora da lente mas **não** edita
  (ADR 0013); admin vê tudo menos pessoal alheio.
- **Hierarquia LTREE**: path/depth na criação (raiz e filha); move/reparent
  reescrevendo a subtree; troca de projeto levando a subtree; ciclo e
  auto-pai → 409.
- **Soft-delete cascateado**: cascata na subtree; `cascade_count` correto;
  apagada some; 1 linha `deleted` com `cascade_count` no metadata.
- **task_history**: eventos gravados nas mutações; **imutabilidade**
  (UPDATE/DELETE levantam exceção); **exatamente uma** trigger de
  imutabilidade após `upgrade head` — valida a consolidação (ADR 0015).
- **Assignment/Watchers (Entrega 4)**: cria linha + `assigned`;
  idempotência (no-op sem novo history); `unassigned` + 404 na remoção;
  pessoal monouser (409); alcance do designado (422); operador designando
  no quadro geral; **assignment não concede edição** (403 persiste);
  self-watch sem permissão e sem history; terceiro sem `task.assign` → 403.

Fatia **fina de HTTP** (complementar) — só o mapeamento exceção→status do
`errors.py`, que o nível de serviço não enxerga: 201/200 no POST de
assignee, 422, 404, 403.

## Non-goals

- Pipeline de CI (GitHub Actions) — o harness fica CI-ready, mas o
  workflow em si fica pra depois.
- Cobertura HTTP completa (todos os endpoints) — só a fatia de status.
- Testar módulos `auth`/`workspaces`/`users` no banco — foco no módulo
  `tasks`, onde está o risco acumulado.
- Transformar o baseline 0001 numa migration DDL completa (auto-construção
  do schema sem dump) — registrado como evolução futura no ADR 0016.

## Definição de pronto

- [ ] `schema/schema_v5.sql` versionado (gerado pela Camila, passo 0).
- [ ] Migration `0005` aplicada na VPS; prod com **uma** trigger.
- [ ] `db-test` no compose; `pytest -m integration` sobe schema e roda.
- [ ] Marcador `integration`; suíte de lógica pura segue rodando sem DB.
- [ ] Cobertura must-have verde contra o `db-test`.
- [ ] Sem regressão na suíte de lógica pura (89 testes).
