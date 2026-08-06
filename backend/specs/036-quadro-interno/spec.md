# Spec 036 — Quadro interno de subtime

> **Status: decisões fechadas (ADR 0034, 0035, 0036). Fatia 1 escrita em
> 07/08.** Esta spec entrega o quadro que o subtime cria para si, e por
> tabela a primeira superfície de API de quadro do produto.
>
> Destino: `backend/specs/036-quadro-interno/spec.md`

## Objetivo

Hoje existe **um** quadro no workspace: o geral, do time raiz (ADR 0032). O
`/quadro/[teamId]` que o SEO abre é esse mesmo quadro filtrado pela lente do
time — não tem linha em `board`, não se cria, não se edita, não se apaga.

Esta spec entrega o **quadro interno**: linha de verdade em `board`, com
colunas próprias e tarefas próprias, criado pelo supervisor do subtime. O
subtime passa a poder organizar o trabalho dele com as colunas dele, sem que
isso apareça no quadro de todo mundo.

⚠️ **Duas coisas passam a se chamar "quadro" e elas são diferentes.** A
distinção, os nomes de tela e o ciclo de vida de cada uma estão na **ADR
0034** e não se repetem aqui.

**Não** entrega: mover tarefa entre quadros, arquivar quadro, tela de
restauração. Ver §Fora de escopo.

---

## O que o código faz hoje (medido no repo, 06–07/08)

| Fato | Onde |
|---|---|
| Existe **1** quadro em produção, do time raiz; 536 tarefas vivas, 86% na raiz | ADR 0032 |
| `Board` e `BoardColumn` usam só `UUIDPrimaryKeyMixin` + `TimestampMixin` — **nenhum dos dois tem `deleted_at`** | `db/models/boards.py` |
| `BoardService` tem **um** método: `create_default_board`. Sem CRUD de coluna, sem apagar, sem renomear | `board_service.py` |
| `BoardRepository` **não** estende `BaseRepository` e usa SQL textual nas duas consultas — o filtro de soft delete não chega nele sozinho | `board_repository.py` |
| `grep -rn "board" app/modules/tasks/api/` devolve **zero linhas**. `board_id` e `column_id` não estão em `TaskResponse`, `TaskListItem` nem `TaskDetailResponse` | `api/schemas.py` |
| `grep -n "board" app/modules/auth/domain/permissions.py` devolve **zero linhas**. `board.manage.subteam` não existe | `permissions.py` |
| `visible_team_ids` já entrega "subtime + ADMIN + MANAGER da raiz", e é consumido por 7 arquivos | `auth/domain/team_scope.py` |
| `semantic` e `is_default_target` são escritos pelo `BoardService` e **lidos por ninguém**. `notify_deadline` ganhou leitor na F1a | grep em `app/` |
| Índice parcial `board_um_padrao_por_time`: único em `team_id WHERE is_default` — **não sabe de `deleted_at`** | `db/models/boards.py` |
| Índice parcial `board_column_um_status_por_quadro`: único em `(board_id, legacy_status) WHERE legacy_status IS NOT NULL` — várias colunas com NULL coexistem no mesmo quadro | `db/models/boards.py` |
| **8** arquivos de produção do front importam `@/lib/status`; **5** usam `STATUSES` (9 usos em `minhas-tarefas`, 1195 linhas, zero teste de componente) | grep em `web/` |
| O arreio de teste sabe montar dois quadros desde 07/08 (`make_board`, `make_task(board_id=)`) | `tests/integration/factories.py` |

### Os três achados que desenham a spec

**1. A FK composta protege um caminho de escrita e não o outro.** Na EDIÇÃO de
status, `board_id` fica e só a coluna muda: o par `(coluna de outro quadro,
board da tarefa)` não existe e a FK **recusa** — erro alto. Na SUBTAREFA, ela
nasceria com `board_id` **e** coluna do mesmo quadro errado: par internamente
consistente, a FK **aceita**, e a árvore fica partida entre dois quadros sem
erro e sem tela. É por isso que a F2 veio **antes** de existir um segundo
quadro, e não junto.

