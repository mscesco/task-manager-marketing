# Entrega 10 — Hierarquia de subtarefas + responsáveis no quadro

> **Status:** Entregue
> **Tipo:** predominantemente front (1 mudança pequena de backend).
> **Migration:** nenhuma — `task_assignment` existe desde o baseline e as
> rotas de `/assignees` já estavam no ar.
> **ADRs:** backend `0024` (herança de team), `0025` (assignees em lote);
> front `0003` (detalhe reusa a lista), `0004` (quadro só raízes / subtarefa
> no card).

## O que entregou (linguagem de produto)

Antes, uma tarefa tinha time, mas a decomposição em partes e o "quem faz cada
parte" só existiam no banco — o quadro não mostrava. Esta entrega leva isso
pra tela:

1. **Subtarefas** dentro do card pai, pra quebrar uma tarefa em partes.
2. **N responsáveis** por tarefa e por subtarefa.
3. **Leitura de relance** no card: selo de responsáveis + contagem de
   subtarefas, sem abrir nada.

Ataca a dor de "o Notion mostra confuso": quem abre o quadro vê de quem é
cada coisa e em quantas partes está dividida.

## Decisões cravadas

1. **Subtarefa vive dentro do card pai** (sublista no painel de detalhe),
   não como card solto. Quadro renderiza só raízes (`depth === 0`),
   client-side sobre o fetch plano. — ADR front 0004.

2. **Subtarefa herda `team_id` do pai no backend** (não pelo pin do front).
   No `create`, quando vem `parent` e não vem `team_id` explícito:
   `team_id = parent.team_id`, antes da resolução por `default_team_id`.
   Mata o fallback silencioso que re-armaria a dívida #2 pra subtarefas. —
   ADR backend 0024.

3. **Painel de detalhe estilo Trello**: clicar no card abre leitura + ações
   diretas. Editar título/escalares é o botão "Editar" (abre o `TaskModal`).
   O painel **não busca nada** — reusa a lista que o quadro já tem (sem
   `GET /tasks/{id}`, dodge do E6) e navega por dentro nas subtarefas. — ADR
   front 0003.

4. **Listagem traz `assignee_ids` em lote** (`GET /tasks`, 1 query). As
   mutações (`PATCH`, `POST assignees`) **não** retornam `assignee_ids` — o
   front preserva no upsert. — ADR backend 0025.

5. **Responsáveis no detalhe**: bolinhas dos atuais sempre visíveis; botão
   "Designar" abre/fecha a lista suspensa (busca + checkbox). Grava na hora
   (otimista, com revert no erro). Decidido dropdown porque com ~30 pessoas
   a lista aberta o tempo todo enchia o painel.

6. **Concluir rápido** na linha da subtarefa: checkbox marca `COMPLETED`;
   desmarcar volta pro **status anterior**.

7. **Selo do card** mostra os responsáveis **da própria tarefa** (2 bolinhas
   + "+N"), não agrega subtarefas. Badge à parte conta subtarefas diretas.

## Endpoints usados (todos já existentes, exceto a herança)

- `GET /api/v1/tasks` → agora com `assignee_ids` por item (bulk).
- `POST /api/v1/tasks` `{title, parent_task_id}` (sem `team_id`) → herda time.
- `PATCH /api/v1/tasks/{id}` `{status}` → editar / concluir-rápido.
- `POST /api/v1/tasks/{id}/assignees {user_id}` → 201/200 idempotente.
- `DELETE /api/v1/tasks/{id}/assignees/{user_id}` → 200 com a lista; 404 no-op.
- `GET /api/v1/members` → lista pra busca (memoizada no front).

## Limitações conhecidas (não são bugs)

- **Concluir-rápido / "voltar pro anterior" é por sessão.** O status de
  antes é guardado em memória enquanto o painel está aberto naquele pai. Se
  a subtarefa **já estava concluída** quando você abriu, ou após recarregar
  a página, desmarcar cai em **BACKLOG** (não há anterior pra onde voltar).
  Acertar 100% exigiria ler `task_history` no backend — fora de escopo.

- **Prefill stale.** Detalhe e edição usam o snapshot do `GET /tasks`; se
  alguém editou a mesma task no meio tempo, pode estar levemente velho.
  Tráfego atual (time pequeno) torna aceitável. — ADR 0002/0003.

## Fora de escopo (registrado pra próxima)

- **Excluir tarefa no front.** O backend tem `DELETE /tasks/{id}` com
  **cascata** (apaga a subárvore) e restrito a ADMIN/MANAGER, mas a UI não
  expõe. Quando entrar, o **aviso de cascata é obrigatório**: apagar um pai
  leva todos os filhos junto. Hoje não há o que avisar porque não há excluir.

## Verificação (smoke manual)

- Criar subtarefa pela sublista → aparece na lista; badge do pai vira
  `☑ 0/1`; ela **não** vira card no quadro.
- Subtarefa criada **não some nem dá 404** ao abrir (herança de time ok).
- Clicar na subtarefa → painel troca de foco com "‹ Voltar"; criar um neto
  confirma recursão em >1 nível.
- Responsáveis: bolinhas visíveis sem clicar; "Designar" abre/fecha; marcar
  reflete na hora; com lista fechada o painel fica curto.
- Concluir-rápido: marcar risca + atualiza `(feitas/total)` e o badge do
  card; desmarcar volta pro status anterior; **responsável não some** ao
  concluir/reabrir (upsert preserva `assignee_ids`).
- Rede: navegar pelo detalhe **não** dispara `GET /tasks/{id}`.
