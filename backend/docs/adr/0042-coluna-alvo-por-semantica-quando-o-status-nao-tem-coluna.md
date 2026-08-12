# 0042 — Status sem coluna no quadro cai na coluna alvo da SEMÂNTICA, e o status é reescrito junto

## Status

Accepted — 11/08/2026. Decisão da **fatia 5b** da Spec 036 (quadro avulso), e
pré-requisito dela: sem esta regra, quadro com menos de 8 colunas é uma
armadilha com data marcada.

É o **par inverso da 0041**. A 0041 respondeu *"que status tem esta coluna?"*
(`coluna → status`, na escrita por `column_id`). Esta responde *"que coluna
recebe este status?"* (`status → coluna`, na escrita por `status`) quando o
quadro não tem coluna para ele. As duas dividem a mesma casa
(`board_semantics.py`) e o mesmo princípio: **a ponte primeiro, a semântica
depois, e nunca "a primeira coluna que achar"**.

Não supersede a **0033** nem a **0032**. Torna executável a decisão original da
**0030** (*"quadro novo nasce com A fazer / Fazendo / Feito"*), que o
`board_defaults.py` registrou como adiada — ver §Contexto.

## Contexto

`BoardRepository.column_for_status_in_board(board_id, status)` procura, dentro
do quadro, a coluna com `legacy_status = :status`. Não achando, levanta
`ValidationError`. **Isso é deliberado e o docstring diz o porquê:** cair para
"a primeira coluna que achar" gravaria a tarefa na coluna errada em silêncio, e
é o defeito que a Spec 035 inteira existe para evitar.

Enquanto todo quadro nasce com as 8 colunas padrão — uma por status, ponte em
todas — essa função nunca falha. **A fatia 5b acaba com essa garantia:** quadro
criado por pessoa nasce com **4 colunas** (decisão de 11/08, ver o
`plan-fatia-5.md`), uma por semântica.

⚠️ **O `board_defaults.py` já previu isto, e adiou pela dependência que agora
foi cumprida:**

> *"OITO COLUNAS, E NÃO AS TRÊS DA ADR 0030. (...) enquanto a coluna é derivada
> do `status`, um quadro de três colunas não tem para onde mandar uma tarefa
> `PLANNED`, `IN_REVIEW`, `EXTERNAL_APPROVAL`, `BLOCKED` ou `CANCELLED` --
> cancelar uma tarefa num workspace novo daria erro, ou a tarefa nasceria sem
> coluna. As três valem quando o front ler as colunas do banco e `status`
> deixar de ser 1:1 com elas."*

O front passou a ler as colunas do banco na **fatia 4c**, e a escrita por
coluna existe desde a **5a**. A condição está cumprida. O que **não** morreu é
o enum: `TaskStatus` tem 8 valores e vai ter 8 valores para sempre —
`ALTER TYPE ADD VALUE` não tem downgrade no Postgres, como o próprio comentário
do `EXTERNAL_APPROVAL` registra (migration `0006`).

⚠️ **Portanto esta regra não é ponte de transição. É permanente.** O produto
vai ter, para sempre, de responder "onde cai o status X num quadro que não tem
coluna para ele".

### ⚠️ Quatro e oito: por que existem os dois

Leia isto antes do mapa, porque a confusão entre as duas camadas é o que torna
esta ADR difícil de ler três semanas depois.

**O produto tem QUATRO estados**, e sempre teve: início, meio, fim, cancelado.
No código é `ColumnSemantic` (`OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`). É a
classificação de verdade — é ela que decide se cobra prazo, se a tarefa é
terminal e se entra na varredura de arquivamento.

**Os OITO valores de `TaskStatus` não são um segundo conjunto de estados: são
as oito colunas do Quadro geral do Marketing, fossilizadas.** Quando essas
colunas foram pedidas, o sistema não separava "coluna" de "status" — coluna
*era* status (ADR 0033). Cada coluna pedida virou um valor de enum. A semântica
de 4 só nasceu na Spec 035, e a partir dela os 8 viraram **ponte de
compatibilidade** (`legacy_status`).

