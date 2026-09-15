# Spec 048 — O time como contexto

**Status:** escrita em 10/09/2026, decidida com a Camila na mesma conversa.
Decisões tomadas — a última (§4.1, a forma da URL) confirmada por ela em
11/09: *"pode ser como recomenda"*. **Todas as fatias entregues** — A e B em
11/09; C, D e E entre 11 e 14/09.
**PR:** #53, empilhado sobre o #52 (Spec 047).
**Escopo:** frontend, mais **duas** mudanças de backend (§5, fatias D e E).
**Depende de:** **Spec 046 fatia 4** (a área na URL do quadro, e o `area_id`
obrigatório em `default_board_and_column_for_status`) e **Spec 047** (o seletor
de contexto no rodapé, e o `currentContext` que resolve o time pela URL).
**Placar na abertura:** backend **1103**, front **1249**, `tsc --noEmit` limpo,
`next build` ok — medido em 10/09 no branch `spec-047`.
**Placar no fechamento:** backend **1133**, front **1353**, `tsc --noEmit` limpo,
`next build` ok com as cinco rotas estáticas, `ruff` 49 (inalterado) — medido em
14/09 no branch `spec-048`.
**Não faz parte desta spec:** o dashboard de entrada, e o recorte de
permissões. Ver §6.

---

## 1. O que ela pediu, e por que nada disso funciona hoje

A frase que abriu o assunto, em 10/09:

> *"Esse menu de times é para navegar entre os times raiz em que faço parte,
> ou no caso de quem é gestor ou admin na org, para entrar e ver as infos,
> quadros e afins dos times, sabe?"*

E a que definiu o alcance:

> *"As telas acho melhor mudar de acordo com o time raiz em que estou, literal
> todas as telas do menu, minhas tarefas, arquivadas e afins."*

⚠️⚠️ **O seletor do rodapé é uma promessa que o produto não cumpre.** Ele
existe desde a Spec 047, lista os times raiz, marca em qual você está — e
**trocar de time não muda tela nenhuma**. Os sub-quadros do menu continuam os
mesmos, Minhas tarefas continua a mesma, a fila continua a mesma.

⚠️ E não é ausência de recurso: é **defeito ativo**, porque a segunda raiz já
existe. Com "Comercial" e "Marketing" no banco, seis lugares do produto passaram
a responder pela **primeira raiz por nome** — e "C" vem antes de "M". A tela
mostra o Comercial vazio a quem está trabalhando no Marketing.

⚠️ **Isso trava a entrega.** A Camila parou o smoke da 047 nos blocos 3 a 5 por
causa disso: *"o quadro geral quebrou agora, então não posso subir nada"*. Esta
spec é o que destrava aquele smoke.

---

## 2. O que já existe — medido em 10/09, abrindo os arquivos

⚠️⚠️ **A maior parte do mecanismo está construída.** Esta seção está aqui para
impedir que alguém escreva de novo.

| peça | onde | estado |
|---|---|---|
| o time resolvido pela URL | `lib/contextSwitcher.ts` · `currentContext` | ✅ nasceu em 10/09 (Spec 047). Sobe de subtime até a raiz, e trata `/times/<id>` e `/quadro/<id>` |
| quais times a pessoa alcança | `lib/contextSwitcher.ts` · `rootsForPerson` | ✅ testada. Papel de organização vê todas; o resto, as suas |
| o endereço do quadro de um time | `lib/areas.ts` · `urlDoQuadroDeArea` | ✅ uma função, e não um template espalhado (Spec 046 §4.4) |
| ⭐ o quadro geral **da área** no backend | `board_repository.py` · `default_board_and_column_for_status` | ✅ `area_id` **obrigatório, sem default** desde a Spec 046 fatia 4 |
| ⭐ o espelho de colunas do quadro geral | `app/minhas-tarefas/page.tsx` · `posicaoDaTarefa` | ✅ guarda `origem` (a coluna real) e `colunaDaTela` (a equivalente no geral, por ponte e depois por semântica — ADR 0042) |
| o arraste contido | `app/minhas-tarefas/page.tsx` · `arrastavel` | ✅ só arrasta card que **mora** no quadro geral |
| ⭐⭐ o time do formulário | `models/solicitations.py:321` | ✅ `SolicitationForm.team_id`, indexado por `solicitation_form_por_time`. O comentário diz: *"`team_id` É O QUE DECIDE QUEM TRIA (…) decisão da Camila (22/08): a fila é de acordo com o formulário e o time"* |
| o time do projeto | `models/operational.py` · `Project.team_id` | ✅ obrigatório em projeto vivo desde 10/09 (saiu o pessoal) |
| a recusa honesta de "qual é a raiz?" | `lib/areas.ts` · `soleRootTeam` | ✅ levanta `AreaIndefinidaError("varias")` em vez de sortear |

