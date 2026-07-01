# Plan 023 — Cor de prazo + notificação

Média. **2 fatias de backend** (gated pela spec) + **1 de n8n** (config, receita,
sem código) + **1 de front** (cor, sem gate). A cor (Fatia 4) é independente e
pode sair primeiro/isolada se o backend escorregar pro pós-lançamento.

## Fatia 1 — Migration: colunas de dedup + backfill (backend) — GATED
- `app/db/models/operational.py::Task` — `+ due_soon_notified_for: Mapped[date |
  None]` e `+ overdue_notified_for: Mapped[date | None]` (Date, nullable).
- `alembic/versions/0003_deadline_notif_flags.py` (novo):
  - `op.add_column` das duas colunas (nullable, sem server_default).
  - **Backfill (D4):** `UPDATE task SET due_soon_notified_for = due_date,
    overdue_notified_for = due_date WHERE due_date IS NOT NULL` — mata o flood
    inicial (só dispara pra prazos cruzados depois do deploy).
  - `downgrade`: drop das duas colunas.
- Validação Claude: `py_compile` + revisão do head da revisão (down_revision =
  `0002_notifications`). Validação Camila: `alembic upgrade head` num banco de
  teste + conferir as colunas e o backfill.
- **PARAR pra você aprovar a spec antes de qualquer código.**
- Commit: `feat(db): colunas de dedup de notificacao de prazo + backfill`.
- **DEPLOY.md:** anotar que esta migration precisa rodar no deploy (R2).

## Fatia 2 — Emitter + serviço de varredura + endpoint (backend) — GATED
- `app/modules/notifications/domain/notification.py::NotificationType` —
  `+ TASK_DUE_SOON`, `+ TASK_OVERDUE`.
- `app/modules/notifications/application/notification_emitter.py` — dois métodos
  novos, `due_soon(...)` e `overdue(...)`: fan-out pros responsáveis, `actor_id
  = None`, sem `_actor_name` (sistema), payload `{task_title, due_date}`, mesmo
  `_emit_safely` (savepoint). Dedup de destinatário (`dict.fromkeys`).
- `app/modules/tasks/application/deadline_notify_service.py` (novo) — espelha
  `StaleArchivalService`: varre workspaces, entra em `tenant_scope`, resolve
  `hoje` em America/Sao_Paulo (D7), seleciona candidatos (D5/D6), carrega
  responsáveis via `task_assignment`, emite, grava a coluna de dedup, **commita
  por workspace** com isolamento (um workspace que falha é pulado). Retorna
  contagem por tipo/workspace.
- `app/modules/tasks/api/system_router.py` — `+ POST /system/tasks/
  notify-deadlines` (mesma trava `require_system_token`) → `DeadlineNotifyService
  (session).run(now=datetime.now(UTC))`.
- `tests/integration/test_deadline_notify_db.py` (novo) — critérios 1–8 da spec.
- Validação Claude: `py_compile` + grep dos call-sites. Validação Camila: pytest
  do arquivo + suíte inteira.
- Commit: `feat(notifications): job de aviso de prazo (due-soon + overdue)`.

## Fatia 3 — Workflow n8n (config na VPS, sem código)
- Schedule Trigger (diário, cedo — ex. 07:00 BRT) → HTTP Request `POST` no
  endpoint, Header Auth `X-System-Token` + **Retry On Fail** (seguro pela dedup).
- Entrego o passo a passo (nós, headers, cron) quando as Fatias 1–2 estiverem
  verdes. Reusa a credencial de sistema já criada pro archive-stale.

## Fatia 4 — Cor de prazo (frontend, sem gate)
- Helper em `web/lib/status.ts` (ou util novo): `deadlineTone(due_date, status,
  is_archived)` → `"overdue" | "soon" | null`, calculado na data local.
- `web/components/TaskCard.tsx` e `web/components/TaskDetail.tsx` — aplicar a cor
  ao selo/label de prazo (vermelho/laranja) conforme o tone. Task
  concluída/cancelada/arquivada → sem alerta.
- Validação: esbuild parse + `npm run build`.
- Commit: `feat(web): cor de prazo (laranja perto, vermelho atrasado)`.

## Ordem
1 → 2 → 3 → 4, parando após cada uma pra você testar/commitar. Fatia 4 (cor)
pode ser puxada pra frente se você quiser algo visível no lançamento antes das
notificações ficarem prontas.