**2. O soft delete de quadro é manual, e por isso tem de vir antes do
endpoint.** A ADR 0034 decidiu que apagar quadro interno apaga as tarefas
junto — mas `board` não tem `deleted_at`, e o `BoardRepository` não herda o
filtro automático do `BaseRepository`. Se o `GET /boards` nascer sem
`deleted_at IS NULL`, ele lista quadro apagado a partir do dia em que apagar
existir: **defeito plantado numa fatia e colhido em outra**, com a leitura
passando verde no meio.

**3. A tarefa não carrega o quadro na API, e sem isso o front não tem o que
desenhar.** "`Board.tsx` parametrizado por colunas vindas da API" recebe a
lista de colunas e não sabe em qual colocar cada card. Existe uma fatia de
contrato entre o endpoint de quadros e o front, e ela não estava no roteiro
até 07/08.

---

## Decisões

As decisões de escopo amplo estão em ADR e **não se repetem aqui**:

| assunto | ADR |
|---|---|
| Lente × quadro interno; nomes de tela; apagar leva as tarefas; N quadros por subtime; `/minhas-tarefas` sem seletor; sem `board.description` | **0034** |
| Tarefa herda `team_id` do TIME DO QUADRO; visibilidade sai da lente; designar para fora do subtime é proibido | **0035** |
| Coluna sem `legacy_status` deriva o status pela SEMÂNTICA; coluna resolvida dentro do quadro da tarefa | **0036** |

⚠️ A **0034 reverte** uma linha da 0030 (*"arquivar, nunca apagar"*). Quem ler
a 0030 primeiro vai achar que esta spec está errada. Está na §Status da 0034.

O que é local desta entrega e não vira ADR:

**E1 — A migration de `deleted_at` vem sozinha, antes de tudo.** Coluna
nullable que ninguém lê não afeta o código velho; ela sobe, fica parada, e é o
que permite ao `GET /boards` já nascer com o filtro **e** com teste que pode
falhar (o teste apaga um quadro na mão).

**E2 — O filtro de soft delete vale onde o quadro é DESCOBERTO, não onde ele é
RECEBIDO.** `default_board_and_column_for_status` descobre e filtra;
`column_for_status_in_board` recebe `board_id` de quem já resolveu o quadro e
não filtra — um `JOIN` ali seria custo no caminho mais quente do produto
(`create`, uma vez por nó na duplicação) para proteger um estado que a 0034 já
impede. Isso é **invariante, não constraint**: virou a consulta 4 de
`scripts/invariantes.sql`.

**E3 — `board_column` não ganha `deleted_at`.** Apagar coluna é outra
operação: pela 0030 ela exige escolher a coluna de destino das tarefas e some
de verdade. Schema para decisão não tomada é especulação.

**E4 — Quadro PADRÃO não pode ser apagado.** O índice parcial
`board_um_padrao_por_time` não sabe de `deleted_at`: um padrão apagado
continuaria bloqueando a criação de um novo padrão para aquele time, e o time
ficaria sem quadro e sem como recriar. A trava é no serviço, na fatia 5. Se um
dia o padrão virar apagável, o índice ganha `AND deleted_at IS NULL` na mesma
migration.

---

## Critérios de aceitação

1. `alembic upgrade head` aplica em banco vazio e no dump; `downgrade -1` e
   `upgrade head` de novo funcionam.
2. `alembic revision --autogenerate` sai **vazio** depois (portão do CI). ⚠️ Em
   particular, nenhum `op.alter_column` mexendo em `comment`: o texto do
   `COMMENT` de `board.deleted_at` é idêntico ao do `SoftDeleteMixin`.
3. Quadro apagado **não** é descoberto como quadro geral — o repositório
   levanta em vez de devolvê-lo.
4. `GET /api/v1/boards` devolve só os quadros que o usuário alcança:
   supervisor de outro subtime não vê o quadro alheio; ADMIN vê todos;
   nenhum quadro de outro workspace aparece (tenant isolation).