**Ou seja:** o modelo já sabe de que time cada coisa é. O que falta é **a tela
dizer em qual time ela está**, e as consultas ouvirem.

---

## 3. ⚠️⚠️ Os seis lugares que sorteiam a raiz hoje

Todos medidos em 10/09. Nenhum deles levanta erro — **todos respondem errado**.

### 3.1. A entrada do quadro redireciona para a primeira por nome

`entradaDoQuadro` ([`lib/areas.ts:154`](../../../web/lib/areas.ts)) com duas ou
mais raízes devolve `{tipo: "redirecionar", para: urlDoQuadroDeArea(areas[0].id)}`
— e `rootTeams` ordena por nome. Somado à rota `/` (que manda para `/quadro`), o
efeito é: **entrar no sistema abre o Comercial**.

### 3.2. A barra lateral é cega ao time

`computeLens` ([`lib/lens.ts:105`](../../../web/lib/lens.ts)) faz
`allTeams.find((t) => t.parent_team_id === null)` — a primeira raiz — e usa isso
como `rootId`. E para um ADMIN, `boardSubteams` são **todos** os subtimes de
**todos** os times, sem recorte.

### 3.3. A visão de quadro de Minhas tarefas espelha um quadro qualquer

`quadroGeralComIndice()` ([`lib/api.ts:996`](../../../web/lib/api.ts)) faz
`quadros.find((q) => q.is_default)` — "o" padrão, no singular. Com dois times
existem dois, e a ordem é a que a API devolver.

### 3.4. Duas escritas ainda caem em `getRootTeamId()`

`createTask` sem `team_id` ([`lib/api.ts`](../../../web/lib/api.ts)) e o caminho
legado do `Board`. A função **levanta** com mais de uma raiz, de propósito
(Spec 046 fatia 1) — o `Board` engole e segue sem filtro; o `createTask` estoura.

⚠️ `createProject` **já foi consertado** em 10/09: o formulário passou a
perguntar o time. É o precedente do desenho desta spec — *perguntar, não
adivinhar*.

### 3.5. A fila de solicitações é da organização

`list_batches` ([`solicitations/infrastructure/repository.py:89`](../../app/modules/solicitations/infrastructure/repository.py))
filtra por workspace e por status. **Não filtra por time** — e o modelo já diz
que devia (`form.team_id`, §2).

### 3.6. A listagem de formulários também

Mesma coisa: quem tem `solicitation_form.manage` vê e edita os formulários de
todos os times.

> ⚠️⚠️ **CORREÇÃO DE 11/09 — a §3.5 e a §3.6 estavam ERRADAS, e do mesmo jeito.**
> As duas dizem que não há filtro de time. **Há**: o recorte por `form.team_id`
> existe desde a Spec 043 fatia A — no `_base_select` do
> `SolicitationRepository` (com teste) e no `listar_formularios` (sem teste
> nenhum até hoje). Fui ler os dois arquivos e as duas afirmações caíram.
>
> ⚠️ **Com o `list_page` de projetos, são TRÊS afirmações desta spec sobre o
> código que não sobreviveram à leitura dele — e as três têm a mesma origem:**
> escrevi a partir das notas de "o que falta" da spec anterior, em vez de abrir
> o arquivo. A nota da Spec 043 dizia *"o que nunca existiu foi o `WHERE`"*, e
> isso era verdade **no dia em que foi escrita**.
>
> **O que faltava de verdade, nos três lugares, era o segundo recorte:**
>
> | | pergunta | para papel de organização |
> |---|---|---|
> | a **lente** | "posso ver?" | `None` — vê tudo |
> | o **`team_id`** | "estou olhando qual time?" | recorta |
>
> A lente sozinha não conserta o que ela reportou, porque ela administra a
> organização e alcança o Comercial de verdade. Tratar isso como um problema só
> teria fechado o furo de quem não administra e deixado o defeito da tela de pé.
>
> ⚠️ **E a §3.6 cobria uma regra sem teste.** A listagem de formulários tinha a
> lente escrita, comentada — e nenhum teste. Apagar o `if visiveis is not None`
> deixaria a suíte inteira verde. Agora há
> `tests/integration/test_formularios_do_time_db.py`, e a sabotagem foi
> executada.

