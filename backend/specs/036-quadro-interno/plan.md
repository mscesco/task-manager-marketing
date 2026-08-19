# Plano — Spec 036 (Quadro interno de subtime)

> ⚠️ **ESTE É O ÚNICO PLANO DESTA SPEC.** A pasta tem `spec.md` e `plan.md`, e
> mais nada — igual a todas as outras specs do repositório.
>
> **Consolidado em 13/08/2026.** Até esta data a 036 era a única spec com
> quatro arquivos: `plan-fatia-5.md` e `sondagem-fatia-4.md` nasceram ao lado
> do `plan.md` em vez de dentro dele, e a sessão seguinte, para não se
> contradizer, **rebaixou o `plan.md` a histórico** apontando para o arquivo
> novo. O arquivo canônico foi demovido para acomodar a exceção. Os dois foram
> absorvidos aqui e apagados; nada do conteúdo deles se perdeu.
>
> ⚠️ **A ABSORÇÃO RENUMEROU A CONFERÊNCIA VISUAL, e havia comentário de código
> citando o número antigo.** Três citavam `plan-fatia-5.md` por item: o item 1
> de lá é o **5** daqui, o 10 é o **17**, e o 12 é o **19**. Foram repontados
> em 17/08. **Se você renumerar de novo, rode
> `grep -rn "conferencia visual" web/ backend/` antes de fechar.**
>
> ⚠️ **SE VOCÊ FOR ESCREVER UMA FATIA NOVA, ESCREVA NESTE ARQUIVO.**",
 Criar um
> `plan-fatia-N.md` ao lado é o que produziu a bagunça que este cabeçalho está
> desfazendo. Seção nova vai no fim da lista de fatias; texto superado vira
> subseção marcada como histórica, como as três que já existem aqui.

## Estado (conferido no `main` em 13/08/2026)

Portões verdes: **backend 846 passed**, **front 791 passed**, `tsc` 0,
`next build` compilando. Migrations `0013` (⚠️ **a `0013` NÃO está em
produção** — ver §Fatia 9). ADRs backend: 42.

⚠️ **A CONFERÊNCIA VISUAL DA FATIA 6 FOI FEITA EM 17/08, e achou SEIS coisas
que os três portões não acharam** — o mesmo padrão da 4c (cinco) e da 5b-6
(duas). Quatro eram defeito, e **duas eram erro da própria lista de
conferência**. Todas fechadas; ver §Fatia 6 e §Conferência visual.

⚠️ **NADA DA FATIA 5b ESTÁ EM PRODUÇÃO.** Tudo commitado em `main`, nada
deployado. O deploy espera a fatia 6 — decisão de 13/08, ver §Ordem de deploy.

| fatia | estado | testes |
|---|---|---|
| **1** — `board.deleted_at` (migration `0012`) | ✅ em produção | — |
| **2** — `GET /api/v1/boards` | ✅ em produção | — |
| **3** — quadro e coluna na resposta de tarefa | ✅ em produção | — |
| **4a** — semântica da coluna no front | ✅ em produção | — |
| **4b** — `/minhas-tarefas` pela API | ✅ em produção | — |
| **4c** — os quatro caminhos de escrita | ✅ em produção | 503→529 |
| **ADR 0042** — coluna alvo por semântica | ✅ escrita | — |
| **5b-1** — os dois degraus em `column_for_status_in_board` | ✅ em `main` | 657→681 |
| **5b-2** — caminhos de escrita por status | ✅ em `main` | 681→685 |
| **5b-3** — permissões + `BoardService` + `POST`/`PATCH` | ✅ em `main` | 685→714 |
| **5b-4a** — criar e renomear coluna | ✅ em `main` | 717→733 |
| **5b-4b** — apagar coluna, duas travas, códigos de erro | ✅ em `main` | 733→765 |
| **5b-5a** — `colunaEquivalente` e `rotuloDeColuna` (lib pura) | ✅ em `main` | 529→541 |
| **5b-5b** — índice de colunas, `/minhas-tarefas`, `/arquivadas`, lente D1 | ✅ em `main` | 541→565 |
| **5b-6** — `board_id` na criação + a tela do quadro avulso | ✅ em `main` | 765→774 / 565→650 |
| **5b-7** — correções de 13/08 (§Fatia 5b-7) | ✅ em `main` | 774→776 / 650→669 |
| **6a** — `reordenar_colunas` (vira etapa do lote) | ✅ em `main` | 776→790 |
| **6b** — `lib/ordemDeColunas` + guardião de corpo | ✅ em `main` | 669→689 |
| **6a-bis** — Quadro geral editável | ✅ em `main` | 790→794 |
| **6a-ter** — `PUT /columns` em lote | ✅ em `main` | 794→807 / 689→691 |
| **6c-1** — `lib/rascunhoDeColunas` | ✅ em `main` | 691→716 |
| **6c-2a/b** — cabeçalho editável + form de criar coluna | ✅ em `main` | 716→736 |
| **6c-3** — `RevisaoDaEdicao` | ✅ em `main` | 736→748 |
| **6c-2c** — a fiação no `Board.tsx` | ✅ em `main` | 748→754 |
| **dívida** — `destinosDoRascunho` + divergência reposta | ✅ em `main` | 754→737 (−20: `EditorDeColunas.test.tsx` apagado) |
| **6c-4** (17/08) — coluna nova desenhada e reordenável no rascunho | ✅ em `main` | 737→745 |
| **6c-5** (17/08) — o texto da coluna vazia no condicional | ✅ em `main` | 745→747 |
| **6a-bis-2** (17/08) — `is_status_bridge` + lápis no Quadro geral | ✅ em `main` | 747→757 / 807→808 |
| **6c-6** (17/08) — o modo de edição não cai no estado vazio | ✅ em `main` | 757→758 |
| **9** (18/08) — nome único de quadro e de coluna, backend | ✅ em `main` | 808→823 |
| **9** (18/08) — barra o nome repetido antes de mandar, front | ✅ em `main` | 758→769 |
| **8** (18/08) — `move` recusa pai em outro quadro | ✅ em `main` | 823→829 |
| **8** (18/08) — em quadro avulso, o time da tarefa é o do quadro | ✅ em `main` | 829→834 |
| **7** (18/08) — apagar quadro + script de resgate, backend | ✅ em `main` | 834→842 |
| **7** (18/08) — confirmação por digitação, front | ✅ em `main` | 769→788 |
| **conferência 18/08** — rota de `GET`/`DELETE` de quadro (o teste que faltou) | ✅ em `main` | 842→846 |
| **conferência 18/08** — id próprio para o arraste de cabeçalho | ✅ em `main` | 788→791 |

⚠️ **AS TRÊS FATIAS DO PORTÃO ESTÃO FECHADAS EM CÓDIGO (9 → 8 → 7).** O que
falta do portão é **a reconferência na tela**, e só ela.

⚠️ **A FATIA 6 ESTÁ FECHADA EM CÓDIGO E NÃO ESTÁ CONFERIDA NA TELA.** "Em
`main`" aqui quer dizer **portão verde**, e os itens 4 e 5 da §Conferência
visual (arraste de cabeçalho, rolagem automática) **não têm guardião nenhum** —
`onDragEnd` não roda em jsdom. Nada nesta tabela autoriza dizer que a fatia 6
funciona.

### As seis da conferência de 17/08

| o que a tela mostrou | o que era | onde |
|---|---|---|
| `TypeError` ao trocar de quadro no modo de edição | **defeito**: nenhum efeito zerava o rascunho na troca de `boardId`; o `!` em `destinosDoRascunho` mentia para o `tsc` | `Board.tsx`, `rascunhoDeColunas.ts` |
| coluna criada não dava para posicionar antes de concluir | **defeito**: o ref `tmp:` entrava na `ordem` e era filtrado do que a tela desenha — as setas moviam uma coluna invisível e `indice`/`total` contavam listas diferentes | `colunasParaDesenhar` |
| "guarda tarefas apagadas" num quadro criado 5 min antes | **defeito de texto**: `exigeDestino` significava "o backend recusou, logo existem" no painel antigo, e virou "pergunte sempre" no lote — o texto continuou AFIRMANDO um fato que ninguém mediu | `avisoDeExclusao` |
| lápis não aparecia no Quadro geral | **defeito**: a 6a-bis saiu do backend em 13/08 e o front continuou com `boardId && …`; o geral é desenhado SEM `boardId` | `Board.tsx`, `/quadro/page.tsx` |
| modo de edição com zero tarefa visível desenhava o estado vazio e nenhuma coluna | **defeito**, achado pelo teste da correção acima. ⚠️ `raizes` é a lista JÁ FILTRADA: basta um filtro que não casa nada | `Board.tsx` |
| "Concluído" sem "×"; duas abas reordenando não recusam | **a lista estava errada**, não o código — ver §Conferência visual |

⚠️ **CINCO DAS SEIS ESTAVAM EM RAMOS SEM TESTE NENHUM.** O `quantas === 0` de
`avisoDeExclusao` não tinha guardião; os seis testes do lápis passavam
`boardId={AVULSO}` e nenhum cobria o Quadro geral. **Sabotagem viria verde nos
dois — eles testavam o ASSUNTO, e não a LINHA.** É o erro (b) do handoff de
13/08, terceira repetição.

⚠️ **`_recipients` filtra `is_active`** (dano medido: 29 avisos) — em `main`,
não em produção. ⚠️ **Medido em 13/08: a notificação é IN-APP e só** (o modelo
`Notification` é "notificacao in-app entregue a um recipient"; não há SMTP nem
e-mail no módulo). Os 29 avisos são linhas numa tabela endereçadas a contas
**desativadas**, que não entram para vê-las. **Medido não é o mesmo que
danoso** — este item foi usado por várias sessões como custo de adiar o deploy,
e não sustenta esse papel.

⚠️ **A fatia 1 foi commitada JUNTO com o código que lê `deleted_at`** — a
migration NÃO podia ficar para trás, e a `0012` está em produção desde 10/08. A
4 e a 5 são as que mudam o que as pessoas veem.

## Como ler este arquivo

Nove fatias, e três delas viraram várias. As três primeiras são backend e
**nada muda na tela**; a quarta é o front; a quinta é a feature; a sexta é o
modo de edição; a **sétima** (apagar quadro) e a **oitava** (mover tarefa entre
quadros) foram criadas em 17/08, e a **nona** (nome único) em 18/08.
⚠️ **A ordem é 9 → 8 → 7, e ela mudou em 18/08:** a 9 (entregue) destrava a
confirmação da 7, e a 8 estabelece a invariante de pai e filha sem a qual a 7
teria de tratar um estado que a 8 vai proibir. **Neste arquivo elas aparecem
nessa ordem**; o texto de 17/08 da fatia 8 ficou como histórico no fim.

⚠️ **Três seções são HISTÓRICAS e estão marcadas como tal** — "Fatia 4c: o
bloqueio original", "Fatia 4 (texto original)" e "Fatia 5 (texto de 10/08)".
Elas ficam porque registram por que o roteiro mudou. **Não as execute.**

⚠️ **Duas fatias por sessão, no máximo** — a sessão de 05/08 emendou três
"pequenas" e custou 58 testes vermelhos.

⚠️ **Cada fatia tem sabotagem própria, com string única, dizendo qual teste
deve cair** — e a sabotagem tem de **reverter a correção inteira**, não
mutilar. Mutilar um `WHERE` de forma que a consulta devolva duas linhas e o
`.first()` escolha uma pode passar verde por sorte.

⚠️ **Sabotagem VERDE é descoberta, não alívio.** Em 13/08 duas sabotagens
verdes revelaram, uma, um campo que nunca saía no corpo da requisição
(§Fatia 5b-7) e, outra, uma linha acrescentada sem caso, que foi removida.

---

## Fatia 1 — `board.deleted_at` (escrita em 06/08)

`0012_board_soft_delete.py`, sobre a head `0011_task_board_not_null`.

**Sobe:**
- `ALTER TABLE board ADD COLUMN deleted_at timestamp with time zone` + o
  `COMMENT`;
- `Board` ganha `SoftDeleteMixin` (`BoardColumn` **não** — E3 da spec);
- `default_board_and_column_for_status` ganha `AND b.deleted_at IS NULL`;
- a regra E2 escrita no cabeçalho do `board_repository`;
- `scripts/invariantes.sql` ganha a consulta 4.

⚠️ **Sem índice.** `board` tem uma linha em produção e poucas dezenas no pior
caso da 0034. Índice parcial aqui é custo de escrita sem ganho de leitura
mensurável — entra em migration própria quando a contagem justificar, com o
número na justificativa.

⚠️ **O texto do `COMMENT` é idêntico ao do `SoftDeleteMixin`, caractere a
caractere.** Drift de comentário é comparado por TEXTO: divergir deixa o
`autogenerate` propondo a diferença para sempre.

**Como testar:** `upgrade head`, `\d+ board` (a coluna e o comentário),
`downgrade -1`, `upgrade head` de novo, `autogenerate` vazio.

**Sabotagem:** apagar `AND b.deleted_at IS NULL` do SQL → cai
`test_quadro_apagado_nao_e_descoberto_como_quadro_geral` com `DID NOT RAISE`.

---

## Fatia 2 — `GET /api/v1/boards` (sessão própria)

Leitura só. Devolve os quadros que o usuário alcança, pela mesma lente
(`visible_team_ids`). Substitui o `/boards/current` que handoffs antigos
previam, porque agora passa a existir mais de um quadro.

**Sobe:**
- rota, schema de resposta (`id`, `name`, `team_id`, `is_default`, colunas);
- `BoardRepository` ganha a consulta de listagem, com
  `deleted_at IS NULL` **e** `workspace_id`.

⚠️ **É a primeira fatia do roteiro com superfície de API e permissão
envolvida** — o primeiro lugar onde um erro vira dado exposto. Não atacar logo
depois de uma rodada de correções.

**Testes que provam a fatia** (são o critério 4 da spec, e vêm antes do
código):
- supervisor do subtime A **não** vê o quadro interno do subtime B;
- ADMIN vê todos;
- quadro de outro workspace nunca aparece (tenant isolation);
- quadro apagado não aparece.

Os quatro precisam de dois quadros no mundo do teste — use `make_board` e
`make_task(board_id=)` do arreio, e **não** monte quadro à mão.

**Sabotagem:** trocar o filtro pela lente por "todos os quadros do workspace"
→ cai o teste do supervisor de outro subtime.

---

## Fatia 3 — Quadro e coluna na resposta de tarefa

✅ **ESCRITA E TESTADA EM 10/08/2026.** O que este bloco descrevia **não é o
que foi entregue** — leia a §Correção abaixo antes de qualquer coisa.

A que faltava no roteiro até 06/08. Sem ela a fatia 4 não é construível: o
front recebe a lista de colunas e não sabe em qual colocar cada card.

**Subiu:**
- `board_id` e `column_id` em `TaskResponse` (`api/schemas.py`). Duas linhas.
  `TaskListItem`, `TaskDetailResponse`, `TaskDuplicateResponse` e `MyTaskItem`
  herdam e ganham os campos sem uma linha a mais;
- `tests/integration/test_task_board_no_contrato_db.py` — 4 testes;
- `scripts/invariantes.sql` ganha a consulta 7.

Sem migration, sem `JOIN` novo, sem mudança de repositório: os dois campos já
vinham no objeto ORM (`NOT NULL` desde a `0011`) e os routers montam tudo com
`model_validate(task)`.

### ⚠️ Correção de 10/08 — DUAS coisas que este plano pedia e que NÃO entraram

**1. O nome do quadro NÃO entrou, e não é esquecimento.** O plano pedia
*"`board_id`, `column_id` e o nome do quadro"* mais *"o selo de de qual quadro
veio"* da ADR 0034 (item 6). Com o `GET /boards` da fatia 2 em produção, o
front resolve `board_id` → nome no cliente, com o catálogo que ele já busca
para desenhar as colunas. Cravar o nome na task criaria um campo que
desatualiza no dia em que a fatia 5 permitir renomear quadro. **O selo sai de
graça; o campo custaria manutenção.**

**2. `semantic` e `notify_deadline` NÃO entraram, e a §4 da
a §Fatia 4 — por que ela virou TRÊS está SUPERADA nesse ponto.** A sondagem (06/08) concluiu
que a fatia 3 estava subespecificada por faltar os dois. **A fatia 2 resolveu
isso depois de a sondagem ser escrita:** `BoardColumnResponse` já os carrega, e
o docstring dela diz explicitamente que os pôs ali por causa dessa sondagem.
O front cruza por `column_id`. Repeti-los na task criaria uma segunda fonte de
verdade para o mesmo dado, e a fatia 5 teria de invalidar as duas.

**3. O teste de alcance que este plano pedia NÃO PODE FALHAR, e por isso não
foi escrito.** O plano pedia *"o teste de que não se expõe `board_id` de
quadro fora do alcance de quem pergunta"*. Esse cenário não é alcançável:
`BoardRepository.default_board_and_column_for_status` resolve o quadro de toda
tarefa nova com `JOIN team ... AND t.parent_team_id IS NULL` (ADR 0032), então
`board.team_id` é **sempre a raiz** — que todo mundo alcança. Quem enxerga a
tarefa enxerga o quadro.

O que substitui esse teste são dois que afirmam **por que** não há vazamento, e
portanto podem falhar quando o porquê deixar de valer:
- `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` — passa pelo `TaskService`
  e lê `board.team_id` do banco;
- `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` —
  cruza `GET /tasks/{id}` com `GET /boards`. É o único teste do repositório que
  liga as duas superfícies.

Mais a **consulta 7** do `invariantes.sql`, que prende a mesma afirmação no
DADO — o teste passaria mesmo que alguém gravasse `board_id` à mão no banco.

⚠️ **A consulta 7 mediu `0` em produção em 10/08, e esse zero é AUSÊNCIA DE
CASO.** Há um quadro só, e ele é da raiz. Ela só vira afirmação quando a
consulta 5 mostrar um quadro de subtime. O aviso está no próprio arquivo.

**Sabotagem — MEDIDA em 10/08, não prevista:** apagar as **duas** linhas
`board_id: uuid.UUID` e `column_id: uuid.UUID` do `TaskResponse` derruba
**três** testes, todos com `KeyError: 'board_id'`: detalhe, listagem **e** o
cruzado. Sobra verde só o `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`,
que lê o banco e nunca toca a resposta HTTP.

⚠️ **A previsão escrita antes de rodar dizia DOIS, e estava errada** — o teste
cruzado lê o `board_id` da resposta da task antes de comparar com o `/boards`.
Mesmo viés (para menos) já registrado no handoff de 10/08, §1(f).

---

## Fatia 4a — ✅ EM PRODUÇÃO (10/08) — a semântica da coluna no front

Decisões na **ADR 0040**. Nenhuma linha de tela mudou: a fatia é ADITIVA de
propósito, porque trocar as assinaturas de uma vez deixaria o `tsc` vermelho
entre fatias.

**Subiu:**
- `lib/coluna.ts` — `type Coluna`, `terminal`, `avisaPrazo`, `pararEhNoticia`,
  `deadlineTonePorColuna`, `diasParadoPorColuna`, `colunasPadraoMinhasTarefas`,
  `corDaColuna`, `corEhHex`;
- `lib/plural.ts` — `plural` saiu da gaveta que o `lib/status.ts` tinha virado;
- `lib/status.ts` — `deadlineDays` exportada (reuso da MESMA aritmética de
  data), e o bloco das funções por status marcado com data de demolição;
- `lib/__tests__/paridadeColuna.test.ts` — **61 testes**.

⚠️ **DUAS IMPLEMENTAÇÕES DA MESMA REGRA CONVIVEM**, e é o defeito que a fatia
existe para matar. O que autoriza a convivência é o teste de paridade, que
compara as duas caso a caso contra as 8 colunas padrão. **Ele morre junto com
o bloco antigo, na 4c.** Se você está lendo isto depois da 4c e o bloco antigo
ainda existe, a migração ficou pela metade.

⚠️ **A tabela das 8 colunas no teste de paridade é CÓPIA MANUAL do
`board_defaults.py`.** Nenhum portão liga os dois. Ao mexer em `COLUNAS_PADRAO`
lá, mexa aqui.

⚠️ **O ponto não-óbvio, e está na ADR 0040:** `diasParado` NÃO traduz por
`semantic` sozinho. BLOCKED tem semântica `IN_PROGRESS` e passaria a ganhar o
selo "parada há X dias", que a D6 excluiu de propósito. A regra é
`semantic === "IN_PROGRESS" && avisaPrazo(coluna)` — e isso **funde dois
conceitos**, deliberadamente.

**Sabotagem MEDIDA:** trocar o corpo de `pararEhNoticia` por
`return coluna.semantic === "IN_PROGRESS";` derruba **dois** —
`BLOCKED: parada há muito responde igual` e `o selo de parada sai só nas três
colunas de trabalho ativo`.

---

## Fatia 4b — ✅ EM PRODUÇÃO (10/08) — `/minhas-tarefas` pela API

**Subiu:**
- `lib/api.ts`: `type Quadro`, `listBoards()`, `colunasDoQuadroGeral()` — e o
  tipo `Task` ganhou `board_id`/`column_id`, **que a fatia 3 tinha esquecido**;
- `lib/__tests__/quadros.test.ts` — 8 testes;
- `app/minhas-tarefas/page.tsx`: as três constantes de escopo de módulo
  (`STATUS_LABEL`, `STATUS_COLOR`, `TODOS_STATUS`) sumiram; o filtro padrão
  saiu do inicializador de `useState`; chips, rótulos e cores vêm de
  `coluna.name`/`coluna.color`; o filtro casa por `t.column_id`;
- `components/__tests__/minhasTarefas.test.tsx` — 7 testes (era 5).

⚠️ **NADA MUDOU VISUALMENTE, e é o resultado certo.** Produção tem um quadro
com as 8 colunas padrão, cujos nomes e cores são exatamente os que estavam
cravados no `STATUSES`. A tela mudou de FONTE, não de conteúdo. O que dá para
observar: uma requisição a mais (`GET /api/v1/boards`) ao abrir a tela.

⚠️ **O KANBAN DESTA TELA NÃO FOI MIGRADO** — ver o bloqueio na 4c. Dois mundos
convivem no arquivo: a vista de LISTA lê a API, a de QUADRO lê `STATUSES`. Há
15 linhas de comentário no `porStatus` explicando por quê.

**Conferência visual da 4b** (não estava prevista neste arquivo, e deveria):
chips com os 8 nomes reais, Concluído escondido ao abrir, Cancelado aparecendo,
"Todos" religando, e a vista de Quadro ainda arrastando.

---

## Fatia 4c — ✅ DESBLOQUEADA em 10/08, e a 4c-1 está ENTREGUE

O bloqueio desta seção acabou no momento em que a **fatia 5a** (backend) subiu:
o `PATCH /tasks/{id}` aceita `column_id` e deriva o status (ADR 0041). O texto
do bloqueio fica abaixo, intacto, porque explica POR QUE a ordem foi essa.

### 4c-1 — ✅ ENTREGUE (front: 503 → 514)

**Escopo:** `Board.tsx`, `TaskCard.tsx`, `lib/api.ts` e o repasse da coluna aos
cards de `/minhas-tarefas`. Os três portões verdes, `next build` compilando.

**Quatro decisões, tomadas com a Camila antes do código:**

1. **O quadro sai das TAREFAS** (`board_id`), não da flag `is_default`. Custa
   mais hoje e some com um item de dívida: continua certo no dia do quadro
   interno, sem ninguém lembrar de voltar lá. Lote vazio cai no padrão; lote
   com mais de um quadro cai no padrão e o contador de "fora da coluna"
   denuncia o resto.