⚠️ **Ou seja: os 4 mandam, os 8 são resíduo — e resíduo permanente**, porque
`ALTER TYPE` não remove valor no Postgres. Quadro novo nasce com 4 colunas, uma
por semântica, e não precisa dos outros quatro valores para nada. **Esta ADR é
a regra que traduz os 8 para os 4 quando um quadro não conhece os 8.**

### O mapa medido (11/08/2026)

`TaskStatus` → `ColumnSemantic`, lido de `board_defaults.COLUNAS_PADRAO`:

| status | semântica |
|---|---|
| `BACKLOG` | `OPEN` |
| `PLANNED` | `OPEN` |
| `IN_PROGRESS` | `IN_PROGRESS` |
| `IN_REVIEW` | `IN_PROGRESS` |
| `EXTERNAL_APPROVAL` | `IN_PROGRESS` |
| `BLOCKED` | `IN_PROGRESS` |
| `COMPLETED` | `DONE` |
| `CANCELLED` | `CANCELLED` |

⚠️ **É 8:4, e é a MESMA assimetria da 0041, lida na outra direção.** Quatro
status caem em `IN_PROGRESS` e dois em `OPEN`. Num quadro de 4 colunas, quatro
dos oito status não têm coluna própria: `PLANNED`, `IN_REVIEW`,
`EXTERNAL_APPROVAL` e `BLOCKED`.

**E a produção confirma que isso é aceitável.** Medição do Quadro geral em
11/08: *Aprovação Interna* **4**, *Aprovação Externa* **1**, *Cancelado* **0**
— cinco cards em 176, contra 42 em *Em Andamento* e 87 em *Concluído*. As
colunas que somem no quadro de 4 são as que a operação praticamente não usa. A
decisão de 4 colunas não é economia de código: é o uso medido.

## Decisão

**D1 — `column_for_status_in_board` ganha um segundo degrau, nesta ordem:**

1. **coluna com `legacy_status = :status`** → é ela. Exato, sem perda. Cobre as
   8 colunas padrão, que são **100% da produção hoje** (um quadro, 8 colunas, 0
   sem ponte — consulta 5 do `invariantes.sql`);
2. **não achando: coluna com `is_default_target = TRUE` e
   `semantic = semantica_do_status(status)`** → é ela;
3. **não achando nenhuma das duas: `ValidationError`, como hoje.** A trava alta
   continua existindo para o caso que continua sendo impossível de responder —
   quadro sem nenhuma coluna daquela semântica.

⚠️ **A ordem é a decisão inteira.** Invertida, uma tarefa `EXTERNAL_APPROVAL`
no Quadro geral pararia em *Em Andamento* em vez de *Aprovação Externa*, e
**nenhum portão pegaria**: o resultado é uma coluna válida, do quadro certo,
com semântica certa. Aparece como card no lugar errado na tela de todo mundo,
depois do deploy.

**D2 — ⚠️ O STATUS É REESCRITO PELA COLUNA QUE RECEBEU A TAREFA.** Caindo no
degrau 2, o status gravado **não é o pedido**: é
`status_da_coluna(legacy_status, semantic)` da coluna de destino — a função da
0041, sem função nova.

Num quadro de 4 colunas, `status=BLOCKED` resulta em coluna *Em Andamento* e
**`status=IN_PROGRESS`**.

Isto não é acabamento, é o que sustenta a **invariante 3** do
`invariantes.sql` (*"a coluna é a do status certo, só onde existe a ponte"*).
Sem a reescrita, uma tarefa `BLOCKED` numa coluna cujo `legacy_status` é
`IN_PROGRESS` **põe a invariante 3 em diferente de zero** — e ela é uma das
seis que a conferência de produção lê como "0 = sem defeito". Perder a
invariante custa mais do que preservar um status que aquele quadro não sabe
representar.

É também a direção que a 0041 já cravou: **a coluna é a fonte, o status é o
derivado.**

**D3 — o mapa `status → semântica` é FIXO, no código, ao lado do mapa da
0041.** Não é derivado de `COLUNAS_PADRAO`.

