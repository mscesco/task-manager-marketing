# Spec 042 — Contagem agregada de subtarefa

**Status:** proposta (aguardando aprovação)
**Escopo:** backend (`app/`) **e** frontend (`web/`) — o contrato muda dos dois lados
**Não toca:** arquivamento, semântica de coluna, autenticação
**Placar na abertura:** Backend **860**, Front **865**, migrations `0014`

> **Numeração:** 042 e não 040/041 porque esses dois já estão nomeados no
> handoff (múltiplos times raiz e reações em comentário). Esta spec é mais
> urgente que as duas, mas renomeá-las custaria mais confusão que o número vale.

---

## 1. Problema, medido em 19/08

| | |
|---|---|
| o quadro carrega | **917** de teto **1000** |
| desses, subtarefa | **670** (73%) |
| cards desenhados | **170** |
| folga até o teto | **83** |

**O quadro carrega 917 para desenhar 170.**

⚠️ **E não é vazamento do arquivamento — testado e descartado** (Spec 039
§6.11.0.1). Das 670 subtarefas, **257 são não-terminais** (198 BACKLOG, 37
IN_PROGRESS, 12 PLANNED, 8 IN_REVIEW, 2 BLOCKED). Item de checklist aberto é
trabalho vivo: o arquivamento não pode tocá-las, hoje nem nunca, **e elas
crescem com o uso**.

⚠️ **Um time pode mover o número sozinho.** SEO tem 10 cards e **110
subtarefas** — 11 por card, contra 2,7 do Marketing. Nenhum ajuste de
arquivamento alcança um hábito de uso.

**Conclusão:** parar de carregar subtarefa é a única saída. Esta spec é como
fazer isso sem quebrar as cinco coisas que dependem delas.

---

## 2. ⚠️⚠️ As CINCO consumidoras da subarvore carregada

Este é o achado que dimensiona a spec. Quem implementar só "um contador no
backend" quebra quatro funcionalidades em silêncio.

| # | consumidora | onde | o que quebra sem subtarefa carregada |
|---|---|---|---|
| 1 | **contador do card** `☑ 5/15` | `Board.tsx:1120-1140` | some de todos os cards |
| 2 | **filtro por pessoa** | `filtrosQuadro.ts::responsaveisPorRaiz` | a raiz some ao filtrar por quem só é responsável **na subtarefa** — que é *"o caso comum: a raiz é a campanha; a pessoa toca uma peça dela"* |
| 3 | **filtro por subtime** | `Board.tsx::subtimesPorRaiz` | mesma coisa, com subtime no lugar de pessoa |
| 4 | **busca por título** | `filtrosQuadro.ts::raizesQueCasamBusca` | procurar por uma subtarefa volta a devolver vazio (regressão de 05/08) |
| 5 | **checklist e duplicação no detalhe** | `TaskDetail`, `duplicacaoSubtarefas.ts`, `Board.tsx:1978` | o painel não tem o que desenhar; duplicar não leva as filhas |

⚠️ **As 2, 3 e 4 não se resolvem com contador nenhum** — elas precisam de
*conteúdo* da subtarefa (responsável, time, título), não de quantidade.

---

## 3. O que o backend passa a devolver

### 3.1. No `TaskListItem` — dois números e dois conjuntos

Mesmo desenho do `assignee_ids_for_tasks` (ADR 0025): **uma query em lote para
a página inteira**, anexada no router depois da listagem, e não uma consulta
por card.

| campo | tipo | escopo | serve a |
|---|---|---|---|
| `subtask_total` | `int` | **filhas DIRETAS** | denominador do `☑ x/y` |
| `subtask_done` | `int` | **filhas DIRETAS** | numerador |
| `subtree_assignee_ids` | `list[UUID]` | **subárvore inteira, raiz junto** | consumidoras 2 **e** 3 |

⚠️⚠️ **DIRETA e SUBÁRVORE não são a mesma coisa, e a diferença é real.** O
`task_service.py:770` diz com todas as letras que *"profundidade não é limitada
em task"*. O contador do card indexa por `parent_task_id` (um nível); o filtro
por pessoa sobe até a raiz com `raizDe()`. Trocar um pelo outro dá número errado
em card com neta.

⚠️ **`subtree_assignee_ids` inclui os da própria raiz**, porque é isso que o
`responsaveisPorRaiz` faz hoje (varre `tasks` inteiro, raiz incluída). Devolver
só os das filhas faria a raiz com responsável próprio sumir do filtro. No SQL
isso sai de graça: o `<@` do LTREE é descendente-**ou-igual**.