2. **`coluna` é prop OBRIGATÓRIA do `TaskCard`.** O `tsc` listou os quatro usos
   de uma vez — que é exatamente o que faltou na fatia 3.
3. **Cascata otimista por coluna**, aceitando a janela de `status` velho.
   ⚠️ **Esta decisão foi CORRIGIDA no mesmo dia** — ver "o que a conferência
   manual achou", abaixo.
4. **Duas metades em vez de uma sessão.** A `STATUSES` continua existindo para
   quem ainda a consome, então o `tsc` não obriga a migrar tudo junto — o
   plano anterior dizia o contrário, e estava errado.

**Sabotagens medidas (5):** escolher o quadro por `is_default`, card lendo
`status`, contador da checklist lendo `status`, filtro de prazo lendo `status`,
apagar o contador de card fora de coluna. Cada uma derruba UM teste, pelo nome
— registradas no cabeçalho do `Board.test.tsx`.

⚠️ **DUAS DELAS PASSARAM VERDE ANTES DE O TESTE EXISTIR** (a escolha do quadro
e o filtro de prazo). Os dois portões nasceram de RODAR a sabotagem, não de
planejar. Repita o procedimento na 4c-2.

### ⚠️ O que a CONFERÊNCIA MANUAL achou, e nenhum portão achou

Três coisas, todas invisíveis para `pytest`, `tsc`, `vitest` e `next build`:

1. **O contador da checklist no card** ainda lia `status` — arrastar um pai
   para conclusão concluía a subárvore no banco e o número só mudava com F5.
2. **A proporção no DETALHE da tarefa** (`lib/subtarefas.ts::progresso`) lê
   `status` e continuou parada depois do conserto do card. **Dois números
   discordando é pior que um número velho.**
3. **O filtro de prazo** também lia `status` (achado junto, não pela tela).

O conserto de (2) foi manter coluna **e** status em sincronia na cascata
otimista — e isso NÃO é o front derivando status: a cascata só roda em coluna
de conclusão, e a do backend grava `COMPLETED` fixo. **Dívida: quem migrar
`progresso` para a coluna apaga a metade `status` do `onDragEnd`.**

### ⚠️ O que a 4c-1 NÃO validou

- **O `onDragEnd` inteiro.** Drag-and-drop não é exercitável em jsdom. A rede é
  a conferência manual, e foi ela que achou as três coisas acima.
- **O caminho de ERRO do arrastar** (403/500 → reverter card e checklist).
  Não há tarefa que a Camila não possa mover, então não deu para forçar.
  ⚠️ **Código de reversão nunca executado**, e ele MUDOU nesta fatia (passou a
  guardar dois campos). Forçável em 30s com o modo offline do devtools.

### 4c-2 — ✅ ENTREGUE (front: 514 → 529)

Quatro passos, cada um com portões verdes antes do seguinte:

**a) `lib/subtarefas.ts::progresso` decide pela coluna.** Era o item mais caro
e a razão de a 4c-1 ter parado onde parou: a regra é lida por QUATRO telas, e
duas (`/arquivadas`, `/tarefa/[id]`) não carregavam colunas.
⚠️ **A saída não foi migrar as quatro telas: foi o `TaskDetail` passar a
carregar as próprias colunas.** As quatro ganharam o comportamento sem serem
tocadas. Preço: uma requisição a mais ao abrir o detalhe, **não medida** — o
item de desempenho do §9 do handoff ganhou uma linha.

**b) Kanban de `/minhas-tarefas` + `onDragEnd` dela.** O bloqueio de contrato
citado abaixo acabou com o `PATCH column_id`. ⚠️ A validação da coluna de
destino AQUI não é formalidade como no `Board.tsx`: esta tela junta tarefas de
QUALQUER quadro e desenha as colunas do quadro GERAL. `STATUSES` saiu desta
tela por inteiro.

**c) `TaskModal` e o badge do `TaskDetail`.** O campo "Status" do modal virou
**"Coluna"** — o rótulo mudou junto com a fonte. ⚠️ Descoberta ao abrir o
código: **o `TaskDetail.tsx:678` que o plano listava como `<select>` de status
era a CAIXINHA da subtarefa**, já migrada no passo (a). O quarto caminho de
escrita não existia; existia um leitor que ninguém tinha mapeado (o badge).

**d) Badge de `/arquivadas`.** ⚠️ Coluna OPCIONAL aqui, ao contrário do
`TaskCard`: lá ela decide regra e faltar é defeito; aqui é rótulo, e obrigá-la
faria a tela esperar as colunas para listar — sendo que o assunto da tela é
reativar tarefa.

**Sabotagens medidas: 10 no total** (5 na 4c-1, 5 na 4c-2), cada uma derrubando
1 ou 2 testes NOMEADOS. Registradas no cabeçalho de cada arquivo de teste.

### ⚠️ A DEMOLIÇÃO DO `STATUSES` NÃO É DESTA FATIA — e o plano estava errado

O texto anterior desta seção dizia "só então: apagar `STATUSES`, os 16 tokens
de cor e o `paridadeColuna.test.ts`". **Medido em 10/08, isso não é executável
agora**, e por dois motivos independentes:

1. **`STATUSES` virou a RESERVA do badge**, em `/arquivadas` e no
   `TaskDetail`. Quando a coluna da tarefa não está na lista carregada, o
   rótulo cai nele. ⚠️ **Em `/arquivadas` esse caso é NORMAL, não defeito**: a
   tela lista o workspace inteiro e as colunas vêm do quadro geral, então
   tarefa arquivada de um quadro de subtime cai na reserva por natureza.
   Apagar `STATUSES` deixa o badge em branco nesses casos.
2. **A COR do badge continua saindo de `STATUS_TEXT`**, e isso é decisão, não
   esquecimento: `coluna.color` é token de TRAÇO e reprova AA como fundo sob
   texto (Spec 031 §2.2b). Cor acessível de coluna arbitrária tem de sair da
   luminância, e `lib/coluna.ts::corEhHex` já registra, desde a 4a, que essa
   derivação é da **fatia 5**.

**Conclusão: `STATUSES` sobrevive à 4c e morre na fatia 5**, junto com o CRUD
de coluna que define cor. O `paridadeColuna.test.ts` (61 testes) segue válido
até lá — ele afirma a paridade da tabela de reserva com o backend.

### ⚠️ O que a 4c NÃO validou

- **Os dois `onDragEnd`** (quadro e `/minhas-tarefas`). Drag-and-drop não é
  exercitável em jsdom. Foram conferidos À MÃO, nos dois temas.
- **O caminho de ERRO do arrastar** (403/500 → reverter card e checklist).
  Não há tarefa que a Camila não possa mover. ⚠️ **Código de reversão nunca
  executado, e ele MUDOU duas vezes nesta fatia** (passou a guardar dois
  campos, nas duas telas). Forçável em 30s com o modo offline do devtools.
- **`/tarefa/[id]`** — ganhou o comportamento de graça pelo `TaskDetail`, sem
  teste de montagem próprio. As outras três telas que montam o detalhe também
  não têm.
- **Desempenho.** Duas requisições novas (`colunasDoQuadro` no detalhe e no
  modal), nenhuma medida.

### ⚠️ O que a CONFERÊNCIA MANUAL achou, e nenhum portão achou

Cinco coisas, ao longo da 4c inteira. **Todas invisíveis para `pytest`, `tsc`,
`vitest` e `next build`** — e é o registro mais útil desta seção:

1. O contador da checklist no card ainda lia `status` (4c-1).
2. A proporção no DETALHE continuou parada depois do conserto do card — dois
   números discordando sobre a mesma coisa.
3. O filtro de prazo lia `status` (achado junto, não pela tela).
4. **Desmarcar uma subtarefa "funcionava na primeira vez e depois não"**: a
   memória de qual coluna devolver morria ao fechar o detalhe. Virou regra
   fixa — ver a seção da decisão, no `TaskDetail`.
5. Três sabotagens PASSARAM VERDE antes de o teste existir (a escolha do
   quadro, o filtro de prazo, o `is_default_target`).

⚠️ **A lição, para a fatia 5: sabotagem verde é descoberta, não confirmação.**
Rodar a sabotagem é o que revela decisão sem portão.

---

## Fatia 4c — o bloqueio original (histórico, medido em 10/08 de manhã)

**NÃO COMECE POR AQUI.** O `plan.md` original a descrevia como "os quatro
arquivos que sobraram". Aberto o código, ela não é executável antes da 5.

`Board.tsx` usa `STATUSES` em quatro lugares, e **os quatro são o kanban**:
montar as colunas (`:677`), desenhá-las (`:977`), o tipo do componente
`Coluna` (`:1101`) e o `onDragEnd` (`:405–411`), que compara
`atual.status === destino` e manda **status** para o backend.

**Não existe caminho para traduzir coluna → status no front.**
`legacy_status` NÃO é exposto pelo `GET /boards`, de propósito (ADR 0033:
expô-lo convidaria o front a se amarrar na ponte em vez da semântica). A
semântica também não resolve: QUATRO colunas padrão têm `IN_PROGRESS`.

⚠️ **Migrar o `Board.tsx` sem o endpoint quebra o arrastar, e NENHUM PORTÃO
PEGA:** `tsc` e `next build` não leem estado, e o `Board.test.tsx` registra que
drag-and-drop não é testável em jsdom.

**Sobra da 4c, sem bloqueio — RECONTADO em 10/08 (à noite):** só
`app/arquivadas/page.tsx:43` e `components/TaskDetail.tsx:66`, e os dois são
mapa de RÓTULO (leitura). Vão de carona.

⚠️ **`TaskModal` NÃO vai de carona: é caminho de ESCRITA.** O `<select>` de
`TaskModal.tsx:887` manda status, igual ao arrastar — depende do MESMO
endpoint. E `TaskDetail.tsx:678` (`updateTask(f.id, { status: destino })`)
também escreve, num arquivo de 2186 linhas sem teste de componente.

⚠️ **São QUATRO caminhos de escrita de status no front, não um.** Medido:
`Board.tsx:onDragEnd`, `app/minhas-tarefas/page.tsx:496`,
`components/TaskDetail.tsx:678` e `components/TaskModal.tsx:887`. Os quatro
migram juntos ou nenhum migra — e o `TaskDetail` nem aparecia nesta lista.
**Reestime a 4c contra esses quatro, não contra "os arquivos que sobraram".**

**O que a 4c ainda carrega quando destravar:** o `(typeof STATUSES)[number]`
usado como TIPO em `Board.tsx:1101` e `minhas-tarefas/page.tsx:1152`. Morre
junto com a const; precisa da `interface Coluna` (já existe em
`lib/coluna.ts`). **O `tsc` pega os dois de uma vez — não dá para fatiar por
arquivo.** E o quarto problema da sondagem: os 16 tokens de cor declarados por
NOME de status no `globals.css`, que coluna criada por gente não tem.

---

## Fatia 4 (texto original — mantido como registro)

Uma via de render para geral, projeto, lente e interno.

⚠️ **ANTES DELA, teste de componente em `minhas-tarefas/page.tsx`** — não no
`TaskDetail`. É onde a mudança pesa (9 usos de `STATUSES`, 1195 linhas, zero
teste) e é o arquivo onde descobrir tarde custa mais caro.

**São 8 arquivos, não 6.** Os cinco que usam `STATUSES` quebram de verdade;
os outros três entram porque `@/lib/status` vai ser partido em "puro e
síncrono" e "vindo da API".

⚠️ `STATUSES` deixa de ser `const` síncrona: estado de carregando, de erro, e
um default antes de o dado chegar. O `<select>` do `TaskModal` inicializa em
`"BACKLOG"` cravado, linha 104.

**Carona:** os tokens de cor do status de **projeto** (`projetos/page.tsx` e
`projetos/[id]/page.tsx` têm hex cravado e duplicado, fora do sistema da Spec
031, e não invertem no tema escuro). Sozinho não paga o deploy.

**Sabotagem:** devolver a lista de colunas vazia da API → o quadro tem de
mostrar estado de erro, não um quadro sem colunas.

---

## Fatia 4 — por que ela virou TRÊS (absorvido da sondagem de 09/08)

> Esta seção substitui o `sondagem-fatia-4.md`, apagado na consolidação de
> 13/08. ⚠️ **Nada naquele documento foi executado** — era leitura de arquivo e
> contagem, sem `tsc`, sem `npm test`, sem navegador. O que sobreviveu ao fato
> de a fatia 4 estar em produção desde 10/08 está aqui, com a medição original.

**Veredito: três sessões, não uma. E a primeira não é front.**

| sessão | o quê | por que separada |
|---|---|---|
| **4a** | ADR da semântica no front + `semantic`/`notify_deadline` na resposta da fatia 3 + partir `lib/status.ts` | é decisão + contrato de API. Não é a mesma coisa que mexer em tela. |
| **4b** | teste de componente de `minhas-tarefas` + converter o arquivo | 1195 linhas, zero teste, 7 usos, e o `useState` do ponto duro |
| **4c** | `Board.tsx`, `TaskDetail.tsx`, `arquivadas`, `TaskModal` | os quatro dependem da 4a estar pronta |

Efeito no roteiro: a spec passou de 5 fatias para 7, e a fatia 5 ficou a cinco
sessões de distância, não a duas.

### O que a sondagem mediu (06/08, no `main` de então)

⚠️ **Os 8 arquivos que importavam `@/lib/status` não eram 8.** Três não tinham
nada a ver com quadro: `lib/exclusao.ts` (só `plural`),
`app/projetos/[id]/page.tsx` (só `PRIORITY_LABEL`) e `components/TaskCard.tsx`
(custo zero direto). **`lib/exclusao.ts` importando `plural` de `@/lib/status`
é a evidência de que aquele módulo já tinha virado gaveta:** uma função de
pluralização morava no arquivo de status porque foi ali que nasceu.

Os **cinco** que usavam `STATUSES`, e onde a fatia realmente morava:

| arquivo | linhas | usos | teste de componente |
|---|---|---|---|
| `app/minhas-tarefas/page.tsx` | 1195 | 7 | **nenhum** |
| `components/TaskDetail.tsx` | 2186 | 2 | **nenhum** |
| `components/Board.tsx` | 1218 | 3 | sim |
| `components/TaskModal.tsx` | 1045 | 1 | parcial |
| `app/arquivadas/page.tsx` | 404 | 2 | parcial |

⚠️ **O trabalho não era "trocar import": era tirar código do escopo de
módulo.** Cinco constantes eram derivadas **no topo do arquivo**, calculadas no
`import`, antes do primeiro render — `STATUS_LABEL`, `STATUS_COLOR` e
`TODOS_STATUS` em `minhas-tarefas`, `STATUS_LABEL` em `TaskDetail` e em
`arquivadas`. Cada uma virou `useMemo` **dentro** do componente, e todo
call-site passou a exigir estar dentro da função. Em arquivos de 1195 e 2186
linhas sem teste, **é aí que estava o custo**.

⚠️ **`STATUSES` também era usado como TIPO** (`(typeof STATUSES)[number]`, em
`Board.tsx` e `minhas-tarefas`). Virando dado de runtime, a derivação morre.

### ⚠️ O achado que mudou o roteiro, e que ainda explica o produto de hoje

`lib/status.ts` tinha **três taxonomias de status escritas à mão**, e as três
eram **semântica de coluna**, não rótulo:

| conjunto | valor | função |
|---|---|---|
| `STATUS_OCULTOS_POR_PADRAO` | `{COMPLETED}` | `statusPadraoMinhasTarefas()` |
| `STATUS_QUE_PARAM` | `{IN_PROGRESS, IN_REVIEW, EXTERNAL_APPROVAL}` | `diasParado()` |
| corpo de `deadlineTone()` | `COMPLETED \|\| CANCELLED \|\| BLOCKED` | `deadlineTone()` |

**Isso é exatamente `column.semantic` e `column.notify_deadline`** — os campos
que a Spec 035 criou no backend e que o handoff de então listava como "continuam
sem leitor". O leitor deles era o front.

O que quebraria no dia do primeiro quadro interno: coluna criada por gente tem
`legacy_status` **NULL**, e as três funções receberiam um status fora de todos
os conjuntos. Uma tarefa em *"Aguardando cliente"* alertaria prazo, porque
`deadlineTone` só silenciava `COMPLETED/CANCELLED/BLOCKED` — e `notify_deadline`
existe no backend justamente para desligar isso.

⚠️ **E as três passavam nos testes.** 296 linhas em `status.test.ts`, todas
contra a lista fixa de 8. **Teste correto para o mundo de hoje e cego para o de
amanhã** — a frase vale para muita coisa desta spec.

⚠️ **O `plan.md` da época punha as três do lado errado da divisão.** Ele mandava
partir `@/lib/status` em "puro e síncrono" e "vindo da API"; `deadlineTone` e
`diasParado` **parecem** puras — recebem string, devolvem valor, sem I/O — e
dependem da taxonomia. Iriam para o lado "puro" por inércia, levando o defeito
junto.

### O ponto mais duro, em uma linha

`app/minhas-tarefas/page.tsx:117`, inicializador de `useState`:
`() => new Set(statusPadraoMinhasTarefas())`. Roda no **primeiro render**, antes
de qualquer `fetch`. O filtro padrão da tela dependia da lista de colunas, que
passou a chegar depois. **Não havia solução barata:** ou a tela nasce sem filtro
e aplica quando o dado chega (e a lista pisca), ou não renderiza até chegar (e a
tela mais usada do produto ganha um "carregando" que não tinha). Decisão de
produto, não de código.

### O que ainda vale, e não foi resolvido

⚠️ **Os tokens `--status-*-dot` / `--status-*-text` são declarados em
`app/globals.css` por NOME de status.** Coluna criada por gente não tem token. A
sondagem contou isso como "um quarto problema", e é o que a fatia 5b respondeu
escolhendo **cor por rotação sobre os 8 tokens existentes**, em vez de hex livre
(§Fatia 5, corte 2).

⚠️ **Não medido, e continua não medido:** o custo da carona dos tokens de cor do
status de PROJETO (`projetos/page.tsx` e `projetos/[id]/page.tsx`).

---

## Fatia 5 — o quadro avulso (vigente; escrita em 11/08, emendada até 13/08)

> Esta seção era o arquivo `plan-fatia-5.md`, absorvido aqui na consolidação de
> 13/08. Ela **substitui** a §"Fatia 5 (texto de 10/08)", que segue logo
> abaixo como registro histórico.
>
> ⚠️ **Duas subseções que viviam no texto de 10/08 continuam VIGENTES e foram
> promovidas para seções próprias**, porque estavam presas dentro de um bloco
> marcado "não execute": o **§Portão do vazamento de quadro** e o
> **§Adendo — mover tarefa entre quadros**. Elas eram o motivo pelo qual a
> seção histórica não podia ser apagada; agora podem ser lidas sem que ninguém
> precise garimpar dentro de texto morto.

### ⚠️ O que mudou de entendimento em 11/08 (leia antes de tudo)

Três coisas que o texto de 10/08 (§Fatia 5 histórica) afirmava e que **estão erradas** sob o modelo de
produto confirmado:

**a) "O quadro do subtime nasce vazio" — não existe esse quadro.**
`/quadro/[teamId]` é **lente**, não registro (ADR 0034 §Contexto). O modelo
híbrido está implementado e **em produção** desde a fatia 4:
`Board.tsx:687-704` mostra a união de (A) tarefas da raiz com algum responsável
do subtime e (B) internas do subtime (`team_id === subteamId`). A lente nasce
cheia por construção. **A questão "migrar as tarefas existentes" não existe.**

**b) "Mexer em `default_board_and_column_for_status` é escopo OBRIGATÓRIO da
fatia 5" — é o contrário: mexer nela é DEFEITO.**
Tarefa interna de subtime nasce hoje com `board_id` do Quadro geral e `team_id`
do subtime, e é exatamente isso que a faz aparecer na lente. Mudá-la para
"o quadro do time da tarefa" tira a tarefa interna da lente.
⚠️ **`test_tarefa_de_subtime_nasce_no_quadro_da_raiz` continua CERTO e continua
VERDE.** O texto de 10/08 mandava reescrevê-lo; não reescreva.
Quadro avulso recebe tarefa por **`board_id` explícito no comando de criação**,
que é parâmetro, não descoberta.

**c) "ADR 0036: derivação do status pela semântica" está listada como entrega
da fatia 5 — ela já existe**, e as 0034 e 0035 também. O que falta é código,
não decisão. A decisão que faltava é a **0042**, escrita em 11/08.

**d) ⚠️ ACRESCENTADO EM 12/08 — "a cor da coluna roda RGB livre (hex)"
também está superado.** O texto de 10/08 afirma isso na §Ordem revisada,
parágrafo da cor, citando a ADR 0040 item 4, e manda o backend validar
`^#[0-9a-fA-F]{6}$`. **O corte de 11/08 decidiu o contrário para esta fatia:**
coluna nova nasce com cor de **token**, por rotação fixa. Ver §2, corte 2.

---

### O modelo, em três linhas

| | `board.team_id` | quem edita o quadro | quem vê |
|---|---|---|---|
| **Quadro geral** (existe) | raiz | ADMIN, MANAGER | todos |
| **Avulso de subtime** (5b) | subtime | supervisor do subtime, ADMIN, MANAGER | membros do subtime + ADMIN/MANAGER |
| **Extra da raiz** (5c) | raiz | ADMIN, MANAGER | todos |

Visibilidade sai de graça do `team_scope` (ADR 0035 D3). **Nenhuma permissão
por quadro, nenhum eixo novo.**

⚠️ **O Quadro geral do Marketing NÃO SE MEXE.** 176 tarefas vivas, 8 colunas,
0 sem ponte. Nada nesta fatia toca nele. `COLUNAS_PADRAO` (8) continua sendo o
padrão do quadro **de workspace**, congelada junto com a cópia da migration
`0008` e o `test_quadro_novo_nasce_igual_ao_migrado`. `COLUNAS_BASE` (4) é
conjunto **novo**, usado só por quadro criado por pessoa. **Dois conjuntos,
ambos vivos, ambos testados** — quem editar um tem de justificar por que não
editou o outro. Os dois vivem em
`app/modules/tasks/domain/board_defaults.py`.

### As 4 colunas base (decisão de 11/08, entregue na 5b-3)

| `legacy_status` | nome | `semantic` | `notify_deadline` | `is_default_target` |
|---|---|---|---|---|
| `BACKLOG` | Backlog | `OPEN` | `True` | `True` |
| `IN_PROGRESS` | Em Andamento | `IN_PROGRESS` | `True` | `True` |
| `COMPLETED` | Concluído | `DONE` | `True` | `True` |
| `CANCELLED` | Cancelado | `CANCELLED` | `True` | `True` |

⚠️ **Gênero masculino em "Concluído" e "Cancelado"**, igual às 8 padrão
(confirmado em 11/08). Divergir aqui é duas telas do mesmo produto escrevendo a
mesma coluna de dois jeitos.
⚠️ **Uma por semântica, e as quatro marcadas como alvo** — é o que faz o
degrau 2 da ADR 0042 responder desde o primeiro dia do quadro.
⚠️ **Nascer com 4 não é o mesmo que ser obrigado a manter 4.** A pessoa pode
apagar *Em Andamento* e *Cancelado* depois (0042 D4); não pode apagar a última
`OPEN` nem a última `DONE`. Nascer com as quatro poupa quem quer cancelar de
criar coluna na primeira semana.
⚠️ **As quatro nascem COM `legacy_status`.** Coluna acrescentada por gente
nasce **sem**, e aí vale a 0041. Os dois casos convivem no mesmo quadro.

