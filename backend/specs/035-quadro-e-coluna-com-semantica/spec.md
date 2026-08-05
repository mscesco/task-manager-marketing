# Spec 035 — Quadro e coluna com semântica (fundação)

> **Status: pronta para execução. Decisões fechadas em 05/08 (ADR 0030).**
> Esta spec entrega a FUNDAÇÃO e **nada muda na tela**. Configurar coluna,
> quadro personalizado de subtime e o front lendo colunas do quadro são
> specs seguintes.
>
> Destino: `backend/specs/035-quadro-e-coluna-com-semantica/spec.md`

## Objetivo

Hoje "coluna" não existe: a coluna **é** o `task.status`, um ENUM nativo do
Postgres. Enquanto for assim, não há quadro configurável — e trocar o ENUM
por texto livre quebraria em silêncio os quatro subsistemas que dependem do
**significado** do status.

Esta spec cria as entidades `board` e `board_column`, faz a coluna **declarar
sua semântica**, e passa a derivar `task.status` dela. Depois disso, criar
coluna nova é configuração; hoje é mudança de schema.

**Não** entrega configurabilidade. A distinção está em §Fora de escopo.

---

## O que o código faz hoje (medido no repo, 05/08)

| Fato | Onde |
|---|---|
| `task_status` é ENUM **nativo** com **8** valores: `BACKLOG`, `PLANNED`, `IN_PROGRESS`, `IN_REVIEW`, `EXTERNAL_APPROVAL`, `BLOCKED`, `COMPLETED`, `CANCELLED` | `db/models/enums.py` |
| `EXTERNAL_APPROVAL` entrou pela Spec 026, via `ALTER TYPE ADD VALUE` — **sem downgrade** (Postgres não remove valor de enum) | `0006_external_approval_status` |
| A cor da coluna é **token de tema** (`var(--status-*-dot)`), não hex — Spec 031 C1a | `web/lib/status.ts` |
| 39 referências a `TaskStatus`/`task_status` em 9 arquivos do backend | grep |
| 104 referências a nomes de status em 16 arquivos do front | grep |
| Apenas **11** perguntam pela semântica (`COMPLETED`/`CANCELLED`) | grep |
| Concluir o pai cascateia conclusão pra subárvore; pula `COMPLETED`, `CANCELLED` e **arquivadas** | `task_repository.complete_descendants` |
| A cascata roda **só na transição** pra `COMPLETED` (`if virou_concluido:`) | `task_service.update` |
| Varredura arquiva terminal parada há N dias: `COMPLETED` por `completed_at`, `CANCELLED` por `updated_at` | `task_repository.list_stale_terminal` |
| Aviso de prazo pula `COMPLETED`, `CANCELLED` **e `BLOCKED`** | `deadline_notify_service.py:46` |
| `UPDATE` textual **não** dispara o `onupdate` do ORM; `updated_at` não tem trigger | `complete_descendants` (comentário) |
| FK composta com `workspace_id` é o padrão do schema | `db/models/*.py` |
| Índice único **parcial** já é técnica usada | `team_unica_raiz_por_workspace` |
| Head das migrations | `0007_token_version` |
| Um único time raiz por workspace; hoje a raiz é o **Marketing**, com 7 subtimes | banco de produção, 05/08 |

### Os três achados que desenham a spec

**1. O que quebra não é a contagem de referências, é o silêncio.** Trocar 143
referências é braçal. Mas se a coluna virar texto livre, os 11 pontos que
perguntam "isto está concluído?" param de funcionar **sem levantar exceção**:
o job arquiva errado, a proporção da checklist mente, o aviso de prazo não
dispara. É a assinatura de defeito que este repositório já produziu três vezes
numa única sessão. Daí a decisão central: **a coluna declara o que significa.**

**2. `BLOCKED` carrega comportamento escondido.** Ele não é só um rótulo — está
na lista de status que não recebem aviso de prazo, com a justificativa "não há
o que agir enquanto travada". Isso é uma **quinta** informação que o ENUM
carrega por acidente. Virar semântica resolveria um caso; virar **flag por
coluna** (`avisa_prazo`) resolve o caso geral e entrega mais: "Aguardando
cliente" deixa de cobrar prazo sem precisar de código.

