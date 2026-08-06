# 0036 — Coluna sem `legacy_status` deriva o status pela SEMÂNTICA

## Status

Accepted — **refina a 0033, não a supersede.** A direção `status → coluna`
continua valendo onde existe a ponte `legacy_status`. Este ADR define o que
acontece onde ela não existe, que é o quadro interno da Spec 036.

Fecha as decisões **D4 e D5** de 06/08/2026. A D5 já está em produção (fatia F2
de 06/08).

## Contexto

A 0033 tornou a coluna derivada do status, com `legacy_status` como ponte 1:1, e
registrou a ponte como **coluna com data de demolição**. O plano que sobrou dali
era: colapsar os oito status em quatro, inverter a derivação, dropar a ponte.

Duas coisas mudaram esse plano, e as duas são dado, não opinião.

**1. Nenhum status está morto.** Medido em produção em 06/08/2026, seis semanas
de histórico (primeiro registro 25/06), 536 tarefas vivas:

| status | transições | vivas | primeiro uso |
|---|---|---|---|
| COMPLETED | 260 | 219 | 25/06 |
| IN_PROGRESS | 178 | 85 | 25/06 |
| PLANNED | 136 | 45 | 25/06 |
| IN_REVIEW | 32 | 11 | 25/06 |
| BACKLOG | 31 | 170 | 25/06 |
| BLOCKED | 8 | 5 | 22/07 |
| EXTERNAL_APPROVAL | 6 | 0 | 23/07 |
| CANCELLED | 2 | 1 | 23/07 |

`PLANNED` é central. `BLOCKED` e `EXTERNAL_APPROVAL` nasceram em julho e estão
em rampa. **Colapsar para quatro apagaria trabalho real da tela de gente que
está usando.**

**2. O colapso era o único deploy do roteiro que não voltava por rollback de
imagem.** Ele mexe em dado (`task_status` é ENUM nativo), então rebobinar o
código não rebobina as tarefas remapeadas.

Ou seja: o caminho crítico da Spec 036 passava por uma migration destrutiva,
para viabilizar uma feature que não precisa dela.

## Decisão

**Onde a coluna tem `legacy_status`, nada muda. Onde ela é NULL, o status vem
da semântica:**

```
legacy_status preenchido  ->  status = legacy_status
                              (quadro geral, 8 colunas, comportamento de hoje)

legacy_status NULL        ->  status = padrão da semântica
                              OPEN        -> BACKLOG
                              IN_PROGRESS -> IN_PROGRESS
                              DONE        -> COMPLETED
                              CANCELLED   -> CANCELLED
```

**É isto que tira o colapso de status do caminho crítico.** Uma tarefa na coluna
"Arte" de um quadro interno recebe `IN_PROGRESS`: grosso, e **correto para os
onze pontos do backend que perguntam pela semântica** — varredura de
arquivamento, cascata de conclusão, aviso de prazo, proporção da checklist.
O quadro interno desenha por `column_id`, então a grossura não aparece na tela
dele.

**D5 (já em produção) — a coluna é procurada DENTRO do quadro da tarefa.**
`board_and_column_for_status` cravava o quadro do time raiz
(`parent_team_id IS NULL`). Era a resposta certa enquanto havia um quadro só.
O `BoardRepository` passou a ter dois métodos com perguntas diferentes:
`default_board_and_column_for_status` (onde nasce tarefa de topo) e
`column_for_status_in_board` (qual é a coluna deste status NESTE quadro). O
raciocínio completo está no cabeçalho do módulo e não se repete aqui.

## Consequências

- ⚠️ **Duas regras de derivação convivem.** Elas moram num lugar só
  (`app/modules/tasks/domain/board_semantics.py`) e **há teste comparando as
  duas** — mesmo remédio que a 035 usou para a lista da migration versus a do
  serviço. Sem esse teste, a segunda regra é uma cópia que envelhece sozinha.
- O drop do `legacy_status` sai do roteiro e vira **dívida com gatilho escrito**.
  O gatilho: quando o front desenhar todo quadro por colunas vindas da API, a
  ponte deixa de ter leitor. Não antes.
- O colapso de status para quatro sai do roteiro pelo mesmo motivo, e volta a
  ser discutido **com dado**, não por elegância de modelo. O sinal de que
  amadureceu é `PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` caindo
  juntos para perto de zero por várias semanas.
- ⚠️ **A tarefa de quadro interno passa a ter um `status` que ninguém escolheu.**
  Ela aparece em `/minhas-tarefas` agrupada por esse status grosso. É o preço
  aceito, e é o que faz a tela de "minhas tarefas" continuar funcionando sem
  saber que quadros existem (ADR 0034, item 6).
- Enquanto a derivação pela semântica não existir em código,
  `column_for_status_in_board` **levanta** para um quadro sem ponte, de
  propósito: falhar alto impede a tarefa de ser gravada numa coluna arbitrária.

## ⚠️ Correção da consulta de invariante da 0033

A 0033 §Como medir registrou:

```sql
SELECT count(*) FROM task t JOIN board_column c ON c.id = t.column_id
WHERE c.legacy_status IS DISTINCT FROM t.status;   -- 0
```

**Ela para de funcionar no dia do primeiro quadro interno.** Coluna criada por
gente tem `legacy_status` NULL, e `NULL IS DISTINCT FROM 'BACKLOG'` é `TRUE` —
ou seja, toda tarefa do quadro interno passa a contar como violação. Um alarme
que grita sem motivo é desligado, e depois não grita quando deveria.

A 0033 já avisava que a consulta tinha prazo (*"o último instante em que ela
ainda faz sentido"*). A versão que sobrevive escopa a checagem a onde a ponte
existe:

```sql
SELECT count(*) FROM task t JOIN board_column c ON c.id = t.column_id
WHERE c.legacy_status IS NOT NULL
  AND c.legacy_status IS DISTINCT FROM t.status;   -- 0
```

As três invariantes de quadro passam a viver em `backend/scripts/invariantes.sql`,
versionadas. ⚠️ A migration `0011` carrega a versão sem filtro como guarda; ela
**já está em produção e não é editável** — e não há problema: ela rodou num
mundo em que toda coluna tinha ponte, e não roda de novo.

## Alternativas consideradas

- **Colapsar os oito status em quatro antes da Spec 036** (o plano da 0033).
  Rejeitada pelos dados de 06/08: apagaria `PLANNED` (45 vivas, 136 transições),
  `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` da tela, e é o único deploy do
  roteiro sem rollback por imagem.
- **Quadro interno com as oito colunas padrão, herdando `legacy_status`.**
  Rejeitada: é o quadro geral com outro nome. A feature inteira existe para o
  subtime ter colunas próprias.
- **Coluna sem status: `task.status` fica NULL no quadro interno.** Rejeitada:
  `status` é `NOT NULL` e é lido por onze pontos do backend e por
  `/minhas-tarefas`. Cada um deles precisaria de um caminho de exceção, e a
  tela agruparia por um valor ausente.
- **Casar coluna por NOME em vez de semântica.** Já rejeitada na 0033 e
  registrada de novo porque volta toda sessão: quebra em silêncio no primeiro
  rename.