### O que fica de FORA da 5b (corte de 11/08, decidido com o custo na mesa)

1. **Apagar quadro.** Cria e renomeia; a lixeira vem depois. Custo aceito:
   quadro criado por engano fica lá, feio e inofensivo. ⚠️ A ADR 0034 item 4 e
   a confirmação digitada com contagem de **subárvore** continuam valendo — só
   não são desta fatia. **Escreva o `UPDATE` de restauração em
   `backend/scripts/` junto com a fatia que entregar a lixeira**, no mesmo
   commit: não há tela de restaurar, e quem desfaz é uma pessoa na VPS.
2. **Seletor de cor.** Coluna nova nasce com cor de **token**, por rotação fixa
   sobre os 8 existentes. Sem hex, sem `<input type="color">`, sem luminância,
   sem validação `^#[0-9a-fA-F]{6}$`. ⚠️ Isto **contradiz de propósito** o
   parágrafo da cor no `plan.md` (§1d). ⚠️ `lib/coluna.ts::corEhHex` **continua
   sem leitor** — e agora com data: ele ganha leitor na fatia do seletor de
   cor, ou o campo tem de justificar sua existência de novo.
3. **Mover tarefa entre quadros.** Fatia **5c**, curta, logo depois. A ADR 0042
   entrega o mapa que a encarecia. ⚠️ Só a versão **dentro do mesmo
   `team_id`**; atravessar time muda quem vê e continua proibido pela ADR 0034
   item 3.

---

### As sub-fatias 5b, em ordem de execução

⚠️ **A ordem é por raio de explosão, não por tamanho.** A 5b-1 é um no-op em
produção; a 5b-5b é a primeira que um usuário enxerga.

### 5b-1 — a regra da ADR 0042 (backend, domínio puro) — ✅ ENTREGUE

**Subiu:** `semantica_do_status()` em `board_semantics.py`; o degrau 2 em
`BoardRepository.column_for_status_in_board`; a reescrita do status pela coluna
de destino (D2).

**Por que primeiro:** o Quadro geral tem ponte nas 8 colunas, então o degrau 2
**nunca é alcançado em produção**. Esta fatia subiu sem mudar uma linha de
comportamento para ninguém, e é a única do conjunto com essa propriedade.

**Portões:** `pytest`. Sem front, sem migration, sem API. 657 → 681.

⚠️ **Armadilha encontrada na execução:** `text()` devolve **STRING, não enum**.
`column_for_status_in_board` devolvia `'IN_PROGRESS'` em vez de
`TaskStatus.IN_PROGRESS` — **8 vermelhos**. Como `TaskStatus` e
`ColumnSemantic` são `StrEnum`, `==` responde certo em todo lugar do produto e
o defeito só aparece sob `is`. Todo `select` textual que traz coluna de enum
precisa de `TaskStatus(x)` / `ColumnSemantic(x)`.

**Sabotagens rodadas** (§Como medir da 0042):

| sabotagem | derruba |
|---|---|
| Inverter os degraus em `column_for_status_in_board` | **5** testes, 2 deles anteriores à ADR |
| Tirar só o `DESC NULLS LAST` do repositório | **1** — `test_coluna_sem_ponte_nao_ganha_do_casamento_exato` |
| `task.status = command.status` no update | **1** — `test_o_status_gravado_na_tarefa_e_o_da_coluna_que_recebeu` |

⚠️ **A fixture tem de separar posição de alvo.** Se a coluna
`is_default_target` for também a primeira por posição, a regra certa e a errada
dão a mesma resposta — foi assim que três sabotagens passaram verde na 4c, e
foi assim de novo na 5b-5a.

### 5b-2 — o levantamento dos caminhos que escrevem `status` — ✅ ENTREGUE

**Não é código. É uma lista, e ela é entregável.** 681 → 685.

Todo caminho que escreve `status` (e não `column_id`) passa a poder cair no
degrau 2. Levantados e cobertos, cada um com teste em quadro de 4 colunas:

- `TaskService.create` (status inicial) — seguro;
- `TaskService.update` pelo caminho `status` — seguro;
- `TaskRepository.complete_descendants` (cascata de conclusão) — ⚠️ **NÃO era
  seguro**, ver abaixo;
- duplicação de tarefa (uma vez por nó da árvore) — seguro;
- varredura de arquivamento — confirmado que **LÊ e não escreve** status;
- o que sobrou de `PATCH status` no front após a 4c — seguro.

⚠️ **EMENDA DE 11/08, ESCRITA DEPOIS DE MEDIR.** O texto original desta seção
dizia: *"a leitura de 11/08 diz que todos são seguros (`DONE`, `CANCELLED`,
`OPEN` e `IN_PROGRESS` sempre têm coluna nas 4 base)"*. **Era falso para a
cascata.** A subconsulta de `complete_descendants` é SQL puro e resolvia `DONE`
por ponte apenas — num quadro sem ponte para `COMPLETED` ela não achava coluna
nenhuma. A fatia existiu exatamente para transformar leitura em medição, e a
medição desmentiu a leitura. **Não repita a frase "é seguro por construção"
sem um teste ao lado dela.**

⚠️ **A cascata é um `UPDATE` em massa por `ltree` e não pode chamar o
repositório uma vez por linha.** É por isso que a regra da 0042 tem duas
implementações no backend, e a duplicação é deliberada. Ver §6.

### 5b-3 — `BoardService` cria e renomeia (backend) — ✅ ENTREGUE

**Subiu:** `COLUNAS_BASE`; `BoardService.criar_quadro(team_id, name)` e
`renomear_quadro`; as permissões; `POST /api/v1/boards` e `PATCH /boards/{id}`.
685 → 714.

⚠️ **DUAS permissões, não uma:** `board.manage.subteam` e `board.manage.root`.
Uma só significa ou supervisor editando o Quadro geral, ou ADMIN sem editar
nada.
⚠️ **Cada uma entra nos conjuntos de TODOS os papéis que a exercem** — não há
hierarquia em `permissions.py`, são listas literais. `board.manage.subteam` vai
em `SUPERVISOR`, `MANAGER` e `ADMIN`.
⚠️ **A trava de ESCOPO mora no serviço** (`BoardService._assert_pode_gerir`),
com o `team_id` do alvo — precedente literal de `member.manage.subteam`
(Spec 028). O mapa diz *o quê*; o serviço diz *sobre quem*.
⚠️ **Nenhuma migration.** O índice parcial `board_um_padrao_por_time` protege
"um PADRÃO por time"; quadro avulso é não-padrão e o schema já o comporta
(ADR 0034 item 5). Conferido antes de escrever migration por reflexo.

⚠️ **A armadilha que custou 11 vermelhos:** as duas rotas de escrita **não**
têm `require_permission` — decisão certa, a autorização depende do alvo — mas
`require_permission` fazia DUAS coisas, e a segunda era
`Depends(get_tenant_context)`. **`_: TenantContextDep` parece não usado e não
é.** `set_tenant` roda num lugar só do produto e não há middleware; sem a
dependência a rota quebra em **100% das requisições em produção**, com os 17
testes de serviço verdes o tempo todo. Está escrito no cabeçalho do
`boards_router.py`.

⚠️ **404 antes de 403 no `PATCH /boards`, e é o certo.** A permissão depende do
`team_id` do quadro, então ele é buscado primeiro; um 403 confirmaria que o
quadro existe.

**Sabotagens rodadas:**

| sabotagem | derruba |
|---|---|
| Tirar a trava de escopo do supervisor | **2** |
| Tirar a saída por `board.manage.root` | **3** (ADMIN, MANAGER, e um pelo setup) |
| Tirar `_: TenantContextDep` do `POST` | **7**, e zero do `PATCH` |
| Router grava direto (com `workspace_id` certo) | **6** — os quatro 403 viram 201 |

⚠️ **Três travas têm UM guardião só.** Apagar aquele teste devolve o defeito ao
silêncio completo.
⚠️ **`test_admin_cria_na_raiz_e_no_subtime` é o teste fraco do conjunto** —
continuou verde com o router gravando direto, porque só confere 201. Vale
porque está pareado com os recusados.

### 5b-4 — CRUD de coluna (backend) — ✅ ENTREGUE (5b-4a 717→733, 5b-4b 733→765)

**Sobe:** criar, renomear, reordenar e apagar coluna dentro de um quadro
avulso.

⚠️ **Duas travas diferentes, e confundi-las é o defeito clássico aqui:**

- **"para onde vão estas tarefas?" (0042 D5).** Apagar coluna com tarefas abre
  aviso com o número e um selector: *para qual coluna?*. Coluna vazia some sem
  perguntar. O selector oferece **todas** as outras colunas do quadro. Destino
  terminal (`Concluído`/`Cancelado`) muda o texto do aviso, porque não é mover
  — é concluir ou cancelar o lote, com cascata de subtarefas, `terminal_since`
  ligando e avisos de prazo morrendo. O status de cada tarefa é reescrito pela
  coluna escolhida (D2) e cada uma gera linha em `task_history`.
- **"o quadro continua funcionando depois?" (0042 D4).** Recusa `422` ao apagar
  a **última coluna `OPEN`** ou a **última `DONE`** — as duas semânticas que o
  sistema escreve sozinho (criação e cascata de conclusão). *Em Andamento* e
  *Cancelado* **podem** ser apagadas: quadro de 3 colunas é válido.

⚠️ **O selector não substitui a recusa.** Nada impede alguém de apagar a última
`DONE` escolhendo *Backlog* como destino — e a quebra só aparece na semana
seguinte, quando outra pessoa concluir uma tarefa-mãe cuja subtarefa mora aqui.
⚠️ **Coluna criada por gente nasce sem `legacy_status`.** Não invente um: é o
que faz a 0041 valer para ela.
⚠️ **Não deixar apagar coluna do Quadro geral por este caminho** enquanto a
5c não existir. A 8ª coluna sumir do quadro de 176 tarefas não é o risco desta
fatia. ⚠️ É essa recusa que segura `default_board_and_column_for_status`, que
ficou de FORA da ADR 0042 de propósito.

### 5b-5a — o módulo puro (front) — ✅ ENTREGUE

**Subiu:** `lib/coluna.ts::colunaEquivalente` e `rotuloDeColuna`, com
`lib/__tests__/colunaEquivalente.test.ts`. 529 → 541.

⚠️ **A fixture original não discriminava.** No `GERAL`, `Em Andamento` é a
primeira `IN_PROGRESS` por posição **e** é o alvo — regra certa e regra errada
respondiam igual. Corrigido, e o cabeçalho do arquivo agora diz
`⚠️ a resposta NAO depende da ordem do array`. **É literalmente a armadilha que
o próprio cabeçalho já avisava.**

### 5b-5b — ligar as duas telas transversais (front) — ✅ ENTREGUE (541→565)

⚠️ **Esta fatia vem ANTES da tela do quadro, e é a ordem que importa.** No
instante em que existir uma tarefa fora do Quadro geral, ela aparece em
`/minhas-tarefas` e em `/arquivadas`. **É PRÉ-REQUISITO da 5b-6, não
sequência.**

⚠️ **É a fatia mais arriscada que sobrou.** Mexe em `app/minhas-tarefas/page.tsx`
(**1321 linhas**) e `app/arquivadas/page.tsx` (**438**).

#### As QUATRO regressões, medidas no `main` em 12/08

O texto de 11/08 dizia que "a mudança não é a tag, é o agrupamento do kanban".
**Incompleto.** São quatro caminhos, e o kanban é o **único que avisa**:

1. ⚠️ **Vista de LISTA, silenciosa e sem contador.**
   `app/minhas-tarefas/page.tsx:583` —
   `const okStatus = colunasOn === null || colunasOn.has(t.column_id);`
   `colunasOn` é populado na linha 221 com `colunasPadraoMinhasTarefas(cs)`,
   ou seja **ids das colunas do Quadro geral**. Tarefa de outro quadro nunca
   está nesse `Set` e é filtrada fora da lista. Não há `foraDaColuna` aqui.
2. **Vista de KANBAN, com contador.** `page.tsx:640-651` monta `porColuna` só
   com as colunas do geral e joga o resto em `foraDaColuna`. **Tarefa de quadro
   avulso é contada e não desenhada.** Esta é a que o texto original descrevia,
   e é a menos grave das quatro justamente porque avisa.
3. ⚠️ **O alerta de prazo morre.** `page.tsx` na linha de `dueTone`:
   `col ? deadlineTonePorColuna(col, ...) : null`. Sem coluna resolvida, sem
   alerta. O comentário justifica: *"sem coluna resolvida não há como decidir →
   sem alerta, que é o lado seguro"*. Era o lado seguro quando "sem coluna"
   significava **dado faltando**. Depois da 5b-6 significa **quadro
   diferente**, e o lado seguro passa a ser o lado que mata o aviso de prazo de
   todo quadro avulso.
4. **`todosLigados`** (`page.tsx:674`) compara `colunasOn.size` contra
   `colunas.length` do geral. Menor, mesmo pacote.

#### ⚠️ `rotuloDeColuna` não modela o caso normal da tela que vai servir

Assinatura entregue na 5b-5a:
`rotuloDeColuna(nomeDaColuna: string, nomeDoQuadro: string | null)`, onde
`null` significa **"é o quadro desta tela"**. Não existe representação para
"não sei qual quadro" nem para "não sei qual coluna".

E `/arquivadas` passa `nomeDaColuna={colunaPorId.get(t.column_id)?.name}`
(`app/arquivadas/page.tsx:225`) — **`string | undefined`**, porque a tela lista
o workspace inteiro e a coluna pode não ter vindo na página carregada. Este
arquivo chama esse caso de **normal**.

⚠️ **Decida a assinatura ANTES de abrir o `page.tsx` de 1321 linhas**, não
dentro dele. O teste atual crava `rotuloDeColuna("Backlog", "")` → `" · Backlog"`;
o backend recusa nome vazio (`BoardService._nome_valido`), então isso nunca vem
da API — mas é o valor que um front sem dado tende a passar.

**Sobe:**
- tag `Quadro · Coluna` nas **duas** vistas de `/minhas-tarefas` (lista e
  kanban) e em `/arquivadas`;
- as quatro correções acima;
- **sem seletor de quadro.** Decisão de 11/08, confirmando a ADR 0034 item 6: o
  kanban de `/minhas-tarefas` agrupa por **status**, que é o denominador comum
  entre quadros; coluna não é. Um seletor é exclusivo e esconderia carga de
  trabalho sem erro nenhum. Se um dia for preciso focar, é **filtro** — aditivo
  e visível, no padrão dos filtros de pessoa e escopo que já existem;
- **o filtro da lente passa a exigir `board_id` do Quadro geral**
  (`Board.tsx`, decisão D1 de 11/08). ⚠️ **Ainda NÃO implementado** — medido em
  12/08, `Board.tsx:693-704` filtra só por `team_id`. Uma linha, com teste.
  ⚠️ **Entra aqui e não na 5c**: sem ela, tarefa de quadro extra da raiz passa
  no filtro da lente (`team_id === rootId` + responsável do subtime), a tela
  desenha as colunas do geral, `porColuna[t.column_id]` não acha nada e **o
  card some sem erro**.

**Testes que têm de ser escritos e falhar ANTES da correção:**
- tarefa com `column_id` de outro quadro aparecendo na **lista** de
  `/minhas-tarefas`;
- a mesma tarefa **mantendo o alerta de prazo**;
- tarefa de quadro extra da raiz **não** aparecendo na lente do subtime.

⚠️ Se algum deles passar verde contra o código atual, a fixture não discrimina.

⚠️ **Por que a tag carrega as DUAS informações:** o quadro responde "onde
mora"; a coluna responde "por que este card está agrupado em Em Andamento se a
coluna dele chama outra coisa". Coluna sem ponte deriva status pela semântica
(0041) — sem o segundo pedaço, o agrupamento parece defeito.

⚠️ **`STATUSES` só morre quando esta fatia estiver no ar**, e mesmo assim
continua sendo a reserva para tarefa cuja coluna não veio na lista carregada —
caso **normal** em `/arquivadas`, que lista o workspace inteiro. O
`paridadeColuna.test.ts` (61 testes) segue válido.

⚠️ **`include` do `vitest.config.ts` é só `lib/**` e `components/**`.** Teste
de página mora em `components/__tests__/` e importa de `@/app/...`. Os que
existem hoje: `minhasTarefas.test.tsx` (10) e `ArquivadasPai.test.tsx` (4).

### 5b-6 — a tela (front) — ✅ ENTREGUE (765→774 / 565→650)

**Sobe:** criar e renomear quadro dentro da **tela do time** (ADR 0034 item 5 —
não no menu lateral); seletor entre os quadros daquele time; CRUD de coluna na
tela; render de quadro avulso.

⚠️ **Quadro de lente NÃO mostra afordância de editar nem apagar — ausente, não
desabilitada** (ADR 0034 item 2). Lente e quadro avulso vão conviver no mesmo
seletor: a descrição fixa da lente é *"espelho do quadro geral"*.
⚠️ **O nome do quadro tem de aparecer no modal de criar tarefa**, explícito e
não inferido pela tela. Enquanto mover entre quadros não existir, tarefa criada
no quadro errado só se conserta apagando e recriando — perdendo comentários,
histórico, subtarefas e designações. Essa linha de UI é o que separa uma dívida
de um chamado por semana.
⚠️ **A tela não pode oferecer status que o quadro não tem** (ADR 0042,
§Consequências). Se algum `<select>` ainda listar os 8 fixos, ele mente de dois
jeitos diferentes: marcar "Bloqueado" num quadro de 4 colunas tem **êxito** e
devolve `IN_PROGRESS`; cancelar num quadro sem *Cancelado* devolve **422**, que
é um erro sem explicação para quem clicou.

---

### 5b-7 — as sete correções de 13/08 — ✅ ENTREGUE (backend 774→776, front 650→669)

Não estava no roteiro. Saiu de uma revisão de QA e de uma revisão de UI/UX
pedidas depois de a 5b-6 fechar, e **três dos sete eram defeitos que nenhum
portão pegava**.

| # | o quê | onde |
|---|---|---|
| 1 | tarefa nascia com o time de QUEM CRIA, e não com o do quadro | `Board.tsx` |
| 2 | coluna com tarefa APAGADA virava beco sem saída | `EditorDeColunas.tsx`, `lib/edicaoDeColunas.ts` |
| 3 | `/boards` falhando travava a tela em "Carregando" para sempre | `Board.tsx` |
| 4 | leitura de coluna não conferia a lente | `board_service.py` |
| 5 | `board_id` **nunca saía no corpo** do `POST /tasks` | `lib/api.ts` |
| 6 | `.error-text` usada em dois lugares e definida em nenhum | `globals.css` |
| 7 | quadro escolhido não vivia na URL | `app/quadro/[teamId]/page.tsx` |

⚠️ **O #5 é o mais importante desta lista, e o mais instrutivo.** O tipo
`TaskCreateInput` declarava `board_id` com quinze linhas de comentário, o
`TaskModal` preenchia, o `Board` passava e o backend inteiro consumia
(schema → router → `TaskService.create`). **A linha que põe o campo no CORPO
nunca existiu.** Toda tarefa criada dentro de um quadro avulso nasceu no
Quadro geral, com os três portões verdes.

⚠️ **E o sintoma não apontava para lá:** a tarefa não dava erro, não sumia e
não ficava sem dono — ela aparecia na LENTE do time, marcada como "Interna",
porque `team_id` ia no corpo e `board_id` não. **Meio certo é mais difícil de
ler que tudo errado.**

⚠️ **O teste de componente deu FALSA CONFIANÇA.** Havia um teste afirmando que
o `Board` "manda o `board_id`" — ele mocka `api.createTask` e confere o
ARGUMENTO, não o corpo HTTP. Medido: com o defeito presente, os 37 testes do
`Board.test.tsx` ficam **todos verdes**.

⚠️ **A MESMA FALHA JÁ TINHA ACONTECIDO EM 05/08**, na função vizinha, com
`subtask_assignees` e `skip_subtasks` — e a lição estava escrita no topo de
`lib/__tests__/duplicateTaskCorpo.test.ts`: *mock do cliente HTTP esconde campo
que o cliente não repassa*. Aconteceu de novo uma semana depois.

**A regra que fica, e ela é a versão-cliente da armadilha das três linhas:**

> No `lib/api.ts`, **`body: input` é seguro** (passa o objeto inteiro, campo
> novo chega sozinho); **`body: { … }` campo a campo NÃO é**. Campo novo numa
> função do segundo tipo ganha uma linha no `*Corpo.test.ts` correspondente, no
> mesmo commit. **Teste de componente que mocka a função da API não conta como
> guardião.**

Auditoria feita em 13/08: as funções que montam corpo campo a campo e ganharam
campo novo recentemente são exatamente **duas** — `duplicateTask` e
`createTask`. As duas já falharam do mesmo jeito, e as duas têm guardião de
corpo agora. `criarColuna`, `createBoard`, `updateTask`, `renomearColuna` e
`renomearQuadro` usam `body: input` e são imunes por construção.

**Sabotagens rodadas:**

| sabotagem | derruba |
|---|---|
| `timeDaTarefaNova` → `subteamId ?? null` | **1** |
| `defaultBoardId` → `null` | **1** |
| `board_id` fora do corpo em `createTask` | **1** — e **zero** no `Board.test.tsx` |
| seletor de destino volta a depender só de `quantas > 0` | **1** |
| `catch` de `listBoards` volta a só gravar `[]` | **2** |
| lente fora de `contar_tarefas_da_coluna` | **1** (estimado 2, veio 1 — o par do teste cobria) |
| `?quadro=` sem conferir o time do quadro | **2** |

⚠️ **Duas sabotagens vieram VERDES, e as duas ensinaram algo:**

1. **`setQuadros(null)` ao trocar de quadro** — linha acrescentada na própria
   sessão, com comentário justificando. Nenhum teste caiu porque **ela não faz
   nada**: se a lista antiga não tem o `boardId` novo, a tela já espera pelo
   guardião de baixo; se tem, mostrar direto é o certo. O que ela acrescentava
   era um piscar de "Carregando…" a cada troca. **Removida.**
2. **Cor do botão destrutivo** — não é testável em jsdom, mas o **nome da
   classe** é, e a decisão é de segurança. Teste acrescentado. ⚠️ Ele prende o
   nome da classe, **não a pintura**: o `include` do vitest é só `lib/**` e
   `components/**`, então apagar `.btn-danger` do `globals.css` mantém tudo
   verde e o botão sai sem estilo. **As classes CSS não têm guardião nenhum.**

---

## Fatia 5 (texto de 10/08 — HISTÓRICO, superseded em 11/08)