**3. Manter o ENUM é o que torna a migração incremental.** `task.status`
continua existindo e passa a ser **derivado** da semântica da coluna. Os 11
pontos continuam funcionando sem saber que colunas existem, o front continua
funcionando sem mudar uma linha, e a entrega inteira é invisível — portanto
reversível por rollback de imagem, que é como esta operação faz deploy.

---

## Decisões

### D1 — Duas tabelas novas: `board` e `board_column`

`board`: `id`, `workspace_id`, `team_id`, `name`, `is_default`, timestamps.

`board_column`: `id`, `workspace_id`, `board_id`, `name`, `color`, `position`,
`semantica`, `avisa_prazo`, `is_destino`, timestamps.

`semantica` é ENUM nativo novo — `column_semantic` — com quatro valores:
`ABERTA`, `EM_ANDAMENTO`, `CONCLUIDA`, `CANCELADA`. ENUM nativo, e não texto
com CHECK, para seguir o que o schema v5 já faz com os outros quatro enums.

⚠️ **Nesta spec existe UM quadro por workspace**, o geral, do time raiz.
Quadro personalizado de subtime é spec seguinte; o modelo já o comporta.

### D2 — `task` ganha `board_id` e `column_id`, com FK composta

Os dois `NOT NULL` ao fim da migração, com
`FOREIGN KEY (column_id, board_id) REFERENCES board_column (id, board_id)`.

⚠️ **A FK composta é o ponto da decisão, não detalhe.** Ela torna impossível
**no banco** que uma tarefa aponte para coluna de outro quadro. Sem ela, esse
estado é questão de tempo, não aparece na tela, e entra na mesma família de
`path`/`depth` — corrupção sem sintoma e sem conserto por deploy.

### D3 — `status` passa a ser DERIVADO, com um único ponto de escrita

Mover a tarefa de coluna é a operação; `status` é consequência:

| semântica | status gravado |
|---|---|
| `ABERTA` | `BACKLOG` |
| `EM_ANDAMENTO` | `IN_PROGRESS` |
| `CONCLUIDA` | `COMPLETED` |
| `CANCELADA` | `CANCELLED` |

⚠️ **Um ponto de escrita só**, no service. Nenhuma rota grava `status`
diretamente; nenhuma outra função deriva a mesma coisa em outro lugar. Duas
fontes para a mesma verdade é dívida — o que a torna administrável é ela ser
escrita num lugar só.

**Compatibilidade:** `status` recebido no PATCH continua aceito e é traduzido
para a **coluna de destino daquela semântica no quadro da tarefa** (ver D4).
Isso mantém o front atual funcionando com o backend novo, e é o que preserva
a possibilidade de rebobinar só um dos dois.

### D4 — A coluna de destino é MARCADA, não deduzida

`board_column.is_destino`, com índice único **parcial** em
`(board_id, semantica) WHERE is_destino` — mesma técnica do
`team_unica_raiz_por_workspace`.

Uma função só, `coluna_de_destino(board_id, semantica)`, atende os quatro
lugares que precisam da resposta: onde nasce a tarefa nova, para onde a
cascata de conclusão manda cada descendente, o que a ação "cancelar" faz, e a
tradução do PATCH de compatibilidade.

**Rejeitada: "a primeira daquela semântica, pela ordem".** Zero campo, zero
controle — e amarra duas coisas sem relação: reordenar colunas passaria a
mudar o destino da cascata sem ninguém pedir. O conserto seria travar a
reordenação ou avisar sobre ela, ou seja, administrar para sempre um problema
que um booleano elimina. **Com `is_destino`, a ordem visual não significa nada
além de ordem visual.**

### D5 — `avisa_prazo` na coluna substitui o `BLOCKED` cravado

`DeadlineNotifyService` deixa de ler uma lista de status e passa a perguntar
`avisa_prazo` da coluna. Terminal continua fora por semântica.

### D6 — `terminal_desde` vira o relógio do arquivamento

