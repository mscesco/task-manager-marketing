# Spec 008 — Baseline real: a 0001 vira a fonte da verdade do schema

> **Status:** Proposed
> Fonte da verdade desta entrega. Implementação segue `plan.md`.
> **Renumeração:** esta entrega assume o slot 008. O Google SSO, antes
> chamado de "E8" nas conversas, passa a ser a **Entrega 9**. Motivo no
> ADR 0022 e em "Por que antes do SSO".

## Problema

A migration `0001_baseline_v5` é vazia (`pass`). O schema atual existe de
forma executável **apenas** no dump `schema/schema_v5.sql`. As migrations
0002–0007 carregam DDL real, mas **não rodam em nenhum ambiente novo**: o
`db-test` carrega o dump via `initdb.d` e depois faz `alembic stamp` — ele
carimba a versão, não aplica os deltas. Produção foi construída aplicando
0002→0007 ao longo do tempo; isso nunca mais acontece.

Consequência operacional: o dump é *load-bearing*. Toda entrega que toca o
banco força regenerar o dump da produção (ritual do `regen_schema.ps1`,
ADR 0016) e ressincronizar `SCHEMA_BASE_REVISION`. Consumiu ~15 mensagens
na E7 e reaparece como atrito em **toda** entrega com migration. Não é
imposto de processo — é imposto de arquitetura, e some quando a 0001 deixa
de ser vazia.

Pré-condição já satisfeita (passo zero executado): o dump fresco da
produção **bate byte a byte** com o `schema_v5.sql` versionado (descontado
o nonce do pg_dump 16 e CRLF). **Não há DDL aplicado na mão na VPS para
reconciliar.** A matéria-prima da reescrita está limpa.

## Por que antes do SSO (não como apêndice da ida à VPS)

- Reescrita é ~90% trabalho local: reescrever a 0001, validar contra um
  Postgres descartável. **Não exige tocar a VPS para escrever nem validar.**
  O único toque em produção é um `alembic stamp` de uma linha.
- O SSO está bloqueado no Google Cloud Console (dependência externa da
  Camila). Esse tempo de calendário tem custo de oportunidade zero — é onde
  o baseline cabe sem competir por janela.
- O SSO é o primeiro a colher o benefício: nasce com `upgrade head` limpo,
  sem dump.

## Decisão de desenho (resumo; detalhes no ADR 0022)

- **Colapsar a história.** A `0001` reescrita reproduz o **estado atual
  inteiro**. As migrations **0002–0007 são apagadas**. A `0001` vira,
  simultaneamente, raiz (`down_revision = None`) e head.
- **DDL inline** via `op.execute()` (não um `.sql` externo lido em runtime).
  Objetivo: a `0001` ser fonte da verdade *autocontida*; arquivo externo
  reintroduz a dependência que estamos matando. Trade-off: migration longa.
  Aceito conscientemente.
- **A `0001` cria tudo**, inclusive o que hoje mora fora dos models ORM:
  extensões `ltree` e `pgcrypto`, os enums, as 12 tabelas, FKs compostas,
  CHECKs, índice GIST de ltree, a função `task_history_immutable` e a
  trigger de imutabilidade de `task_history`. Sem isso, banco reconstruído
  nasce **sem a imutabilidade do histórico** — garantia de negócio.
- **`db-test` se constrói das próprias migrations.** Para de carregar
  `schema_v5.sql` via `initdb.d`; passa a rodar `alembic upgrade head` sobre
  Postgres vazio (extensões garantidas por `00_test_extensions.sql`, que
  permanece). É o ganho central: acaba a dependência do dump por entrega.
- **`schema_v5.sql` é rebaixado a referência congelada.** Não some agora;
  vira o oráculo do harness de validação e some de vez quando a validação
  estiver verde e estável.

## O re-stamp em produção (único toque obrigatório)

Quando a `0007_password_lifecycle` deixa de existir na árvore, o alembic da
produção quebra: lê `0007` na `alembic_version`, não acha o arquivo, aborta
(`Can't locate revision identified by '0007_password_lifecycle'`). Como o
`entrypoint.sh` roda `alembic upgrade head` no boot, **o próximo restart do
container na VPS entra em crash loop** até a `alembic_version` ser
realinhada.

