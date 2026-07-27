# Plan 029 — Ciclo de vida de times

> **Não iniciar sem D1–D5 fechadas, D2 acima de tudo.** Este plan assume
> **D2=(a) soft-delete/aposentar** — a recomendação. Se a Camila escolher
> D2=(b) hard-delete, **este plan não serve**: (b) é uma spec própria de
> migração de dados e deve ser tratada isolada, com dump antes e restore
> testado (o §6 registra que o restore nunca foi testado).

Porte com D2=(a): **pequeno-médio.** Uma migration de coluna, um filtro, uma
tela nova, uma confirmação forte. As rotas de criar/mover já existem.

Ordem de deploy: **padrão** (código antes; a migration desta spec adiciona
coluna nullable com default, não é o caso da exceção da 026). A migration é
segura para código velho (coluna nova que ninguém lê ainda).

---

## Fatia 1 — Aposentar no domínio + migration (backend, auto-suficiente)

Arquivos:
- `backend/alembic/versions/00NN_team_deactivated_at.py` (novo)
  - `ADD COLUMN deactivated_at TIMESTAMPTZ NULL` em `team`.
  - `downgrade()` remove a coluna — aqui **há** downgrade real (coluna nullable,
    diferente do `ADD VALUE` de enum da 026).
  - Migration mora dentro da imagem (`COPY alembic`) → **build antes de rodar**
    (achado da 026, vale para toda migration).
  - ⚠️ `DATABASE_URL` aponta para o banco certo? `task_manager_dev` e
    `task_manager` (prod) na **mesma instância** — conferir antes (§2 do
    handoff).
- `backend/app/db/models/organization.py` — `deactivated_at` no modelo `Team`.
- `backend/app/modules/workspaces/application/workspace_service.py`
  - `TeamService.deactivate(team_id)`: seta `deactivated_at = now()`.
    - **Recusa** se o time for raiz (`parent_team_id IS NULL`) → D4.
    - Idempotente: reaposentar não erra.
  - `TeamService.reactivate(team_id)` (se D5/D2=a): zera `deactivated_at`.
  - `list_teams` (linha 197): filtrar `deactivated_at IS NULL` **por padrão**;
    parâmetro opcional `incluir_inativos` para uma futura tela de auditoria.
  - `create` e `assign_to_team`: **recusar** criar tarefa/vincular membro em
    time aposentado (D2=a, critério 6). Rever onde `team_id` é aceito.

> **`session.rollback()` expira objetos ORM** (§8) — capturar o `id` do time
> antes de qualquer ponto que possa dar rollback ao ler atributo depois.

**Portão:** `pytest` inteiro + testes novos (Fatia 2). Cadeia de migration sobe
do vazio (Postgres real).

---

## Fatia 2 — Testes de integração (backend) — prova o que não pode quebrar

Arquivo novo: `backend/tests/integration/test_team_lifecycle_db.py`

1. `test_aposentar_subtime_preserva_tarefas` — cria subtime, cria tarefa nele,
   aposenta o time, **a tarefa ainda existe e é legível** por query direta.
   Este é o critério que separa (a) de (b): o dado sobrevive.
2. `test_aposentar_nao_viola_task_history` — o histórico das tarefas do time
   aposentado continua lá; nenhum UPDATE/DELETE na tabela imutável.
3. `test_nao_aposenta_raiz` → erro de regra (D4).
4. `test_subtime_aposentado_recusa_tarefa_nova` (D2=a, critério 6).
5. `test_subtime_aposentado_recusa_membro_novo`.
6. `test_reativar_traz_de_volta` (se D5/D2=a).
7. `test_list_teams_esconde_inativos_por_padrao`.

> **Sabotagem (§8):** quebrar de propósito o filtro `deactivated_at IS NULL` do
> `list_teams` e confirmar que o teste 7 **fica vermelho**. Conferir com `grep`
> que a sabotagem entrou antes de rodar. Idem para a recusa da raiz (teste 3).

Sem espião de símbolo renomeável — rota/serviço real contra Postgres real.

---

## Fatia 3 — Baixar o gate de criar/mover (backend, D1)

- `backend/app/modules/workspaces/api/router.py`
  - Se D1 = "ADMIN + MANAGER": trocar `require_permission("workspace.manage")`
    por `require_permission("team.manage")` em `create_team` e `move_team`.
    Revisar se alguma regra dentro do service assumia só-ADMIN.
  - `deactivate`/`reactivate`: gate `team.manage`, **mais** a checagem de raiz
    no service (D4). Aposentar é a ação destrutiva — se a Camila quiser
    restringir aposentar a ADMIN mesmo com criar liberado a MANAGER, é aqui.

**Portão:** testes da Fatia 2 cobrindo os papéis.

---

## Fatia 4 — Front: tela nova de gestão de times

Arquivos:
- `web/app/times/page.tsx` (novo) — ou uma aba dentro de `membros`. Decidir na
  execução; **provavelmente rota própria**, porque membros já é uma tela cheia
  e misturar "aposentar um departamento" com "cadastrar uma pessoa" repete o
  erro de escopo que esta dupla de specs separou de propósito.
  - Lista subtimes ativos, botão **criar** (nome + slug), botão **mover**.
  - **Aposentar**: fluxo separado com **digitar o nome do time para confirmar**
    (D3). Um clique não aposenta.
  - Time raiz aparece como âncora, **sem** botão de aposentar/mover (D4).
- `web/lib/api.ts` — adicionar `createTeam`, `moveTeam`, `deactivateTeam`,
  `reactivateTeam` (os dois primeiros batem em rotas que já existem).

> **Fronteira do front (Spec 027):** a regra "este time pode ser aposentado?"
> (não-raiz, ativo, ator tem poder) é **decisão** → `web/lib/`, função pura,
> testada. O JSX só desenha. Ex.: `web/lib/gestaoTimes.ts::podeAposentar(team,
> me)`. **Não** espalhar `if` de permissão pelo componente — foi assim que
> nasceu o bug do modal (§8).

**Portão:** `npm test` (função pura de regra de time testada), `tsc --noEmit`,
`next build`.

---

## Fatia 5 — Criar "Influenciadores" / aposentar "Copy" (operação, não código)

Depois de tudo no ar: fazer a operação real pela tela. Antes de aposentar Copy:
- **dump do banco** (`~/backups/`, padrão da Camila) — mesmo com soft-delete,
  é a primeira vez exercitando a aposentadoria em prod.
- conferir que as tarefas de Copy que ainda importam foram movidas/tratadas, ou
  aceitar que ficam legíveis mas fora da vista.

---

## Se D2=(b) for escolhido (hard-delete) — AVISO

Este plan é descartado. (b) exige: dump obrigatório + **restore testado antes**
(hoje nunca foi), script transacional que move tarefas/projetos para um destino
escolhido, tratamento explícito do `task_history` imutável (provavelmente
manter as linhas com o `team_id` antigo e aceitar referência a time inexistente,
ou nunca hard-deletar a linha do time e só marcá-la). É projeto, não fatia.
**Recomendação do assistente: não escolher (b) sem uma razão concreta que (a)
não cubra.**

## Estimativa honesta

Com D2=(a): factível como spec normal pós-lançamento. O risco real está
concentrado na Fatia 1 (recusar operações em time inativo sem quebrar as
existentes) e na Fatia 5 (primeira aposentadoria em prod). **Não é trabalho de
semana de lançamento.**