`task.terminal_desde` é gravado quando a tarefa **entra** numa coluna terminal
(`CONCLUIDA` ou `CANCELADA`) e limpo quando sai. `list_stale_terminal` passa a
usá-lo no lugar de `completed_at`/`updated_at`.

⚠️ **É proteção, não refatoração.** Quando a semântica de uma coluna puder ser
editada (spec seguinte), marcar "Aprovação" como terminal numa terça à tarde
faria o job arquivar de madrugada tudo que está parado ali há mais de 20 dias
— de uma vez, sem aviso. É o formato do incidente das 177 emissões. Com
`terminal_desde`, a mudança de semântica grava `now()` e o relógio recomeça.

**Equivalência exigida:** a migração popula `terminal_desde` com exatamente o
que o job lê hoje (`completed_at` para concluídas, `updated_at` para
canceladas). O conjunto que a varredura seleciona tem de ser **idêntico**
antes e depois — é critério de aceitação, não expectativa.

Diferença conhecida e aceita: hoje editar uma tarefa cancelada reinicia o
relógio dela (porque `updated_at` muda); com `terminal_desde` congelado, não
reinicia mais. É correção, não regressão.

### D7 — A migração preserva as SETE colunas atuais

O quadro migrado nasce com uma coluna por status existente, **com os nomes de
hoje e na ordem de hoje**, mapeadas assim:

⚠️ **São OITO, e os rótulos são os que a tela já mostra hoje** (`web/lib/status.ts`).
Inventar rótulo novo aqui mudaria a tela no dia do deploy, que é o oposto do
que esta migração existe para fazer.

| status | nome da coluna | semântica | flags |
|---|---|---|---|
| `BACKLOG` | Backlog | `OPEN` | `is_default_target` |
| `PLANNED` | Planejado | `OPEN` | |
| `IN_PROGRESS` | Em Andamento | `IN_PROGRESS` | `is_default_target` |
| `IN_REVIEW` | Aprovação Interna | `IN_PROGRESS` | |
| `EXTERNAL_APPROVAL` | Aprovação Externa | `IN_PROGRESS` | |
| `COMPLETED` | Concluído | `DONE` | `is_default_target` |
| `CANCELLED` | Cancelado | `CANCELLED` | `is_default_target` |
| `BLOCKED` | Bloqueado | `IN_PROGRESS` | `notify_deadline = false` |

⚠️ **`BLOCKED` é a ÚLTIMA linha, e isso não é detalhe de formatação.** A ordem
desta tabela vira o `position` gravado no banco pela migration `0008`, e
`position` é a ordem que a tela vai ler quando o front passar a montar as
colunas a partir do quadro. `web/lib/status.ts` desenha Bloqueado **depois** de
Cancelado, e `Board.tsx` renderiza na ordem daquele array — logo, "na ordem de
hoje" significa Bloqueado por último. A primeira versão desta tabela agrupava
`BLOCKED` com os outros `IN_PROGRESS` por semântica; a `0008` copiou daqui, e a
divergência só apareceria na fatia do front, como regressão visual num diff que
não contém a causa.

⚠️ **Nomes de coluna e de enum em INGLÊS, valores de rótulo em português.**
A spec original escrevia a semântica como `ABERTA/EM_ANDAMENTO/...`; o schema
v5 inteiro usa identificadores em inglês (`is_archived`, `completed_at`,
`task_status`), e um enum em português no meio deles é uma pedra no sapato de
quem ler daqui a um ano. O que a pessoa vê continua em português, porque vem
da coluna `name`.

⚠️ **`color` guarda o TOKEN, não hex.** A Spec 031 (C1a) tirou os hex fixos
justamente porque não invertiam no tema escuro. As colunas migradas levam
`var(--status-backlog-dot)` e companhia; coluna criada à mão no futuro pode
levar hex. O campo é string livre e o front já resolve os dois.

⚠️ **Quadro NOVO nasce com três** (A fazer / Fazendo / Feito) — isso é a spec
seguinte. Migrar para três empurraria sete colunas de tarefas reais em três no
dia do deploy, mudando a tela de todo mundo de uma vez, que é exatamente o que
esta migração existe para evitar. Enxugar é reorganização, e é do time.

