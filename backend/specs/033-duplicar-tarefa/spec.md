# Spec 033 — Duplicar tarefa

> **Status: pronta para execução. Todas as decisões fechadas em 03/08.**
> D2 = modal pré-preenchido. D4 = subárvore inteira. D5 = sem datas.
> D6 = leva responsáveis. D7 = caixa "levar as subtarefas". D8 = prefixo
> "Cópia de". D9 = descarta e reporta. D10 = arquivada não vem.
>
> Destino: `backend/specs/033-duplicar-tarefa/spec.md`

## Objetivo

Refazer um trabalho que já foi feito hoje exige recriar tarefa e subtarefas à
mão, uma a uma, com responsável obrigatório em cada. Duplicar substitui isso por
um clique mais uma revisão.

**Não** é template. A distinção importa e está registrada na §Fora de escopo.

---

## O que o código faz hoje (medido no repo, 03/08)

| Fato | Onde |
|---|---|
| `create()` calcula `path` e `depth` a partir do pai | `task_service.py:159+` |
| `create()` resolve `team_id` por precedência: explícito → herdado do pai → default do criador | idem |
| `create()` valida projeto (subárvore de time; projeto pessoal alheio → 404) | idem |
| `create()` valida datas (`start_date <= due_date`) | `_validate_dates:654` |
| `create()` grava 1 linha `CREATED` em `task_history` | idem |
| `CreateTaskCommand` aceita `assignee_ids`; aplicação **atômica** — inválido → 422 e a criação inteira reverte | `task_service.py:77-79` |
| `CreateTaskCommand` **não** aceita `position` | `task_service.py:67-79` |
| `CreateTaskCommand` **não** aceita `due_soon_notified_for` nem `overdue_notified_for` | idem |
| Subtarefa herda o time do pai (com teste) | `test_subtask_team_inheritance_db.py` |
| Responsável é **obrigatório** ao criar, no modal e na criação rápida de subtarefa (29/07) | `TaskModal.tsx:242`, `TaskDetail.tsx:~1380` |
| O motivo da regra de 29/07: **44 das 50 tarefas ativas sem responsável eram subtarefas** | comentário no código |
| `filhos: Task[]` no `TaskDetail` são os filhos **DIRETOS** | `TaskDetail.tsx` |
| Não existe limite de profundidade em tarefa (só `depth >= 0`) | `db/models/operational.py` |
| A checklist desenha **um** nível — neto não aparece | `TaskDetail.tsx` |

### Os três achados que desenham a spec

**1. `create()` já resolve tudo, e o que ele NÃO aceita é o que salva a
duplicação.** `position`, `due_soon_notified_for` e `overdue_notified_for` não
entram no comando — caem no default. Isso mata de graça as duas armadilhas
previstas: a cópia não nasce "já avisada" (ver D5) e não colide de posição.

**2. Duplicação tem que ser uma sequência de `create()`, não cópia de linha.**
`INSERT … SELECT`, ou um clone no repositório, passaria por fora de `path`,
`depth`, precedência de time, validação de projeto e `task_history` — em
silêncio, e com tudo verde. Esta é a decisão de arquitetura da spec: ela é a
diferença entre herdar os testes que já existem e ter que refazê-los.

**3. A regra de 29/07 e "duplicar sem responsável" são incompatíveis.**
Se as subtarefas copiadas nascessem sem responsável, uma duplicação de uma
tarefa com 6 filhas geraria 6 órfãs de uma vez — reconstruindo o passivo de 44
mais rápido do que ele foi construído. Ver D6.

---

## Decisões

### D1 — Rota nova: `POST /api/v1/tasks/{id}/duplicate`

O corpo carrega os campos da tarefa-pai **já revisados no modal** mais
`include_subtasks: bool`.