> ⚠️ **NÃO EXECUTE ESTA SEÇÃO.** O plano vigente é a §Fatia 5 acima, neste
> mesmo arquivo. Este texto é de 10/08 e
> está mantido como registro, no mesmo padrão da §"Fatia 4c — o bloqueio
> original" e da §"Fatia 4 (texto original)".
>
> **As quatro afirmações erradas, com o que vale no lugar:**
>
> 1. **"O quadro do subtime nasce vazio"** — não existe esse quadro.
>    `/quadro/[teamId]` é **lente**, não registro (ADR 0034). O modelo híbrido
>    está em produção desde a fatia 4 (`Board.tsx:687-704`). **A migração de
>    tarefas não existe como questão** — e as três saídas de custo listadas
>    mais abaixo nesta seção respondem a uma pergunta que não se faz.
> 2. **"Mexer em `default_board_and_column_for_status` é obrigatório"** — é o
>    contrário: **mexer é DEFEITO**. Tarefa interna nasce com `board_id` do
>    geral e `team_id` do subtime, e é isso que a faz aparecer na lente.
>    ⚠️ **`test_tarefa_de_subtime_nasce_no_quadro_da_raiz` continua CERTO e
>    VERDE.** Esta seção manda reescrevê-lo; **não reescreva.**
> 3. **"ADR 0036: derivação do status pela semântica" como entrega da fatia** —
>    as ADRs 0034, 0035 e 0036 já existiam. Faltava código, não decisão. A
>    decisão que faltava é a **0042**, escrita em 11/08.
> 4. **"A cor da coluna roda RGB livre (hex)"** (parágrafo perto do fim deste
>    arquivo, citando a ADR 0040 item 4, com validação
>    `^#[0-9a-fA-F]{6}$` no backend) — o corte de 11/08 decidiu o contrário
>    para a 5b: coluna nova nasce com cor de **token**, por rotação fixa. Sem
>    hex, sem luminância, sem validação. `lib/coluna.ts::corEhHex` continua sem
>    leitor, agora com data.
>
> **O que desta seção CONTINUA VALENDO** e está recitado no arquivo novo: o
> §Portão do vazamento de quadro logo abaixo, e a trava da permissão
> `board.manage.subteam` nos três conjuntos de `permissions.py`.

**Sobe:**
- migration: quadro não-padrão e coluna sem `legacy_status` já são suportados
  pelo schema — conferir antes de escrever migration por reflexo;
- `BoardService` ganha criar/renomear/apagar quadro e CRUD de coluna;
- permissão `board.manage.subteam`, com a trava de escopo no serviço (o mapa
  diz **o quê**, o serviço tem o `team_id` do alvo — precedente literal de
  `member.manage.subteam`, Spec 028);
- ADR 0035: `team_id` do TIME DO QUADRO, e designar para fora recusado no
  serviço;
- ADR 0036: derivação do status pela semântica, num lugar só, com teste
  comparando as duas regras;
- ADR 0034: apagar leva as tarefas, aviso com o número, **e a trava do E4**
  (quadro padrão não se apaga);
- rota e tela, com a troca de quadro **dentro da tela do time**.

### ⚠️ DECISÃO DE 10/08: O QUADRO DO SUBTIME NASCE VAZIO

Decisão de produto, tomada com quem pediu a funcionalidade. **O quadro novo
não recebe nenhuma tarefa existente.** As tarefas de hoje (832, todas no
`Quadro geral`) continuam onde estão.

**Por que isso é decisão e não preguiça — medido em 10/08:** *não existe
caminho no código para mover uma tarefa de quadro.* `task.board_id` é escrito
no `create` e em mais um lugar só (`task_service.py:423`, subtarefa herdando o
quadro do pai). Nenhuma rota, nenhum serviço, nenhum script. Fazer o quadro
novo nascer cheio exigiria escrever essa operação primeiro.

⚠️ **NASCER vazio é a decisão. CONTINUAR vazio é DEFEITO — e é o padrão do
código hoje.** `BoardRepository.default_board_and_column_for_status` procura
explicitamente o time SEM PAI (`JOIN team ... AND t.parent_team_id IS NULL`,
ADR 0032). Enquanto ela não mudar, **tarefa NOVA de subtime também é gravada
no quadro da raiz**, e o quadro interno fica vazio para sempre. Mexer nela é
escopo OBRIGATÓRIO desta fatia, não item opcional.

O alarme já está montado: `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`
fica vermelho no momento em que essa função mudar. **Esse vermelho é o sinal
de que a fatia funcionou** — reescreva o teste junto com a decisão nova, não
o apague (ver o portão do vazamento, acima).


> ⚠️ **AS DUAS SUBSEÇÕES QUE ESTAVAM AQUI E CONTINUAM VIGENTES FORAM PROMOVIDAS**
> na consolidação de 13/08: o **§Portão do vazamento de quadro** e o
> **§Adendo — mover tarefa entre quadros** agora são seções próprias, mais
> abaixo. Elas eram o motivo pelo qual esta seção não podia ser apagada.
>
> ⚠️ **A subseção "O QUADRO DO SUBTIME NASCE VAZIO", logo acima, é HISTÓRICA
> junto com o resto**: ela descreve um quadro que não existe. `/quadro/[teamId]`
> é lente, não registro (ADR 0034), e a lente nasce cheia por construção.

---

## Fatia 6 — modo de edição de colunas, em LOTE

> Escrita em 13/08/2026, **revisada no mesmo dia** depois do LoFi da Camila.
> ⚠️ **A primeira versão desta seção descrevia o modelo "cada ação vai ao
> servidor na hora". Ele foi trocado** — ver §O modelo, e a nota sobre o que
> isso custou da 6a.
> ✅ **FECHADA EM CÓDIGO em 13/08** (6a, 6a-bis, 6a-ter, 6b, 6c-1, 6c-2a/b,
> 6c-2c, 6c-3), CI #52 verde: backend 807, front 737.
> ✅ **CONFERIDA NA TELA EM 17/08**, e a conferência achou seis coisas (§Estado).
> ⬜ **FALTA RECONFERIR o que as correções mexeram** — a lista curta está na
> §Conferência visual, e é o que resta do portão do deploy nesta fatia.

⚠️ **ESTA FATIA VEM ANTES DO DEPLOY DA 5b.** Decisão de 13/08, e o motivo é
concreto: `BoardService.criar_coluna` grava `position=len(existentes)` —
**sempre o fim**, sem alternativa. Sem reordenar, a ordem das colunas de um
quadro fica congelada para sempre em "as 4 base + ordem de criação", e **não há
conserto**: apagar e recriar devolve a coluna ao fim de novo.

⚠️ **O argumento contrário caiu quando foi medido.** Várias sessões trataram as
29 notificações indevidas como custo de adiar o deploy. Elas são **in-app**,
endereçadas a contas desativadas que não entram para vê-las. O custo real de
adiar é próximo de zero.

### O modelo: nada vai ao servidor até "Concluir edição"

Modo de edição sobre o próprio quadro, ligado por um lápis no cabeçalho. Dentro
dele a pessoa mexe à vontade — renomeia no lugar, arrasta cabeçalhos, marca
colunas para sumir, cria colunas — e **nada é gravado**. Ao concluir, uma
revisão resolve as pendências (para onde vão as tarefas de cada coluna marcada)
e **um pedido só** grava tudo.

⚠️ **O QUE ESTE MODELO PERMITE E O ANTERIOR NÃO:** trocar uma coluna por outra.
Hoje é impossível — seria criar "Entregue", salvar, depois apagar "Aprovação"
mandando as tarefas para lá: duas idas, em duas telas. Em lote é um gesto só, e
é assim que a pessoa pensa a operação. **É por isso que o modelo mudou**, e não
por preferência de interação.

⚠️ **A COLUNA CRIADA PRECISA PODER SER DESTINO DE UMA APAGADA, e ela ainda não
tem id.** Daí o `tmp:` no corpo — ver o desenho do endpoint. Sem isso, o caso de
uso acima não fecha, e ele é a razão de ser do lote.

### Decisões (13/08, com a Camila)

| | decisão | por quê |
|---|---|---|
| D1 | **Lote.** Nada vai ao servidor até concluir | Trocar coluna por outra vira um gesto |
| D2 | Um botão só: **"Concluir edição"** | Sem "Salvar" + "Cancelar": no lote, sair sem concluir JÁ é o cancelar |
| D3 | Sair sem concluir **descarta tudo**, inclusive coluna criada | ⚠️ **Com aviso**, senão a coluna some sem explicação |
| D4 | O "×" **marca** a coluna, e ela fica riscada até concluir | É o que torna o lote legível: você vê o que vai acontecer antes de confirmar |
| D5 | **Setas ← / →** ao lado do arraste | Dão o guardião (ver D9) e dão teclado e leitor de tela |
| D6 | **Selo de alvo** no cabeçalho | Ver ⚠️ abaixo |
| D7 | Coluna nova **continua nascendo no fim** | Com reordenar existindo, cria-e-arrasta basta |
| D8 | **Cards travam, e continuam visíveis** | Sumir esconderia que o "×" está sobre uma coluna com 40 tarefas |
| D9 | A regra de ordem mora em **`lib/`**, pura e testada | `onDragEnd` não é testável em jsdom |
| D10 | **Cor fica de fora** — fatia própria | Hoje a cor sai de `_cor_por_rotacao`; aceitar cor exige schema, validação e a decisão paleta × hex livre. `corEhHex` continua sem leitor |
| D11 | O lápis só existe com **`podeEditarColunas`** | Senão é um botão que abre um modo onde tudo dá 403 |
| D12 | **Quadro geral é editável** (ADMIN e MANAGER da raiz) | Ver §Fatia 6a-bis |
| D13 | **Sem migration** | `position` já existe |

⚠️ **D6, e é a decisão menos óbvia.** A ADR 0030 decidiu que o destino da
cascata é `is_default_target`, e **não** "a primeira pela ordem" — de propósito,
para que arrastar não mude comportamento em silêncio. Mas **reordenar torna a
confusão provável**: é natural pôr uma segunda coluna de conclusão ("Entregue")
antes de *Concluído* e esperar que as tarefas passem a cair lá. Não vão — coluna
criada por gente nasce com `is_default_target=False`, e **não existe operação
para trocar o alvo** (item 5 do §O que falta). O selo evita que alguém descubra
isso por dedução, na semana seguinte, com uma tarefa no lugar errado.

### ⚠️ Os três preços do lote, aceitos em 13/08

1. **Recusa perde tudo.** Se outra pessoa mexer nas colunas enquanto esta edita,
   o servidor recusa o lote inteiro e ela refaz todas as alterações. No modelo
   por ação, perderia só a que falhou. Aceito porque quem edita coluna são
   ADMIN e MANAGER, e raramente.
2. **A revisão fica pesada com várias exclusões.** Cada coluna marcada precisa
   da sua própria pergunta de destino, com o aviso mudando de texto inteiro
   quando o destino é terminal. Três exclusões = três blocos numa tela só.
3. **A contagem de tarefas é buscada NA HORA DE CONCLUIR**, e não quando a
   pessoa clica no "×". Entre um e outro alguém pode ter criado tarefa naquela
   coluna, e o número da revisão tem de ser o do momento da decisão.

⚠️ **E o que o lote NÃO protege:** apagar continua sendo o único irreversível.
Depois de confirmar, as tarefas foram movidas — ou concluídas, com cascata nas
subtarefas, `terminal_since` ligado e fila de arquivamento. **Nenhum "descartar"
desfaz isso.** A revisão é a última chance, e é por isso que ela mostra
contagem, destino e o aviso que muda de texto.

### O endpoint de lote (6a-ter)

`PUT /api/v1/boards/{board_id}/columns`, corpo com o estado desejado:

```
{
  "criar":    [{"tmp": "nova-1", "name": "Entregue", "semantic": "DONE"}],
  "renomear": [{"id": "...", "name": "Em revisão"}],
  "apagar":   [{"id": "...", "destino": "tmp:nova-1"}],
  "ordem":    ["...", "tmp:nova-1", "..."]
}
```

⚠️ **`PUT` E NÃO `PATCH`**: o corpo descreve o estado final do conjunto de
colunas, não um remendo.

⚠️ **A ORDEM DAS ETAPAS É OBRIGATÓRIA: criar → renomear → apagar → reordenar.**
Criar antes porque a coluna nova pode ser destino de uma apagada. Reordenar por
último porque a conferência de conjunto dele compara com as colunas que
**existem depois** de criar e apagar — rodá-lo antes compararia contra um quadro
que está prestes a mudar.

⚠️ **`tmp:` RESOLVE ANTES DE CHEGAR AO `TaskService`.** O mapa `tmp → id real`
é montado na etapa de criação e usado na de apagar. Um `destino` com `tmp:` que
não esteja em `criar` é recusa, não `None` — cair para "sem destino" produziria
`coluna_sem_destino` num pedido que **tinha** destino, e a tela não teria como
explicar.

⚠️ **TUDO NUMA TRANSAÇÃO SÓ.** Falha em qualquer etapa desfaz as anteriores. É o
que torna o preço nº 1 aceitável: não existe lote meio aplicado.

**As travas continuam, avaliadas contra o ESTADO FINAL** — o que é mais correto
e mais permissivo que hoje: não sobrar coluna de início, ou não sobrar alvo de
início, é recusa; apagar a última de conclusão é recusa **mesmo que a pessoa
tenha criado outra**, porque coluna criada por gente nunca nasce como alvo. ⚠️ É
aqui que a ausência do item 5 do §O que falta (trocar o alvo) vai doer pela
primeira vez de forma visível.

### ⚠️ O QUE A MUDANÇA DE MODELO CUSTOU DA 6a

A 6a foi construída antes de o modelo assentar. O que ela deixou:

| peça | destino |
|---|---|
| `BoardService.reordenar_colunas` | **sobrevive** — vira a última etapa do lote |
| os 14 testes de integração dela | **sobrevivem** — testam o serviço direto |
| `lib/ordemDeColunas.ts` + 17 testes (6b) | **sobrevivem** — a tela reordena localmente |
| rota `PATCH /{board_id}/columns/order` | ⚠️ **morre** — ninguém mais a chama |
| `BoardColumnReorderRequest` | ⚠️ **morre** junto |
| `api.reordenarColunas` + `reordenarColunasCorpo.test.ts` | ⚠️ **morrem** junto |

⚠️ **APAGUE A ROTA MORTA NO MESMO COMMIT DO ENDPOINT DE LOTE.** Endpoint sem
chamador é a mesma doença de `corEhHex`, e esta ainda vem com schema e teste
próprios dando aparência de coisa viva.

### Sub-fatias, em ordem

| | o quê | estado |
|---|---|---|
| **6a** | `reordenar_colunas` + rota + 14 testes | ✅ **entregue** (776→790) |
| **6b** | `lib/ordemDeColunas.ts` + 17 testes + `api.reordenarColunas` + guardião de corpo | ✅ **entregue** (669→689) |
| **6a-bis** | Quadro geral editável — ver seção própria | ✅ **entregue** (790→794) |
| **6a-ter** | `PUT /columns` em lote, `tmp:`, transação, e apagar a rota morta | ✅ **entregue** (794→807 / 689→691) |
| **6c-1** | `lib/rascunhoDeColunas.ts` | ✅ **entregue** (691→716) |
| **6c-2a/b** | `CabecalhoDeColunaEditavel.tsx` + `FormNovaColuna.tsx` | ✅ **entregue** (716→736) |
| **6c-3** | `RevisaoDaEdicao.tsx` | ✅ **entregue** (736→748) |
| **6c-2c** | a fiação no `Board.tsx` | ✅ **entregue** (748→754) |
| **dívida** | `destinosDoRascunho` em `lib/` + `mensagemDeDivergencia` reposta | ✅ **entregue** (754→737) |

⚠️ **A ROTA MORTA FOI APAGADA como o parágrafo acima mandava:**
`PATCH /{board_id}/columns/order`, `BoardColumnReorderRequest`,
`api.reordenarColunas` e `lib/__tests__/reordenarColunasCorpo.test.ts` **não
existem mais**. `BoardService.reordenar_colunas` sobreviveu, como previsto.

⚠️ **`@dnd-kit/sortable` é dependência NOVA** — só o `@dnd-kit/core` está
instalado. Mesmo autor, mesma linha de versão. Instalar, não improvisar com o
core. O `package-lock.json` entra no commit.

### ⚠️ O QUE O REDESENHO TINHA DE PRESERVAR — conferido em 17/08

⚠️ **`components/EditorDeColunas.tsx` E O TESTE DELE NÃO EXISTEM MAIS**
(apagados na 6c-2c; é a queda de 20 no total do front). Esta seção deixa de ser
requisito a cumprir e vira **registro de onde cada peça foi parar** — os cinco
itens abaixo foram localizados no `main` de 17/08.

O painel apagado era onde morava o diálogo de apagar — **a peça mais perigosa
da funcionalidade inteira**, endurecida na 5b-7. Requisito, não "seria bom":

1. o beco sem saída da coluna com tarefa **apagada** (soft-deleted) — a contagem
   conta só as vivas, mas o `DELETE` exige destino se houver apagadas, por causa
   da FK `RESTRICT`;
2. o botão destrutivo em **vermelho** (`.btn-danger`), separado do azul de ação;
3. **foco** no diálogo ao abrir e **`Esc`** para fechar;
4. o resto da tela **travado** enquanto o diálogo está aberto;
5. as sabotagens que provam cada um dos quatro.

**Onde cada um está hoje** (`grep`, 17/08):

| | onde foi parar |
|---|---|
| 1. beco da tarefa apagada | `RevisaoDaEdicao.tsx` — o seletor de destino aparece para **toda** coluna marcada; o comentário da contagem viva/apagada está na linha 75 |
| 2. `.btn-danger` | `RevisaoDaEdicao.tsx:283`, e o teste que o prende é `RevisaoDaEdicao.test.tsx:195` |
| 3. foco + `Esc` | `RevisaoDaEdicao.tsx:56` (`caixaRef.current?.focus()`) e `:120` (`Escape`, guardado por `!ocupado`) |
| 4. resto da tela travado | `RevisaoDaEdicao.tsx:100` — `position:fixed; inset:0; zIndex:60` **inline**. ⚠️ **`.modal-card` carrega só animação**; o posicionamento não vem da classe |
| 5. as sabotagens | `RevisaoDaEdicao.test.tsx` |

⚠️ **O ITEM 4 NÃO TEM GUARDIÃO DE ESTILO.** O `include` do vitest é
`lib/**` + `components/**`: apagar `.btn-danger` do `globals.css` mantém os 737
verdes e o botão sai sem cor. O teste prende o **nome da classe**, não a
existência da regra.

⚠️ **NO LOTE, O ITEM 1 MUDOU DE LUGAR, E NÃO DESAPARECEU.** A revisão pergunta o
destino de toda coluna marcada — inclusive das que parecem vazias. É o que já
conserta o beco por construção: o seletor está sempre lá.

⚠️ **A REGRA SOBREVIVE, O DESENHO NÃO.** Tudo o que decide está em
`lib/edicaoDeColunas.ts` — `avisoDeExclusao`, `destinosPara`,
`impedimentoDeExclusao`, `explicaRecusa`, `mensagemDeDivergencia` — com 19 testes
que não dependem de tela. **É a fronteira da Spec 027 pagando o que prometia.**

⚠️ **`destinosPara` PRECISA PASSAR A ACEITAR AS COLUNAS `tmp:`**, senão a coluna
recém-criada não aparece no seletor de destino — que é a razão de ser do lote.

### Armadilhas medidas em 13/08

⚠️ **`criar_coluna` DEPENDE DE AS POSIÇÕES SEREM DENSAS (`0..n-1`).** Ela grava
`position=len(existentes)`. Buraco deixado pelo reordenar faz a próxima coluna
nascer com posição **duplicada**.

⚠️ **NÃO EXISTE ÍNDICE ÚNICO EM `(board_id, position)`** — conferido em
`app/db/models/boards.py`. Posição duplicada **não estoura nada**, e `ORDER BY
position` com empate devolve ordem indefinida: as colunas trocam de lugar entre
um F5 e outro, sem erro em lugar nenhum.

⚠️ **`_renumerar` NÃO É CHAMADO por `reordenar_colunas`, e isso foi MEDIDO.** A
chamada estava lá "por segurança" e a sabotagem de removê-la veio VERDE: o laço
já grava `0..n-1` denso, porque a conferência de conjunto garante que a lista é
completa. Quem segura a densidade é aquela conferência.

⚠️ **A CONFERÊNCIA DE CONJUNTO É TRIPLA, e as três são necessárias.** `len`,
`set`, e — a que quase escapou — id repetido: `{a,a,b,c} == {a,b,c}` é
verdadeiro em Python. Sem o `set`, um id de outro quadro passa e estoura em
`KeyError`, que numa requisição real é **500** e não 422.