---

## 4. As decisões

### 4.1. O time mora na URL, como query

**Decidido por ela:** *"área entra na url, pois estarei movendo entre times
diferentes"*. Coincide com a Spec 046 §4.4, que escolheu URL para o quadro com
motivo escrito: é o que faz o link compartilhável e o botão Voltar funcionarem,
"coisas que 'área ativa' guardada em estado não dá".

**A FORMA foi confirmada em 11/09** — query. As duas que estavam na mesa:

| forma | como fica | custo |
|---|---|---|
| **query** (recomendada) | `/minhas-tarefas?time=<id>` | nenhuma rota muda. ⚠️ `useSearchParams` em rota estática **derruba o `next build`** — armadilha já registrada duas vezes (`AGENTS.md` §6 e Spec 047 §7). **Cinco telas** precisariam de fronteira de `Suspense`, e as cinco são estáticas hoje: `/minhas-tarefas`, `/projetos`, `/arquivadas`, `/solicitacoes`, `/formularios` (conferido no `next build` de 10/09) |
| **prefixo de caminho** | `/t/<id>/minhas-tarefas` | conceitualmente mais limpo. Reescreve as cinco rotas e todo link interno que aponta para elas |

⭐ **A escolhida foi a query, e o argumento não é preguiça:** as duas rotas que
**já** carregam o time no caminho (`/times/[id]` e `/quadro/[teamId]`) são telas
**do** time — o time é o assunto delas. As outras cinco são telas **filtradas
pelo** time. A distinção é real, e a URL passa a dizê-la:

    /times/<id>            -> esta tela é DO time
    /quadro/<id>           -> este quadro é DO time
    /minhas-tarefas?time=  -> esta tela é MINHA, recortada pelo time

⚠️ **Sem o parâmetro, a tela não fica sem contexto:** ela resolve o time da
pessoa (a mesma conta de `peopleEntry`) e **reescreve a URL** com `replace`, de
modo que o link fique explícito e o Voltar não volte a um estado sem contexto.

### 4.2. Trocar de time mantém a tela

⚠️ **O seletor do rodapé passa a preservar a tela atual.** Estando em
`/minhas-tarefas?time=A`, clicar em B vai para `/minhas-tarefas?time=B` — e não
para a tela do time B.

**Por quê:** "trocar de time" é gesto de trabalho, e jogar a pessoa para outra
tela no meio dele é perder o lugar. Ver as pessoas de um time é outro ato, e já
tem porta própria — o item **Time** do menu.

⚠️ Exceção: em `/organizacao`, que não é de time nenhum, o seletor manda para a
tela do time escolhido — não há tela equivalente para preservar.

### 4.3. Minhas tarefas é a exceção, e mantém as duas visões

⚠️⚠️ **Eu propus tirar a visão de quadro, e ela recusou.** O registro importa
porque o argumento que eu usei estava certo pela metade: um kanban precisa das
colunas de **um** quadro, e "minhas tarefas" atravessa vários. A resposta dela
resolve isso sem tirar nada:

> *"A pessoa pode alternar entre ver a lista, que tem o filtro de mostrar tudo
> ou por time raiz em que ela está. E também pode, quando for para o quadro na
> tela, escolher o time do quadro (…) assim, o quadro é uma visão filtrada por
> responsável do geral (incluindo tarefas internas de outros quadros do time
> raiz como já faz hoje, mesmo que mentindo) e espelha as colunas do quadro
> geral daquele time que ela está olhando."*

Ou seja:

- **lista** → filtro `tudo` | por time raiz em que ela está;
- **quadro** → exige **um** time. As colunas são as do quadro geral dele; os
  cards são as tarefas dela na árvore daquele time, **incluindo as internas de
  outros quadros**, mapeadas por semântica.
- **Os dois seletores são independentes:** a lista pode dizer "tudo"; o quadro
  não pode — kanban não espelha dois quadros ao mesmo tempo.

