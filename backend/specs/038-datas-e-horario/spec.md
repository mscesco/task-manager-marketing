# Spec 038 — Data de início na tela, e horário no prazo

> **Status: escopo escrito em 18/08/2026, decisões de produto PENDENTES (duas,
> na §Decisões que faltam).** Pedido da Camila em 18/08, junto com a conferência
> do deploy da Spec 036.
>
> Destino: `backend/specs/038-datas-e-horario/spec.md`

## Objetivo

Duas coisas que parecem uma, e o que separa as duas é uma migration.

**A)** `start_date` existe no banco, na API e no cliente HTTP — e **não tem
campo em tela nenhuma**. Esta spec dá tela a ele.

**B)** `due_date` é `date` puro: a coluna não tem onde guardar hora. Esta spec
troca o tipo para `timestamptz` e faz o **horário decidir se a tarefa está
atrasada**, que foi o pedido literal.

⚠️ **A "A" NÃO TEM MIGRATION E A "B" TEM.** Elas são fatias separadas por
decisão da Camila em 18/08, e a ordem é A → B: a A entrega valor sem tocar em
dado, e a B mexe em 1085 linhas de produção.

**Não** entrega: reações em comentário (pedido no mesmo dia, é outra spec —
tabela nova, e juntar as duas numa migration só faria voltar uma arrastar a
outra); paginação do quadro; nem o seletor de data do Figma como componente
reaproveitável fora do detalhe da tarefa.

---

## O que o código faz hoje (medido no repo, 18/08)

| Fato | Onde |
|---|---|
| `task.start_date` e `task.due_date` são `Date` — o tipo `date` do Postgres, que **fisicamente não guarda hora** | `db/models/operational.py:279-280` |
| `project.start_date` e `project.due_date` são `Date` também — e o Figma do modal de projeto pede Início/Término | `db/models/operational.py:115-116` |
| `task.completed_at` **já é** `DateTime(timezone=True)` → `timestamptz`. **O padrão que a fatia B segue já existe no modelo** | `db/models/operational.py:281` |
| `due_soon_notified_for` e `overdue_notified_for` são `Date`, e existem para **dedup do aviso** (Spec 023): o job só notifica se diferem do `due_date` atual | `db/models/operational.py:287,296` |
| `start_date` **já viaja na API**: está no tipo de resposta, no `create` e no `update` | `web/lib/api.ts:1609,1705,1716` |
| O `TaskModal` mexe **só** em `due_date`. `start_date` não tem input em lugar nenhum do front | `web/components/TaskModal.tsx:205,556,626` |
| "Atrasada" é **comparação de STRING**: `t.due_date < hoje`, com `hoje` em `YYYY-MM-DD` | `web/components/Board.tsx:1315`, `hojeISO()` em `:82` |
| O filtro de prazo tem três estados (`todos`/`atrasadas`/`em-dia`) e **tarefa sem data aparece em todos** (decisão da Camila) | `web/lib/filtrosQuadro.ts:261`, `Board.tsx:1308` |
| `lib/status.ts` **zera a hora de propósito** para contar dias: `new Date(ano, mês, dia)` e divisão por `86400000` | `web/lib/status.ts:183-185,215-217` |
| Produção tem **1085 tarefas** (consulta 5 do `invariantes.sql`, 18/08) | `backend/scripts/invariantes.sql` |

### Os três achados que desenham a spec

**1. ⚠️ A COMPARAÇÃO DE ATRASO É `string < string`, E ISSO QUEBRA EM SILÊNCIO
COM HORÁRIO.** O comentário do `hojeISO()` explica por que é assim hoje:

> "Hoje" como YYYY-MM-DD no fuso LOCAL. `due_date` vem do backend como date
> pura (sem hora), então a comparação é string vs string (ISO ordena certo).
> **Nada de `new Date(due_date)`: isso interpretaria como UTC e escorregaria 1
> dia.**

Com `timestamptz`, o `due_date` chega como `"2026-08-19T18:00:00Z"`. Comparado
com `"2026-08-19"`, a string **mais curta é MENOR** — prefixo perde. Então
`due_date < hoje` fica **`false` para uma tarefa cujo prazo já passou hoje**, e
a tarefa deixa de aparecer no filtro "Atrasadas" sem erro, sem log e sem nada na
tela. ⚠️ **É a mesma família do `str.replace` que falha calado.**

E a saída óbvia — `new Date(due_date)` — é exatamente a que o comentário proíbe,
por escorregar um dia. **A fatia B tem de resolver as duas ao mesmo tempo.**

**2. ⚠️ O DEDUP DO AVISO DE PRAZO COMPARA DOIS TIPOS QUE VÃO DEIXAR DE BATER.**
`due_soon_notified_for` e `overdue_notified_for` guardam *o `due_date` para o
qual o aviso já saiu*, e o job só notifica quando diferem do atual — é o
self-healing da Spec 023. Trocando `due_date` para `timestamptz` e deixando os
dois como `date`, a comparação passa a ser sempre "diferente", e **o job volta a
notificar todo dia, para todas as tarefas com prazo**. As 26 pessoas recebem.
⚠️ **Os três campos mudam juntos ou nenhum muda.**

