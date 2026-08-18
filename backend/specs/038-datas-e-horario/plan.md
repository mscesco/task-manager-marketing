# Plano — Spec 038, datas e horário

> Escrito em 18/08/2026, **antes de código**, para a Camila conferir. Mesmo
> formato do `plan.md` da Spec 036: uma seção por fatia, com o que sobe, os
> guardiões e as armadilhas medidas.
>
> ⚠️ **A ORDEM É A → B, e não é preferência.** A fatia A não tem migration e não
> toca em dado nenhum; a B converte 1085 linhas de produção e depende de **três
> decisões de produto** que estão em aberto (§Decisões que faltam, no `spec.md`).
> Entregar a A primeiro põe valor na tela sem gastar a janela de rollback barato.

---

## Fatia A — `start_date` na tela — ⬜ ESCOPO

**Sem migration. Sem mudança de backend. Sem decisão pendente.**

⚠️ **O CAMPO EXISTE PONTA A PONTA MENOS O INPUT.** Está no banco
(`operational.py:279`), no tipo de resposta e no corpo do `create` e do `update`
(`api.ts:1609,1705,1716`). O que não existe é lugar de digitar. **É a doença do
`corEhHex` e do `notify_deadline`: capacidade completa sem leitor** — e desta vez
o conserto é o mais barato dos três.

### O desenho, decidido em 18/08

A cápsula **"Datas"**, com "Data de início" e "Data de entrega", aberta a partir
do chip de data no detalhe da tarefa.

⚠️ **NÃO É PADRÃO NOVO.** Os chips `Coluna`, `Prioridade` e `Sem Projeto` já são
gatilhos que abrem painel suspenso. O chip de data é o único que **não abre
nada** hoje. Esta fatia liga o que já existe ao redor dele, e por isso não paga
custo de aprendizado.

### O que sobe

- A cápsula "Datas" no `TaskDetail`, com os dois campos.
- `start_date` no `TaskModal` (criação), ao lado do prazo — o Figma do modal
  "Nova tarefa" já desenha "Início" e "Término".
- ⚠️ **A regra "início não pode ser depois da entrega"**, e ela é DECISÃO:
  recusa, ou aceita e avisa? Hoje não existe nem regra nem par de campos para
  quebrá-la. **Recomendo AVISAR e aceitar** — prazo que antecede o início é
  comum em replanejamento, e recusar obriga a apagar um para mexer no outro.
  Se for recusar, mora no serviço (o backend é quem tem os dois valores).

### Guardiões

| sabotagem | esperado |
|---|---|
| `start_date` não entra no corpo do `create` | teste de corpo (⚠️ `body: input` é seguro; campo a campo, não) |
| limpar a data manda `""` em vez de `null` | teste: o payload leva `null` |
| a cápsula fecha ao clicar dentro | teste de componente — usar o padrão do painel de filtros (`Board.tsx:252`), **não** o `useFecharAoClicarFora`, que é de modal |
| início depois da entrega passa sem nada | teste da decisão acima, qualquer que seja ela |

⚠️ **TESTE DE COMPONENTE QUE MOCKA A API NÃO É GUARDIÃO DE CORPO.** Vale a
herança da Spec 036: o corpo se prende em teste de `lib/`.

---

## Fatia B — horário no prazo — ⬜ ESCOPO, BLOQUEADA

⚠️ **NÃO COMECE ESTA FATIA ANTES DAS TRÊS RESPOSTAS** da §Decisões que faltam
(`spec.md`): fuso, hora do backfill, e se horário é obrigatório. A terceira é a
que mais muda o tamanho, e não foi feita em 18/08.

### A migration

`ALTER TABLE ... TYPE timestamptz` em **seis** colunas, e as seis juntas:

| coluna | por quê |
|---|---|
| `task.due_date` | o pedido |
| `task.start_date` | par do de cima; deixar um `date` e outro `timestamptz` põe dois tipos no mesmo formulário |
| `project.due_date`, `project.start_date` | existem (`operational.py:115-116`) e o Figma do modal de projeto os desenha |
| `task.due_soon_notified_for` | ⚠️ **dedup da Spec 023** — ver abaixo |
| `task.overdue_notified_for` | ⚠️ idem |