⚠️ `COLUNAS_PADRAO` é um **layout de quadro**, não uma classificação de status.
Derivar dela faria "mudar as colunas com que o quadro nasce" mudar, em
silêncio, "o que cada status significa" — dois conceitos com ciclos de vida
diferentes amarrados por acidente. As duas cópias precisam **concordar**, e o
teste de equivalência é o que garante isso, no mesmo desenho já usado por
`test_a_regra_da_COLUNA_e_a_do_STATUS_concordam` e por
`test_quadro_novo_nasce_igual_ao_migrado`.

**Casa:** `app/modules/tasks/domain/board_semantics.py`, função pura, sem
banco, ao lado de `status_da_coluna` e `TERMINAL_SEMANTICS`. ⚠️ **Um lugar
só.** O degrau 2 da D1 é SQL no repositório; a classificação é domínio puro.

**D4 — o mínimo de um quadro é UMA coluna `OPEN` e UMA coluna `DONE`.** Não é
"uma por semântica". O critério não é simetria, é **medição de quem escreve
status sozinho**, sem ninguém pedindo (levantamento de 11/08):

| semântica | escrita automática | obrigatória? |
|---|---|---|
| `OPEN` | `TaskService.create` — toda tarefa nasce em `BACKLOG` | **sim** |
| `DONE` | cascata de conclusão (`task_service.py:402, 842, 1431` → `complete_descendants`) | **sim** |
| `IN_PROGRESS` | nenhuma | não |
| `CANCELLED` | nenhuma — só aparece no mapa de semântica e na LEITURA de terminais do `archival.py` | não |

⚠️ **A assimetria é o ponto.** Um quadro sem coluna `DONE` faz *concluir uma
tarefa-mãe* explodir para quem clicou, num quadro que essa pessoa talvez nem
conheça — a cascata alcança subtarefa em quadro alheio. Já um quadro sem
`Cancelado` só significa que ali cancelar não é um conceito, e a tela não
oferece. O primeiro é erro de terceiro; o segundo é escolha de quem monta o
quadro.

**Portanto o CRUD recusa (`422`) apagar a última coluna `OPEN` ou a última
`DONE`, e permite apagar as outras duas.** Um quadro de três colunas —
*Backlog / Em Andamento / Concluído* — é válido, e é literalmente o que a
ADR 0030 tinha decidido antes de ser adiada.

**D5 — apagar coluna com tarefas dentro PERGUNTA o destino; não move sozinho.**
A operação abre um aviso com o número de tarefas e um selector: *"para qual
coluna?"*. Coluna vazia é apagada direto, sem pergunta.

- **o selector oferece todas as outras colunas do quadro**, não só as da mesma
  semântica. Concluir ou cancelar um lote é coisa legítima de querer, e proibir
  força a pessoa a fazer card por card;
- ⚠️ **destino terminal (`DONE` ou `CANCELLED`) muda o aviso.** Mandar 12
  tarefas para *Concluído* não é mover, é **concluir 12 tarefas**: dispara a
  cascata das subtarefas, muda a proporção da checklist, começa o relógio de
  `terminal_since` da varredura de arquivamento e mata os avisos de prazo. O
  aviso diz isso, com o número. Destino não-terminal: aviso simples;
- **o status de cada tarefa movida é reescrito pela coluna de destino** (D2), e
  cada uma gera linha em `task_history`. Transacional.

⚠️ **A D5 responde "para onde vão estas tarefas". A D4 responde "o quadro
continua funcionando depois". São problemas diferentes e as duas travas são
necessárias** — o selector não impede alguém de apagar a última coluna `DONE`
escolhendo *Backlog* como destino, e é aí que a cascata quebra na semana
seguinte.

⚠️ **`is_default_target` ganha leitor de verdade aqui** — é o degrau 2 da D1
que a consulta, e o CRUD tem de mantê-la única por semântica presente no
quadro. Até 10/08 a flag existia **sem nenhum leitor**, e o handoff daquela
sessão registra que a fixture com `Backlog` como primeira por posição *e* como
alvo padrão fez uma sabotagem passar verde: a regra certa e a errada davam a
mesma resposta. **A fixture desta ADR tem de separar as duas** — a coluna alvo
não pode ser a primeira por posição.

