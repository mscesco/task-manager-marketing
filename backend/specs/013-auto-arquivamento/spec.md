# Spec 013 — Auto-arquivamento de tarefas terminais

## Objetivo
Manter o conjunto vivo do quadro limitado ao longo do tempo, arquivando
automaticamente tarefas em estado terminal (COMPLETED/CANCELLED) paradas há
mais de N dias, e oferecer uma tela onde elas sejam consultadas e reativadas.
Tarefas terminais **recentes** continuam no quadro (têm valor: "o que o time
entregou esse mês"); só as velhas saem.

Contexto: complementa a Opção A do P0.2 (fetch completo com teto/aviso). A
Opção A estanca a perda silenciosa; o auto-arquivamento reduz a pressão sobre
o teto removendo do conjunto vivo o balde que cresce sem fim (terminais velhas).

## Regra de elegibilidade
Uma task é elegível quando, simultaneamente:
- `is_archived = false` (já arquivada não reentra), e
- está em `COMPLETED` ou `CANCELLED`, e
- passou do limite de dias no estado terminal.

Carimbo de "quando ficou terminal" (schema assimétrico):
- `COMPLETED` → `completed_at` (carimbo preciso, setado ao entrar no estado).
- `CANCELLED` → `updated_at` (DECISÃO A: aproximação barata, sem migration).
  Limitação aceita: editar uma task cancelada reseta o relógio. Raro para
  task terminal.

Limite: `STALE_ARCHIVE_DAYS`, configurável via env. **Default 20** (DECISÃO B).

Regra final:
`(COMPLETED AND completed_at < now - DIAS)` OR `(CANCELLED AND updated_at < now - DIAS)`.

## Decisões cravadas
- **A** — CANCELLED medido por `updated_at` (sem migration). Alternativa
  parqueada: coluna `cancelled_at` (precisa, exige migration).
- **B** — Limite = 20 dias (`STALE_ARCHIVE_DAYS`, default 20).
- **C** — Reativar = `unarchive` + status → `BACKLOG` (tira da elegibilidade,
  resolve o loop de re-arquivamento). `unarchive` puro continua existindo;
  desarquivar mantendo COMPLETED faz a varredura re-arquivar em ≤1 dia —
  comportamento esperado, documentado.
- **D** — Ator do histórico = **admin do workspace** (papel ADMIN, escolha
  determinística se houver mais de um), com `metadata: {automated: true,
  reason: "stale_terminal"}`. Motivo: `task_history.user_id` é NOT NULL com FK
  para `users` — não há "ator nulo/sistema" sem migration na tabela de
  auditoria imutável.
- **E** — Auth do endpoint = segredo compartilhado (header `X-System-Token`
  contra env `SYSTEM_API_TOKEN`). Máquina-a-máquina, sem sessão JWT.

## Gatilho
Endpoint trancado + workflow agendado no n8n (já roda na VPS) batendo 1x/dia.
Sem varredura preguiçosa no carregamento do quadro (amarraria write a read).

## Endpoint
`POST /api/v1/system/tasks/archive-stale` — header `X-System-Token`.
Itera todos os workspaces; por workspace entra em `tenant_scope`, resolve o
admin, arquiva em lote, grava histórico. O caminho em lote NÃO passa pelos
guards por-task (`assert_editable`) — é job de sistema confiável, workspace-wide.
Retorna `{archived_count, by_workspace}`. Idempotente.

## Tela de arquivadas (front)
Página listando tarefas arquivadas, botão "Reativar" (unarchive + status→BACKLOG).
Exige filtro `archived_only` na listagem (hoje `include_archived=true` traz
arquivadas E ativas; filtrar no cliente bateria no mesmo truncamento já
resolvido no P0.2).

## Fora de escopo (consciente)
- BACKLOG crescendo sem fim (é grooming; a Opção A cobre o vivo passando do teto).
- Restaurar o status exato pré-conclusão via histórico (over-engineering).
- Auto-arquivamento de projetos (só tasks por enquanto).