⚠️ **A ROTA DE SEGMENTO FIXO TEM DE SER DECLARADA ANTES DA DE PARÂMETRO.** O
FastAPI casa na ordem de declaração; `columns/order` declarada depois de
`columns/{column_id}` é capturada como `column_id="order"` e morre em "id
inválido". Medido em 13/08, depois de eu cometer o erro. **Vale para o `PUT
/columns` também**, que colide com `POST /columns` só no método — confira.

### Sabotagens previstas (6a-ter e 6c)

| sabotagem | esperado |
|---|---|
| lote aplica sem conferir o conjunto final | testes de concorrência |
| ordem das etapas trocada (apagar antes de criar) | o teste de "coluna nova como destino" |
| `tmp:` desconhecido vira `None` em vez de recusa | teste próprio |
| falha na etapa 3 não desfaz as etapas 1 e 2 | teste de transação |
| cards continuam arrastáveis no modo de edição | ⚠️ conferência visual — **não testável em jsdom** |
| selo de alvo removido | teste de componente |
| sair do modo com pendências não avisa | teste de componente |

### Tamanho

**Estimativa, não medida** (backend não roda sem Postgres): **6a-bis** meio dia;
**6a-ter** um dia; **6c** dois dias. Total restante: **3 a 4 dias**.
⚠️ **Consumiu mais de uma sessão.** Use isso ao estimar a 7 e a 8.

---


## Fatia 9 — nome único de quadro e de coluna — ✅ ENTREGUE (18/08)

> Escrita e entregue em 18/08/2026. **Decisão da Camila, com o custo na mesa.**
> Backend 808→823, front 758→769. **Migration `0013`, e ela NÃO subiu.**

⚠️ **AS TRÊS PERGUNTAS FORAM RESPONDIDAS EM 18/08, e as respostas estão no
código:** maiúscula CONTA ("Backlog" e "backlog" convivem); quadro APAGADO não
ocupa o nome (índice parcial); espaço nas pontas é limpo (`strip`, que os dois
validadores já faziam).

⚠️ **O QUE FOI ENTREGUE, E COM QUE GARANTIA:**

| | onde a regra mora | o que a sustenta |
|---|---|---|
| **quadro** | índice `board_nome_unico_por_time` (`0013`) **+** `_assert_nome_de_quadro_livre` | o índice é a verdade; a validação existe para a recusa sair 422 com `code` e não `IntegrityError`/500 |
| **coluna** | `_assert_nomes_do_lote` (estado FINAL) + `_assert_nome_de_coluna_livre` (entradas de uma só) | **nenhum índice** — ver abaixo. Vigia: consulta 9 do `invariantes.sql` |
| **tela** | `nomeRepetidoNoRascunho`, no "Concluir edição" | barra antes de mandar: no lote a recusa perde a edição INTEIRA |

⚠️ **POR QUE COLUNA NÃO TEM ÍNDICE, e não é esquecimento.** O lote aplica em
quatro etapas com `flush` em cada uma. Um `UNIQUE (board_id, name)` recusaria o
estado INTERMEDIÁRIO de dois gestos legítimos — trocar duas colunas de nome
entre si, e apagar "Aprovação" para criar outra "Aprovação" no mesmo lote (que
é a razão de ser do lote). E recusaria com `IntegrityError`, ou seja **500**.
Os dois gestos têm teste próprio (`test_o_lote_permite_TROCAR_dois_nomes` e
`test_o_lote_permite_APAGAR_e_RECRIAR_com_o_mesmo_nome`); **se alguém
"consertar" acrescentando o índice, os dois caem.**

### ⚠️ ANTES DE APLICAR A `0013` EM PRODUÇÃO

**Rode a consulta 8 do `invariantes.sql`.** A migration confere e ABORTA com a
lista se houver duplicata — de propósito, para não devolver o erro cru do
Postgres, que diz "não consegui criar o índice" sem dizer quais quadros nem o
que fazer. Em produção não deve haver (um quadro só, consulta 5); em
desenvolvimento havia, criados na conferência de 17/08. **O conserto é
RENOMEAR pela tela** — apagar quadro não existe até a fatia 7.

### Dois defeitos achados escrevendo esta fatia

1. ⚠️ **O erro do lote não aparecia quando não havia coluna marcada para
   apagar.** `erroLote` só era passado para a `RevisaoDaEdicao`, que só existe
   com exclusão. Um lote de renomear e reordenar recusado (403,
   `colunas_divergentes`, rede caída) chamava `setErroLote` e sumia: **a pessoa
   clicava em "Concluir edição" e não acontecia nada.** Anterior à fatia 9.
   Corrigido, com `role="alert"` — o erro nasce longe do foco.
2. ⚠️ **`semantic` como STRING passa por tudo e quebra no `logger`.**
   `ColumnSemantic` é `StrEnum`: a string compara igual, atravessa permissão,
   nome, posição e o `INSERT` inteiro, e só estoura em `semantica.value`, a
   última linha. **A falha aparece longe da causa.** Irmã da armadilha já
   catalogada "`text()` devolve STRING, não enum".

⚠️ **HOJE NÃO EXISTE NADA IMPEDINDO, e isso foi CONFERIDO, não suposto:** não
há `UniqueConstraint` em `board.name` nem em `board_column.name`
(`app/db/models/boards.py`), e `BoardService` não valida nome repetido em
lugar nenhum. A conferência de 17/08 mostrou **três** quadros "Quadro CRM
Teste" no mesmo subtime e **duas** colunas "Em Andamento" no mesmo quadro.

⚠️ **É PRÉ-REQUISITO DA FATIA 7, E ESSE É O MOTIVO DE ELA VIR ANTES.** A Fatia
7 confirma a exclusão de quadro **digitando o nome**. Com três quadros de mesmo
nome, digitar o nome não diz qual — a confirmação vira teatro, e teatro numa
operação que apaga as tarefas dentro é pior que nenhuma confirmação.

### A regra

- **Quadro:** nome único por **time** (`team_id`, `name`).
- **Coluna:** nome único por **quadro** (`board_id`, `name`).

### ⚠️ As perguntas que decidem o tamanho — responda ANTES de escrever código

1. **Compara com ou sem maiúscula?** "Backlog" e "backlog" são o mesmo nome?
   ⚠️ Se forem, o índice precisa ser sobre `lower(name)`, e isso muda a
   migration. Se não forem, a tela vai aceitar os dois e alguém vai reclamar.
2. **Quadro APAGADO ocupa o nome?** A `0012` é soft delete: `deleted_at` não
   nulo. ⚠️ Índice simples faria um quadro apagado bloquear o nome dele para
   sempre, **sem nada na tela explicando por quê**. Índice PARCIAL
   (`WHERE deleted_at IS NULL`) resolve, e o repositório já usa essa técnica em
   `board_um_padrao_por_time`.
3. **Espaço nas pontas conta?** `_nome_de_coluna_valido` já faz `strip`; o de
   quadro precisa fazer o mesmo, senão `"CRM "` passa por ser diferente de
   `"CRM"`.

### ⚠️ O QUE VAI QUEBRAR NA SUA MÁQUINA, E NÃO EM PRODUÇÃO

**A migration vai FALHAR no banco de desenvolvimento**, porque ele tem os três
"Quadro CRM Teste" e as duas "Em Andamento" criados na conferência de 17/08.
Índice único não é criado sobre dado que já viola.

- **Em produção não falha:** um quadro só (`Quadro geral`) e oito colunas de
  nomes distintos — `invariantes.sql` consulta 5, medida em 10/08.
- **Antes de rodar, apague as duplicatas do banco de dev pela tela.** ⚠️ E
  **escreva a consulta que ACHA duplicata em `invariantes.sql`, no mesmo
  commit** — ela é o que prova que produção está limpa antes do deploy, e é o
  que vai avisar se alguém criar duplicata entre agora e a migration.

### Guardiões

| sabotagem | esperado |
|---|---|
| tirar o índice do banco | teste de integração que tenta gravar a duplicata direto e espera `IntegrityError` |
| tirar a validação do serviço | teste que espera **422 com `code`**, e não 500 do banco |
| o índice sem `WHERE deleted_at IS NULL` | teste: apagar um quadro e recriar com o mesmo nome |
| a tela não mostra o erro | teste de componente lendo o `code`, nunca a mensagem |

⚠️ **DUAS CAMADAS, E AS DUAS SÃO NECESSÁRIAS.** O índice é a verdade; a
validação no serviço é o que transforma a recusa em **422 com `code`** em vez
do 500 que um `IntegrityError` cru produz. Este projeto já tem a cicatriz:
`@model_validator` devolvendo 500 está catalogado nas armadilhas.

---

## Fatia 8 — o LUGAR de uma tarefa — ✅ ENTREGUE (18/08)

> Backend 823→834. **Sem migration.** Duas travas, o mesmo assunto: cada tarefa
> aparece num lugar só, e quem decide é a dupla `board_id` + `team_id`.

| | onde |
|---|---|
| **pai e filha no mesmo quadro** | `TaskService.move` recusa pai de outro quadro (`pai_em_outro_quadro`) |
| **em quadro avulso, o time da tarefa é o do quadro** | `_assert_time_do_quadro`, no `create` E no `update` (`time_fora_do_quadro`) |

⚠️ **A SEGUNDA VALE SÓ EM QUADRO AVULSO, e essa metade vale 216 tarefas.** No
Quadro geral o time continua livre — é o que sustenta a tarefa INTERNA de
subtime, que vive no geral com `team_id` do subtime e aparece **só na lente
dele**. Medido em 18/08: 583 na raiz, 216 em subtimes (101 Mídias Sociais, 85
SEO, 10 Audiovisual, 10 Desenvolvimento, 4 CRM, 3 Eventos, 3 Design). Uma
trava que valesse para o geral apagaria a funcionalidade.

⚠️ **ALCANCE NÃO É PROPRIEDADE, e só ficou claro escrevendo.**
`_assert_board_in_reach` responde *"você alcança este quadro?"* — e um MANAGER
da raiz alcança todos. Ele podia criar tarefa no quadro do SEO com time de
Design, e a trava antiga deixava passar. São perguntas diferentes.

⚠️ **DECISÃO DE 18/08: RECUSA, e não mover junto.** Mover a subárvore entre
quadros mexeria em coluna, permissão e histórico ao mesmo tempo — entrega
própria. **A mensagem diz o que fazer** ("mova a tarefa de topo inteira"), e
tem teste para isso: recusar sem saída é um beco.

⚠️ **A consulta 10 do `invariantes.sql` deu ZERO em 18/08, por AUSÊNCIA DE
CASO** — produção tem um quadro só. Ela só vira afirmação depois do deploy.

---

## Fatia 8 — texto de escopo (histórico, antes da entrega)

> Escrita em 17/08/2026, **reescrita em 18/08**: a ordem inverteu (8 → 7) e o
> escopo cresceu com a invariante declarada pela Camila.

⚠️ **A ORDEM INVERTEU EM 18/08, e o motivo é concreto.** A fatia 7 apaga o
quadro e as tarefas dentro; ela só é simples se a subárvore inteira estiver
DENTRO. Enquanto pai e filha puderem viver em quadros diferentes, a 7 teria de
tratar o caso disperso — e esse tratamento vira **código morto** no dia em que
a 8 proibir o estado. É a doença que esta spec já catalogou três vezes
(`corEhHex`, `is_default_target` até a 4c, a rota `PATCH /columns/order`).

### ⚠️ A INVARIANTE, declarada em 18/08

> *"As tarefas e subtarefas que vivem dentro de um quadro devem ser só desse
> quadro. Se mover uma subtarefa, move-se a tarefa pai inteira junto ou não
> move."*

⚠️ **ELA NÃO VALE HOJE, E ISSO FOI MEDIDO, não suposto.** `TaskService.move`
troca o `parent_task_id` e **não toca em `board_id` em linha nenhuma** — zero
menções no método inteiro. Mover B para debaixo de A, com A em outro quadro,
deixa B no quadro velho. A FK composta `(column_id, board_id)` **aceita**,
porque o par continua internamente consistente.

⚠️ **E O CÓDIGO JÁ SABIA.** O cabeçalho do `board_repository.py` descreve este
exato estado e o chama de *"o silencioso"* — a FK aceita e ninguém percebe. Foi
fechado no `create` (subtarefa herda o quadro do pai) e **nunca no `move`**.

⚠️ **HOJE É INOFENSIVO E DEIXA DE SER NO DIA DO DEPLOY:** produção tem um
quadro só, então não há segundo quadro para divergir. **Medida pela consulta 10
do `invariantes.sql`**, que entrou em 18/08 — e ela é `0` por AUSÊNCIA DE CASO,
não por trava. Leia junto com a 5, igual à 7.

⚠️ **PELA TELA NÃO DÁ, PELA API DÁ.** O `TaskDetail` só oferece trocar de
PROJETO; trocar de pai não tem controle. Mas `POST /tasks/{id}/move` aceita
`parent_task_id`, e **este workspace usa n8n contra esta API** — mesmo modelo de
ameaça de `_assert_team_in_reach` e `_assert_board_in_reach`.

### Decisão de 18/08: **RECUSA**, e não move junto

`move` para um pai de outro quadro devolve **422 com `code`**. Mover a subárvore
inteira entre quadros ficou de fora — é a fatia grande (mexe em coluna,
permissão e histórico ao mesmo tempo), e recusar já fecha a invariante.

⚠️ **SEM MIGRATION.** Recusar é regra de serviço; a `0013` fica como está.

### O que sobe

- ⚠️ **A recusa no `move`**, com `code` próprio. **Escreva o teste ANTES** — ele
  falha hoje, contra os 823 verdes, e é a única coisa desta fatia que não é
  opinião.
- **`board_id` no move de tarefa entre quadros**, ou rota própria — decidir, e
  escrever a decisão aqui. ⚠️ **Só dentro do mesmo `team_id`** (regra de 13/08).
- ⚠️ **A outra metade da divergência, medida em 17/08:** `PATCH /tasks/{id}`
  aceita `team_id`, valida o alcance, escreve `task.team_id` e **não toca em
  `board_id`** — dá para deixar os dois apontando para times diferentes, e
  quadro decide QUEM VÊ (ADR 0035 D3).

### Guardiões

| sabotagem | esperado |
|---|---|
| `move` para pai de outro quadro | **teste novo** — falha hoje, no `main` verde |
| `PATCH` com `team_id` de outro time e `board_id` intacto | **teste novo** — hoje NADA o pega |
| move para quadro de outro `team_id` | teste de recusa 422 |
| move sem recalcular a coluna | teste da ADR 0042 |

---

## Fatia 7 — apagar quadro — ✅ ENTREGUE (18/08)

> Backend 834→842, front 769→788. **Sem migration** — a `0012` criou o
> `deleted_at` do quadro em 06/08, justamente para este dia.

⚠️⚠️ **É A OPERAÇÃO MAIS DESTRUTIVA DO PRODUTO, E A ÚNICA QUE NÃO PERGUNTA O
DESTINO DAS TAREFAS.** Apagar coluna sempre oferece para onde elas vão; aqui
elas somem junto. **A expectativa que o resto do produto ensinou está errada
neste botão** — é por isso que a confirmação é por digitação do nome, e não um
"tem certeza?".

⚠️ **E ELA SÓ FUNCIONA PORQUE O NOME É ÚNICO NO TIME (fatia 9).** Com três
quadros "Quadro CRM Teste", digitar o nome não diz qual. Foi por isso que a 9
veio antes.

### ⚠️ O QUE SEGURA O RESGATE, E COMO QUEBRÁ-LO SEM PERCEBER

`restaurar_quadro.sql` devolve **só o que aquele clique apagou**, casando
`task.deleted_at = board.deleted_at`. Isso funciona porque **`NOW()` no
Postgres é o instante da TRANSAÇÃO**, igual em todos os comandos dela.

⚠️ **Trocar aquele `NOW()` por um `datetime.now()` do Python quebra o resgate
em silêncio:** dois instantes com microssegundos de diferença, a igualdade não
casa nada, e o script devolve o quadro **vazio, sem erro** — com todos os
outros testes verdes. O guardião é
`test_o_deleted_at_do_quadro_e_das_tarefas_e_IGUAL`, e ele existe só para isso.

A outra metade: o `UPDATE` filtra `deleted_at IS NULL`, então tarefa apagada de
propósito semanas atrás **não é re-carimbada e não ressuscita**. O script
mostra esse número em separado, para quem for restaurar conferir antes.

### Três coisas que só apareceram escrevendo

1. **Os comentários vão antes das tarefas.** O `UPDATE` deles casa pelas
   tarefas VIVAS; rodando depois, elas já estariam marcadas e os comentários
   ficariam vivos pendurados em tarefas apagadas.
2. ⚠️ **O passo 2c do resgate pode falhar, e a falha é correta.** O índice de
   nome único (`0013`) é parcial em `deleted_at IS NULL` — se alguém criou
   outro quadro com o mesmo nome depois da exclusão, ressuscitar este produz
   duas linhas iguais e o banco recusa. O `BEGIN` garante que nada fica pela
   metade; o conserto é renomear um dos dois.
3. ⚠️ **O aviso de divergência era escrito e nunca aparecia.** Estava pendurado
   no estado `erro` do `SeletorDeQuadro`, que só é desenhado **dentro do
   formulário de renomear** — fechado na hora em que alguém apaga. Pego por
   teste, não por leitura.

### ⚠️ A ESPERA ETERNA, e por que o primeiro conserto estava errado

O `Board.tsx` avisava desde 13/08: *"no dia de apagar quadro isto vira espera
eterna"*. A fatia 7 tornou isso alcançável.

⚠️ **O primeiro conserto tentou separar "a lista ainda não foi buscada" de
"foi, e o quadro não veio" — e os dois casos são INDISTINGUÍVEIS num único
instante.** Na corrida de quem acabou de criar o quadro, a lista também já foi
buscada e também voltou sem ele: o `listBoards` saiu antes de o `POST` gravar.
**O teste da corrida foi quem mostrou.**

O que separa é o TEMPO: a tela busca uma **segunda vez** antes de desistir.
⚠️ **Uma só** — um laço transformaria o quadro apagado numa tela batendo no
servidor para sempre, que é o defeito anterior com custo de rede.

### Sem history por tarefa, e é escolha

Seriam centenas de linhas por clique (173 tarefas de topo só no geral). O
rastro é o log `board.apagado` com a contagem, mais a igualdade de carimbo —
mais precisa que o history para o único uso que importa: desfazer.

---

## Fatia 7 — texto de escopo (histórico, antes da entrega)

> Escrita em 17/08/2026. Era o item 1 da §"o que falta"; virou fatia própria
> quando a §Definição de pronto fechou a lista do deploy.

⚠️ **DEPENDE DA FATIA 9 (✅ entregue em 18/08) E DA FATIA 8 (⬜).** A
confirmação por digitação só desambigua com nome único; e apagar a subárvore só
é simples com a invariante de pai e filha valendo. **A ordem é 9 → 8 → 7.**

### ⚠️ AS TRÊS PERGUNTAS FORAM RESPONDIDAS EM 18/08

1. **O Quadro geral pode ser apagado?** **NÃO.** Ele é onde nasce toda tarefa
   de topo (`default_board_and_column_for_status`); sem ele ninguém cria tarefa
   nenhuma — as 26 pessoas, de uma vez. **O botão não aparece nele**, ausente e
   não desabilitado (ADR 0034 item 2, mesma regra da lente).
2. **Com tarefas dentro: pede destino ou apaga junto?** **APAGA JUNTO**, como a
   ADR 0034 já dizia. ⚠️ **E é a única operação do produto que não pergunta o
   destino** — a tela da coluna ensinou o contrário, onde o "×" sempre oferece
   para onde as tarefas vão. Por isso a confirmação exige **digitar o nome** e
   mostrar a **contagem da subárvore** na tela.
   ⚠️ **O `UPDATE` de restauração em `backend/scripts/` no MESMO commit** — não
   há tela de desfazer, e esse script é a única saída de quem apagar errado.
3. **Subtarefa com pai em outro quadro?** **NÃO PODE EXISTIR** — invariante
   declarada em 18/08. ⚠️ **Ela não valia no código**, e fechá-la é a §Fatia 8,
   que por isso passou a vir antes desta. Quando a 8 estiver entregue, esta
   fatia apaga a subárvore inteira sem tratar caso disperso nenhum.

⚠️ **É A OPERAÇÃO MAIS PERIGOSA DA SPEC INTEIRA, e não é a exclusão de coluna.**
A ADR 0034 decidiu que **apagar quadro apaga as tarefas dentro**. Isso está
escrito em dois lugares no código, e os dois DEPENDEM da decisão:

1. o cabeçalho do `board_repository.py` (§"onde o filtro `deleted_at IS NULL`
   vale"): `coluna_para_status` **não faz `JOIN` em `board` de propósito** —
   custo no caminho mais quente do produto — *"apostando que tarefa viva em
   quadro apagado não existe"*;
2. a **consulta 4** do `invariantes.sql`, cujo comentário diz, com todas as
   letras, que ela é **a única coisa que segura a invariante**, porque
   **nenhuma constraint a sustenta**: é cascata de aplicação, não de banco.

⚠️ **LOGO: "apagar quadro" NÃO É `UPDATE board SET deleted_at = NOW()`.** Se a
cascata para as tarefas não entrar no MESMO commit, a consulta 4 sai de zero na
primeira vez que alguém usar o botão, e o defeito aparece **em outra tela, dias
depois**, quando `coluna_para_status` resolver uma coluna de um quadro que não
existe mais.

⚠️ **A consulta 4 é trivialmente 0 hoje** porque não há caminho de produto que
apague quadro — o próprio arquivo diz isso. **Esta fatia é o que torna a
consulta 4 uma medição de verdade.** Rode-a antes e depois.

### O que sobe

- `DELETE /api/v1/boards/{board_id}` — **não existe** (conferido em 17/08: o
  `boards_router.py` tem `GET ""`, `POST`, `PATCH /{board_id}`,
  `PUT /{board_id}/columns`, e o CRUD de coluna; **não há delete de quadro**).
- `BoardService.apagar_quadro`, com a cascata.
- A confirmação **digitando o nome**, com contagem de **subárvore**.
- ⚠️ **O `UPDATE` de restauração em `backend/scripts/`, no MESMO commit.** Não
  há tela de restaurar, e a pasta já é o lugar disso (`invariantes.sql`,
  `set_member_role.py`, `provision_workspace.py` moram lá).
- ⚠️ **A troca da espera de "quadro pedido e não encontrado" por "este quadro
  não existe mais"** — está anotado no `Board.tsx`. Sem isso, quem estiver com
  o quadro aberto quando outra pessoa o apagar fica em "Carregando…" para
  sempre.

### Guardiões

| sabotagem | esperado |
|---|---|
| `apagar_quadro` marca o `board` e **não** as tarefas | teste que roda a consulta 4 em SQL contra o banco de teste |
| a trava do quadro padrão sai | teste de recusa 422 |
| a confirmação aceita nome errado | teste de componente |
| a contagem da subárvore não conta subtarefa | teste próprio |

⚠️ **A CONTAGEM NA TELA TEM DE BATER COM O QUE O BACKEND APAGA.** É o item 10 da
conferência da 5b, repetido: número na tela que não bate com o banco é pior que
número velho.

---

## Fatia 10 — o seletor de quadro vira dropdown no título — ✅ ENTREGUE (18/08)

> Escopo escrito em 18/08/2026 **antes de código**, conferido pela Camila, e
> entregue no mesmo dia. **Front 791 → 801. Sem backend, sem migration.**
> ⚠️ **Primeira fatia desta spec entregue em BRANCH com PR**
> (`spec-036/escopo-fatias-10-e-11`), e não direto em `main`.

⚠️ **O QUE ENTROU, E ONDE:**

| | arquivo |
|---|---|
| dropdown (escolher + criar) | `components/SeletorDeQuadro.tsx`, **reescrito** |
| renomear + apagar | `components/AcoesDoQuadro.tsx`, **novo** |
| `title: ReactNode` + slot `acoesDoQuadro` | `components/Board.tsx` |
| a ligação, e a linha separada que saiu | `app/quadro/[teamId]/page.tsx` |
| guardiões | `__tests__/SeletorDeQuadro.test.tsx` (16, reescrito) e `__tests__/AcoesDoQuadro.test.tsx` (15, novo) |

⚠️ **OS 38 TESTES DE `lib/__tests__/seletorDeQuadro.test.ts` NÃO FORAM TOCADOS**,
e era a previsão do escopo. `opcoesDoSeletor`, `opcaoSelecionada`,
`nomeConfere`, `quadroPedidoNaUrl` e `nomeDeQuadroValido` são decisão pura e não
sabem como a tela desenha. **A conta do 801:** `791 − 21 + 16 + 15`.

### ⚠️ COLISÃO DE NOME, achada pelo teste e não pela leitura

O gatilho de apagar e o botão de **confirmar** do `ConfirmarExclusaoDeQuadro` se
chamavam os dois **"Apagar quadro"**. O `getByText` quebrou com *"found multiple
elements"* — e o defeito não era do teste: eram **dois botões de mesmo nome na
árvore, com pesos opostos** (um abre diálogo, o outro apaga as tarefas de outras
pessoas). ⚠️ **O conserto é os gatilhos SAÍREM da árvore enquanto o diálogo está
aberto**, e tem teste próprio. Quem "consertar" trazendo-os de volta o derruba.

### A resolução do nome do quadro saiu da página

A página tinha um `?? \`Quadro · ${team.name}\`` que resolvia o nome do quadro
avulso. Saiu: quem sabe o nome do escolhido é o `opcaoSelecionada` dentro do
seletor, e ele já o desenhava. ⚠️ **Manter as duas seria uma segunda definição do
mesmo nome, e elas divergiriam no primeiro rename.**

### Conferência visual — ✅ FEITA EM 18/08

Conferido pela Camila, na tela, e **nada disto tem guardião**: o dropdown
abrindo, escolhendo e fechando ao clicar fora; o título com o chevron ao lado da
contagem; e a barra do modo de edição com as **duas famílias de botão** separadas
(quadro à esquerda, junto do selo *Modo edição*; coluna à direita).

### ⚠️ ELA ENTRA NESTE DEPLOY, E ISSO CONTRARIA A REGRA ESCRITA

A §Definição de pronto diz que **item novo não entra na lista fechada** — vai
para a §"o que falta" e sobe no deploy seguinte. **Esta fatia é exceção
declarada, decidida pela Camila em 18/08**, e o motivo é de tempo real e não de
gosto:

⚠️ **NINGUÉM EM PRODUÇÃO JAMAIS VIU O SELETOR.** Trocá-lo **antes** do deploy
custa zero de reaprendizado; **depois** custa uma pessoa reaprendendo por cada
uma das 26. É a mesma forma de argumento que colocou a fatia 9 na lista — ela
destrava algo que já estava lá, e não abre vontade nova.

