# Plan 026 — Coluna "Aprovação Externa"

Pequena. **3 fatias, todas concluídas.** O volume ficou nos testes, não no
código: o inventário real foi 1 linha no enum, 1 migration, 1 rename +
1 entrada no `status.ts`. Nenhum arquivo de regra de negócio foi tocado — e
isso é afirmação **provada** pela Fatia 2, não suposição.

> **Ordem de deploy (spec, seção própria) — MIGRATION ANTES do código.**
> Exceção declarada à regra do DEPLOY.md. Por isso a Fatia 1 vem primeiro e é
> auto-suficiente: sobe para produção **sem** as Fatias 2 e 3 sem quebrar nada.

---

## Fatia 1 — Enum + migration (backend, auto-suficiente) ✅

Arquivos:
- `backend/app/db/models/enums.py` — `EXTERNAL_APPROVAL = "EXTERNAL_APPROVAL"`
  em `TaskStatus`, entre `IN_REVIEW` e `BLOCKED`.
- `backend/alembic/versions/0006_external_approval_status.py` (novo)
  - `down_revision = "0005_solicitations"`.
  - `upgrade()`: dentro de `op.get_context().autocommit_block()`,
    `ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'EXTERNAL_APPROVAL'
    AFTER 'IN_REVIEW';`
    - `autocommit_block` obrigatório (`env.py:117` roda em transação).
    - `IF NOT EXISTS` garante reexecutabilidade.
  - `downgrade()`: **no-op documentado.** Postgres não remove valor de enum;
    desfazer exigiria recriar o tipo e reescrever as colunas — migration
    própria, pensada e testada, nunca um rollback.

**Verificado (Postgres 16 real):** cadeia sobe do vazio até `0006`;
`alembic current` = `0006_external_approval_status (head)`; valor no enum com
`enumsortorder` **4.5** (entre `IN_REVIEW`=4 e `BLOCKED`=5); segundo
`upgrade head` não falha.
**Aplicado no dev da Camila em 2026-07-22** (`0006 (head)` confirmado).

---

## Fatia 2 — Testes de integração (backend) ✅

Arquivo: `backend/tests/integration/test_external_approval_status_db.py` (novo)

Prova que o valor novo se comporta como "tarefa aberta" nos 4 pontos que a
varredura identificou. Sem estes testes, a spec seria uma afirmação.

1. **Round-trip** — `PATCH` com `status="EXTERNAL_APPROVAL"` persiste e lê de
   volta (cliente ASGI + banco).
2. **Sweep NÃO arquiva** — `is_stale_terminal` com o status novo e data de 1
   ano atrás devolve `False`. Teste **puro** de propósito: a regra é função
   pura; testá-la na origem é mais forte e rápido que montar o sweep inteiro.
3. **Cascata engole (D6)** — mãe com filho em `EXTERNAL_APPROVAL`; concluir a
   mãe deixa o filho `COMPLETED` com `completed_at`.
4. **Prazo dispara (D5)** — task no status novo com `due_date` vencido gera
   `TASK_OVERDUE` (`overdue_count == 1`).

> **Armadilha do §8 do handoff:** nenhum destes usa `monkeypatch`/espião de
> símbolo — todos exercitam o caminho real. Um espião passaria verde sem
> provar nada.

**Verificado:** 4 testes passam isolados; **suíte completa 379 passed**
(375 + 4), zero regressão — reproduzido no ambiente do assistente **e**
confirmado no ambiente da Camila.

> Nota de ambiente (não afeta o projeto): rodar a suíte fora do pin exige
> `bcrypt==4.0.1`. O `pyproject.toml` já fixa isso; versões 4.1+/5.x quebram
> o `passlib 1.7.4` na coleta dos testes.

---

## Fatia 3 — Front (uma linha de dados) ✅

Arquivo: `web/lib/status.ts`
- Rótulo de `IN_REVIEW`: `"Em Aprovação"` → `"Aprovação Interna"` (D2).
  Chave inalterada.
- Entrada nova entre `IN_REVIEW` e `COMPLETED` (D3):
  `{ key: "EXTERNAL_APPROVAL", label: "Aprovação Externa", color: "#8b5cf6" }`.
- Comentário do arquivo atualizado (7 → 8 status) com o porquê do rename.
- **Ordem existente preservada** — `COMPLETED`/`CANCELLED` antes de `BLOCKED`
  é a decisão E9; nada foi reordenado.

Nenhum outro arquivo mudou. `Board`, `TaskModal`, `TaskDetail`,
`minhas-tarefas` e `arquivadas` derivam de `STATUSES` — a fatia **conferiu**
isso, não alterou.

**Verificado:** varredura de status hardcoded no front (só menções a
`"COMPLETED"`, que são lógica de conclusão, e o `PROJECT_STATUS`, outro
domínio); `npx tsc --noEmit` 0 erros; `npx next build` limpo, **15 rotas**.

**Não verificável aqui:** front sem runner de teste. Teste manual no dev —
quadro com 8 colunas, arrastar card para Aprovação Externa e recarregar,
conferir rótulo novo no modal e no detalhe.

---

## Deploy

Estado em 2026-07-22: **migration já aplicada no dev** (`0006 (head)`).
Produção estava em `0005_solicitations`.

1. Pré-voo do DEPLOY.md: conferir `DATABASE_URL` (dev e prod na MESMA
   instância), `pg_dump`, taguear as imagens atuais.
2. `alembic upgrade head` — aplica só o `0006`; seguro com código velho no ar.
3. `build` do web + `up -d`.
4. Smoke em produção: arrastar um card para Aprovação Externa e recarregar.

## Pendências que esta spec deixou anotadas (não são dela)
- Contraste WCAG das cores de status (achado aberto pré-existente).
- Front sem runner de teste.
- Se as 8 colunas incomodarem no uso real, rediscutir a E9 (candidata óbvia a
  sair do quadro: `CANCELLED`).