**3. ⚠️ CONVERTER `date` PARA `timestamptz` ESCOLHERIA UMA HORA PARA 1085 LINHAS,
E `00:00` ESTARIA ERRADO.** Hoje uma tarefa com prazo "19/08" só é atrasada
**depois que o dia 19 acaba** (`due_date < hoje`). Um backfill com meia-noite
poria toda tarefa com prazo hoje em atraso **de manhã**, e daria um dia de atraso
a todo prazo passado.

⚠️ **ESTE ACHADO MATOU O PRÓPRIO DESENHO QUE O ORIGINOU, e o registro fica.** Ele
foi escrito para dizer "cuidado com o backfill"; ao responder que **horário não é
obrigatório** (Camila, 18/08), o desenho mudou para `date` + `time` NULO e
**deixou de haver backfill**. Os três achados desta seção continuam valendo como
descrição do que a alternativa `timestamptz` custaria — e é por isso que ela foi
recusada, e não por gosto. Ver §Decisões.

---

## ⚠️ Decisões — a 3 foi respondida, e ela redesenhou a fatia B

### 3. Horário é obrigatório? — ✅ **NÃO** (Camila, 18/08)

Uma tarefa pode ter data **sem** hora. E essa resposta **derruba o desenho de
`timestamptz`**, que este documento propunha uma hora antes:

⚠️ **UM `timestamptz` NÃO CONSEGUE DISTINGUIR "19/08 SEM HORA" DE "19/08
00:00".** São dois estados de produto — "vence no dia 19" e "vence à meia-noite
do dia 19" — e um único valor os representa igual. Guardar assim exigiria uma
coluna-bandeira ao lado (`due_tem_hora`), que é a mesma informação partida em
duas colunas que precisam concordar sempre.

### ⚠️ O desenho que a resposta 3 destrava: `date` + `time` NULO

**`due_date` continua `date`. Entra `due_time`, `time` NULO.** "Sem hora" é
`due_time IS NULL` — um estado, não um valor especial.

| | `timestamptz` (recusado) | `date` + `time` NULO (recomendado) |
|---|---|---|
| backfill nas 1085 linhas | **obrigatório**, e `00:00` erra por um dia | **nenhum** — `NULL` já significa o comportamento de hoje |
| `due_soon_notified_for` / `overdue_notified_for` | mudam junto **ou o job notifica todo dia** | **não mudam** |
| `t.due_date < hoje` no front | quebra em silêncio (achado 1) | **continua valendo** para tarefa sem hora, que é 100% do dado existente |
| tipo de coluna alterado em produção | 6 | **0** — só uma coluna nova, nula |
| distinguir "sem hora" | precisa de bandeira | é o próprio `NULL` |

⚠️ **A ADIÇÃO É SEGURA E A TROCA DE TIPO NÃO É.** O `DEPLOY.md` diz, na
§Atualização: *"coluna nullable e tabela nova que ninguém referencia não afetam
o código velho, que nunca pergunta por elas"*. `due_time` nulo cai exatamente
nisso. Trocar o TIPO de coluna que o código já lê é pior que os dois casos
documentados lá.

⚠️ **E `time` SEM FUSO É O QUE VOCÊ QUER**, não um defeito: "18:00" é hora de
relógio de parede, e é isso que a pessoa digita. O fuso entra uma vez só, na
comparação, e não em cada linha.

**O preço, honesto:** duas colunas que **têm de ser lidas juntas sempre**, e
ordenar por prazo vira `ORDER BY due_date, due_time NULLS LAST`. É menos elegante
e muito mais barato.

### 1. O horário é de qual fuso? — ⬜ **ainda aberta**

O servidor roda em UTC; o time está no Brasil. Com `date` + `time`, o fuso não
entra no dado — entra só em **uma** comparação ("já passou?").

- **(a) Fuso fixo do workspace (`America/Sao_Paulo`).** Um time, um país. O
  horário significa a mesma coisa para todo mundo que olha. **Recomendado.**
- (b) Fuso de quem olha (do navegador). Transforma "atrasada" em coisa que
  depende de quem pergunta — duas pessoas vendo a mesma tarefa em estados
  diferentes.

### 2. Hora do backfill — ✅ **não existe mais**

A pergunta só existia no desenho de `timestamptz`. Com `due_time` nulo, **não há
backfill**: as 1085 linhas continuam significando exatamente o que significam
hoje.

### 4. Nova, e ela nasceu do desenho novo: "atrasada há quanto?"

`lib/status.ts` conta em **dias inteiros** e zera a hora de propósito
(`:183-185`, `:215-217`). Com hora, "Atrasada 2 dias" continua em dias, ou vira
"atrasada há 5 horas" quando for menos de um dia? ⚠️ **Só afeta tarefa COM
hora** — sem hora, nada muda.

---

## Fora de escopo

| | por quê |
|---|---|
| reações em comentário | tabela nova (`comment_reaction`), spec própria. ⚠️ **Migration separada de propósito:** "já vai ter migration" não economiza arquivo nenhum, e juntar faz o rollback de uma arrastar a outra |
| paginação do quadro | ataca o teto de carregamento, não o prazo |
| `notify_deadline` por coluna | decisão de 13/08 (Spec 036): não fazer |
| seletor de data reaproveitável | o Figma pede a cápsula "Datas" no detalhe da tarefa; generalizar antes de haver segundo uso é a doença do `corEhHex` |