**Alternativa avaliada e rejeitada: campo `copy_subtasks_from` no `POST /tasks`
comum.** Menos superfície, mas contrabandearia a **leitura de outro agregado**
para dentro de uma criação genérica — a autorização de "posso ver a tarefa de
origem?" ficaria implícita num endpoint cujo contrato é "crio uma tarefa nova".
Rota nomeada torna a autorização explícita e o histórico legível.

**Alternativa avaliada e rejeitada: o front chama `POST /tasks` N+1 vezes.**
Zero backend, e **não é atômico**. Se a terceira subtarefa falhar, sobra meia
árvore no quadro e ninguém sabe o que faltou. Ver D9.

### D2 — O modal abre pré-preenchido; não existe duplicação em um clique

Duplicar é "criar, com tudo já preenchido". Um conceito só, não dois.

Três motivos, todos medidos:

- O `TaskModal` **já exige responsável ao criar**. Criação direta contornaria o
  portão que vocês construíram em 29/07. O modal reaproveita de graça.
- O título quase sempre precisa mudar. Duas "Campanha Black Friday" na mesma
  coluna é ruído, e a pessoa renomearia em seguida de qualquer jeito.
- O modal já carrega o filtro de escopo (`foraDoEscopo`, `timeDaTarefaNova`).
  Uma rota que criasse direto teria que reproduzir essa decisão no backend, e a
  regra passaria a existir em dois lugares.

⚠️ **Custo aceito:** o modal edita **uma** tarefa, não a árvore. As subtarefas
são criadas no salvar, sem revisão individual. A caixa da D7 existe para que a
pessoa ao menos **veja** que elas vêm.

### D3 — Duplicar uma subtarefa gera uma **irmã**

Sob o mesmo pai. Não vira tarefa de topo.

Se a cópia virasse de topo, isso seria **promoção**, que é exatamente o
`detach_parent` que ficou fora de escopo em 03/08. Esta decisão é o que mantém
"mover tarefa" fora desta spec de forma limpa.

### D4 — Profundidade da cópia (fechada: **subárvore inteira**)

Duplicar replica a profundidade que já existe; não cria profundidade nova. Mas
falta dizer **quantos níveis** vêm.

- **(a) Subárvore inteira.** Uma cópia é uma cópia. Se existir neto, ele vem.
  ⚠️ O front só conhece os filhos **diretos**, então a caixa da D7 mostraria um
  número menor que o real quando houver neto.
- **(b) Só os filhos diretos.** O número da caixa fica exato e a recursão some.
  ⚠️ Neto é descartado em silêncio — a cópia não é uma cópia.

**Fechada em (a).** O front não desenha neto hoje, então profundidade 2 é um
acidente do produto, não um recurso — e descartar dado em silêncio é pior que
mostrar um número conservador.

⚠️ **Consequência de UI, obrigatória:** a caixa da D7 diz **"Levar as
subtarefas (N diretas)"**. A palavra "diretas" não é enfeite — é o que impede
que a pessoa veja 4, receba 7, e ache que o sistema inventou tarefas.

### D5 — A cópia **não** leva datas (fechada)

Nem `start_date`, nem `due_date`, nem no pai nem nas filhas.

O motivo não é preferência: **é o comportamento do job de prazo.** Se as datas
viessem junto, duplicar uma campanha de março geraria subtarefas já vencidas —
e como `overdue_notified_for` não é copiado (achado 1), a próxima execução do
job dispararia aviso de atraso para todas elas de uma vez.

Isso não é hipótese. O job roda diariamente às 05:00 UTC e emitiu 95
`TASK_OVERDUE` em produção; em 01/08 foram 51 numa única execução.

Regra de produto por trás: se o trabalho está sendo refeito, a data velha nunca
é a data nova.

### D6 — A cópia leva **responsáveis**, no pai e nas filhas (fechada)

Confirmada por você: *"leva exatamente igual o que a tarefa leva"*.

No pai isso significa **pré-preencher o modal** com os responsáveis da original
— quem quiser trocar, troca antes de salvar. Nas filhas, aplicar direto.

Sem isso, a regra de 29/07 vira enfeite: o número 44 volta a subir, e mais
rápido, porque agora sobe de 6 em 6.