### 3.1.1. ⚠️ Não existe campo de subtime — corrigido ao ler o código

A primeira versão desta spec previa um `subtree_team_ids`. **Não serve.** O
`subtimesPorRaiz` (`Board.tsx:1160-1174`) não usa `task.team_id`: ele pega o
**subtime da PESSOA responsável**, via o mapa `memberTeam` que o front já
carrega.

Então a consumidora 3 se resolve sozinha a partir de `subtree_assignee_ids` —
o front faz o mesmo `memberTeam.get(id)` que faz hoje. **Um campo a menos, e
nenhuma regra nova no backend.**

### 3.1.2. `/me/assignments` fica fora

O `me_router` devolve `MyAssignmentsResponse`, forma própria — não é
`TaskListItem`. A tela "Minhas tarefas" mostra subtarefa como card solto (ADR
0004), então o contador de checklist não é a peça dela. **Fora da A1**, e sem
risco de campo nascer zerado em silêncio.

### 3.2. A busca (consumidora 4) NÃO vira campo

Não há campo que represente "casa com um termo que ainda não foi digitado". A
busca por título de subtarefa **tem de ir para o servidor** — o próprio
`raizesQueCasamBusca` já registra isso: *"Busca no servidor é o conserto de
verdade, e é outro tamanho."*

**Decisão:** entra nesta spec como parâmetro `q` na listagem, casando **título
de raiz OU de descendente** e devolvendo **a raiz**. Sem isso, a fatia do front
não pode parar de carregar subtarefa.

⚠️ **Só título, não descrição** — decisão de 05/08 mantida: casando por
descrição o card aparece com o termo em lugar nenhum da tela, e a leitura
honesta é "o filtro bugou".

---

## 4. ⚠️ As quatro regras que a agregação TEM de reproduzir

Estão em `web/lib/subtarefas.ts::progresso` e `Board.tsx:1125-1139`, cada uma
com o defeito que a originou. Errar qualquer uma troca o número na tela de
todo mundo.

**(a) Conta pela COLUNA, não por `status`.**
`column.semantic === "DONE"`. Em 10/08 o card lia coluna e o detalhe lia
`status`, e a mesma tarefa mostrava **"2/2" no card e "(0/2)" no detalhe**.

**(b) `DONE`, não `terminal()`.**
Cancelada **não** conta como concluída. É a distinção que o enum do backend já
registra; usar `terminal()` faria subtarefa cancelada aparecer como entregue.

**(c) Arquivada sai do numerador E do denominador.**
A barra responde *"quanto falta do trabalho vivo"*. Contar o que saiu do fluxo
faria a porcentagem **cair** quando alguém arquiva — o oposto de arquivar.
⚠️ Consequência deliberada: filha só arquivada dá `subtask_total = 0`, e a tela
não desenha contador nem barra.

**(d) Coluna desconhecida não conta como concluída, mas ENTRA no denominador.**
Sumir do denominador inflaria a porcentagem em silêncio.

⚠️ **E `subtask_total` NÃO serve ao aviso de exclusão.** A cascata do
soft-delete (ADR 0005) leva a subárvore **inteira, arquivada ou não** — outro
número. O `subtarefas.ts` existe porque essa troca já foi feita uma vez: o
aviso passou a usar a contagem da checklist e uma tarefa de filhas **só
arquivadas** deixava de avisar, enquanto a exclusão apagava as duas.
**Se o aviso for reusar campo agregado, precisa de um `subtree_size` próprio.**

---

## 5. ⚠️⚠️ A janela otimista — o bug de 10/08 volta se ninguém olhar

Hoje, arrastar um pai para "Concluído" cascateia no banco **e** o card atualiza
na hora, porque a atualização otimista mexe na **coluna** das subtarefas
carregadas e o contador reconta localmente.

**Sem as subtarefas carregadas, não há o que recontar.** O card mostraria
`☑ 0/7` até a resposta do servidor — exatamente o *"contador só mudava depois
de um F5"* que a fatia 4c consertou.

**Saída barata e derivável:** ao mover um card para coluna de semântica `DONE`,
o front faz `subtask_done = subtask_total` localmente, otimista. **Não precisa
das filhas para saber isso** — a cascata do backend conclui a subárvore inteira.

⚠️ **O inverso não vale.** Tirar de "Concluído" **não** descascateia no
backend; as filhas continuam concluídas. Então na saída o front **não** deve
zerar — deve manter o número e deixar a resposta corrigir. Assumir simetria
aqui inventaria um estado que o banco não tem.

**Portão:** teste de componente que arrasta um pai para coluna `DONE` e afirma
o contador **antes** da resposta.

---

