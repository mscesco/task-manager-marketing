# Spec 023 — Cor de prazo + notificação (2 dias antes e no dia que atrasa)

## Objetivo
Tornar o prazo visível e ativo. Duas frentes:
- **Cor (front):** task com prazo em ≤2 dias fica **laranja**; task atrasada fica
  **vermelha**. Só pra tasks abertas (não concluída/cancelada/arquivada).
- **Notificação (backend + n8n):** avisar os **responsáveis** duas vezes por
  prazo — (1) quando faltam ~2 dias, (2) no dia em que atrasa. Cada evento
  dispara **uma vez** por prazo, nunca repetido em loop.

## O que já existe (reuso, não invento)
- **Job agendado:** `StaleArchivalService` + `/system/tasks/archive-stale` +
  `require_system_token` (X-System-Token, fail-closed) + n8n Schedule → HTTP.
  Copio esse molde inteiro pro job de prazos.
- **Emissor:** `NotificationEmitter` (savepoint best-effort); `notification.
  actor_id` é **nullable** → notificação de sistema (sem ator humano) cabe.
- **Responsáveis:** pivot `task_assignment` (task_id, user_id, workspace_id).
- **Task:** `due_date` é `date` puro (sem hora); `status`, `is_archived`
  (mixin), `deleted_at` (soft-delete) disponíveis pros filtros.

## Decisões cravadas
- **D1 — Dois eventos, um disparo cada (do seu aval).** `due_soon` (~2 dias
  antes) e `overdue` (no dia que atrasa). **Não** repete diariamente enquanto
  atrasada — isso treinaria o time a ignorar o sino.
- **D2 — Destinatários: só responsáveis.** `task_assignment` da task. Sem
  criador, sem watchers. **Consequência (ver R1):** task com prazo e **sem
  responsável** não notifica ninguém.
- **D3 — Idempotência via 2 colunas na task (RECOMENDADO).** Adicionar
  `due_soon_notified_for date NULL` e `overdue_notified_for date NULL`, cada uma
  guardando o `due_date` para o qual aquele aviso já saiu. Condição do job:
  dispara se `due_date` bate a janela **E** `<coluna> IS DISTINCT FROM due_date`;
  após enviar, grava `<coluna> = due_date`. **Self-healing:** se o prazo mudar, a
  coluna (valor antigo) difere do novo `due_date` → reabilita sozinho, sem
  gancho no `update()`.
  - **Alternativa sem migration (exposta pra você decidir):** deduplicar
    consultando `notification` (existe TASK_DUE_SOON pra esta task com
    `payload.due_date == due_date`?). Evita mexer no schema, MAS acopla a dedup
    à longevidade das notificações — se um dia entrar purga/retention de
    notificação, a dedup quebra e volta a spammar. Por isso **recomendo as
    colunas**. Custo real das colunas: **uma migration Alembic que PRECISA rodar
    no deploy** (incidente canônico — ver R2).
- **D4 — Backfill anti-flood (crítico).** A migration seta as duas colunas =
  `due_date` para **todas as tasks existentes que já têm `due_date`**. Sem isso,
  a primeira execução do job dispararia retroativamente pra toda task já
  atrasada/perto de vencer (enxurrada no dia do deploy). Com o backfill, o
  recurso só dispara pra prazos cruzados **depois** do deploy.
- **D5 — Janelas robustas a dia perdido.** `due_soon`: `hoje <= due_date <=
  hoje+2` (não só o dia exato — se o job pular um dia, a task ainda é pega no
  seguinte; a coluna evita re-disparo). `overdue`: `due_date < hoje`.
- **D6 — Filtros do candidato:** `due_date IS NOT NULL`, `status NOT IN
  (COMPLETED, CANCELLED)`, `is_archived = false`, `deleted_at IS NULL`.
- **D7 — Timezone (subtil, mas real).** `due_date` é data pura. "Hoje" precisa
  ser a data em **America/Sao_Paulo** (UTC-3), não UTC — senão, perto da
  meia-noite, o job julga a task contra o dia errado (BRT vs UTC diverge até 3h).
  O job resolve `hoje` na tz local. Vai como constante agora
  (`America/Sao_Paulo`); vira config se um dia houver multi-fuso.
- **D8 — Sistema, sem ator.** `actor_id = None`. Novos tipos
  `TASK_DUE_SOON` e `TASK_OVERDUE`. Payload: `{task_title, due_date}`.
- **D9 — Cor (front) derivada do mesmo critério.** dias até `due_date` (tz
  local): `< 0` → vermelho; `0..2` → laranja; senão neutro. Só em task aberta
  (não concluída/cancelada/arquivada). Puramente visual, sem backend.

## Riscos residuais
- **R1 — Task sem responsável não é avisada.** Decisão D2. Se isso incomodar,
  a saída é notificar o criador como fallback quando não há responsável — fica
  parqueado até você pedir.
- **R2 — Migration no deploy.** As colunas exigem `alembic upgrade head` no
  deploy. É o ponto de falha canônico de vocês; entra explícito no `DEPLOY.md`.
- **R3 — Escorregão de 1 dia se o job falhar.** Com a janela de `due_soon`
  (D5), um dia perdido só atrasa o aviso (não perde). O `overdue` exato pode
  escorregar 1 dia num job perdido — aceitável. n8n com Retry On Fail é **seguro**
  aqui: a coluna de dedup ignora o que já foi notificado.
- **R4 — Fuso.** Se a instituição operar fora de BRT, D7 precisa virar config.

## Fora de escopo
- Notificação de **mudança de status** (feature 4 da lista, spec própria).
- Digest / agrupamento de notificações; horário de aviso por usuário; e-mail.
- Fallback pro criador quando não há responsável (R1, parqueado).

## Critérios de aceite
**Backend (Fatias 1–2):**
1. Task com `due_date = hoje+2`, aberta, com 1 responsável → job emite 1
   `TASK_DUE_SOON` pro responsável; roda de novo no mesmo dia/dia seguinte → **não
   duplica** (coluna gravada).
2. Task com `due_date = ontem`, aberta, com responsável → job emite 1
   `TASK_OVERDUE`; re-execução não duplica.
3. Mudar o `due_date` de uma task já notificada → reabilita e notifica de novo
   pro novo prazo.
4. Task concluída/cancelada/arquivada/deletada → **nunca** notifica, mesmo com
   `due_date` vencido.
5. Task sem responsável → nenhuma notificação (R1).
6. Falha de um workspace não derruba os outros (isolamento por workspace, igual
   archive-stale).
7. Endpoint `/system/tasks/notify-deadlines` fechado sem `X-System-Token` (401).
8. Backfill: tasks pré-existentes com `due_date` não geram avisos retroativos na
   1ª execução.

**Front (Fatia 4):**
9. Card e detalhe: prazo em ≤2 dias → laranja; atrasado → vermelho; task
   concluída/arquivada → sem cor de alerta.