5. `GET /api/v1/boards` não devolve quadro apagado.
6. Toda resposta de tarefa carrega `board_id`, `column_id` e o nome do quadro
   — e **nunca** o `board_id` de um quadro fora do alcance de quem pergunta.
7. Tarefa criada em quadro interno recebe o `team_id` **do time do quadro**,
   inclusive quando quem cria é ADMIN ou MANAGER da raiz (ADR 0035):
   ```sql
   SELECT count(*) FROM task t JOIN board b ON b.id = t.board_id
   WHERE b.is_default = false AND t.team_id IS DISTINCT FROM b.team_id;  -- 0
   ```
8. Designar alguém de fora do time do quadro interno é **recusado no serviço**,
   com mensagem — não só ausente do seletor.
9. Uma tarefa numa coluna sem `legacy_status` recebe o status derivado da
   semântica (ADR 0036), e a regra tem teste comparando as duas derivações.
10. Apagar quadro interno apaga as tarefas junto, o aviso **diz o número**, e
    apagar quadro **padrão** é recusado (E4).
11. As cinco consultas de `scripts/invariantes.sql` voltam `0` (a 5 é
    contexto, não invariante).
12. `pytest` com `TEST_DATABASE_URL`, **zero skipped**. Front verde nos três
    portões.

---

## Fora de escopo

- **Mover tarefa entre quadros.** Nasce dentro, morre dentro (ADR 0034, item
  3). Se precisar existir, é spec própria com aviso na tela dizendo quem deixa
  de ver.
- **Arquivar quadro** (o que a 0030 previa). A 0034 escolheu apagar; arquivar
  continua possível e não está nesta spec.
- **Tela de restauração de quadro apagado.** Consequência aceita da 0034: o
  conserto é `UPDATE` no banco, na mão.
- **`board_column.deleted_at`** e o CRUD de "apagar coluna com destino" (E3).
- **Colapso dos oito status para quatro** e **drop do `legacy_status`.** Fora
  do caminho crítico desde a ADR 0036, com gatilho escrito.
- **Teste de componente do `TaskDetail`** (2186 linhas). Dívida com gatilho: a
  spec que mexer em comentário ou subtarefa paga.
- **Terceiro nível de time.** ADR próprio.
- **Menu lateral de dois níveis** para trocar de quadro (ADR 0034, item 5).

---

## Fronteira de risco

⚠️ **A fatia 2 é a primeira superfície de API com permissão do roteiro.** É o
primeiro lugar onde um erro vira dado exposto para quem não deveria ver. Não é
fatia para atacar logo depois de uma rodada de correções, e ela precisa dos
três testes do critério 4 antes de qualquer outra coisa.

⚠️ **Quem tem permissão de criar quadro é exatamente quem dispara o
vazamento.** Pela Spec 024, ADMIN e MANAGER só existem na raiz; se a tarefa
criada no quadro interno herdar o `default_team_id` de quem criou, ela nasce
da raiz — e tarefa da raiz todo mundo alcança. É a ADR 0035, e é a razão de o
critério 7 ser uma consulta e não um teste só.

⚠️ **Apagar quadro passa a ser a operação de maior alcance do produto por
clique**, e não tem volta pela tela. O aviso com o número é parte da entrega,
não acabamento.

⚠️ **Ordem de deploy: migration ANTES do código.** `Board` ganha `deleted_at`;
o SQLAlchemy emite lista explícita de colunas, então o código novo contra o
schema velho quebra toda leitura de quadro pelo ORM. Mesmo caso da `0008` e da
`0010`, e a exceção está no `DEPLOY.md`.

⚠️ **`STATUSES` deixa de ser `const` síncrona e vira dado assíncrono** na
fatia 4. Estado de carregando, de erro, e um default antes de o dado chegar —
o `<select>` do `TaskModal` inicializa em `"BACKLOG"` cravado, linha 104. São
8 arquivos, e o maior deles não tem teste de componente.

⚠️ **Todo teste de árvore precisa de DOIS quadros.** Até 06/08 todo teste
vivia num mundo de um quadro só, e era exatamente por isso que a consulta
cravada no quadro do time raiz passou despercebida desde a 035.