⚠️ **E a mentira é conhecida e aceita, com estas palavras: *"mesmo que
mentindo"*.** Uma tarefa que vive numa coluna de quadro interno aparece na
coluna **equivalente** do geral, por semântica. É o que `posicaoDaTarefa` já
faz, e o comentário dela já registra o defeito clássico: confundir `origem`
(de onde saem prazo e semântica) com `colunaDaTela` (onde o card é desenhado).

⚠️ **Esta tela é a única que atravessa times de propósito**, e é por isso que
ela tem "tudo". Frase que vale guardar: *o time muda com a área; o que é meu,
não.*

### 4.4. A fila e o formulário são do time raiz

**Decidido por ela:** *"formulários e solicitações são por time raiz.
separados"*.

⭐ **E isso não é decisão nova — é a de 22/08 finalmente implementada.** O
`SolicitationForm.team_id` está no banco desde a Spec 043, com o comentário
*"é o que decide quem tria"* e a citação dela: *"a fila é de acordo com o
formulário e o time"*. O que nunca existiu foi o `WHERE`.

- **A fila** passa a filtrar por `solicitation.form_id -> form.team_id`.
- **A listagem de formulários** passa a filtrar por `form.team_id`.
- ⚠️ **A URL pública NÃO muda.** `/solicitar/<slug>` continua sem login e sem
  time: o slug é único por workspace de propósito (dois times não disputam
  `/solicitar/arte`), e quem preenche não sabe o que é time.
- ⚠️ **Solicitação órfã** (`form_id` nulo, de antes da Spec 043) hoje aparece
  para quem tem `solicitation.review` no workspace. Com o filtro, ela sairia de
  todas as filas — **decisão: ela fica visível para papel de organização**, que
  é quem pode adotá-la. Some da fila de time, não do produto.

### 4.5. Onde a pessoa cai ao entrar

⚠️ Hoje `/` manda para `/quadro`, que redireciona para a primeira raiz por nome.
**Nesta spec, `/` manda para o quadro do time DA PESSOA.**

⚠️⚠️ **E "a mesma conta de `peopleEntry`" ESTAVA ERRADO** — era o que esta seção
dizia até 11/09, e a fatia B pegou ao ligar. `peopleEntry` recebe
`rootsForPerson`, que para quem tem **papel de organização devolve TODOS os
times**; a primeira por nome é "Comercial", e ela trabalha no Marketing. A spec
conservava o próprio defeito que ela existe para matar, com outra roupa.

A conta certa distingue duas perguntas que não são a mesma:

    rootsForPerson  -> onde a pessoa ALCANÇA   (para quem administra: todos)
    ownRootTeams    -> onde a pessoa TRABALHA  (o vínculo, resolvido na árvore)

E a ordem de preferência — `preferredTeams` — é **trabalha primeiro, alcança
depois**. O resto não é descartado: é ele que distingue "tem um time só,
desenha" de "tem vários, redireciona".

⚠️ Vale para os TRÊS lugares que fazem a mesma pergunta: a reserva do
`activeTeam`, o destino do item **Time** do menu e a entrada do quadro. Escrever
a regra nos três seria a quarta cópia de regra de navegação deste projeto — e as
três anteriores já divergiram.

⚠️ **O dashboard não entra aqui.** Ela pediu um painel de "o que fazer agora", e
combinamos que é spec própria e **depois** desta: o painel é por time, e precisa
que o contexto exista para poder ser recortado.

---

## 5. As fatias

Cada uma fica verde sozinha, e a ordem não é negociável nas três primeiras.

**Fatia A — o time ativo tem nome, e uma fonte só (front).** ✅ **ENTREGUE
em 11/09.**
`lib/activeTeam.ts`: `activeTeam(pathname, search, teams, reachable)` responde
*"em que time estou?"* em cinco degraus (caminho → `tudo` → parâmetro → time da
pessoa → nada), e `withTeam` monta a URL preservando os outros parâmetros.
**Nada de tela mudou** — a fatia só criou a resposta, com 25 testes.
⚠️ Vai primeiro porque as três seguintes a consomem, e porque a regra em `lib/`
é a única que tem guardião (`app/` está fora do `include` do vitest).