## Consequências

**Boas.**

- Quadro de 4 colunas passa a ser seguro, e a decisão original da 0030 fica
  executável 5 dias depois de ter sido registrada como adiada.
- **Nada muda em produção no dia do deploy.** O Quadro geral tem ponte nas 8
  colunas, então o degrau 1 responde sempre e o degrau 2 nunca é alcançado. A
  fatia 5b-1 é, por construção, um no-op em produção — e é por isso que ela vai
  primeiro.
- O CRUD de coluna ganha a regra de destino sem inventar nada: quem escolhe é a
  pessoa (D5), e o status resultante sai da coluna escolhida (D2).
- **Quadro de três colunas passa a ser possível**, cumprindo a ADR 0030 cinco
  dias depois de ela ter sido registrada como adiada.
- **Mover tarefa entre quadros fica barato** (`plan.md` da 036, adendo). O que
  encarecia era mapear a tarefa para uma coluna do destino; esta ADR entrega
  esse mapa. Segue não priorizado, mas por escolha, não por custo.

**Ruins, e aceitas.**

⚠️ **Num quadro de 4 colunas ninguém consegue marcar uma tarefa como
"Bloqueado".** A requisição tem **êxito** e a tarefa vira `IN_PROGRESS`. Perda
semântica em escrita bem-sucedida é o pior tipo de silêncio, e a mitigação
**não é no backend**: depois da 4c o front desenha por colunas, então a
interface daquele quadro **não oferece** status que ele não tem. Se alguma tela
ainda oferecer os 8 status fixos, ela mente. Item de conferência visual
obrigatória da 5b.

⚠️ **Escrita por API continua podendo pedir qualquer um dos 8.** O front não
oferecer não impede a requisição. O comportamento é definido (D2), não é erro,
e é o correto — só não é o pedido.

⚠️ **Cascatas e varreduras precisam ser relidas contra isto, uma vez.**
`complete_descendants` escreve `COMPLETED` (semântica `DONE`) e a duplicação
copia o status dentro do mesmo quadro — ambos seguros em quadro de 4 colunas,
porque `DONE` sempre tem coluna. ⚠️ **"Seguros" aqui é leitura, não medição.**
A fatia 5b tem de listar os caminhos que escrevem `status` e cobrir cada um com
um teste em quadro de 4 colunas.

⚠️ **A 0041 avisou que o mapa dela não é derivável de `is_default_target`, e
esta ADR usa `is_default_target`.** Não há contradição — são direções
diferentes: a 0041 vai de coluna para status e precisa responder mesmo em
quadro malformado, então usa mapa fixo; esta vai de status para coluna, e
"coluna" só existe dentro de um quadro concreto. **A D4 é o que garante que o
quadro responde aos status que o sistema escreve sozinho**, e é por isso que
ela é recusa do CRUD e não boa prática.

⚠️ **Quadro sem coluna `IN_PROGRESS` ou sem `CANCELLED` é válido e o degrau 3
volta a existir para ele.** Um `PATCH status=CANCELLED` por API num quadro sem
*Cancelado* recebe `422`. Está correto — é pedir ao quadro uma coisa que ele
não representa — mas **a tela não pode oferecer essa ação**, ou o 422 vira erro
inexplicável para quem clicou.

## Como medir

- **Sabotagem 1 (D1, ordem):** inverter os degraus — consultar
  `is_default_target` antes de `legacy_status`. Tem de cair o teste que afirma
  que `status=EXTERNAL_APPROVAL` no Quadro geral (8 colunas) devolve a coluna
  *Aprovação Externa*, e não *Em Andamento*. **Nomeie o teste que cai, não
  conte quantos caem.**
- **Sabotagem 2 (D2, reescrita):** gravar o status pedido em vez do derivado.
  Tem de cair o teste que manda `status=BLOCKED` num quadro de 4 colunas e
  afirma `status == IN_PROGRESS`. ⚠️ **Se nenhum teste cair, esse teste não
  existe** — e ele é o único que separa esta ADR da invariante 3 quebrando em
  produção no primeiro quadro criado.
