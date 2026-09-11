# Spec 048 — O time como contexto

**Status:** escrita em 10/09/2026, decidida com a Camila na mesma conversa.
Decisões tomadas — a última (§4.1, a forma da URL) confirmada por ela em
11/09: *"pode ser como recomenda"*. **Fatias A e B entregues em 11/09.**
**Escopo:** frontend, mais **duas** mudanças de backend (§5, fatias D e E).
**Depende de:** **Spec 046 fatia 4** (a área na URL do quadro, e o `area_id`
obrigatório em `default_board_and_column_for_status`) e **Spec 047** (o seletor
de contexto no rodapé, e o `currentContext` que resolve o time pela URL).
**Placar na abertura:** backend **1103**, front **1249**, `tsc --noEmit` limpo,
`next build` ok — medido em 10/09 no branch `spec-047`.
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

**Fatia C — as telas recortam (front).**
Projetos, Arquivadas, Solicitações e Formulários passam a ler o time ativo e a
filtrar. Minhas tarefas ganha os dois seletores da §4.3, e
`quadroGeralComIndice` passa a receber o time (defeito 3.3).
⚠️ E as duas escritas do 3.4 param de cair em `getRootTeamId()` — o time ativo
substitui o palpite, como já aconteceu no `createProject`.

**Fatia D — a fila é do time (backend).**
`list_batches` e as duas contagens (`count_pending`,
`count_approved_without_task`) passam a receber o time e a filtrar por
`form.team_id`. Papel de organização continua vendo tudo, e as órfãs seguem a
§4.4.
⚠️ **Sem parâmetro default**, pelo mesmo motivo que a Spec 046 fatia 4 usou em
`default_board_and_column_for_status`: um `team_id: uuid.UUID | None = None`
deixaria todo chamador existente compilando e errado em silêncio.

**Fatia E — a listagem de formulários é do time (backend).**
Mesmo desenho, no `form_router` e no serviço.

---

## 6. O que esta spec deliberadamente NÃO faz

- **O dashboard de entrada.** Pedido dela na mesma conversa, e adiado por
  dependência: ele é por time. Spec própria, depois desta.
- **O recorte de permissões** (`*.manage` → verbos separados). Documentado em
  `~/Documents/gestor-de-tarefas-permissoes.html`, e **decidido para depois**
  desta spec, com motivo: o recorte não encosta na camada de escopo que esta
  spec mexe, e é mudança larga — melhor sobre base verde e já entregue.
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