⚠️⚠️ **E ela trouxe uma dívida à tona:** `rootOf` existia DUAS vezes, privada,
em `lib/contextSwitcher.ts` e `lib/lens.ts` — e as duas **já divergiam** no caso
de pai pendurado (a de `lens.ts` devolvia o último nó conhecido, afirmando que
um subtime era raiz; a outra devolvia `null`). Viraram uma,
`rootTeamOf` em `lib/areas.ts`, unificada no `null` — fail-closed. Três cópias
de uma caminhada de árvore é o defeito que a Spec 034 já pagou (D2/D4).

**Fatia B — a barra deixa de sortear (front).** ✅ **ENTREGUE em 11/09.**
`computeLens(myTeams, allTeams, roles, activeRootId)` — o time ativo **sem
default**, pelo mesmo argumento da Spec 046 fatia 4: o `tsc` apontou os dois
chamadores em vez de deixá-los compilando e errados. `boardSubteams` passou a
ser os subtimes **daquele** time; "Quadro geral" aponta para ele; e
`entradaDoQuadro` passou a receber os times **da pessoa em ordem de
preferência** em vez da árvore inteira. Mata os defeitos 3.1 e 3.2.
⚠️ **É a fatia que destrava o smoke da 047.**

⚠️⚠️ **O `search` VAI VAZIO nesta fatia, e é decisão, não esquecimento.**
Nenhuma tela escreve `?time=` ainda, então ler a query na barra não
acrescentaria informação — e obrigaria a resolver AGORA o `useSearchParams` em
rota estática. A barra resolve pelo caminho e, fora dele, pelo time em que a
pessoa trabalha. **A fatia C tem de ligar a query no `AppShell` junto com as
telas**; sem isso a barra mostraria os quadros de um time e a tela o conteúdo de
outro.

⚠️ E a §4.2 (trocar de time mantém a tela) **ficou para a fatia C**, de
propósito: escrever `?time=` no seletor antes de as telas honrarem o parâmetro
poria uma URL que mente — ela diria o time e a tela não filtraria.

**Fatia C — as telas recortam (front).** ✅ **ENTREGUE entre 11 e 14/09.**
Projetos, Arquivadas, Solicitações e Formulários passam a ler o time ativo e a
filtrar. Minhas tarefas ganha os dois seletores da §4.3, e
`quadroGeralComIndice` passa a receber o time (defeito 3.3).
⚠️ E as duas escritas do 3.4 param de cair em `getRootTeamId()` — o time ativo
substitui o palpite, como já aconteceu no `createProject`.

> ⚠️⚠️ **CORREÇÃO DE 11/09 — A ORDEM DESTA LISTA ESTAVA ERRADA, e o erro é
> desta spec.** A fatia C é de FRONT, e quatro das cinco telas dela não podiam
> recortar porque **a rota que cada uma lê não aceita time**. Medido, rota por
> rota, e não deduzido:
>
> | tela | rota | o que faltava |
> |---|---|---|
> | `/projetos` | `GET /projects` | ✅ resolvido em 11/09 (lente da ADR 0007 + `team_id`) |
> | `/minhas-tarefas` | `GET /me/assignments` | nenhum parâmetro de time |
> | `/arquivadas` | `GET /tasks` | tem `team_id`, **mas é igualdade em `Task.team_id`** |
> | `/solicitacoes` | a fila | fatia D |
> | `/formularios` | a listagem | fatia E |
>
> ⚠️ **O caso de `/arquivadas` é o mais traiçoeiro dos cinco**, porque o
> parâmetro EXISTE e usá-lo pareceria pronto. `team_id` em `GET /tasks` casa
> `Task.team_id == team_id` — igualdade crua. Recortar por raiz com ele
> **esconderia toda tarefa interna de subtime**, e ignoraria a regra do time
> efetivo que o próprio repositório documenta: *"o time que decide o alcance é
> `COALESCE(project.team_id, task.team_id)`"*. O recorte por raiz precisa de
> parâmetro PRÓPRIO, com a semântica de raiz + descendentes sobre o time
> efetivo — e não de reaproveitar o que existe.
>
> **A ordem certa é D e E ANTES do resto de C**, mais um parâmetro novo para as
> duas rotas de tarefa. O que foi entregue da C em 11/09 é a fundação (a barra
> lendo `?time=`, o contexto descendo para as telas, a reescrita da URL, a §4.2)
> e a única tela cuja rota estava pronta.
>
> **Por que o erro passou:** a fatia foi escrita listando as TELAS, e nenhuma
> linha dela perguntava *"a rota aceita?"*. Escrever fatia de front sem
> conferir o contrato que ela consome é o mesmo defeito, de outro tamanho, do
> comentário que eu pus no `list_page` dizendo que a lente já respondia.