Sequência obrigatória na VPS (detalhada no `plan.md`):

1. `alembic current` → confirmar produção em `0007_password_lifecycle`.
2. **Dump de segurança do schema** antes de qualquer stamp.
3. Deploy do código novo (0001 reescrita, 0002–0007 apagadas).
4. `alembic stamp 0001_baseline_v5 --purge` — `--purge` zera a
   `alembic_version` antes de gravar o novo id (evita linha duplicada).
5. `alembic current` → confirma a nova raiz. `upgrade head` vira no-op.

O re-stamp **não muda schema** — o DDL da 0001 é idêntico ao que já está em
produção (provado no passo zero). É realinhamento de metadados.

## Mudança acoplada: entrypoint deixa de migrar sozinho

Migration automática no boot é faca apontada pra produção a cada restart
(OOM, reboot da VPS) — e o dia do colapso é exatamente o dia em que banco e
árvore estão dessincronizados. **Esta entrega remove o `alembic upgrade
head` do `entrypoint.sh`**; migration vira passo manual de deploy. Perde-se
comodidade, ganha-se controle sobre quando o schema muda.

## Mudança acoplada: include_object vira filtro de verdade

Hoje `include_object()` em `alembic/env.py` retorna `True` sempre — stub que
**não filtra nada**, apesar de a docstring afirmar que protege trigger e
extensões. Funciona por sorte. Com a 0001 criando esses objetos, o
autogenerate da Entrega 9 (SSO) pode emitir `DROP` espúrio. Esta entrega
implementa o filtro real: ignorar função/trigger de imutabilidade e
extensões no autogenerate.

## Carona barata

`.env.example`: porta `5432` → `15432` (o default atual quebra qualquer dev
que copie o arquivo literal e use o túnel SSH).

## Fora de escopo (explicitamente)

- Higiene do zip (`.pyc`/`.pytest_cache` versionados) — conserto do processo
  de empacotamento, não desta spec.
- `COMO_INICIAR_O_PROJETO.md` ausente — tarefa de documentação separada.
- Remoção do IP/root do README — **fazer já, fora de qualquer entrega**
  (exposição viva).
- wait-for-db/retry no entrypoint — modo de falha diferente; opcional como
  carona, não bloqueia esta entrega.

## Critério de pronto (DUPLO — inegociável)

A reescrita é mecânica mas tem um único ponto de falha concentrado: provar
que o schema reconstruído == o atual. Uma constraint com nome diferente, um
default escrito de outro jeito, a ordem de uma coluna — qualquer divergência
quebra um teste de integração e você não sabe se é bug no teste ou no
baseline. Por isso o portão é duplo:

- [ ] **Portão 1 — fidelidade de schema.** Banco vazio → `alembic upgrade
      head` → `pg_dump --schema-only` → bate com `schema_v5.sql` de
      referência (descontado nonce/CRLF, via harness automatizado). Diff
      vazio.
- [ ] **Portão 2 — regressão.** Os **146** testes passam (95 puros + 51
      integração), com o `db-test` agora construído por `upgrade head`.

S� "146 testes passam" **não** basta. Os dois portões, nessa ordem.

## Critérios de aceite

- [ ] `0001` reescrita reproduz extensões, enums, 12 tabelas, FKs compostas,
      CHECKs, índice GIST de ltree, função + trigger de imutabilidade.
- [ ] 0002–0007 apagadas; `0001` é raiz e head.
- [ ] `db-test` roda `alembic upgrade head` (não carrega mais o dump via
      initdb); `00_test_extensions.sql` preservado.
- [ ] Harness de validação (Portão 1) implementado e verde.
- [ ] 146 testes passando (Portão 2).
- [ ] `entrypoint.sh` não roda mais migration no boot.
- [ ] `include_object` filtra função/trigger/extensões de verdade.
- [ ] README §5 reescrito; `.env.example` corrigido para 15432.
- [ ] ADR 0022 escrito, supersede a 0016; 0016 marcada `Superseded by 0022`.
- [ ] Runbook do re-stamp em produção documentado (no plan.md).