⚠️ **E A FATIA 7 PIOROU A LINHA ATUAL.** Cada quadro ganhou "Apagar" ao lado do
"Renomear" que já tinha: a linha passou a ter **1 + 2N + 1 botões** para N
quadros. Com um quadro só em produção isso é invisível hoje — e passa a doer no
primeiro quadro que alguém criar, que é justamente o que este deploy libera.

### ⚠️ O QUE EU ACHEI LENDO O CÓDIGO, E QUE MUDA O ESCOPO

**Conferido em 18/08, arquivo por arquivo:**

1. ⚠️ **O `SeletorDeQuadro` existe em UM lugar só:**
   `app/quadro/[teamId]/page.tsx:153`. **Ele NÃO existe em `/quadro`** — a
   página do Quadro geral chama `<Board title="Quadro geral" />` direto
   (`app/quadro/page.tsx:33`) e não tem seletor nenhum.
2. ⚠️ **A BARRA LATERAL JÁ FAZ A NAVEGAÇÃO DE PRIMEIRO NÍVEL.** O accordion
   "Quadros" do `AppShell.tsx:231-238` lista `/quadro` (Quadro geral) **mais uma
   sub-aba por subtime da lente** (`computeLens`). Ou seja o seletor da página é
   o **segundo** nível: dentro de um subtime, ele escolhe entre a **lente** e os
   **quadros avulsos daquele subtime**.
3. ⚠️ **HOJE SÃO DUAS LINHAS, e o desenho do Figma funde as duas.** A linha do
   seletor (`marginBottom: 14`, na página) e a barra do `Board` com o `<h1>`.
   Fundir é o ganho real da fatia — uma dobra inteira de volta.
4. ⚠️ **O `<h1>` É DO `Board`, E O SELETOR É DA PÁGINA.** O título é
   `title: string` e aparece **duas vezes** no `Board.tsx` (linha 1334, barra do
   modo de edição; linha 1383, barra normal). Para o título virar gatilho do
   dropdown, o `Board` precisa aceitar um **nó** no lugar da string.

### ⚠️ A DECISÃO DE PRODUTO QUE ESTA FATIA NÃO TOMA

**O dropdown convive com o accordion da barra lateral, ou substitui?**

Hoje há **duas** formas de trocar de contexto (barra lateral e seletor da
página). Depois desta fatia haveria duas ainda, mas com a segunda mais visível
— e as duas mostram conjuntos **diferentes**: a barra mostra Quadro geral +
subtimes; o dropdown mostra lente + avulsos de UM subtime.

⚠️ **NÃO ESCREVA CÓDIGO ANTES DE RESPONDER ISTO.** É o tipo de pergunta que,
respondida depois, joga a fatia fora: se o dropdown tiver de listar também os
subtimes, ele deixa de ser `opcoesDoSeletor` e passa a precisar do `computeLens`
— outra fatia, outro tamanho.

### O que sobe

- **O título vira gatilho.** `Board` passa a aceitar o título como nó
  (`ReactNode`), e as **4 chamadas** continuam funcionando com string:
  `/projetos/[id]:159`, `/quadro:33`, `/quadro/[teamId]:170` e `:185`.
- **`+ Novo quadro` vira item DENTRO do dropdown** (decisão da Camila, 18/08).
- ⚠️ **`Renomear` e `Apagar` SAEM da linha e vão para o MODO DE EDIÇÃO**
  (decisão da Camila, 18/08). São **três casos**, e a regra "ausente, e não
  desabilitada" (ADR 0034 item 2) vale para os três:

| | modo de edição | Renomear | Apagar |
|---|---|---|---|
| **Lente** | não tem (`Board.tsx:888`: `quadroEditavel` é `null` na lente e no projeto) | — | — |
| **Quadro geral** (`is_default`) | tem, desde a 6a-bis | ⚠️ **no BACKEND sim, na TELA não existe** — ver abaixo | ❌ **AUSENTE** — `quadro_padrao_nao_apagavel`, e `opcoesDoSeletor` já filtra `!q.is_default` |
| **Avulso** | tem | ✅ | ✅ |

⚠️ **A LINHA DO QUADRO GERAL ESTAVA IMPRECISA NA PRIMEIRA VERSÃO DESTE ESCOPO, e
a correção é de 18/08.** Ela dizia "Renomear ✅ sim", citando o
`board_service.py:385` ("O QUADRO GERAL PODE SER RENOMEADO", só por
`board.manage.root`). **Isso é verdade no backend e falso na tela:**

- o Quadro geral vive em **`/quadro`**, e essa página chama
  `<Board title="Quadro geral" />` direto (`app/quadro/page.tsx:33`): **não tem
  seletor, e agora não tem `AcoesDoQuadro`**;
- e ela nunca teve — `opcoesDoSeletor` filtra `!q.is_default`, então o Quadro
  geral **nunca apareceu** no seletor, nem na versão de abas.

⚠️ **LOGO: renomear o Quadro geral continua sem caminho de tela, exatamente
como antes desta fatia. NÃO é regressão** — é uma capacidade de backend sem
leitor, a mesma família do `corEhHex` e do `notify_deadline`. **Dar tela a ela é
a "saída 3" da §decisão de produto** (o dropdown também aparecer em `/quadro`),
adiada pela Camila em 18/08 junto com a decisão de os dois níveis conviverem.

### ⚠️ A "ARMADILHA DE SEQUÊNCIA" NÃO EXISTE — retratação de 18/08

**Este escopo nasceu afirmando que apagar o quadro de dentro do modo de edição
aninharia duas confirmações**, e que o `"Você tem alterações que ainda não foram
aplicadas. Descartar?"` do `fecharEdicao` apareceria depois, sobre um quadro
morto. **Fui ler o código e é falso.**

⚠️ **`Board.tsx:403` JÁ TEM UM `useEffect` EM `[boardId]`** que zera `rascunho`,
`revisando` e `criandoColuna`. O comentário dele diz, com todas as letras, que
**descarta em silêncio e isso é escolha**: trocar de quadro é navegação, e pedir
confirmação depois que o `boardId` já mudou avisaria tarde. Apagar chama
`onSelecionar(null)` (`SeletorDeQuadro`, `confirmarExclusao`), o `boardId` muda,
e o rascunho morre ali.

⚠️ **E O `Board` NEM SOBREVIVE À TROCA.** A página desenha
`quadroSelecionado ? <Board boardId=…/> : <Board subteamId=…/>` em dois ramos de
um ternário — sair de um quadro avulso para a lente **desmonta** um e monta o
outro. O rascunho não tem como atravessar.

⚠️ **FICA REGISTRADO COMO ERRO, e não apagado.** Foi escrito a partir da
intenção ("dois diálogos, logo aninham") e não do arquivo, que é o padrão de
erro que o handoff desta spec manda vigiar. **Nenhum conserto é necessário nesta
fatia por esta razão.**

### O custo, medido

⚠️ **Os 21 testes de `components/__tests__/SeletorDeQuadro.test.tsx` são
reescritos. Os 38 de `lib/__tests__/seletorDeQuadro.test.ts` ficam INTACTOS** —
`opcoesDoSeletor`, `podeRenomear`, `podeApagar`, `nomeConfere` e
`quadroPedidoNaUrl` são decisão pura e não sabem como a tela desenha. É a
fronteira da Spec 027 pagando o que prometia.

### Guardiões

| sabotagem | esperado |
|---|---|
| o dropdown desenha "Apagar" no Quadro geral | teste de componente: ausente, e não desabilitado |
| o dropdown desenha "Renomear" na lente | teste de componente: ausente |
| o Quadro geral perde o "Renomear" | teste de componente: presente para `board.manage.root` |
| o dropdown não fecha ao clicar fora | teste de componente |
| `Board` deixa de aceitar título string | as 4 chamadas existentes, sem mudança |

### ⚠️ QUAL PADRÃO DE "FECHAR AO CLICAR FORA" USAR — corrigido em 18/08

Este escopo dizia "use o `useCliqueFora`, já usado pelo painel de filtros".
**As duas metades estavam erradas:**

1. ⚠️ **O painel de filtros NÃO usa o `useCliqueFora`.** Ele tem um
   `useEffect` próprio com `document.addEventListener("mousedown")` —
   `Board.tsx:252-261`, e o comentário diz "mesmo padrão do picker de
   responsável".
2. ⚠️ **E o `useFecharAoClicarFora` resolve outro problema.** Ele existe para
   MODAL: pareia `mousedown` com `mouseup` porque selecionar texto dentro do
   card e soltar fora fechava o modal e apagava formulário (defeito de
   31/07, com captura). Dropdown não tem texto para selecionar dentro.

⚠️ **O precedente certo é o do painel de filtros** (`Board.tsx:252`), que é
irmão visual do que esta fatia constrói. **Não copie o de modal.**

---

## Fatia 11 — o aviso na queda para a lente — ⬜ ADIADA, foi para a §"o que falta" (18/08)

> Escrita em 18/08/2026 junto com a fatia 10, e **tirada do caminho do deploy no
> mesmo dia**, pela Camila, depois de o problema ser lido no código em vez de
> descrito de memória.

### ⚠️ POR QUE ELA SAIU: SÃO DOIS CAMINHOS, E SÓ UM É MUDO

Este escopo nasceu dizendo "a queda é muda", no singular. **São dois caminhos, e
o mais importante dos dois já avisa:**

1. ⚠️ **A ABA QUE JÁ ESTAVA ABERTA — JÁ AVISA, e bem.** O `Board` recebe o
   `boardId`, busca a lista, não acha, **tenta de novo uma vez** (para não
   confundir quadro apagado com a corrida de criação) e desenha a caixa
   vermelha de `Board.tsx:856`: *"Este quadro não existe mais. Ele pode ter sido
   apagado por outra pessoa enquanto você o tinha aberto."* **Este é o caso real
   de "alguém apagou enquanto eu olhava".**
2. **F5, OU ABRIR O LINK DO ZERO — este é o mudo.** Aqui a ordem é outra: o
   `quadroPedidoNaUrl` roda ANTES, na página, devolve `null`, e a página troca
   `<Board boardId=…/>` por `<Board subteamId=…/>`. **O `Board` nunca fica
   sabendo que um quadro foi pedido**, então a caixa vermelha não tem chance.

### ⚠️ E A FATIA 10 JÁ MELHOROU O CAMINHO 2, SEM QUERER

Antes o título era o texto `Quadro · {time}`. Com o dropdown, ele passou a
mostrar **"Lente do time"** e a descrição *"espelho do quadro geral"*. **A tela
já diz onde a pessoa ESTÁ** — falta dizer que o que ela pediu acabou. Isso
rebaixa a fatia de "buraco" para "ausência".

### ⚠️ E O CASO NÃO EXISTE EM PRODUÇÃO ANTES DESTE DEPLOY

Há **um quadro só**, e ele é o PADRÃO, que `quadro_padrao_nao_apagavel` recusa
apagar. Para o caminho 2 acontecer alguém precisa **criar** um quadro avulso,
**compartilhar o link** e **apagar** — as três coisas só passam a ser possíveis
depois desta janela. **Segurar o deploy por um caso que o deploy é quem cria
inverte a ordem.**

⚠️ **O TEXTO DE ESCOPO ABAIXO CONTINUA VALENDO** para quando ela vier — é a
§"o que falta", item 2.

---

### Escopo (mantido para quando ela vier)

⚠️ **`quadroPedidoNaUrl` DERRUBA `?quadro=` DESCONHECIDO E CAI NA LENTE, EM
SILÊNCIO** — `lib/seletorDeQuadro.ts`, e o docstring diz que é **de propósito**:
link velho, id digitado na mão, ou quadro apagado por outra pessoa. "Erro na
cara de quem só abriu a tela seria pior que o lugar padrão dela."

⚠️ **ERA CERTO ATÉ A FATIA 7, E A FATIA 7 CRIOU UM CASO NOVO.** Antes dela,
quadro não desaparecia — só o link podia estar velho. Agora **uma pessoa apaga o
quadro que outra tem aberto**, e a tela da segunda troca de lugar sozinha, sem
dizer nada.

⚠️ **E O `plan.md` JÁ REGISTRA QUE "Este quadro não existe mais" NUNCA APARECE
DEPOIS DE UM F5** — só na aba que já estava aberta, porque o `quadroPedidoNaUrl`
resolve antes. São **dois** caminhos e um só tem mensagem.

### O que sobe

- Um aviso na queda, **dispensável em um clique**, e **não** um erro de página.
- ⚠️ **Só quando o `?quadro=` existia e sumiu** — não quando ele nunca foi
  válido. `quadroPedidoNaUrl` devolve `null` nos dois casos hoje; separá-los
  pede um terceiro estado, e é o tamanho real desta fatia.

### Guardiões

| sabotagem | esperado |
|---|---|
| a queda volta a ser muda | teste de `lib`: o terceiro estado |
| o aviso aparece com `?quadro=` nunca válido | teste de `lib`: não aparece |
| `quadros === null` (lista não chegou) vira queda | teste de `lib`: já existe, não pode cair |

---

## Fatia 8 — texto de 17/08 (histórico, superseded)

> Mantido porque registra o escopo antes de a invariante de pai e filha
> aparecer. **A vigente é a seção acima.**
> ⚠️ **É a "saída 3" do §Adendo — mover tarefa entre quadros**, que listou três
> opções em 10/08 e não escolheu. **A escolha é esta seção**; o adendo virou
> histórico e guarda o custo medido das outras duas. Se você reabrir a
> discussão, reabra lá — não escreva uma terceira versão.

⚠️ **NÃO É "ACRESCENTAR `board_id` AO `/move`". É FECHAR UMA DIVERGÊNCIA QUE JÁ
EXISTE NO CÓDIGO E QUE ESTE DEPLOY TORNA ALCANÇÁVEL.** Medido em 17/08:

- `POST /tasks` guarda o `board_id` com `_assert_board_in_reach`, e o docstring
  dela diz por quê: *"quadro decide QUEM VÊ (ADR 0035 D3)"*.
- `PATCH /tasks/{id}` aceita `team_id`, chama `_assert_team_in_reach`, escreve
  `task.team_id = command.team_id` — e **não toca em `board_id`**
  (`task_service.py`, `async def update`).
- `POST /tasks/{id}/move` move **pai e projeto**, e só (`TaskMoveRequest`).
  Não conhece quadro.

⚠️ **RESULTADO: dá para deixar `team_id` e `board_id` apontando para times
diferentes.** A tarefa continua desenhada no quadro do time ANTIGO enquanto
pertence ao novo. Hoje é inofensivo porque **nenhum quadro não-padrão jamais
existiu em produção** — todo `board_id` é o Quadro geral da raiz. **Deixa de
ser inofensivo no dia do deploy.**

⚠️ **E NÃO É ALCANÇÁVEL PELA TELA:** `TaskUpdateInput` (`lib/api.ts`) **não
expõe `team_id`** — conferido em 17/08. O caminho é n8n, Swagger e chamada
direta, que é exatamente o modelo de ameaça que `_assert_team_in_reach` e
`_assert_board_in_reach` foram escritos para cobrir. **Não trate como teórico:
este workspace usa n8n contra esta API.**

### O que sobe

- `board_id` (e a coluna de destino) no `POST /tasks/{id}/move`, ou rota
  própria — **decidir, e escrever a decisão aqui.**
- ⚠️ **Só dentro do MESMO `team_id`** (regra de 13/08).
- ⚠️ **A regra que impede a divergência**, seja qual for a forma: `team_id` e
  `board_id` de uma tarefa não podem sair de times diferentes por caminho
  nenhum. A ADR 0042 barateou a parte da coluna (o mapa existe).

### Guardiões

| sabotagem | esperado |
|---|---|
| `PATCH` com `team_id` de outro time e `board_id` intacto | **teste novo** — é o furo descrito acima, e hoje NADA o pega |
| move para quadro de outro `team_id` | teste de recusa 422 |
| move sem recalcular a coluna | teste da ADR 0042 |

⚠️ **ESCREVA O TESTE DO FURO ANTES DA FUNCIONALIDADE.** Ele falha hoje, no
`main` verde de 807. É a evidência de que a fatia é necessária, e é a única
coisa nesta fatia que não é opinião.

---

## ⚠️ O portão do vazamento de quadro

> Escrito em 10/08 dentro da fatia 5, emendado em 11/08. **Promovido a seção
> própria na consolidação de 13/08** — ele estava preso dentro de um bloco
> marcado "não execute", e é o item mais vivo do arquivo.

A fatia 3 passou a devolver `board_id` na resposta de tarefa. Ele só é seguro
de devolver porque `board.team_id` é **sempre a raiz** hoje, e a raiz todo
mundo alcança. **Esta fatia é a que quebra essa premissa por desenho.**

No dia em que uma tarefa nascer no quadro do próprio subtime, três coisas
ficam vermelhas ou deixam de valer, e **as três são o alarme, não o defeito**:

1. `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` falha
   (`tests/integration/test_task_board_no_contrato_db.py`). **Não apague este
   teste para a fatia passar** — reescreva-o junto com a decisão nova;
2. `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` passa
   a ser o teste que importa: ele afirma que todo `board_id` devolvido está no
   `GET /boards` de quem perguntou. Se ele ficar vermelho, **há vazamento**;
3. a **consulta 7** do `invariantes.sql` deixa de ser `0`, e aí ela sai de
   "ausência de caso" e vira medição de verdade.

⚠️ **Não existe trava de schema, constraint ou gate de rota protegendo isso.**
O `board_id` sai na resposta sem passar por lente nenhuma — não precisava
passar. A decisão de qual quadro uma tarefa nova recebe é de
`BoardRepository.default_board_and_column_for_status`, e é lá que a pergunta
"quem alcança a tarefa alcança o quadro?" precisa ser respondida de novo, em
vez de continuar valendo por acidente.

**Sabotagem:** reverter a herança de `team_id` (voltar ao `default_team_id`)
→ cai o teste de ADMIN criando tarefa no quadro interno.

### ⚠️ Emenda de 11/08 — o item 1 acima está ERRADO

⚠️ **`test_tarefa_de_subtime_nasce_no_quadro_da_raiz` continua CERTO e continua
VERDE.** O texto de 10/08 (item 1) manda reescrevê-lo quando a fatia 5 subir;
**não reescreva.** Tarefa interna de subtime nasce com `board_id` do Quadro
geral e `team_id` do subtime, e é exatamente isso que a faz aparecer na lente.
Se ele ficar vermelho, alguém mexeu em
`default_board_and_column_for_status` — e isso é **defeito**, não progresso
(§Fatia 5, §1b).

Os itens 2 e 3 continuam valendo sem emenda:
`test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` é o teste
que importa, e a consulta 7 do `invariantes.sql` deixa de ser `0` por ausência
de caso.

Os três furos do "só o subtime vê" continuam abertos **por desenho** (ADR 0035
§Consequências): criador sempre vê; relações furam a lente; designação alcança
quem foi designado. **A resposta continua sendo não** — fechar qualquer um
exige permissão por quadro, que colide com a lente inteira.

### ✅ A PERGUNTA FOI RESPONDIDA EM 18/08, COM O CASO EXISTINDO

⚠️ **A consulta 7 saiu do zero em 18/08 e deu `1`**, no dia do deploy — a tarefa
"Camilão", dentro do primeiro quadro avulso de subtime que já existiu em
produção ("Quadro teste do GOATzinho", time CRM e Automação). **A seção acima
manda parar e reperguntar "quem alcança a tarefa alcança o quadro?", e esta é a
resposta, para não morrer em conversa.**

**Não há vazamento, e a razão NÃO é o front.** `CollaborationService` chama
`_assert_target_reaches_task` em **todos** os caminhos de designar (`assign`,
`assign_many_or_fail` e o caminho de terceiro), e ele usa a **lente do ALVO**
(`user_can_view_task`, `task_guards.py`). ⚠️ **É trava de servidor:** designar
alguém que não alcança a tarefa devolve 422, não importa o que a tela ofereça.
A Spec 034 existe justamente para o seletor não oferecer o que o salvar recusa.

Logo, quem é designado **já alcançava a tarefa antes**, e o alcance de tarefa e
o de quadro saem da mesma lente (`visible_team_ids`: próprio time + raiz, ADR
0035 D3). Ninguém ganha acesso a um `board_id` que não alcança.

⚠️ **E o furo "criador sempre vê" também não abre caminho aqui**, porque criar
tarefa em quadro avulso exige **alcance E propriedade** — `_assert_board_in_reach`
mais `_assert_time_do_quadro`. Alguém de fora do time do quadro não consegue pôr
tarefa nele para depois enxergá-la como criador.

⚠️ **O QUE CONTINUA SEM PROVA: a consulta 7 mede DADO, e o teste
`test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` mede
CÓDIGO.** Os dois estão verdes. O que nenhum dos dois cobre é escrita direta no
banco — e isso é a mesma limitação de `_assert_nomes_do_lote` e da invariante
"tarefa viva em quadro apagado". **Aplicação-com-consulta-vigiando, e não trava
de schema.** Se a consulta 7 crescer sem quadro avulso novo, é ali que se olha.

---

## Adendo — mover tarefa entre quadros (as três saídas de 10/08)

> Escrito em 10/08, promovido a seção própria em 13/08.
> ⚠️ **SUPERSEDED EM 17/08: a decisão está na §Fatia 8**, que escolheu a saída
> 3 e a pôs na §Definição de pronto. Esta seção fica porque as três saídas e o
> custo medido de cada uma continuam sendo o registro de POR QUE a 3 ganhou —
> **não a execute, e não escreva a fatia aqui.**

Pedido reconhecido, adiado por escolha: há coisas antes. Registrado aqui para
não ser redescoberto como surpresa no dia em que alguém abrir o quadro novo e
perguntar "cadê minhas tarefas?". Três saídas, com o custo medido em 10/08:

1. **Só tarefas novas entram** — custo zero. É o estado de hoje e o que foi
   decidido. O quadro leva semanas para ficar útil.
2. **Migração única, rodada na VPS** — ~meio dia, sem tela. Move as tarefas de
   um time para o quadro dele de uma vez. ⚠️ Exige `pg_dump` antes: na
   prática é irreversível.
3. **Mover pela tela** — entrega própria, do tamanho desta fatia inteira
   (mexe em coluna, permissão e histórico ao mesmo tempo).

⚠️ **Nenhuma das três está construída** (conferido em 17/08: `POST
/tasks/{id}/move` move pai e projeto, e não conhece quadro). O argumento de que
"não fica mais barato por esperar" é o que derrubou a opção 1 em 17/08: adiar
não reduz o custo, e **cobra a diferença em tarefa recriada à mão** — apagar e
recriar perde comentário, histórico e vínculo.

---


---

## ⚠️ A ADR 0042 vive em TRÊS lugares, e isso é deliberado

**Regra:** status sem coluna no quadro cai na coluna `is_default_target` da sua
**semântica**, e **o status é reescrito pela coluna que recebeu** (D2). Ponte
primeiro, semântica depois, `ValidationError` no terceiro degrau.

1. `BoardRepository.column_for_status_in_board` — Python + SQL, uma query,
   `ORDER BY ... DESC NULLS LAST`;
2. a subconsulta de `TaskRepository.complete_descendants` — SQL puro. ⚠️ **A
   cascata é um `UPDATE` em massa por `ltree` e não pode chamar o repositório
   uma vez por linha.** Era o furo da 5b-2;
3. `lib/coluna.ts::colunaEquivalente` — front, para as telas que atravessam
   quadros com um conjunto só de colunas.