> ✅ **COMO A C FOI ENTREGUE, na ordem corrigida acima:**
>
> - a barra lê `?time=` com **uma** fronteira de `Suspense` (`TeamParamReader`,
>   irmão do conteúdo, `fallback={null}`), e o time desce às telas por contexto
>   (`lib/useActiveTeam.tsx`) — sem cinco cópias da regra;
> - a URL passa a dizer o time (`teamUrlToWrite`, com `replace`), e trocar de
>   time preserva a tela (`switcherHref`, §4.2);
> - `GET /tasks` e `GET /me/assignments` ganharam **`under_team_id`**: raiz +
>   descendentes pelo **time efetivo**, num predicado único com a lente
>   (`_time_efetivo_em`). O `team_id` antigo ficou — endpoint é contrato;
> - Minhas tarefas tem os dois seletores da §4.3, e o defeito 3.3 morreu:
>   `quadroGeralComIndice(teamId)`;
> - o 3.4 morreu por outro caminho: o modal de criar recebe o time do quadro
>   (`newTaskTeam`), e só a rota legada `/quadro` ainda cai em `getRootTeamId`.
>
> ⚠️ **Uma sabotagem achou furo fora do código desta spec:** o ramo
> `Project.team_id` da lente não tinha teste que o distinguisse do ramo da
> tarefa. Ganhou (`test_a_LENTE_olha_o_time_do_PROJETO_e_nao_o_da_tarefa`).

**Fatia D — a fila é do time (backend).** ✅ **ENTREGUE em 11/09.**
`list_batches` e as duas contagens (`count_pending`,
`count_approved_without_task`) passam a receber o time e a filtrar por
`form.team_id`. Papel de organização continua vendo tudo, e as órfãs seguem a
§4.4.
⚠️ **Sem parâmetro default**, pelo mesmo motivo que a Spec 046 fatia 4 usou em
`default_board_and_column_for_status`: um `team_id: uuid.UUID | None = None`
deixaria todo chamador existente compilando e errado em silêncio.

> ✅ A lente já existia (Spec 043); o que faltou foi o `team_id`. Sem default
> nos três métodos — o `pytest` apontou os treze chamadores. E uma sabotagem
> que não pegou nada revelou que ninguém testava o `total` da fila recortada:
> ganhou teste.

**Fatia E — a listagem de formulários é do time (backend).** ✅ **ENTREGUE em
11/09.**
Mesmo desenho, no `form_router` e no serviço.

> ✅ E a lente desta listagem, escrita desde a Spec 043, **não tinha teste
> nenhum** — apagá-la deixava a suíte verde. Ganhou
> `test_formularios_do_time_db.py`, com as três sabotagens executadas.

---

## 5-bis. O que o teste na tela achou em 14/09

Com as fatias entregues, a Camila testou como admin da organização, com o
Comercial ativo. Nenhum destes defeitos derrubava portão — todos respondiam pelo
time errado, ou escondiam um botão:

- **a barra publicava o time antes de saber qual era** (a árvore a caminho dava
  `kind: "none"`; a query não lida dava a reserva), e as telas refaziam o pedido
  a cada render. O último a responder vencia a lista. → `publishedActiveTeam`;
- **o menu e os "voltar" apagavam o `?time=`**, e a tela caía na reserva. →
  `navHref`; o `?time=` passou a subir de subtime até a raiz;
- **o item Time ignorava o time ativo.** → `peopleEntryFor`;
- **Minhas tarefas vazia sumia com a barra**, e com ela o único seletor de time;
- **o quadro geral era "o" primeiro**: três cópias de `find(is_default)` no
  `Board`. Tarefa criada no Comercial era salva certa e não aparecia. →
  `quadroGeralDoTime`, uma fonte só;
- **novo projeto ignorava o time ativo**, e entrava na lista de outro time;
- **em `/quadro/[teamId]`, o quadro geral da raiz perdeu o lápis e o
  renomear** — o ramo nasceu sem `podeEditarColunas`, sem `acoesDoQuadro`, e o
  avulso sem `daRaiz`. As três viraram obrigatórias: esquecer deixa de compilar.

