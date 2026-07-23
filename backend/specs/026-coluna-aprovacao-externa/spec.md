# Spec 026 — Coluna "Aprovação Externa" no Kanban

## Objetivo
Distinguir, no quadro, a tarefa que espera **aprovação de fora do time**
(cliente, fornecedor, outra área) da que espera **revisão interna**. Antes
desta spec as duas moravam em `IN_REVIEW` (rótulo "Em Aprovação") e a
distinção vivia na cabeça das pessoas — sumia no reload, não filtrava, não
media.

A solução é um **valor novo no enum `task_status`**: `EXTERNAL_APPROVAL`.

> **Por que enum, e não coluna booleana.** A alternativa booleana foi
> considerada e descartada em 2026-07-22, quando a Camila cravou que o estado
> é **exclusivo** ("um card nem pode estar em dois estados ao mesmo tempo").
> Booleano ao lado do status torna representável o estado ilegal
> (`COMPLETED` + aprovação externa) e obrigaria todo código que decide por
> status a consultar dois campos. Estado da máquina => valor da máquina.

## O que já existe (reuso, não invento)

- **Fonte única de colunas no front:** `web/lib/status.ts` (decisão E9 da
  Camila: *"a tela lê daqui"*). `Board`, `TaskModal`, `TaskDetail`,
  `minhas-tarefas` e `arquivadas` derivam colunas, dropdowns, rótulos e cores
  dessa lista. Coluna nova = **uma entrada** ali + rename de um rótulo.
- **O tipo do status no front é `string`** (`web/lib/api.ts:239`), sem union
  TS a atualizar. (`ProjectStatus`, em `api.ts:836`, é o enum de PROJETO —
  outro domínio, não tocado.)
- **Backend não faz switch exaustivo de status.** Varredura: as decisões são
  `== COMPLETED` (cascata, `task_service.py`), `in (COMPLETED, CANCELLED)`
  (sweep, `archival.py` + `task_repository.py`) e a lista de ignorados do
  prazo (`deadline_notify_service.py:47-49`). Valor novo cai no comportamento
  padrão de "tarefa aberta" — o correto — **sem tocar nenhum desses arquivos**.
- **Enum nativo do Postgres** (`create_type=False`, `operational.py:192`).
  Armadilha conhecida: `ALTER TYPE ... ADD VALUE` não roda na transação do
  Alembic (`env.py:117` roda em `context.begin_transaction()`) => exige
  `op.get_context().autocommit_block()`. **Sem precedente no repo** — a 0002
  registra ter evitado `ALTER TYPE`; esta spec introduz o padrão.
- **`TaskStatus` é `StrEnum`** — Pydantic e SQLAlchemy aceitam o valor novo
  sem mudança além da linha no enum.

## Decisões cravadas (Camila, 2026-07-22)

- **D1 — Estado exclusivo, valor novo no enum.** `EXTERNAL_APPROVAL`.
  Sem booleano, sem duplicar coluna de `IN_REVIEW` no front.
- **D2 — Rótulos: "Aprovação Interna" e "Aprovação Externa".** `IN_REVIEW` é
  **renomeado** de "Em Aprovação" para "Aprovação Interna" (só rótulo; a chave
  no banco não muda). Sem o rename, duas colunas "Em Aprovação*" viram
  adivinhação para o time.
- **D3 — Posição: entre Aprovação Interna e Concluído.** No banco,
  `ADD VALUE ... AFTER 'IN_REVIEW'` (cosmético — a ordem que vale é a de
  `status.ts`).
- **D4 — O quadro vai a 8 colunas.** Revisão consciente da decisão E9
  (mostrar todas). Nenhuma coluna é colapsada nesta spec.
- **D5 — O prazo continua contando.** `EXTERNAL_APPROVAL` **não** entra em
  `_STATUS_SEM_AVISO` — cliente lento não pausa o prazo do time.
  (= zero mudança no arquivo; provado por teste.)
- **D6 — Cascata de conclusão engole.** Concluir a mãe conclui descendentes
  em qualquer status, incluindo o novo — comportamento atual, sem regra
  especial. Ciente e aceito.
- **D7 — Sem regra de permissão própria.** Mover para/da coluna segue as
  mesmas regras de qualquer arrasto.
- **D8 — Cor da coluna: violeta `#8b5cf6`.** Distinta do âmbar do `IN_REVIEW`.
  Ciente de que branco sobre as cores de status já reprova contraste hoje
  (achado aberto pré-existente) — **não corrigido aqui**, para não mudar a
  cara do app inteiro dentro de uma spec de coluna.

## Ordem de deploy — EXCEÇÃO à regra padrão

**MIGRATION ANTES do código** (o contrário do padrão do DEPLOY.md — este é o
caso que o cabeçalho da migration declara):

- Valor novo no tipo + código velho = **inofensivo**. Nenhuma linha usa o
  valor até o front novo existir.
- Código novo + tipo velho = arrasto para a coluna nova → Postgres rejeita o
  valor → **500** na cara do usuário.

A migration **não tem downgrade**: Postgres não remove valor de enum.
Irreversível e intencional; registrado no docstring dela.

## Critérios de aceitação — VERIFICADOS

Todos reproduzidos contra Postgres 16 real (não aceitos por confiança):

1. Cadeia de migrations sobe do banco vazio até `0006`. ✅
2. `EXTERNAL_APPROVAL` existe no enum, entre `IN_REVIEW` e `BLOCKED`
   (`enumsortorder` 4.5). ✅
3. Migration idempotente: reexecutar `upgrade head` não falha
   (`IF NOT EXISTS`). ✅
4. Round-trip: `PATCH` para o status novo persiste e lê de volta. ✅
5. Sweep de arquivamento **não** considera o status novo. ✅
6. Cascata de conclusão engole filho no status novo. ✅
7. Aviso de prazo **dispara** para tarefa no status novo. ✅
8. Suíte: **379 passed** (375 anteriores + 4 novos) — zero regressão,
   confirmado no ambiente da Camila. ✅
9. Front: `tsc --noEmit` 0 erros, `next build` limpo, **15 rotas**
   (contagem inalterada). ✅

**Não provado (dívida conhecida, não desta spec):** o front não tem runner de
teste. `tsc` + `build` provam que compila, não que funciona na tela. O teste
de comportamento é manual no dev.

## Riscos e brechas fechadas
- **Card "sumindo" com front velho:** só se uma tarefa ganhasse o status antes
  do front novo subir — impossível, nada escreve o valor até lá. A ordem de
  deploy elimina a janela.
- **Consumo de status fora do `STATUSES`:** varredura no front não achou
  nenhum. As menções literais a `"COMPLETED"` (Board, TaskDetail,
  minhas-tarefas) são a lógica de conclusão, que trata só esse estado —
  espelham o backend e corretamente não mudam.

## Fora de escopo
- Notificar alguém quando a tarefa entra/sai de aprovação externa.
- Campo "quem é o aprovador externo" ou "enviado em".
- Correção de contraste WCAG das cores de status (achado aberto próprio).
- Colapsar colunas do quadro (rediscutir E9 se as 8 incomodarem no uso).
