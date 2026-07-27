# Spec 029 — Ciclo de vida de times (criar, mover, aposentar subtimes)

> **Status: RASCUNHO. Não construir sem fechar as decisões abertas.** A decisão
> mais pesada (§D2 — o que acontece com as tarefas de um time aposentado) é
> migração de dados sobre uma tabela imutável. Tratar com o mesmo cuidado que a
> Camila trata migration em banco compartilhado com o n8n.

## Objetivo

Permitir que ADMIN e MANAGER do **time raiz** (`parent_team_id IS NULL`) mexam
na **existência** de subtimes pela UI — hoje isso só acontece por código, junto
com o seed do schema. Caso motivador da Camila: adicionar "Influenciadores"
como subtime e **aposentar "Copy"**.

Duas operações têm dificuldade radicalmente diferente e a spec as separa:

- **Criar / mover subtime** — o backend **já faz**. É quase só UI.
- **Aposentar subtime** — o backend **não faz**, e não é esquecimento: há
  tarefas, projetos, membros e histórico imutável pendurados no time. É
  migração de dados, não um botão.

## Por que "remover time" não existe hoje (VERIFICADO no código)

- `TeamService` (`workspace_service.py`) tem **`create` (131), `move` (201),
  `list_teams` (197)**. **Não tem `delete` nem `deactivate`.** Grep no repo
  inteiro: zero remoção de time.
- O que **aponta** para um time e quebraria se ele sumisse:
  - `task.team_id` (`operational.py:121`) — tarefas moram no time.
  - `project.team_id` (`operational.py:186`) — projetos idem.
  - vínculo membro–time (`user_team`) — operators que só existem naquele subtime.
  - `task_history` — **append-only, imutável por trigger** (o banco bloqueia
    UPDATE/DELETE). O histórico das tarefas do time aposentado **não pode** ser
    reescrito para apontar para outro time.
- Isto é exatamente o cenário do **§5.4 do handoff** ("script de reestruturação
  transacional") — a Camila já havia marcado essa classe como o caminho caro.

## O que já existe (reuso, não invento) — VERIFICADO

- **Criar subtime:** `POST /api/v1/current/teams` com `parent_team_id`
  preenchido (`workspaces/api/router.py:94`, gated por `workspace.manage` →
  hoje só ADMIN). `TeamService.create` valida slug e hierarquia.
- **Mover subtime:** `POST /api/v1/current/teams/{id}/move`
  (`router.py:116`), com detecção de **ciclo → 409** já implementada.
- **Listar:** `GET /api/v1/current/teams` (`router.py:77`) →
  `TeamListResponse`. O front já consome via `listTeams()` (`api.ts:426`) e já
  monta o texto "subtime pertence ao pai" (`membros/page.tsx:81`).
- **NÃO existe UI de gestão de times** — só de membros. Grep confirma:
  nenhuma tela chama `createTeam`/`moveTeam`. A tela é nova.
- **Permissão `team.manage`** já é de ADMIN e MANAGER (`permissions.py`).
  `workspace.manage` (usada hoje pelas rotas de time) é só ADMIN — ver D5.

## Decisões a fechar (só a Camila)

- **D1 — Quem cria/move subtime: ADMIN só, ou ADMIN + MANAGER do raiz?**
  As rotas hoje exigem `workspace.manage` (só ADMIN). O pedido da Camila fala
  em "managers e admins do time raiz". Proposta: baixar o gate de criar/mover
  para `team.manage` (ADMIN + MANAGER), mantendo aposentar mais restrito (D3).
  ☐ Confirmar.

- **D2 — A DECISÃO PESADA: o que acontece com as tarefas de um subtime
  aposentado?** Opções, em ordem de custo:
  - **(a) Soft-delete / aposentar (RECOMENDADO).** Um `deactivated_at` no
    time. O time some da UI e não aceita tarefa/membro novo, mas **as tarefas,
    projetos e histórico continuam existindo e legíveis**. Zero migração de
    dados. Custo: 1 migration de coluna + filtrar `deactivated_at IS NULL` nas
    queries de listagem de time. **Reversível** (reativar). Cobre "tirar Copy
    da vista" sem risco.
  - **(b) Hard-delete com realocação.** Antes de apagar, mover todas as
    tarefas/projetos do Copy para outro time (qual? escolhido na hora?), tirar
    os membros, e só então apagar. Migração transacional, irreversível, e
    esbarra no `task_history` imutável (o histórico ainda referencia o
    `team_id` antigo via as linhas de evento). **Alto risco**, e o backup de
    restauração **nunca foi testado** (§6 do handoff).
  - **(c) Hard-delete bloqueado se não-vazio.** Só apaga time sem nenhuma
    tarefa/projeto/membro. Simples, mas "Copy" tem conteúdo → não resolve o
    caso motivador.
  ☐ **Recomendação forte: (a).** "Aposentar" quase sempre é o que se quer;
  "apagar de verdade" é raro e caro. Confirmar (a) fecha 90% do escopo com 10%
  do risco.

- **D3 — Aposentar exige confirmação forte.** Proposta: a ação de aposentar um
  subtime pede **digitar o nome do time** para confirmar (estilo GitHub), num
  fluxo separado da criação. Motivo: aposentar mexe em N tarefas de N pessoas;
  um clique acidental não pode fazer isso. ☐ Confirmar.

- **D4 — Time raiz é intocável pela tela.** Proposta: a tela **nunca** deixa
  aposentar nem mover o time raiz (`parent_team_id IS NULL`). Só subtimes.
  Raiz é a âncora do tenant. ☐ Confirmar.

- **D5 — Membros de um subtime aposentado.** Se D2=(a): os operators que só
  estavam no Copy ficam **sem subtime** (vínculo `user_team` do Copy inativo).
  Eles continuam ativos no workspace? Proposta: sim — ficam ativos, sem
  subtime, aparecendo para ADMIN/MANAGER realocarem. **Não** desativar contas
  em massa junto com o time. ☐ Confirmar.

## Critérios de aceitação (a VERIFICAR na execução)

Assumindo D2=(a) aprovado:

1. ADMIN/MANAGER (conforme D1) cria subtime "Influenciadores" pela tela → ele
   aparece no quadro e em `listTeams`.
2. Aposentar "Copy" → ele some da UI de times e do seletor de time; **as
   tarefas de Copy continuam existindo** e legíveis (query direta as encontra).
3. `task_history` das tarefas de Copy **intacto** (trigger não foi violado).
4. Não é possível aposentar nem mover o time **raiz** pela tela.
5. Aposentar exige digitar o nome (D3); cancelar não faz nada.
6. Subtime aposentado **não aceita** tarefa nova nem membro novo.
7. Reativar "Copy" (se D2=a) o traz de volta com as tarefas ainda lá.
8. Cadeia de migration sobe do vazio até a nova head (Postgres real).

## O que esta spec NÃO faz

- Não mexe em **membros** (adicionar/remover operator) → Spec 028.
- Não implementa hard-delete com realocação **a menos que** D2=(b) seja
  escolhido — e, se for, vira uma spec própria de migração de dados, porque o
  risco justifica isolamento.
- Não toca no tenant/workspace, só em times dentro dele.

## Fronteira de risco

Com D2=(a): **baixo** — uma coluna, um filtro, uma confirmação forte, nenhuma
tarefa tocada. Com D2=(b): **alto** — migração transacional sobre tabela
imutável, irreversível, sem restore de backup testado. A escolha de D2 é, na
prática, a escolha entre uma spec de baixo risco e um projeto.