⚠️ **O padrão que se repetiu seis vezes nesta branch:** prop opcional que muda
comportamento esconde uma pergunta que alguém tem de responder (`daRaiz`,
`newTaskTeam`, `podeEditarColunas`, `acoesDoQuadro`…). A resposta foi sempre a
mesma — obrigatória, e `null`/`false` explícitos onde a ausência é decisão.

---

## 6. O que esta spec deliberadamente NÃO faz

- **O dashboard de entrada.** Pedido dela na mesma conversa, e adiado por
  dependência: ele é por time. Spec própria, depois desta.
- **O recorte de permissões** (`*.manage` → verbos separados). Documentado em
  `~/Documents/gestor-de-tarefas-permissoes.html`, e **decidido para depois**
  desta spec, com motivo: o recorte não encosta na camada de escopo que esta
  spec mexe, e é mudança larga — melhor sobre base verde e já entregue.
  → **Spec 049**, escrita em 14/09.
- **Mudar quem enxerga o quê.** Esta spec **recorta a tela** pelo time ativo;
  ela não altera a lente. ⚠️ Se uma tela precisar de um recorte que a lente não
  dá, **falta parâmetro na rota** — a mesma prescrição da Spec 047 §3.1, que a
  Spec 034 já pagou uma vez.
- **Reações no comentário.** Pedida por ela em 10/09 (emoji livre, uma por
  pessoa, notifica o autor). Componente novo, spec própria.
- **Renomear time raiz, reativar pessoa, `slug` editável.** São regra, não
  contexto. Entram com o recorte de permissões.

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **Nenhum destes seis defeitos levanta erro.** Os seis da §3 devolvem a
  resposta de OUTRO time, e o `pytest`/`vitest`/`tsc`/`next build` passam
  verdes em todos. É a mesma classe de defeito que a Spec 046 registrou:
  *"o que estes testes guardam não é erro de execução — é resposta errada"*.
- ⚠️⚠️ **`useSearchParams` em rota estática derruba o `next build`**, e o
  `npm run dev` **não** reclama (`AGENTS.md` §6). **As cinco telas da fatia C
  são estáticas** (`○` no build de 10/09), então as cinco precisam de fronteira
  de `Suspense`. É a armadilha mais provável desta spec, e ela só aparece no
  portão mais lento — depois de a tela já parecer pronta.
- ⚠️ **A regra do time ativo precisa morar em `lib/`.** `app/` está fora do
  `include` do vitest, e o projeto já pagou por isso duas vezes
  (`candidatosParaAdicionar` na Spec 044, `computeLens` na 047).
- **O espelho de colunas de Minhas tarefas não tem guardião visual.** Confundir
  `origem` com `colunaDaTela` produz card na coluna errada, sem erro — o
  comentário no arquivo já nomeia isso, e nenhum teste de corpo pega.
- ⚠️ **A fila filtrada pode ficar VAZIA e parecer quebrada.** Hoje quem tria vê
  tudo; depois da fatia D, um MANAGER do Marketing deixa de ver a fila do
  Comercial. É o comportamento pedido — mas a tela precisa dizer *"a fila do
  Marketing está vazia"*, e não mostrar um vazio sem contexto.
- **A solicitação órfã** (§4.4) não tem teste hoje, e o caminho dela é o que
  menos gente exercita.
  ✅ Na fila, ganhou teste na fatia D. ⚠️ **Criar tarefa a partir dela** segue
  sem resposta com mais de um time raiz — ver §8.

---

## 8. O que falta para encerrar

- **O merge**, depois do #52. Aí a base do #53 troca para `main`.
- ⚠️ **A migration `0024_sai_o_projeto_pessoal`** tem de rodar no deploy de
  produção. O código já não esconde o projeto pessoal; sem ela, os "Pessoal" que
  existirem aparecem para todo mundo.
- **Decisão dela, em aberto:** a tarefa criada a partir de uma solicitação
  ÓRFÃ não tem time para herdar, e com mais de uma raiz o backend recusa
  (`_time_do_quadro_alvo`). É o "adotar a órfã" da §4.4 — perguntar o time na
  tela, ou outra saída.
- **Sem roteiro de smoke formal**: esta spec foi testada pela Camila ao longo do
  caminho, não por roteiro.