### D7 — Caixa "Levar as subtarefas (N)" dentro do modal (fechada)

Marcada por padrão quando `N > 0`; ausente quando `N == 0`.

Existe porque a D2 aceita que as filhas não passam por revisão. A pessoa
precisa **ver** o que vai acontecer antes de confirmar, em vez de descobrir
depois no quadro.

### D8 — Título da cópia (fechada: **prefixo "Cópia de"**)

- **(a) `"Cópia de {título}"`**, truncado ao limite do campo. Evita duas
  tarefas indistinguíveis se a pessoa só apertar Salvar.
- **(b) Título original, sem prefixo.** Menos ruído para apagar, já que a pessoa
  vai renomear.

**Fechada em (a)**, e o prefixo **só no pai** — subtarefa não leva prefixo,
senão a checklist inteira fica com "Cópia de" repetido em cada linha.

⚠️ **Truncar ao limite do campo**, medindo o limite real do `title` antes de
concatenar. Título já no limite mais 9 caracteres de prefixo = 422 numa
operação que a pessoa acha que é um clique.

### D9 — Responsável que não alcança mais a tarefa (fechada: **descarta e reporta**)

Duplicar uma tarefa antiga cujo responsável foi desativado, ou mudou de subtime
e não alcança mais, **falha inteira**: a aplicação de responsáveis é atômica e
devolve 422. Com 6 subtarefas, basta uma.

Duas metades, e elas pedem tratamentos diferentes:

- **Pai — descartar antes de abrir o modal.** O front já tem `foraDoEscopo` e
  `membrosInativos` calculados nessa tela. Quem não passa não entra no
  pré-preenchimento, e a caixa de responsável fica esperando escolha — que é o
  que a regra de 29/07 quer de qualquer jeito.
- **Filhas — descartar em silêncio no backend.** Elas não passam por revisão
  (D2). Um 422 aqui deixaria a pessoa diante de um erro sobre uma pessoa que ela
  não sabe que existe, numa subtarefa que ela não viu.

⚠️ **A filha silenciosa colide com a D6.** Uma subtarefa pode nascer sem
responsável, que é exatamente o que a regra de 29/07 proíbe. É o único ponto
desta spec em que duas regras suas se contradizem, e alguém tem que ceder:

- **(a)** Descartar em silêncio; a subtarefa nasce órfã. Registra em log.
- **(b)** 422 nomeando a pessoa e a subtarefa; a duplicação inteira falha.
- **(c)** Descartar e **avisar na resposta** (`skipped_assignees`), com o front
  mostrando "2 subtarefas ficaram sem responsável" após a criação.

**Fechada em (c).** Não trava a operação, não cria órfão invisível, e devolve
à pessoa exatamente a lista que ela precisa corrigir.

⚠️ **A regra de 29/07 cede aqui, e por escrito.** Uma subtarefa copiada pode
nascer sem responsável quando o responsável original perdeu o alcance. É a
única exceção; ela é **visível** (a tela informa) e é **rara** (exige que
alguém tenha saído do subtime ou sido desativado desde a tarefa original).
Sem esta exceção, duplicar tarefa antiga simplesmente falharia.

### D10 — Subtarefa **arquivada** não é copiada

`paraChecklist(...)` inclui arquivada; a cópia não deve. Duplicar não é hora de
ressuscitar trabalho encerrado, e a contagem da caixa (D7) conta **só as
vivas** — senão a pessoa vê 6, recebe 4, e acha que perdeu duas.

⚠️ Duplicar uma tarefa **pai** arquivada continua permitido. É o caso de "essa
campanha acabou, quero rodar de novo", que é o motivo pelo qual a feature foi
pedida.

### D11 — O que **não** vem junto

Watchers, comentários, anexos, histórico, apontamento de horas, `completed_at`,
`position`, colunas de dedup de prazo. Status da cópia é sempre **BACKLOG**,
independente do status da origem.