⚠️ **Se alguém "unificar", quebra a cascata.** O que mantém as três honestas
são `test_coluna_para_status_db.py`,
`test_cascata_em_quadro_de_quatro_colunas_db.py` e `colunaEquivalente.test.ts`.

| sabotagem | derruba |
|---|---|
| Tirar só o `DESC NULLS LAST` da cascata | **1** — `test_a_cascata_nao_come_a_ponte_quando_as_duas_existem` |

---


---

## ⚠️ Definição de pronto para o deploy (FECHADA em 17/08, emendada em 18/08)

⚠️ **ESTA LISTA ESTÁ FECHADA. Item novo não entra nela — vai para a §"o que
falta", e sobe no deploy seguinte.**

Ela existe porque o deploy já foi adiado **quatro vezes, cada uma por um motivo
diferente e razoável**: as 29 notificações (três sessões, e caiu quando foi
medido), "espera a 5b fechar", "espera a fatia 6", e "espera a spec ficar
redondinha". Somados, produziram duas fatias inteiras em `main` e zero em
produção.

⚠️ **"A SPEC INTEIRA" NÃO SERVE COMO CRITÉRIO, e há prova documentada:** o item
"trocar qual coluna é o alvo de uma semântica" **subiu de urgência por causa da
fatia 6** — o selo "padrão" criou a demanda. Construir gera itens novos. Portão
que espera a lista acabar tem incentivo estrutural para nunca fechar.

### O critério

**Nada que a pessoa fizer na tela pode produzir um estado que ela não consiga
desfazer.** Não é "a spec acabou"; é "não entregamos porta de mão única".

Por esse critério, e só por ele:

| | entra | por quê |
|---|---|---|
| **Conferência visual da fatia 6** (18 itens) | ✅ | os itens 24 e 25 não têm guardião nenhum; se falharem, falham em produção |
| **Fatia 7 — apagar quadro** | ✅ | sem ela, "+ Novo quadro" é um botão sem saída. Quadro criado por engano é permanente, e o conserto vira operação de banco feita por você |
| **Fatia 9 — nome único de quadro e coluna** | ✅ **ENTREGUE 18/08** | pré-requisito da 7: sem ela, confirmar a exclusão digitando o nome não desambigua. ⚠️ **Foi o único item acrescentado à lista fechada — porque destrava um item que já estava nela, e não porque apareceu vontade nova** |
| **Fatia 8 — mover tarefa entre quadros** | ✅ | sem ela, tarefa no quadro errado só se conserta **apagando e recriando** — perda de dado por engano de seleção num modal. E fecha a divergência `team_id`/`board_id`, que este deploy torna alcançável |
| quadro extra da raiz | ❌ | adição pura; ninguém sente falta do que nunca viu |
| trocar coluna alvo de semântica | ❌ | dói, mas é **ausência**, não porta de mão única. Vai virar pedido — responda quando vier |
| seletor de cor | ❌ | cosmético |
| `notify_deadline` | ❌ | já decidido em 13/08 |

⚠️ **SE A 7 E A 8 PASSAREM DE DUAS SEMANAS, A CONVERSA MUDA — mas muda contra
um número, e não contra uma sensação.** A fatia 6 foi estimada em 3–4 dias e
consumiu mais de uma sessão; conte com o mesmo desvio.

### ⚠️ O que sobe junto, e não está em lista nenhuma

A **6a-bis tornou o Quadro geral editável**, e isso deploya no mesmo bloco. A
partir daí um ADMIN acrescenta, renomeia e reordena coluna no quadro que as
**26 pessoas usam todo dia** — e a ADR 0041 passa a valer para ele, que até
13/08 era o único quadro previsível do sistema. **O raio de explosão disso é
maior que o do quadro avulso, que ninguém tem ainda.**

⚠️ **Por isso o item 38 da conferência é o mais importante dos 18** — e vale
medir `board.manage.root` **na base de produção**, não no código, antes de
subir.

---

## Ordem de deploy (vigente — revisada em 17/08)

⚠️ **DECISÃO DE 13/08: NADA SOBE ANTES DA FATIA 6.** Lançar o quadro avulso
sem reordenar coluna entrega uma funcionalidade cuja ordem de colunas fica
congelada para sempre — e o seletor de quadro aparece para **todo mundo** que
abre a página de um time, não só para quem administra. Seriam 26 pessoas vendo
"Lente do time · + Novo quadro" com a resposta sendo "não use ainda".

⚠️ **A ORDEM DE 11/08 (abaixo) PERDEU O SENTIDO, e isso é escolha.** Ela
existia para dar raio de explosão pequeno por passo. O build sobe backend e
front na **mesma imagem**: não há como subir a 5b-1 sem subir a 5b-7 junto.
Subindo em bloco, vira uma janela só. **Sabendo disso**, a escolha é subir em
bloco depois da fatia 6 — dois deploys no total, não oito.

1. ✅ **A §Definição de pronto satisfeita por inteiro** — fatia 6 conferida
   (17/08) **e RECONFERIDA** (18/08), e as fatias **9 → 8 → 7** entregues e
   conferidas. **Fechado em 18/08.**
   ⚠️ **E AS FATIAS 10 E 11 ENTRARAM DEPOIS DISSO, por decisão da Camila em
   18/08 — passo 1-bis, e não item novo na lista fechada.** O motivo está na
   §Fatia 10 e é de tempo real: ninguém em produção jamais viu o seletor, então
   trocá-lo antes custa zero de reaprendizado e depois custa 26 pessoas
   reaprendendo. ⚠️ **A ordem é 10 → 11 → deploy**, e **nenhuma das duas tem
   migration** — a `0013` continua sendo a única desta spec a subir.
   ⚠️ **A FATIA 10 FECHOU EM 18/08** (front 791 → 801, conferida na tela), e a
   **11 SAIU do caminho do deploy no mesmo dia** — ver a §Fatia 11: o caminho
   que importa (a aba já aberta) **já avisa** em `Board.tsx:856`, o dropdown da
   10 melhorou o outro sem querer, e o caso só passa a existir depois desta
   janela. **Logo a ordem é 10 → deploy**, e não 10 → 11 → deploy.
   ⚠️ **E O DEPLOY SOBE UMA COISA QUE NÃO ESTAVA NA LISTA DE 17/08: o
   dropdown.** Ele substitui a linha de abas que ninguém em produção viu, então
   não há o que reaprender — mas o item 38 da conferência (medir
   `board.manage.root` na base de produção) passa a valer **também** para quem
   vai ver "Renomear quadro" e "Apagar quadro" dentro do modo de edição.
2. **Rodar o `invariantes.sql` ANTES**, e anotar a consulta 5. Série:
   696 (06/08) → 802 → 832 (10/08) → **1049 (18/08)**.
   ⚠️ **A CONSULTA 5 CONTA TUDO, INCLUSIVE APAGADAS E ARQUIVADAS.** A leitura
   útil, medida em 18/08, é outra: **799 é o que o quadro carrega**
   (`deleted_at IS NULL AND is_archived = false`), contra um teto de 1000 no
   front (`TASK_FETCH_CEILING`). Das 925 vivas, **565 estão em Concluído** e só
   126 arquivadas — a alavanca é o job de arquivamento, não o teto.
   ⚠️ **As consultas 8, 9 e 10 são novas e deram ZERO em 18/08.** A 8 é o que
   diz se a `0013` passa.
3. ⚠️ **Deploy em bloco, E ELE AGORA TEM MIGRATION.** Sobem as fatias 5b-1 a
   5b-7, a 6, a 9, a 8 e a 7 de uma vez. **A `0013` (nome único de quadro) NÃO
   está em produção** — ela é a primeira migration desta spec a subir junto com
   código, e aborta com a lista se houver nome de quadro repetido. Rode a
   consulta 8 antes.
   ⚠️ **E o `restaurar_quadro.sql` sobe junto**, porque é a única forma de
   desfazer um "apagar quadro" — conferido na tela em 18/08 (item 49).
4. **Rodar o `invariantes.sql` DEPOIS.** A consulta 7 sai de "ausência de caso"
   e a 5 passa a listar mais de um quadro.
5. **Um dia de uso só seu, antes de anunciar ao time.** É a janela em que o
   rollback ainda é `up -d` com a imagem anterior.
6. **Anunciar.**

⚠️ **A JANELA DE ROLLBACK BARATO FECHA NO PRIMEIRO QUADRO CRIADO.** Não há
migration nova, então voltar a imagem não perde dado — mas quadros criados
continuam no banco e o código antigo não os desenha, e tarefas com `board_id`
de quadro avulso **somem da vista** (continuam em `/minhas-tarefas` para quem é
responsável). Para quem olha, é indistinguível de "perdemos tarefas". Depois do
anúncio, voltar atrás deixa de ser operação de imagem e vira operação de dados.

⚠️ **CI verde antes de tocar na VPS** — e "verde" quer dizer que o job
`backend` chegou a executar o passo `pytest`. Um X vindo do `Set up job` é o
GitHub caindo, não o seu código, e na lista de runs os dois são
indistinguíveis.

⚠️ **Migration já em PRODUÇÃO deixa de ser editável.** Vale da `0008` à `0012`.

---

## Conferência visual (obrigatória)

Nenhum portão cobre nada desta lista. A conferência manual achou **cinco**
defeitos na 4c e **dois** na 5b-6 que `pytest`, `tsc`, `vitest` e `next build`
não acharam.

### Regressão — o teste é que NADA muda

1. O Quadro geral continua com as oito colunas, nomes e ordem iguais, e
   **idêntico ao print de 11/08** (176 tarefas).
2. Arrastar tarefa entre colunas continua funcionando e persiste.
3. Concluir um pai com subtarefas continua concluindo a checklist inteira.
4. `/minhas-tarefas` e `/arquivadas` continuam listando o mesmo.

### Fatia 5b — ✅ CONFERIDA EM 13/08

5. Quadro avulso nasce com as 4 colunas, nomes e cores certos, na ordem certa.
6. Criar tarefa dentro dele → **o modal diz em qual quadro ela vai nascer**, e
   ela nasce **naquele quadro** e **no time do quadro**.
7. Arrastar entre as colunas → status muda, e **o caminho de ERRO** (modo
   offline do devtools) devolve o card ao lugar.
8. `/boards` offline com um quadro aberto → **erro com botão "Tentar de novo"**,
   e não "Carregando" eterno.
9. Acrescentar uma 5ª coluna sem ponte → arrastar para ela → conferir o status
   derivado pela semântica, e a tag em `/minhas-tarefas`.
10. Apagar coluna com tarefa dentro → o aviso mostra o número certo, o seletor
    oferece as outras, e as tarefas vão para **a escolhida**. O número na tela
    bate com o banco.
11. Repetir escolhendo *Concluído* → **o aviso muda de texto inteiro**.
12. ⚠️ **Criar tarefa, apagar a tarefa, e então apagar a coluna dela** → o
    seletor de destino **aparece** e o texto diz que a coluna guarda tarefas
    apagadas. Era beco sem saída até 13/08.
13. ⚠️ ~~Erro em vermelho: nome de coluna repetido, e nome de quadro
    repetido.~~ **ESTE ITEM PEDIA O QUE NUNCA EXISTIU, e foi marcado ✅ em
    13/08 por engano.** Conferido em 17/08: não há unique em `board.name` nem
    em `board_column.name`, e não há validação em `board_service`. A tela de
    17/08 mostrava **três** quadros "Quadro CRM Teste" no mesmo subtime e
    **duas** colunas "Em Andamento" no mesmo quadro. Vira a §Fatia 9; volta
    para cá quando ela existir.
14. Apagar *Cancelado* e *Em Andamento* → passa, e sobra um quadro de duas
    colunas funcional.
15. Tentar apagar *Concluído* (última `DONE`) → **recusa com mensagem que
    explica**.
16. Num quadro sem *Cancelado*, a tela **não oferece cancelar**.
17. A mesma tarefa em `/minhas-tarefas`, `/arquivadas` e no quadro → **os três
    lugares concordam**. ⚠️ Dois números discordando é pior que um número velho.
18. A tarefa de quadro avulso aparece na **LISTA** de `/minhas-tarefas`, e não
    só no kanban — e **com o alerta de prazo**.
19. Abrir a lente de um subtime → compartilhadas e internas continuam lá, e
    **nada do quadro avulso aparece**.
20. `?quadro=` na URL: F5 mantém o quadro; Voltar volta para a lente; link
    aberto noutra aba abre no quadro; id inventado cai na lente sem erro.

### Regras de produto que valem em qualquer fatia

- ⚠️ **O quadro de LENTE não mostra afordância de editar nem de apagar** (ADR
  0034 item 2) — ausente, não desabilitada. *Lixeira que não funciona é lixeira
  em que alguém clica.*
- Os dois objetos chamados "quadro" têm **nomes distinguíveis** no seletor.
- O aviso de apagar quadro **diz o número de tarefas** (quando a fatia da
  lixeira existir).

### Fatia 6 — ⬜ A CONFERIR (é o portão do deploy)

⚠️ **ESTA LISTA SUBSTITUI A DE 13/08, que tinha 8 itens e foi escrita antes de a
tela existir.** São 18, e cobrem o que a 6c realmente construiu.

21. O lápis **não aparece** para operador.
22. Ligar o modo: a tela diz "Modo edição" e a barra **troca** de conteúdo —
    somem busca/filtro/"+ Nova tarefa", entram "Adicionar coluna" /
    "Concluir edição" / "Sair".
23. **Os cards param de arrastar** — é a premissa da fatia. Em jsdom só o
    `aria-disabled` do `useDraggable` é observável; o comportamento, não.
24. ⚠️ **Arrastar um cabeçalho reordena** — e a ordem **não persiste** até
    concluir. F5 antes de concluir descarta.
25. ⚠️ **Arrastar uma coluna para fora da área visível** → rolagem automática.
26. Os botões `‹ ›` no cabeçalho movem a coluna, e **travam na ponta**.
    ⚠️ **A versão anterior deste item dizia "as setas ← → só pelo teclado", e
    isso NUNCA existiu** — foi reportado como defeito em 18/08, e o defeito era
    o item. São botões de clicar, alcançáveis por `Tab` + `Enter`. Não há
    atalho ← →, e não vai haver: não existe `KeyboardSensor` no produto.
27. Clicar no nome renomeia; `Esc` desfaz **sem** fechar o modo.
28. O "×" risca a coluna e oferece desfazer.
29. Em `Backlog` (único alvo `OPEN`) **e em `Concluído`** (único alvo `DONE`) o
    "×" **não existe**, e o motivo aparece. ⚠️ **A versão anterior deste item
    citava só o `Backlog` e foi reportada como defeito em 17/08 — o defeito era
    o item.** A regra é sobre o último ALVO de uma semântica obrigatória, e
    vale para as duas pontas; o item 15 da 5b já dizia isso, e os dois não
    estavam amarrados.
30. O selo "padrão" aparece **só** em quem é alvo — e não numa segunda coluna
    do mesmo tipo.
31. "Adicionar coluna": nome + tipo, **sem cor** (cor é fatia própria).
32. Sair com pendências **avisa**.
33. Concluir com exclusão abre a revisão, com contagem e destino.
34. ⚠️ **A coluna criada aparece como destino, marcada "(nova)"** — é o gesto
    que justifica o lote inteiro. Se este falhar, o modelo de lote não se paga.
35. Destino terminal **muda o texto inteiro** do aviso.
36. Criar tarefa numa coluna e, noutra aba, concluir uma edição que a apaga →
    **aviso de divergência** (`mensagemDeDivergencia`, reposta na dívida da 6c).
37. ⚠️ ~~Duas abas reordenando → a segunda recusa com mensagem.~~ **ESTE ITEM
    PEDE O QUE O DESENHO NÃO SUPORTA, e foi medido em 17/08: a segunda aba
    APLICA, em silêncio.** O guardião é a conferência de conjunto de
    `reordenar_colunas`, e ela compara **quais** colunas existem, não em que
    ordem: duas abas reordenando o mesmo conjunto produzem o mesmo `set` e o
    mesmo `len`. **Última escrita vence.**

    ⚠️ **O QUE O GUARDIÃO PEGA DE VERDADE** é o conjunto MUDAR entre a leitura
    e o envio — outra pessoa criou ou apagou uma coluna. **Esse caso continua
    valendo e vale conferir**: numa aba, apague uma coluna e conclua; na outra,
    conclua uma edição montada antes → recusa com mensagem.

    ⚠️ **PEGAR A ORDEM EXIGIRIA VERSÃO NO QUADRO** (etag/`updated_at` conferido
    no `PUT`), ou seja migration e uma fatia própria. **Não entra no portão do
    deploy**: reordenar não muda comportamento nenhum (ADR 0030), então a
    perda de uma última escrita é visual e a pessoa desfaz arrastando de volta.
    Se um dia a ordem passar a decidir alguma coisa, isto sobe de urgência
    junto.
38. No Quadro geral (6a-bis): editar funciona para ADMIN, e apagar "Planejado"
    **recusa** (`_assert_ponte_sobrevive`).

### ⚠️ A RECONFERÊNCIA de 18/08 — o que as correções de 17/08 mexeram

Não é a lista inteira de novo. **Só o que mudou de código depois de cada item
ter passado.** Os itens 1–4 (regressão) e 5–8, 17–20 não foram tocados.

| item | por que voltou |
|---|---|
| **12** | o texto da coluna vazia mudou — tem de ler no CONDICIONAL ("pode guardar"), e o caso comum tem de ler como "escolha e siga" |
| **22, 23** | a barra e o travamento dos cards passaram a valer também no Quadro geral |
| **24, 25, 26** | `colunasParaDesenhar` mudou a lista que o arraste e as setas percorrem — **e 24 e 25 continuam sem guardião nenhum** |
| **28, 29** | o "×" ganhou um terceiro motivo de impedimento (a ponte) |
| **31, 34** | a coluna criada agora **aparece no quadro**, cinza, com selo "nova": criar → arrastar para o meio → concluir → ela nasce lá |
| **33, 35** | a revisão passou a montar o destino `tmp:` pela fonte única |
| **36** | trocar de quadro no modo de edição **descarta o rascunho em silêncio** — comportamento novo, conferir que não assusta |
| **38, 38b** | o lápis no Quadro geral, e o "×" ausente nas oito colunas dele |

⚠️ **DOIS CAMINHOS NOVOS QUE NENHUM ITEM ANTIGO COBRE:**

39. **Quadro geral, ADMIN, com um filtro que não casa nada** → clicar no lápis
    → **as colunas aparecem**, e não "Nenhuma tarefa ainda". Foi o defeito de
    17/08 que só o teste pegou.
40. **Quadro geral, ADMIN** → criar coluna, arrastar para o meio, concluir →
    ela nasce lá **e o quadro das 26 pessoas mudou**. ⚠️ É o único item desta
    lista cujo raio de explosão é o time inteiro.

⚠️ **MAIS TRÊS, da fatia 9 (18/08) — nenhum item antigo os cobre:**

41. **Dois quadros de mesmo nome no mesmo subtime** → o segundo **recusa com
    erro em vermelho**, e o campo não é limpo. Repita com **maiúscula
    diferente** ("Campanhas" e "campanhas") → **passa**, e é decisão, não
    defeito.
42. **No modo de edição, renomear uma coluna para o nome de outra** → o
    "Concluir edição" **recusa em vermelho**, o modo continua aberto **com o
    trabalho dentro**, e nenhum pedido sai. ⚠️ Repita **trocando os nomes de
    duas colunas entre si** → **passa**: é gesto legítimo, e barrá-lo seria o
    defeito.
43. ⚠️ **Devtools em modo offline, renomear uma coluna, "Concluir edição"** →
    tem de aparecer **erro em vermelho** na barra. **Até 18/08 não aparecia
    nada**: `erroLote` só era desenhado dentro da revisão, que só existe quando
    há coluna marcada para apagar. A pessoa clicava e não acontecia nada.

⚠️ **MAIS SEIS, das fatias 8 e 7 (18/08). Os itens 47 a 49 são a operação mais
destrutiva do produto — não pule nenhum, e faça num quadro de teste.**

44. **Numa tarefa de quadro avulso, tentar movê-la para debaixo de uma tarefa
    do Quadro geral** (pela API — a tela não oferece trocar de pai) → recusa
    dizendo para **mover a tarefa de topo inteira**.
45. **Criar tarefa dentro de um quadro avulso** → ela nasce com o time DAQUELE
    quadro, e o modal diz qual.
46. ⚠️ **Lente de um subtime → criar tarefa ali** → ela continua **interna** e
    **não aparece no Quadro geral**, nem para ADMIN. É o comportamento das 216
    tarefas de produção, e a fatia 8 não podia tê-lo mexido.
47. ⚠️ **O botão "Apagar" NÃO existe na lente nem no Quadro geral** — ausente,
    e não desabilitado. Só nos quadros avulsos, e só para quem gere.
48. ⚠️ **Apagar um quadro COM tarefas dentro**, num quadro de teste:
    a contagem aparece **antes** do campo e diz que as arquivadas vão junto; o
    botão fica **travado** até o nome bater; **maiúscula errada não passa**;
    `Enter` **não** confirma; `Esc` fecha. Depois: o quadro some do seletor, a
    tela volta para a lente, e as tarefas somem de `/minhas-tarefas`.
49. ⚠️ **O RESGATE, e ele é o item mais importante desta lista.** Rode
    `backend/scripts/restaurar_quadro.sql` no quadro que você acabou de apagar
    e confira que **o quadro e as tarefas voltam**. Se este falhar, apagar
    quadro é irreversível de verdade — e aí a fatia não pode subir.
    ⚠️ **Antes de restaurar, apague UMA tarefa daquele quadro à mão** e confira
    que ela **NÃO** volta: o resgate devolve só o que aquele clique apagou.
