# Plan 029 — Tela de gestão de times

> Decisões fechadas na `spec.md`. **Não há migration.** Deploy padrão.

Porte: **pequeno-médio.** Três funções de serviço, três rotas, uma tela.

Quatro fatias com portão próprio. A Fatia 1 sobe sozinha se necessário.

---

## Fatia 1 — Editar e remover time vazio (backend)

O caminho simples primeiro. Resolve Copy e Tráfego Pago sem nenhuma lógica de
esvaziamento.

**Arquivos:**

- `backend/app/modules/workspaces/infrastructure/team_repository.py`
  - `contagens(team_id)` → tarefas, projetos, membros, filhos, **numa query só**.
    ⚠️ **Sem filtro de `deleted_at`.** Registro na lixeira mantém a FK; contar só
    os vivos faz a guarda aprovar um `DELETE` que o banco recusa. Medido: CRM e
    Automação tem 3 vivas e 7 na lixeira.

- `backend/app/modules/workspaces/application/workspace_service.py`
  - `TeamService.update(team_id, *, name, description)` — recusa a raiz (D5),
    valida nome não-vazio, **não toca no slug** (D6).
  - `TeamService.delete(team_id)` — recusa a raiz; recusa se `contagens` não for
    toda zero, com os números na mensagem; então apaga.

- `backend/app/modules/workspaces/api/router.py`
  - `PATCH /current/teams/{team_id}` → `team.manage`
  - `DELETE /current/teams/{team_id}` → `workspace.manage`
  - `create_team`: `workspace.manage` → **`team.manage`** (D1)

> `session.rollback()` expira objetos ORM — capturar `id` e nome do time antes de
> qualquer ponto que possa rolar back, se forem usados no log ou na resposta.

**Portão:** `pytest` inteiro (esperado 408 + os novos).

---

## Fatia 2 — Testes da Fatia 1

Arquivo novo: `backend/tests/integration/test_team_management_db.py`

Contra Postgres real, **pela rota** — a lição da Spec 028 foi que 12 testes de
service ficaram verdes com o gate da rota revertido.

1. `test_manager_cria_subtime` (D1)
2. `test_manager_edita_nome_slug_nao_muda` (D6)
3. `test_admin_remove_time_vazio`
4. `test_manager_nao_remove` (403)
5. `test_nao_remove_time_com_tarefa_viva`
6. **`test_nao_remove_time_com_tarefa_na_lixeira`** — erro de regra com mensagem
   clara, **não** `IntegrityError`
7. `test_nao_remove_time_com_membro`
8. `test_nao_remove_time_com_filho`
9. `test_nao_remove_nem_edita_raiz` (D5)
10. `test_slug_liberado_apos_remocao`

> **Sabotagens** (confirmar com `grep` que entraram antes de rodar):
> - filtrar `deleted_at IS NULL` na contagem → teste 6 vermelho
> - remover a recusa da raiz → teste 9 vermelho
> - deixar o `update` mexer no slug → teste 2 vermelho
> - trocar o gate do `DELETE` para `team.manage` → teste 4 vermelho

---

## Fatia 3 — Esvaziar e remover (backend, D3-B)

- `TeamService.esvaziar_e_remover(team_id)` — **uma transação**:
  1. tarefas do time (incluindo as da lixeira) → `team_id` = raiz,
     `is_archived = true`, via o caminho que grava histórico `archived` (D4);
  2. projetos do time → `team_id` = raiz;
  3. membros → vínculo movido para a raiz, SUPERVISOR vira OPERATOR;
  4. `DELETE` do time.
  - **Recusa se houver subtime filho** — remover o filho é ação separada (D3/11).
  - Gate: `workspace.manage`.

- `TeamService.previa(team_id)` → o que a tela mostra antes de confirmar
  ("10 tarefas serão arquivadas, 3 membros irão para Marketing"). **Calculada no
  backend, no momento do clique** — os números mudam sozinhos.

⚠️ **Não reusar `move_member_subteam`.** As travas dela são interpessoais — "não
mexer em si mesmo", matriz de quem-pode-mirar-quem, conflito de destino — e
quebram numa operação em lote. Caso real: a Camila é MANAGER na raiz **e**
OPERATOR no CRM e Automação; se ela remover esse time, a trava de "si mesmo"
dispara e a operação para no meio. O desligamento vai direto no repositório, com
duas regras: quem **já** tem vínculo na raiz só perde o do subtime; quem **não**
tem, ganha o da raiz.

**Testes (mesmo arquivo):**

11. `test_esvaziar_preserva_tarefas` — continuam existindo, `team_id` = raiz,
    `is_archived = true`
12. `test_esvaziar_arquiva_tambem_as_da_lixeira` — senão o `DELETE` falha
13. `test_esvaziar_grava_historico_archived` (D4)
14. `test_esvaziar_move_membros_e_rebaixa_supervisor`
15. **`test_esvaziar_time_onde_o_ator_e_membro`** — o caso da Camila
16. `test_membro_ja_na_raiz_so_perde_o_subtime`
17. `test_esvaziar_recusa_time_com_filho`
18. **`test_falha_no_meio_nao_deixa_time_semi_esvaziado`** — força erro no passo
    3 e confirma que nenhuma tarefa foi arquivada

> **Sabotagem:** tirar o `is_archived = true` do passo 1 → teste 11 vermelho.
> Trocar a transação por commits parciais → teste 18 vermelho.

---

## Fatia 4 — Tela

- `web/app/times/page.tsx` (novo). Rota própria, não aba dentro de membros.
  - raiz no topo como cabeçalho, **sem ações** (D5);
  - subtimes em lista, com contagem de tarefas e membros;
  - **criar**: nome + slug;
  - **editar**: nome e descrição (slug visível, desabilitado);
  - **remover**: sempre pede digitar o nome (D2). Se o time tiver conteúdo, a
    prévia vinda do backend aparece antes da confirmação;
  - time com subtime filho: remover desabilitado, com o motivo.

- `web/lib/api.ts` — `createTeam`, `updateTeam`, `deleteTeam`, `previaRemocao`,
  e **`invalidateTeams()`** zerando `_teams` após cada mutação (D8, aviso já
  escrito no próprio arquivo).

- `web/lib/gestaoTimes.ts` (novo) — regra pura, testada:
  `ehRaiz(time)`, `podeEditar(time, me)`, `podeRemover(time, me)`,
  `confirmacaoValida(digitado, nomeDoTime)`, `motivoBloqueio(contagens)`.
  A decisão mora aqui; o JSX desenha.

**Portão:** `npm test`, `npx tsc --noEmit`, `npx next build`.

---

## Fatia 5 — Operação (não é código)

1. Dump do banco antes da primeira remoção.
2. Criar "Influenciadores".
3. Remover Copy e Tráfego Pago (vazios, caminho A).
4. Só depois, se ainda fizer sentido, exercitar o caminho B em algum time com
   conteúdo — e conferir em `/arquivadas` que as tarefas estão lá.

---

## Estimativa honesta

A Fatia 1 é mecânica e entrega o caso motivador (Copy). A Fatia 3 é onde mora o
risco: sequência de quatro passos que tem de ser atômica, sobre uma função de
movimentação de membros que **não pode** ser reusada.

Se a Fatia 3 parecer cara na hora de escrever, ela é adiável — as fatias 1, 2 e 4
já entregam uma tela útil, e o botão do caminho B pode nascer desabilitado com
"em breve".