Registrado porque cada um deles é uma pergunta que alguém vai fazer depois.

---

## Critérios de aceitação

**Backend**

1. Duplicar sem subtarefas → 1 tarefa nova, BACKLOG, `path`/`depth` corretos
   para o pai indicado.
2. Duplicar com subtarefas → a árvore inteira nasce com `path` e `depth`
   coerentes, conferidos **no banco**.
3. Nenhuma cópia tem `due_date` ou `start_date` (D5).
4. Nenhuma cópia tem `due_soon_notified_for` ou `overdue_notified_for`
   preenchidos.
5. Cada cópia gera **uma** linha `CREATED` em `task_history`.
6. Responsáveis da origem aplicados nas cópias (D6).
7. Subtarefa arquivada da origem **não** é copiada (D10).
8. Duplicar uma subtarefa gera irmã: mesmo `parent_task_id` da origem (D3).
9. Time da cópia segue a precedência normal — herdado do pai novo.
10. Falha no meio → **nada** persiste. Nem a tarefa-pai.
11. Quem não enxerga a tarefa de origem recebe 404, não 403.
12. Duplicar tarefa **arquivada** funciona; a cópia nasce **não** arquivada.

**Front**

13. Botão "Duplicar" no `TaskDetail` abre o modal pré-preenchido.
14. Título vem conforme D8; descrição, prioridade e responsáveis vêm da origem.
15. Campos de data vêm **vazios** (D5).
16. Caixa "Levar as subtarefas (N)" aparece marcada quando N > 0 e some quando
    N == 0.
17. Desmarcar a caixa → só a tarefa-pai é criada.
18. Responsável fora do escopo **não** aparece no pré-preenchimento (D9, pai).
19. Cancelar o modal → nada é criado.

---

## Fora de escopo

- **Templates.** Com duplicar no ar, a maior parte do que foi pedido como
  template está atendida: fixa-se uma tarefa "Modelo: X" e duplica. Template
  como agregado próprio custa ciclo de vida, permissão, migration, tela nova e
  uma decisão de versionamento ("editei o modelo, muda o que já foi criado?")
  que nenhuma outra entrega desta série exige. **Decisão: entregar duplicar e
  esperar 30 dias.** Se o pedido voltar, ele volta com o motivo — e o motivo
  provável é descoberta (achar o modelo sem saber que ele existe), que é uma
  spec diferente da que teria sido escrita hoje.
- **Mover tarefa ↔ subtarefa.** Fora por decisão sua de 03/08.
- **Duplicar em lote / duplicar projeto.**
- **Duplicar a partir do card do quadro.** Só do `TaskDetail` nesta entrega.
- **Recorrência** ("repetir toda segunda"). Precisa de agendador; a única
  máquina de agendamento do produto é o n8n, e ele nem está versionado no repo.

## Fronteira de risco

**Média.** A operação escreve N linhas em `task`, N em `task_history` e M em
`task_assignment`, numa transação só, e mexe em `path`/`depth` — as duas
colunas cuja corrupção não aparece na tela e não tem conserto por deploy.

Três pontos merecem atenção desproporcional:

- **O critério 10.** Duplicação parcial é o pior estado possível: meia árvore no
  quadro, sem nada indicando que faltou. Pior que falhar.
- **O critério 4.** Se as colunas de dedup vierem copiadas — o que acontece se
  alguém "otimizar" trocando a sequência de `create()` por cópia de linha — a
  cópia **nunca** recebe aviso de prazo, e ninguém descobre até alguém perder um
  prazo. Falha silenciosa, sem sintoma.
- **A D9.** É o único lugar onde duas regras suas se contradizem. Qualquer
  escolha ali é visível para o usuário; escolher por omissão é a única opção
  ruim.

⚠️ **`vitest` não enxerga componente.** Os critérios 13-19 não têm cobertura
automática, exceto o que for extraído para `lib/` (ver `plan.md`, Fatia 4).
Conferência visual obrigatória.