## 6. O detalhe continua precisando das filhas de verdade

A ADR front 0003 diz que o detalhe **reusa a lista do quadro**. Se o quadro
para de trazer subtarefa, o painel fica sem checklist, sem duplicação de
filhas e sem o `›` que a Spec 039 §6.3 definiu.

**Decisão:** o detalhe passa a **buscar as filhas ao abrir**.

✅ **E isso não precisa de rota nova:** o `TaskFilters` já aceita
`parent_task_id`. É uma chamada a mais no `open`, sobre um conjunto pequeno.

⚠️ **A ADR front 0003 precisa ser revisitada** — ela deixa de valer para
subtarefa. Superseder ou emendar, mas não deixar contradizendo o código.

---

## 7. O que já existe e barateia a spec

Conferido em `tasks_router.py:80-97` — o `TaskFilters` **já aceita**:

| filtro | serve a |
|---|---|
| `root_only` | ⭐ **o quadro pede só raízes** — é a chave da fatia |
| `parent_task_id` | o detalhe busca as filhas (§6) |
| `team_id` | a lente, se um dia valer a pena |

⚠️ **Correção de uma afirmação minha na Spec 039 §13.1:** eu escrevi que
filtrar por time "depende de o `listTasks` aceitar filtro de time — não
verificado". **Aceita.** A alavanca da lente continua desnecessária (esta spec
a torna redundante), mas o motivo é a redundância, não a falta do filtro.

---

## 8. Fatias

⚠️ **Backend em duas entregas**, porque quem escreve não consegue rodar
`pytest` (não há Postgres na máquina). Foi assim nas 12a/12b e B1/B2, e
funcionou: os erros que sobraram foram de assinatura, não de lógica.

| # | fatia | lado | entrega |
|---|---|---|---|
| **A1** | agregação em lote + os 3 campos no `TaskListItem` | backend | duas queries em lote espelhando as regras do §4, mais o teste de paridade |
| **A2** | `q` na listagem, casando descendente e devolvendo raiz | backend | §3.2 |
| **B1** | detalhe busca as filhas por `parent_task_id`; ADR front 0003 emendada | front | §6 — **vem ANTES da B2**, senão o painel fica vazio |
| **B2** | quadro passa a pedir `root_only`; contador, filtros e busca leem os campos novos | front | §2, e a janela otimista do §5 |

⚠️ **A ordem B1 → B2 não é preferência.** Se a B2 vier antes, o detalhe perde a
checklist. E ⚠️ **B2 só sai de `main` DEPOIS de A1 e A2 estarem lá** — o
Pydantic descarta campo desconhecido em silêncio e o `PATCH`/`GET` volta 200
sem o campo, que foi exatamente o defeito da Spec 038 fatia B2.

---

## 9. Portões

**Backend:** `docker compose run --rm -e TEST_DATABASE_URL=... api-dev pytest`
— **860 na abertura**. Depois: `docker compose up -d --build api-dev`.

⚠️ **Teste de paridade obrigatório**, mesma dupla `pure-domain + SQL` já usada
em `archival.py`, `team_scope.py` e `board_semantics.py`: a agregação em SQL e
a regra do §4 têm de concordar, e um teste compara as duas. Sem ele, o backend
faz uma coisa, o teste unitário prova outra, e os dois ficam verdes.

**Front:** `npx tsc --noEmit`, `npm test` (**865**), `TZ=UTC npm test`,
`npx next build`.

⚠️ **Rota nova ou parâmetro novo leva teste HTTP** — teste de serviço não sabe
se a rota existe.

⚠️ **O que os portões não pegam, e aqui é muito:**

- **o número na tela.** Os testes do front **mocam o `@/lib/api`** — eles
  afirmam o que a tela chama, nunca o que viaja no fio. Contador certo no teste
  e errado em produção é o modo de falha desta spec.
- **`onDragEnd`** não roda em jsdom. A janela otimista do §5 é olho humano.
- **Smoke obrigatório:** abrir uma tarefa com filhas concluídas e arquivadas,
  conferir card × detalhe **mostrando o mesmo número**; filtrar por uma pessoa
  que só é responsável em subtarefa; buscar por título de subtarefa.

---

## 10. Resultado esperado

| | carrega | folga |
|---|---|---|
| hoje | 917 | 83 |
| com `STALE_ARCHIVE_DAYS` 15 | ~830 | ~170 |
| **com esta spec** | **247** | **753** |

E, diferente das outras alavancas, **este número para de crescer com o uso**:
subtarefa deixa de ocupar linha do teto, então o hábito do SEO (11 por card)
passa a não custar nada ao carregamento.