- **Sabotagem 3 (D4):** tirar a recusa e deixar apagar a última coluna `DONE`.
  Tem de cair o teste que apaga *Concluído* de um quadro de 4 colunas e espera
  `422` — e, junto, o teste que conclui uma tarefa-mãe cuja subtarefa vive
  nesse quadro. ⚠️ **O segundo é o que prova o motivo da trava.** Sem ele, a
  regra é simetria; com ele, é a cascata.
- **Contraprova da D4:** apagar *Cancelado* e *Em Andamento* do mesmo quadro
  tem de **passar**, deixando um quadro de duas colunas funcional. Se a trava
  recusar, ela virou "uma por semântica" de novo.
- **Sabotagem 4 (D5):** mover as tarefas para a coluna alvo da semântica
  ignorando o destino escolhido. Tem de cair o teste que apaga uma coluna
  `IN_PROGRESS` mandando as tarefas para *Backlog* e afirma que elas estão em
  *Backlog* com status `BACKLOG` — não em *Em Andamento*.
- **Round-trip, nas 8 colunas padrão:** `status → coluna → status` devolve o
  mesmo status. É o teste que prova que produção não se mexe.
- **Round-trip, nas 4 colunas base:** `status → coluna → status` devolve o
  **canônico da semântica** — `BLOCKED` entra e `IN_PROGRESS` sai. É o teste
  que prende a D2.
- **Equivalência dos mapas:** para cada linha de `COLUNAS_PADRAO`,
  `semantica_do_status(linha.legacy_status) == linha.semantica`. Prende a D3.
- **Invariante 3** do `invariantes.sql` tem de continuar `0` depois do primeiro
  quadro de 4 colunas existir em produção. ⚠️ Antes disso ela é **ausência de
  caso**, não aprovação — mesma leitura que a consulta 7 já recebeu.

## Alternativas consideradas

**Quadro novo nascer com as 8 colunas, como o Quadro geral.** Rejeitada por
produto: replica em todo quadro novo três colunas que a operação usa para 5
cards em 176. E não resolve nada — a primeira coluna que alguém apagar
recria exatamente este problema, só que sem ADR nenhuma dizendo o que fazer.

**Manter a `ValidationError` e proibir quadro com menos de 8 colunas.**
Rejeitada: é a decisão da 0030 sendo desfeita para não escrever 20 linhas de
regra, e transformaria "apagar coluna" numa operação impossível no CRUD que a
5b existe para entregar.

**Fallback para a primeira coluna por posição.** Rejeitada — é literalmente o
que o docstring de `default_board_and_column_for_status` proíbe, com o motivo
escrito: grava na coluna errada em silêncio. `is_default_target` não é "a
primeira que achar"; é a coluna que o schema já marcou como destino daquela
semântica.

**Preservar o status pedido e afrouxar a invariante 3.** Rejeitada: troca uma
invariante medida em produção por um status que aquele quadro não sabe
desenhar. A tarefa apareceria em *Em Andamento* com status `BLOCKED`, e as duas
telas que leem status (`/minhas-tarefas`, `/arquivadas`) discordariam do
quadro. ⚠️ **Dois números discordando sobre a mesma coisa é pior que um número
velho** — lição da 4c, registrada no handoff de 10/08.

**Coluna `is_default_target` opcional, com o degrau 3 como caminho normal.**
Rejeitada: transforma erro de configuração em erro do usuário final, no momento
em que ele arrasta um card.

**Exigir uma coluna de CADA semântica em todo quadro (proposta original da
D4).** Rejeitada em 11/08: é simetria sem causa. `IN_PROGRESS` e `CANCELLED`
não têm nenhuma escrita automática, então proibir apagá-las só impede a pessoa
de montar o quadro de 3 colunas que a ADR 0030 já tinha aprovado. A trava tem
de proteger a cascata, não a estética do schema.

**Mover as tarefas automaticamente para a coluna alvo da semântica ao apagar
uma coluna (proposta original).** Rejeitada em 11/08: é movimentação em lote
pelas costas de quem clicou. O selector da D5 custa uma tela a mais e devolve a
escolha — inclusive a de concluir ou cancelar o lote, que a regra automática
tornaria impossível.
