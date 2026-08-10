# 0041 — O status deriva da coluna pela PONTE, e só pela semântica quando não há ponte

## Status

Accepted — 10/08/2026. Decisão da **peça de backend da fatia 5** da Spec 036
(`PATCH /tasks/{id}` aceitando `column_id`).

Não supersede a **0033** (a coluna é derivada do status) nem a **0036** (o
status deriva da semântica da coluna): ela diz **em que ordem** as duas valem
no dia em que a escrita passa a vir por `column_id`, e **corrige o caminho que
a fatia 5 mandava seguir**. O `plan.md` da 036 dizia apenas "ADR 0036:
derivação do status pela semântica, num lugar só" — implementado ao pé da
letra, isso apaga quatro status. Ver *Alternativas consideradas*.

## Contexto

Hoje a escrita anda numa direção só: o front manda `status`, e o backend
resolve a coluna a partir dele (`TaskService.update`, e a subconsulta da
cascata em `TaskRepository.complete_descendants`). O front não tem como mandar
coluna porque não conhece nenhuma — ele desenha o quadro a partir da lista fixa
de status em `web/lib/status.ts`.

A fatia 4c precisa inverter isso: `Board.tsx:onDragEnd` compara
`atual.status === destino` e manda **status**. Enquanto não houver endpoint que
aceite `column_id`, migrar o `Board.tsx` quebra o arrastar — e **nenhum portão
pega**, porque `tsc` e `next build` não leem estado e o drag-and-drop não é
testável em jsdom.

### ⚠️ O mapa medido (10/08/2026)

De `board_defaults.COLUNAS_PADRAO`, as 8 colunas com que todo quadro nasce:

| `legacy_status` | nome | `semantic` |
|---|---|---|
| `BACKLOG` | Backlog | `OPEN` |
| `PLANNED` | Planejado | `OPEN` |
| `IN_PROGRESS` | Em Andamento | `IN_PROGRESS` |
| `IN_REVIEW` | Aprovação Interna | `IN_PROGRESS` |
| `EXTERNAL_APPROVAL` | Aprovação Externa | `IN_PROGRESS` |
| `COMPLETED` | Concluído | `DONE` |
| `CANCELLED` | Cancelado | `CANCELLED` |
| `BLOCKED` | Bloqueado | `IN_PROGRESS` |

⚠️ **A semântica é 8:4 — QUATRO colunas são `IN_PROGRESS` e duas são `OPEN`.**
Derivar o status só dela colapsa Aprovação Interna, Aprovação Externa e
Bloqueado em `IN_PROGRESS`, e Planejado em Backlog. O comentário de
`app/db/models/boards.py:185-196` já dizia isso, com os nomes, desde a Spec
035. A direção `status → coluna` é 1:1; a direção `coluna → status` **só é 1:1
via `legacy_status`**.

⚠️ **E o projeto já decidiu isto uma vez, num ponto de escrita.**
`complete_descendants` resolve a coluna `COMPLETED` de cada descendente por
`legacy_status`, e não pela semântica `DONE`, com a justificativa escrita no
docstring. Esta ADR aplica a mesma regra no caminho inverso — é consistência
com o que já está no ar, não invenção.

## Decisão

**D1 — `PATCH /tasks/{id}` passa a aceitar `column_id`.** A coluna tem de
pertencer ao `board_id` **da tarefa**; se não pertencer, `422` com o envelope
de erro do projeto (`{error:{...}}`). Não é `404`: a coluna existe, ela só não
é dali. `board_id` **nunca** muda por este caminho — mover tarefa de quadro não
existe (ver o adendo no `plan.md` da 036).

**D2 — o status deriva da coluna nesta ordem, e não em outra:**

1. **`legacy_status` preenchido → o status é ele.** Exato, sem perda. Cobre as
   8 colunas padrão, que são 100% da produção hoje (um quadro, 8 colunas, 0 sem
   ponte — consulta 5 do `invariantes.sql`).
2. **`legacy_status` NULL** (coluna criada por gente, que é o caso que a fatia
   5 cria) **→ o status vem da semântica**, por este mapa fixo:

   | `semantic` | status |
   |---|---|
   | `OPEN` | `BACKLOG` |
   | `IN_PROGRESS` | `IN_PROGRESS` |
   | `DONE` | `COMPLETED` |
   | `CANCELLED` | `CANCELLED` |

**Casa da regra:** `app/modules/tasks/domain/board_semantics.py`, ao lado de
`avisa_prazo` e `TERMINAL_SEMANTICS` — função pura, sem banco, testável sem
subir Postgres. ⚠️ **Um lugar só.** Se esta regra aparecer numa segunda
função, ela vai divergir, e nada no banco impede que divirja.

⚠️ **O mapa da alínea 2 NÃO é derivável de `is_default_target`.** Essa flag
responde "para onde vai a tarefa desta semântica" **dentro de um quadro**, e um
quadro de subtime pode não ter nenhuma coluna marcada. O mapa é fixo, no
código, e responde mesmo para quadro malformado.

**D3 — `column_id` e `status` no MESMO payload → `422`.** Recusa explícita, sem
precedência. Precedência silenciosa é dois donos para o mesmo campo, e o
perdedor some sem erro. Quem chama decide o que quer mandar.