### D8 — Regra de integridade: sempre ao menos uma ABERTA e uma CONCLUIDA

O quadro precisa de ao menos uma coluna de início e uma de conclusão, cada
uma com `is_destino`. Sem início, a tarefa nova não tem onde nascer; sem
conclusão, a cascata não tem destino e a varredura **para em silêncio**.

Nesta spec não há como violar (não há CRUD de coluna). A regra entra como
**teste** agora, para que a spec seguinte não a descubra depois.

### D9 — A cascata de conclusão já é escrita para vários quadros

Concluir o pai move cada descendente para a coluna `CONCLUIDA` **do quadro
dele**. Nesta spec há um quadro só, então é sempre o mesmo — mas o código
consulta `coluna_de_destino(board_da_tarefa, CONCLUIDA)` desde já. Escrever
agora custa a mesma linha; escrever depois custa reabrir a cascata.

### D10 — Nada de tela, nada de CRUD

Sem endpoint de criar/editar/apagar coluna. O único acréscimo na API é
**leitura**: `GET /api/v1/boards/current` devolvendo o quadro e suas colunas,
para a spec seguinte do front consumir.

---

## Critérios de aceitação

1. `alembic upgrade head` aplica em banco vazio e no dump de produção.
2. `alembic revision --autogenerate` sai **vazio** depois (portão do CI).
3. Nenhuma tarefa sem coluna e nenhuma coluna de outro quadro:
   ```sql
   SELECT count(*) FROM task WHERE column_id IS NULL AND deleted_at IS NULL;
   SELECT count(*) FROM task t JOIN board_column c ON c.id = t.column_id
   WHERE c.board_id <> t.board_id;
   ```
   As duas voltam `0`. A segunda por construção — medida assim mesmo, porque
   constraint que ninguém testou é promessa.
4. **Contagem por semântica depois == contagem por status antes.** Guardar os
   dois números antes de rodar a migração.
5. **O conjunto da varredura é idêntico antes e depois** (D6). Rodar
   `list_stale_terminal` nos dois estados e comparar os ids.
6. Concluir um pai continua concluindo a subárvore, agora via
   `coluna_de_destino`.
7. Aviso de prazo continua pulando concluída, cancelada e bloqueada — agora
   por `avisa_prazo`, não por lista de status.
8. `PATCH /tasks/{id}` com `status` continua funcionando e move a tarefa para
   a coluna de destino correta.
9. `pytest` com `TEST_DATABASE_URL`: 526 + os novos, **zero skipped**.
10. O front **não muda** e continua verde nos três portões.

---

## Fora de escopo

- **Criar, editar, apagar e reordenar coluna.** Spec seguinte.
- **Quadro personalizado de subtime** (ADR 0030, decisão B). Spec seguinte.
- **O front lendo colunas do quadro** — 104 referências em 16 arquivos, quase
  todas no `Board` (1218 linhas) e no `TaskDetail` (2186, sem teste de
  componente). É a maior parte do trabalho e merece spec própria.
- **Terceiro nível de time** (organização acima dos departamentos). ADR próprio.
- **Responsável obrigatório** (ADR 0031). Independente desta.
- **Apagar o ENUM `task_status`.** Cabe num ADR futuro, depois que existir
  rede de teste no front.

## Fronteira de risco

⚠️ **Migração de dados em tabela quente.** `task` é a maior tabela do produto
e a migração escreve em todas as linhas vivas. Medir o tempo contra uma cópia
do dump antes de rodar em produção, e ter o rollback de imagem à mão — que
agora está testado.

⚠️ **A varredura roda de madrugada, pelo n8n.** Se a migração subir num dia em
que o job rode antes da conferência, o critério 5 deixa de ser verificável.
Deployar **depois** da janela do job, ou desligar o fluxo durante a subida.

⚠️ **`UPDATE` em massa não avisa o ORM.** Todo teste que conferir estado
depois de um update textual tem de ler do banco (`db.refresh`), senão mede
memória. Foi assim que a inversão da cascata de arquivamento foi pega em
05/08 — e o único teste que sobreviveu à sabotagem sobreviveu por conferir
apenas número, não estado.
