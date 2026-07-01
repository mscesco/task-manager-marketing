# Spec 022 — Trocar o projeto de uma task já criada (inclui tirar de projeto)

> **Número a confirmar.** O snapshot que li tem specs de backend só até 016
> committado; a memória do projeto referencia 020/021 como feitos. Confirme
> `022` contra o repo real antes de commitar a pasta — ajuste se colidir.

## Objetivo
Deixar a pessoa mover uma task de topo entre projetos **depois** de criada, e
também **tirá-la de projeto** (voltar pra avulsa), pela tela de editar. Hoje isso
é impossível pela UI, e o "tirar de projeto" é impossível até pelo backend.

## Correção de premissa
O endpoint `POST /tasks/{id}/move` **já existe e move entre projetos**: valida
que o projeto destino é visível (404 se pessoal alheio), impede ciclo, exige
pai e filho no mesmo projeto. Duas lacunas, só:

1. **Backend não desassocia.** `move()` faz
   `new_project_id = command.project_id or task.project_id`. Como `None or X = X`,
   mandar `project_id = null` **mantém** o projeto atual — não existe como dizer
   "tira de todos os projetos". É o único código novo desta spec.
2. **O front nunca chamou `/move`.** Não há `moveTask` no `api.ts`; `updateTask`
   (PATCH) de propósito não aceita `project_id`. Isso é frontend (Fatias 2–4),
   fora do gate de spec.

## Mudança
- **Backend (Fatia 1 — a única que exige esta spec):** `MoveTaskCommand` e
  `TaskMoveRequest` ganham `detach_project: bool = False`. Quando `true`, a task
  (e a subtree) passa a `project_id = NULL` (avulsa). `reparent_subtree` já
  aceita `project_id` nulo — a coluna é nullable e o `SET project_id = NULL` é
  SQL-válido; só falta afrouxar a tipagem do parâmetro de `uuid.UUID` para
  `uuid.UUID | None`.
- **Frontend (Fatias 2–3 — sem spec):** `moveTask` no client; no `TaskDetail`,
  chip do projeto ao lado de status/prioridade **+** o controle de trocar/tirar
  projeto ali mesmo (padrão do bloco de responsáveis: estado atual sempre
  visível, "Sem projeto" quando avulsa, botão pra mudar). **Não vai no modal** —
  ver R1. Só em task de topo; subtarefa mostra o projeto herdado, read-only.

## Decisões cravadas
- **C1 — Sinal explícito, não null.** `detach_project=True` é o sinal de "tirar
  de projeto". `project_id=None` continua significando "não mexer no projeto".
  Nada de sentinela tri-state no Pydantic (frágil): um booleano resolve.
- **C2 — Detach só em task de topo.** Se a task tem pai (`parent_task_id`
  presente), `detach_project=True` → **422**. Uma subtarefa não vira avulsa
  sozinha: o projeto dela é definido pelo pai. (O front já esconde o seletor em
  subtarefa; o backend recusa de qualquer forma.)
- **C3 — Combinações contraditórias barradas.** `detach_project=True` junto de
  `project_id` preenchido → **422** (ou tira, ou põe num projeto, não os dois).
  `detach_project=True` junto de `parent_task_id` preenchido → **422** (avulsa
  não tem pai).
- **C4 — `team_id` fica como está.** `move()` nunca tocou `team_id` (Achado #1,
  adiado ao marco do 2º time-pai). Uma task que vira avulsa **mantém** o
  `team_id` atual — coerente: task avulsa criada pelo fluxo normal também nasce
  com `team_id` (default do criador). Esta spec **não** reabre o #1.
- **C5 — Idempotência.** `detach_project=True` numa task que já é avulsa
  (`project_id` já null) = no-op silencioso, sem erro. Igual à filosofia atual
  do `move`.
- **C6 — Subtree acompanha.** Detach de uma task com filhos leva a subtree
  inteira pra avulsa (o `UPDATE 2` do `reparent_subtree` reescreve `project_id`
  dos descendentes). Isso é o comportamento correto e já existente do move.
- **C7 — Permissão inalterada.** Continua `require_permission("task.update")` +
  `_assert_editable`. Sem gate novo.
- **C8 — Controle no TaskDetail, não otimista, só topo.** O bloco de projeto no
  detalhe espelha o de responsáveis (estado atual visível + ação pra mudar),
  MAS **não** é otimista como o toggle de responsável: o move reparenta a subtree
  e pode ser rejeitado (visibilidade, 422). Aplica-se no sucesso, com loading.
  Subtarefa: projeto herdado read-only, sem controle.

## Riscos residuais
- **R1 — RESOLVIDO por design.** O controle de projeto vive no `TaskDetail`
  como ação própria (1 chamada `/move`), separado do PATCH dos campos de texto
  do modal. Não há mais save não-atômico: trocar projeto e editar título são
  operações distintas, cada uma atômica. **Não** é otimista (ver C8) — a task
  reparenta a subtree e tem rejeições reais, então aplica-se só no sucesso, com
  loading. (A ideia anterior de pôr no modal foi descartada exatamente por isso.)
- **R1b — Regroup no quadro (Fatia 3, ponto de atenção real).** No `Board.tsx`
  as tasks são **agrupadas por projeto**; mover uma task de projeto tira o card
  de um grupo e põe noutro. O `onSubtaskUpsert` genérico (que arquivar/status
  usa) mescla um campo, mas **não** reagrupa. O pai precisa refetchar ou
  reagrupar após o move. No `minhas-tarefas` (lista plana) é trivial. É onde
  mora o trabalho de verdade do front.
- **R2 — Achado #1 pega carona.** Trocar de projeto continua sem revalidar
  `team_id`. Inócuo hoje (só Marketing). Quando Desenvolvimento entrar, esta
  feature é um dos botões que exercita o #1 — fechar o #1 **antes/junto** de
  habilitar o 2º time-pai, como já amarrado. Nada a fazer aqui.
- **R3 — Chip precisa do nome do projeto.** `Task` só carrega `project_id`. O
  `TaskDetail` recebe um `Map<project_id, title>` dos pais (Board e
  minhas-tarefas), mesmo padrão do `members`. Front, Fatia 3.

## Fora de escopo
- Mover **subtarefa** entre projetos (regra: segue o pai). Não muda.
- Tocar em `team_id` / Achado #1.
- Anexos, notificações de prazo/status, toggle kanban (features à parte).

## Critérios de aceite (Fatia 1 — backend)
1. `move` com `project_id=B` numa task de topo do projeto A → task e subtree vão
   pra B (inalterado, teste de regressão).
2. `move` com `detach_project=true` numa task de topo do projeto A → `project_id`
   da task e da subtree viram `NULL`; a task aparece como avulsa.
3. `detach_project=true` numa task **avulsa** → no-op, 200, sem erro.
4. `detach_project=true` numa **subtarefa** (tem pai) → 422.
5. `detach_project=true` **e** `project_id` preenchido → 422.
6. `detach_project=true` **e** `parent_task_id` preenchido → 422.
7. Sem `detach_project` e sem `project_id`/`parent_task_id` → no-op (inalterado).