50. ⚠️ **Duas abas no mesmo quadro avulso: apague numa, e olhe a outra SEM
    RECARREGAR** → ela diz **"Este quadro não existe mais"**, e não fica em
    "Carregando…" para sempre.

    ⚠️ **A versão anterior deste item mandava RECARREGAR, e estava errada** —
    reportada em 18/08. Com F5, o `?quadro=` passa por `quadroPedidoNaUrl`, que
    recusa id fora da lista e **cai na lente, em silêncio e de propósito**
    (anterior à fatia 7: *"o id pode ter vindo de um link velho; mostrar erro
    para quem só abriu a tela seria pior que mostrar o lugar padrão dela"*).
    A mensagem cobre o outro caso — a aba que já estava aberta.

    ⚠️ **SOBRA UMA PONTA, e ela NÃO entra no portão:** a queda para a lente é
    muda. Com apagar quadro existindo, isso deixa de ser "link velho de alguém"
    e passa a acontecer entre duas pessoas do time. Conserto barato depois do
    deploy: um aviso passageiro na lente.

---

### ⚠️ O que a conferência de 18/08 achou, e o que ela ensinou

**Cinco achados. Dois eram defeito de código, e TRÊS eram erro da própria
lista** — os itens 26, 39 (em aberto) e 50 pediam comportamento que o código
nunca teve.

⚠️ **O PADRÃO DOS ITENS ERRADOS TEM NOME: foram escritos a partir da INTENÇÃO
do plano, e não do código.** Com o 13, o 29 e o 37 (17/08), são SEIS. Item de
conferência que descreve o que a gente queria, e não o que existe, gasta a
rodada de quem confere e ainda produz um "defeito" que não é.
**Antes de escrever item novo, abra o arquivo.**

#### Os dois defeitos

1. ⚠️⚠️ **O ARRASTE DE CARD MORRIA DEPOIS DE ENTRAR E SAIR DO MODO DE EDIÇÃO.**
   Duas coisas registravam no MESMO `DndContext` com o MESMO id: o
   `useDroppable({ id: coluna.id })` do `ColunaKanban` (o alvo do card) e o
   `useSortable({ id: ref })` do cabeçalho, onde `ref` **é** o `coluna.id`. O
   segundo sobrescrevia o primeiro, e ao SAIR da edição o cabeçalho desmontava
   e **apagava a entrada compartilhada, levando junto o alvo do card**.
   Conserto: prefixo `cab:` no id do cabeçalho.

   ⚠️ **O SINTOMA NÃO ACUSAVA A CAUSA.** "O card volta sem aviso" parece regra
   recusando o destino — e `onDragEnd` tem três `return` mudos que dariam o
   mesmo. O que discriminou foi uma pergunta de UMA linha: *nenhuma coluna
   acende ao passar o card por cima?* Sem `over`, não é regra: é registro.

   ⚠️ **NENHUM PORTÃO PEGA, E NÃO VAI PEGAR** — `onDragEnd` não roda em jsdom.
   O que ficou preso é o par `idDeArrasteDoCabecalho`/`refDoArrasteDeCabecalho`,
   com a asserção de que o id do cabeçalho **nunca** é igual ao da coluna.

2. ⚠️ **A ROTA DE APAGAR QUADRO VOLTAVA 405, e a suíte estava verde.** A fatia
   7 subiu com 8 testes de SERVIÇO e ZERO de rota. Teste de serviço não sabe se
   a rota existe: rota não registrada, verbo errado ou `response_model` trocado
   passam verdes e aparecem como **405 na tela de quem clicou**.
   ⚠️ **E o `test_boards_escrita_http_db.py` JÁ AVISAVA no cabeçalho** que a
   primeira versão das rotas de escrita falhou em 100% das requisições com os
   17 testes de serviço verdes. Mesma lacuna, mesmo arquivo, dois meses depois.

#### Uma armadilha de ferramenta, medida na fonte

⚠️ **`useDraggable({ disabled })` NÃO DESREGISTRA O NÓ no `@dnd-kit/core@6.3.1`.**
Lido no `node_modules`: `disabled` entra só no `aria-disabled` e no `useMemo`
dos atributos — **não** no efeito de registro (deps `[draggableNodes, id]`) nem
nos `listeners`. Quem trava o card no modo de edição é o
`{...(travado ? {} : listeners)}`, e não o hook. O comentário do
`CardArrastavel` afirma o contrário e está **errado** — custou duas rodadas de
procura num mecanismo que não existe.

---

⚠️ **OS ITENS 24 E 25 SÃO A ÚNICA PARTE DA SPEC SEM GUARDIÃO NENHUM.**
`onDragEnd` não roda em jsdom, e não vai rodar. Se falharem, falham em produção
— e a pessoa que descobre é a que estiver usando.

---

## Ordem de deploy — versões anteriores (histórico)

> Mantidas porque registram por que a ordem mudou três vezes. **A vigente é
> a §Ordem de deploy, acima.**

### Ordem de deploy — versão de 06/08 (histórico)

⚠️ **ESTA ORDEM ESTÁ SUPERADA — ver a §Ordem revisada logo abaixo.**

1. **Fatia 1 sozinha, e a migration vai ANTES do código — obrigatoriamente.**
   ⚠️ O texto anterior aqui dizia que ela *"pode ficar parada"*. Era verdade
   enquanto nada lia a coluna, e deixou de ser no MESMO commit: o
   `board_repository` roda `AND b.deleted_at IS NULL` em SQL cru, e `Board`
   tem `deleted_at` mapeado (o ORM emite lista explícita de colunas). Subir o
   `main` sem a `0012` quebra o `create` de tarefa de topo
   (`task_service.py:380`) e toda leitura ORM de quadro.
   ✅ **A `0012` ESTÁ EM PRODUÇÃO DESDE 10/08/2026** (`invariantes.sql`, que só
   roda a consulta 4 com ela aplicada). Enquanto ela não estava, não havia
   caminho de hotfix — qualquer deploy, inclusive um de front, arrastava esse
   código junto. **Esse intervalo acabou.** Medido em 06/08: produção tem UM
   quadro (`Quadro geral`, time raiz, 8 colunas, 0 sem ponte, 696 tarefas).
2. **Fatia 2 sozinha.** É permissão. Depois dela, os critérios 4 e 5 da spec.
   ✅ **Em produção.**
3. **Fatia 3** junto ou logo depois da 2 — reusa a mesma lente.
   ✅ **EM PRODUÇÃO desde 10/08.** (Este item dizia "commitada, ainda NÃO em
   produção" depois de a fatia já ter subido — e as 4a e 4b, que vieram
   depois, dependem dela. Estado de fatia se escreve no commit que sobe, não
   na sessão seguinte.)
4. **Fatia 4** quando houver sessão limpa para o front.
5. **Fatia 5**, e só depois da 4 estar **no ar**. Criar quadro sem o front ler
   colunas não muda a tela de ninguém.

⚠️ **Não emendar 2 com 4.** Uma é API com permissão, a outra é front. Nada em
comum além do assunto.

⚠️ **Migration já em PRODUÇÃO deixa de ser editável.** Vale da `0008` à
`0012`.

⚠️ **CI verde antes de tocar na VPS** — e "verde" quer dizer que o job
`backend` chegou a executar o passo `pytest`. Um X vindo do `Set up job` é o
GitHub caindo, não o seu código, e na lista de runs os dois são
indistinguíveis.

---

### Ordem revisada de 10/08 (histórico)

1–3, 4a, 4b: ✅ **em produção.**

4. **A peça de BACKEND da fatia 5, e ela vem AGORA:** `PATCH /tasks/{id}`
   aceitando `column_id`, validando que a coluna pertence ao quadro da tarefa.
   Meia sessão. Destrava, de uma vez: o `Board.tsx`, o kanban de
   `/minhas-tarefas` e o CRUD de coluna.

   ⚠️ **Não é escopo furando fila.** É a mesma classe de descoberta da fatia 3
   ("a que faltava no roteiro até 06/08"): este plano foi escrito antes de
   alguém abrir o `onDragEnd`. O backend hoje resolve coluna A PARTIR do
   status em dois pontos (`task_service.py:824` e `:838`); aceitar `column_id`
   direto é inverter essa direção, que é o que a ADR 0033 promete para o fim
   da ponte.

   ### ⚠️ TRÊS COISAS A DECIDIR ANTES DE ESCREVER A PRIMEIRA LINHA (10/08, noite)

   **1. A derivação pela SEMÂNTICA, sozinha, PERDE STATUS — não a implemente
   como está escrita na fatia 5.** A semântica é 8:4 nas colunas padrão
   (`Em Andamento`, `Aprovação Interna`, `Aprovação Externa` e `Bloqueado` são
   todas `IN_PROGRESS`). Derivar status a partir dela colapsa os quatro em
   `IN_PROGRESS`, e o comentário de `app/db/models/boards.py:191-196` já diz
   exatamente isso, com os nomes. **A regra que preserva o quadro de hoje:
   `legacy_status` quando a coluna tiver um; semântica SÓ quando for `NULL`
   (coluna criada por gente).** Isso é ADR, e vem antes do código —
   ⚠️ **nenhum portão pega o erro**, porque o status derivado errado ainda é um
   status VÁLIDO: só aparece como card pulando de coluna na tela de todo mundo.

   **2. `task.column_id` está gravado DENTRO do `if` de status.** Em
   `TaskService.update`, a atribuição vive dentro de
   `if command.status is not None and command.status != task.status`. No dia em
   que existirem duas colunas de mesma semântica **sem** `legacy_status` (ou
   seja: na fatia 5, por desenho), mover uma tarefa entre elas não muda o
   status → o bloco não roda → **a tarefa não sai da coluna, e não há erro**.
   A gravação por `column_id` tem de sair de dentro daquele bloco.
   **Sabotagem:** devolver a atribuição para dentro do `if` e nomear o teste
   que cai.

   **3. `column_id` e `status` no MESMO payload.** Hoje o PATCH aceita `status`.
   Decida no schema: precedência de um sobre o outro, ou 422 quando vierem os
   dois. Deixar implícito é entregar dois donos para o mesmo campo.

   **Rastro:** `_diff_for_update` gera `STATUS_CHANGED`. Movimentação entre
   colunas de MESMO status não deixa linha nenhuma em `task_history` — mesmo
   buraco que já existe em designação. Decida agora se entra ou se fica
   escrito como dívida.

5. **4c**, que depois disso vira execução mecânica — ⚠️ **contra os QUATRO
   caminhos de escrita** listados na seção da 4c, não contra dois arquivos.
6. **O resto da fatia 5** (criar/renomear/apagar quadro, CRUD de coluna,
   seletor de cor).
   ⚠️ **SUPERSEDED em 11/08 — ver §Fatia 5, sub-fatias 5b.** O "resto" virou seis
   fatias (5b-1 a 5b-6), quatro delas já em produção, e **apagar quadro** e
   **seletor de cor** foram CORTADOS da 5b com o custo na mesa.

⚠️ **A permissão `board.manage.subteam` tem de entrar nos TRÊS conjuntos**
(`ADMIN`, `MANAGER`, `SUPERVISOR`) em `permissions.py`. Não há hierarquia
entre papéis — são listas literais. Se entrar só no SUPERVISOR, o supervisor
cria quadro e o ADMIN não consegue. A trava de escopo mora no serviço
(precedente literal: `member.manage.subteam`, Spec 028).

⚠️ **SUPERSEDED EM 11/08 — não implemente hex nesta fatia.** O corte de 11/08
(§Fatia 5, corte 2) decidiu que coluna nova nasce com cor de **token**, por
rotação fixa sobre os 8 existentes: sem hex, sem `<input type="color">`, sem
luminância e **sem** a validação `^#[0-9a-fA-F]{6}$` no backend. O parágrafo
abaixo continua sendo a descrição correta do custo **da fatia do seletor de
cor**, que virá depois — e é a lista de coisas que precisam existir junto com
ela, não antes.

⚠️ **A cor da coluna foi decidida em 10/08: roda RGB livre (hex).** Ver ADR
0040 item 4. Consequências que precisam de desenho na fatia 5: o campo `color`
passa a ter DOIS formatos (`var(...)` nas 8 padrão, hex nas novas — e as
padrão **não** migram, porque token inverte com o tema e hex não); o texto por
cima precisa sair da luminância; e **o backend TEM de validar
`^#[0-9a-fA-F]{6}$`**, porque `color` vira entrada de usuário indo parar num
`style`, e o campo é `String(60)`.

---

### Ordem de 11/08 (histórico)

1. **5b-1** — ✅ subiu sozinha, no-op em produção.
2. **5b-2** — ✅ testes, sem deploy próprio.
3. **5b-3** e **5b-4** — backend com API, sem front que as alcance. ⚠️ **Não
   crie nenhum quadro em produção ainda.** A 5b-3 já subiu; a 5b-4 não.
4. **5b-5b** — a tag e as quatro correções, antes de existir qualquer tarefa
   fora do Quadro geral.
5. **5b-6** — a tela. **O primeiro quadro de produção nasce aqui.** Rode o
   `invariantes.sql` no mesmo dia: a consulta 7 sai de "ausência de caso" e a 5
   passa a listar mais de um quadro.
6. ⚠️ **Anote o contador de tarefas da consulta 5.** É o único contador de
   produção escrito em algum lugar. Série: 696 (06/08) → 802 → 832 (10/08).

---

---

## O que esta spec NÃO valida

> Fundido em 13/08 das duas listas que existiam (`plan.md` e
> `plan-fatia-5.md`), com as duplicatas removidas.

- **Desempenho.** Nada medido. 26 contas, parede estimada em 150–200. Herdado:
  2 queries por membro, sem índice dedicado. O `Board.tsx` filtra client-side
  sobre a lista inteira e passou de 1372 para ~1500 linhas. `listBoards` sem
  memoização, uma requisição por tela. ⚠️ **Não há índice em `task.column_id`
  nem em `task.board_id`** (conferido em 13/08) — irrelevante com 832 tarefas,
  e a FK `RESTRICT` faz todo `DELETE` de coluna varrer a tabela.
- **Responsivo.** Um `@media` no produto todo (`prefers-reduced-motion`), e
  três utilitários de padding no `AppShell`. A tela de quadro ganhou seletor,
  modo de edição e um kanban de 8 colunas × 240px. ⚠️ **Se celular não é caso
  de uso, escreva isso em algum lugar** — hoje a ausência parece esquecimento.
- **Acessibilidade.** Medido em 13/08: `--text-faint` (`.muted`, **129 usos**)
  reprova AA no tema **claro** (3.07 sobre `--surface`, 2.86 sobre `--bg`, 2.76
  sobre `--surface-2`); o tema escuro passa e foi medido, o claro nunca foi. E
  **não há `KeyboardSensor`** no `Board.tsx`: mover card por teclado é
  impossível, enquanto o `dnd-kit` anuncia ao leitor de tela que basta apertar
  espaço — e espaço abre a tarefa.
- ⚠️ **O DESFAZER DO LOTE (6a-ter).** A transação única é o que torna aceitável
  o preço "recusa perde tudo" — e **não é testável nesta bancada**. A fixture
  usa `join_transaction_mode="create_savepoint"`: um `db.rollback()` no teste
  volta ao SAVEPOINT externo e leva a fixture junto, e afirmar o banco depois de
  um caminho recusado por HTTP cai pelo mesmo mecanismo. O que fica preso é a
  **ausência de `commit`** dentro de `aplicar_lote`
  (`test_aplicar_lote_NAO_comita`), que é a linha da qual o desfazer depende.
  ⚠️ **O resto é revisão de código:** o `commit` mora num lugar só, o router.
- **E2E.** Não existe.
- **Os `onDragEnd`** — nunca serão testáveis em jsdom. Conferência manual,
  sempre. Com a fatia 6 passam a ser três.
- **Apagar quadro** — fatia própria, com a lixeira e o script de restauração.
- **Mover tarefa entre quadros** — fatia 5c.
- **Cor livre e contraste AA** — fatia do seletor de cor.
- **As classes CSS novas** (`.error-text`, `.btn-danger`) — o `include` do
  vitest é só `lib/**` e `components/**`; `globals.css` não é lido por teste
  nenhum.
- **Que apagar quadro apaga as tarefas junto** — é a fatia da lixeira. Os
  testes da fatia 1 provam só que a coluna existe e que a descoberta respeita o
  filtro.
- ⚠️ **`semantic` JÁ TEM LEITOR desde a Spec 037** (correção de 10/08):
  `TaskRepository.bloqueios_por_perda_de_alcance` deriva o que é terminal de
  `TERMINAL_SEMANTICS`, e não de uma lista de status escrita à mão; ele também
  viaja no `GET /boards` desde a fatia 2. ⚠️ **`is_default_target` GANHOU LEITOR
  na 5b-1** (o degrau 2 da ADR 0042). **O campo sem leitor que sobrou é
  `lib/coluna.ts::corEhHex`** — é esse o que citar quando o assunto voltar.
- **A migração contra o volume de produção.** `board` tem uma linha; se isso
  mudar, medir de novo.
- ⚠️ **Nenhum quadro não-padrão jamais existiu em produção.** Tudo o que a 5b
  entregou é regra para um mundo que ainda não aconteceu — e que nasce no
  primeiro deploy.

---

## Números de produção

- **176 tarefas vivas no Quadro geral** (11/08): Backlog 20, Planejado 18, Em
  Andamento 42, Aprovação Interna 4, Aprovação Externa 1, Concluído 87,
  Cancelado 0, Bloqueado não medido. ⚠️ **Não remedido desde então.**
- ⚠️ **87 de 176 são Concluído.** Metade do quadro é trabalho terminado
  esperando a varredura. Não é defeito — é a janela do `terminal_since`. Mas
  vira "o sistema tá pesado" na boca do usuário. **Vale rever o prazo da
  varredura em horário calmo.**
- **71% das tarefas vivas estão na RAIZ** (155 de 219, 10/08).
- **Série de tarefas (consulta 5):** 696 (06/08) → 802 → 832 (10/08).
  ⚠️ **Sem leitura nova.** É o único contador de produção escrito em algum
  lugar, e o `invariantes.sql` não roda desde 10/08.
- Medição que sustenta as 4 colunas base: `Aprovação Interna` **4**,
  `Aprovação Externa` **1**, `Cancelado` **0** — cinco cards em 176, contra 42
  em `Em Andamento` e 87 em `Concluído`.

---

## O que falta da Spec 036, DEPOIS do deploy

⚠️ **OS DOIS PRIMEIROS ITENS SAÍRAM DAQUI EM 17/08** e viraram §Fatia 7 (apagar
quadro) e §Fatia 8 (mover tarefa entre quadros), porque entraram na §Definição
de pronto. **O que sobrou nesta lista NÃO segura o deploy.**

Em ordem de valor. Cada um é fatia própria, e **escreve-se neste arquivo**.

⚠️ **A FATIA 11 ENTROU NESTA LISTA EM 18/08, VINDA DO CAMINHO DO DEPLOY** —
sentido contrário ao da fatia 9, que entrou na §Definição de pronto. **O escopo
dela já está escrito** (§Fatia 11): o aviso quando o `?quadro=` não existe mais
e a tela cai na lente. Saiu porque o caminho que importa — a aba que já estava
aberta — **já avisa** (`Board.tsx:856`), porque o dropdown da fatia 10 melhorou
o outro caminho sem querer, e porque o caso **só passa a ser possível depois
deste deploy**: hoje há um quadro só, e ele é o padrão, que não se apaga.
⚠️ **Ela vem antes do 5c quando vier** — é conserto de sinal, e os outros são
adição.

1. **5c — quadro extra da raiz.** ⚠️ **A PERGUNTA "QUEM EDITA AS COLUNAS DO
   QUADRO GERAL" JÁ FOI RESPONDIDA na 6a-bis (13/08), e este item não depende
   mais dela:** `_assert_quadro_editavel` **saiu** de criar, renomear e
   reordenar — era trava técnica escrita como regra de produto, e o próprio
   docstring dela dizia "vale enquanto a 5c não existir". Hoje edita quem tem
   `board.manage.root` (ADMIN e MANAGER; **não** SUPERVISOR). Sobrou
   `_assert_ponte_sobrevive`, que recusa apagar coluna do quadro PADRÃO com
   `legacy_status` vivo.
   ⚠️ **A URL já está pronta para isto** (13/08): o quadro escolhido vive em
   `?quadro=`, e não em segmento de rota, **exatamente porque**
   `/quadro/{boardId}` colidiria com `/quadro/{teamId}` — os dois são UUID na
   mesma posição. Segmento de rota obrigaria a inventar um formato diferente só
   para os quadros da raiz.
3. **Seletor de cor.** ⚠️ `lib/coluna.ts::corEhHex` **continua sem leitor**.
2. **Trocar qual coluna é o alvo de uma semântica.** ⚠️ **SUBIU DE URGÊNCIA
   EM 13/08, POR CULPA NOSSA.** Não existe, e a trava da 5b-4b faz a ausência
   doer: coluna-alvo nunca pode ser apagada. Até a fatia 6 isso era **ausência
   silenciosa**; o selo "padrão" põe na tela um rótulo que anuncia que existe
   uma coluna escolhida e que não dá para trocá-la. Rótulo visível convida à
   pergunta — e a resposta hoje é "apague o quadro e recomece".
4. **`notify_deadline` na criação de coluna — ✅ RESOLVIDO EM 18/08, e o
   conserto foi de HONESTIDADE e não de código.** A decisão de 13/08 (não
   fazer) continua valendo; o que estava pendente era a documentação, e ela
   saiu: `BoardColumnCreateRequest` agora explica que o campo é **lido e
   exposto, mas não tem escritor**, por que ficou assim, e o que decidiria o
   tamanho de um dia fazê-lo (o `PATCH` é a parte cara — editar a flag de uma
   coluna que já tem tarefas com prazo muda em silêncio quais avisos saem
   amanhã). ⚠️ **E os três lugares que prometiam o contrário foram
   corrigidos**, cada um apontando para a nota:
   `deadline_notify_service.py`, `BoardColumnResponse` e `board_semantics.py`.
   ⚠️ **Nada mudou para quem usa** — coluna nova continua cobrando prazo, que
   é o que "Aprovação Externa" já faz hoje para as 26 pessoas. Mudou só o que
   quem LÊ o código acredita.

   Texto original, mantido porque descreve o estado:
   ⚠️ **Campo sem escritor:**
   `criar_coluna` crava `True`, o schema não aceita e o rename não edita — mas
   **três lugares no código prometem por escrito que dá para desligar**,
   inclusive o `DeadlineNotifyService` ("é como a ADR 0030 prometeu que um time
   criaria 'Aguardando cliente' sem código novo"). Decisão de 13/08: **não
   fazer agora** — "Aprovação Externa" já cobra prazo hoje, no Quadro geral,
   para as 26 pessoas, então coluna nova cobrando prazo não é regressão nem
   barulho novo. ⚠️ **Mas acrescente `notify_deadline` à lista de "não entra, e
   por quê" do `BoardColumnCreateRequest`**, com data: hoje quem lê acredita
   numa capacidade que não existe.

---

## Commits

```
docs(adr): coluna alvo por semantica quando o status nao tem coluna (BE-0042, Spec 036)
feat(boards): column_for_status_in_board cai no is_default_target da semantica (Spec 036, fatia 5b-1)
test(boards): caminhos de escrita por status em quadro de 4 colunas (Spec 036, fatia 5b-2)
feat(perms): board.manage.subteam e board.manage.root (Spec 036, fatia 5b-3)
feat(boards): BoardService cria e renomeia quadro avulso com as 4 colunas base (Spec 036, fatia 5b-3)
feat(front): colunaEquivalente e rotuloDeColuna em lib/coluna (Spec 036, fatia 5b-5a)
feat(boards): CRUD de coluna com trava de coluna alvo de semantica (Spec 036, fatia 5b-4)
feat(front): tag de quadro e coluna nas telas transversais (Spec 036, fatia 5b-5b)
feat(front): lente de subtime filtra pelo quadro geral (Spec 036, fatia 5b-5b)
feat(front): tela de quadro avulso dentro do time (Spec 036, fatia 5b-6)
fix(front): tarefa nasce no time do quadro avulso (Spec 036, fatia 5b-7)
fix(front): coluna com tarefa apagada deixa de ser beco sem saida (Spec 036, fatia 5b-7)
fix(front): erro de /boards deixa de travar a tela (Spec 036, fatia 5b-7)
fix(back): leitura de coluna respeita a lente (Spec 036, fatia 5b-7)
fix(front): board_id volta a sair no corpo do POST /tasks (Spec 036, fatia 5b-7)
fix(front): erro das telas de quadro deixa de sair sem estilo (Spec 036, fatia 5b-7)
fix(front): botao que apaga coluna usa o padrao destrutivo (Spec 036, fatia 5b-7)
fix(front): dialogo de apagar coluna com foco, Esc e lista travada (Spec 036, fatia 5b-7)
fix(front): seletor de quadro com papel ARIA e contraste corretos (Spec 036, fatia 5b-7)
feat(front): quadro selecionado vive na URL (Spec 036, fatia 5b-7)
```

Para a consolidação e a fatia 6:

```
docs(spec): consolida plan-fatia-5 e sondagem no plan.md unico (Spec 036)
docs(spec): fatia 6 -- modo de edicao e reordenar coluna (Spec 036)
```