⚠️ **A recusa mora no ROUTER, com a `ValidationError` de domínio — e isso foi
MEDIDO, não escolhido por estilo.** A primeira implementação usava um
`@model_validator` do Pydantic, que é o lugar óbvio. Ele devolve **500**: o
`_validation_error_handler` põe `exc.errors()` cru dentro do envelope, e o
`ctx` de um validador custom carrega o próprio objeto `ValueError`, que o
`json.dumps` do Starlette recusa. ⚠️ **É um defeito LATENTE do handler, não
desta entrega** — hoje não existe nenhum `model_validator` no projeto, então
ninguém tinha esbarrado nele. Consertar o handler é commit próprio; até lá,
**regra de request deste projeto não mora em `@model_validator`.**

**D4 — a gravação de `task.column_id` sai de dentro do `if` de status.** Hoje
ela vive dentro de
`if command.status is not None and command.status != task.status`. ⚠️ **Com
duas colunas de mesma semântica e sem ponte — exatamente o que a fatia 5 cria —
mover a tarefa entre elas não muda o status, o bloco não roda, e a tarefa NÃO
SAI DA COLUNA, sem erro nenhum.** Arrastar o card e vê-lo voltar sozinho.

**D5 — mover de coluna gera linha em `task_history`**, com
`build_field_update_entry(field_name="column_id", old=..., new=...)`. Custa uma
chamada. ⚠️ A alternativa é herdar o buraco que a designação já tem
(`old_value`/`new_value` sempre `null`), e esse buraco já custou uma sessão de
arqueologia em 10/08.

## Consequências

**Boas.** A direção que a ADR 0033 prometeu para o fim da ponte passa a
existir, com o campo `legacy_status` ainda vivo e ainda mandando enquanto for a
resposta certa. As 4 telas que hoje escrevem status
(`Board.tsx:onDragEnd`, `app/minhas-tarefas/page.tsx:496`,
`components/TaskDetail.tsx:678`, `components/TaskModal.tsx:887`) ganham um
caminho para migrar. Nenhuma tarefa de produção muda de status ou de coluna no
dia do deploy: para as 8 colunas padrão, `coluna → status → coluna` devolve a
mesma coluna.

**Ruins, e aceitas.**

⚠️ **As duas direções passam a coexistir no código.** `status → coluna`
continua rodando quando a escrita vem por `status`; `coluna → status` roda
quando vem por `column_id`. A D3 (422) é o que impede que as duas disputem a
mesma requisição. O par morre quando o front parar de mandar status —
**depois da 4c, não nesta entrega.**

⚠️ **Numa coluna sem ponte, mudar o status por OUTRO caminho tira a tarefa de
lá.** Uma tarefa em "Aguardando cliente" (`IN_PROGRESS`, sem `legacy_status`)
que receba `status=COMPLETED` — pelo `<select>` do `TaskModal`, ou pela cascata
de concluir a tarefa-mãe — pula para a coluna `Concluído` do quadro. Está
correto (é o que "concluir" significa), mas é **perda de posição sem aviso na
tela**, e vai aparecer como "minha tarefa sumiu da coluna". Registrar no
`plan.md` da fatia 5 como conferência visual obrigatória.

⚠️ **`is_default_target` continua sem leitor.** Esta ADR resolveu a derivação
sem ela, de propósito (ver o aviso da D2). Ela ganha leitor no CRUD de coluna,
ou não ganha nenhum — e aí a fatia 5 tem de justificar por que o campo existe.

## Como medir

- **Sabotagem 1 (D2):** trocar a alínea 1 pela alínea 2 — derivar tudo pela
  semântica. Tem de cair o teste que afirma que `column_id` da coluna
  *Aprovação Externa* devolve `status=EXTERNAL_APPROVAL`. **Nomeie o teste, não
  conte quantos caem.**
- **Sabotagem 2 (D4):** devolver a gravação de `column_id` para dentro do `if`
  de status. Tem de cair o teste que move a tarefa entre duas colunas de mesma
  semântica sem ponte. ⚠️ **Se nenhum teste cair, esse teste não existe** — e
  ele é o único que separa esta ADR de um comentário bonito.
- **Invariante 3** do `invariantes.sql` ("a coluna é a do status certo, só onde
  existe a ponte") tem de continuar `0` depois do deploy.
- **Round-trip:** para cada uma das 8 colunas padrão, `coluna → status →
  coluna` devolve a mesma coluna. É o teste que prova que produção não se mexe.

## Alternativas consideradas

**Derivar só pela semântica, como o `plan.md` da fatia 5 mandava.** Rejeitada:
apaga `PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED`. ⚠️ **E o
estrago é invisível para os portões** — o status resultante é um status
*válido*, então `pytest`, `tsc` e `build` passam. Aparece como card pulando de
coluna na tela de todo mundo, depois do deploy.

**Precedência em vez de 422 quando vierem os dois campos.** Rejeitada: qualquer
ordem que se escolha faz um dos dois campos ser ignorado em silêncio. O front
que mandar os dois está com defeito, e é melhor que ele descubra no 422.

**Expor `legacy_status` no `GET /boards` e traduzir no front.** Rejeitada pela
ADR 0033, e a razão continua valendo: convida o front a se amarrar na ponte que
tem data de demolição, em vez da semântica que fica.

**Casar coluna por NOME.** Rejeitada — precedente já escrito em
`db/models/boards.py`: quebra em silêncio no dia em que alguém renomear
"Bloqueado".