⚠️⚠️ **SE OS DOIS ÚLTIMOS FICAREM `date`, O JOB VOLTA A NOTIFICAR TODO DIA,
PARA TODAS AS TAREFAS COM PRAZO.** Eles guardam *o `due_date` para o qual o
aviso já saiu*, e o job só notifica quando difere do atual. Tipos diferentes ⇒
sempre diferente ⇒ aviso sempre. **As 26 pessoas recebem.** Isto é o defeito
mais caro previsível desta fatia, e ele não aparece em teste que não rode o job.

⚠️ **O PADRÃO JÁ EXISTE NO MODELO:** `task.completed_at` é
`DateTime(timezone=True)`. A migration copia a forma dele, não inventa.

⚠️ **O BACKFILL É `23:59`, E NÃO `00:00`.** Ver o achado 3 do `spec.md`: com
meia-noite, toda tarefa com prazo hoje fica atrasada de manhã e todo prazo
passado ganha um dia. São **1085 linhas** em produção.

⚠️ **ORDEM DE DEPLOY: esta migration CAI NA SEGUNDA EXCEÇÃO do `DEPLOY.md`?**
Ela não acrescenta coluna a model existente — ela **troca o tipo** de colunas
que o código já lê. Isso é pior que os dois casos documentados: o código velho
lendo `timestamptz` num campo que ele trata como `date` compara string errado
(ver achado 1). **Logo: código e migration na MESMA janela, e a janela é curta.**
Escreva a ordem no cabeçalho da migration, porque o `DEPLOY.md` diz que o
cabeçalho ganha do padrão.

### O que sobe no front

- ⚠️ **A comparação de atraso deixa de ser `string < string`.** Hoje é
  `t.due_date < hoje` com `hojeISO()` (`Board.tsx:82,1315`), e o comentário do
  `hojeISO` **proíbe** `new Date(due_date)` por escorregar um dia. A fatia tem de
  resolver as duas coisas de uma vez: comparar instantes, e não escorregar fuso.
  **Isto mora em `lib/`, puro e testado** — não dentro do `Board.tsx`.
- O seletor de hora na cápsula "Datas" da fatia A.
- `lib/status.ts` — as duas funções que **zeram a hora de propósito** para contar
  dias (`:183-185` e `:215-217`). "Atrasada 2 dias" continua sendo em dias, ou
  passa a ser "atrasada há 5 horas"? **Decisão de produto, e ela não está na
  lista das três.**

### Guardiões

| sabotagem | esperado |
|---|---|
| a comparação continua sendo `string < string` | teste de `lib/`: prazo hoje às 09:00, agora 18:00 ⇒ **atrasada** (é o caso que falha em silêncio hoje) |
| `new Date(due_date)` no lugar da comparação certa | teste com fuso negativo: prazo 19/08 23:00 não pode virar 20/08 |
| o backfill escreve `00:00` | teste de migration: linha com `date` 19/08 vira 19/08 **23:59** |
| os dedup ficam `date` | ⚠️ **teste que roda o job DUAS vezes** e afirma que a segunda não notifica. Sem ele, este defeito chega em produção como 26 pessoas recebendo aviso repetido |
| tarefa sem prazo entra no filtro | continua aparecendo em todos (decisão da Camila, já valendo) |

⚠️ **O TESTE DO DEDUP É O MAIS IMPORTANTE DA FATIA**, e é o menos óbvio: ele não
testa a tela nem o tipo, testa **o job rodando duas vezes**.

---

## Fatias que NÃO são desta spec

| pedido | onde vai |
|---|---|
| reações em comentário (joia, coração) | spec própria. Tabela `comment_reaction` com `UNIQUE (comment_id, user_id, emoji)`. ⚠️ **FK composta carregando `workspace_id`**, como faz o `Comment` — tabela nova que não siga isso fura o isolamento entre workspaces |
| paginação do quadro | Spec 039 (redesenho), junto com o teto de carregamento |
| contagem de subtarefa agregada no backend | o conserto real do teto — achado da Camila em 18/08. Modelo: `assignee_ids_for_tasks` (ADR 0025), uma query em lote para a página inteira |
