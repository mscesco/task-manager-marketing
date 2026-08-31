# Spec 043 — O formulário de solicitação vira produto

**Status:** aprovada nas decisões (22/08) — fatia A liberada para escrever
**Escopo:** backend (modelo, API, webhook) **e** frontend (formulário público, edição, fila)
**Depende de:** Spec 034 (solicitações), ADR 0009 (papéis), ADR 0035 (visibilidade por time)
**Placar na abertura:** Front **947**, Backend **896**, migrations `0015`
**Fatia A entregue (24/08):** Backend **910**, migrations `0017`

---

## 1. O que JÁ existe — medido em 22/08, abrindo os arquivos

⚠️ **Esta seção vem primeiro de propósito.** A Spec 039 teve **sete de dez
fatias** com escopo escrito a partir do desenho, sem abrir o componente
(§8.1 daquela spec). Aqui o levantamento veio antes de qualquer proposta.

| o que | onde | estado |
|---|---|---|
| formulário declarativo, 11 categorias | `web/lib/solicitacaoForm.ts` (926 linhas) | ✅ existe, **em código** |
| seis tipos de pergunta (`texto`, `textoLongo`, `escolha`, `multi`, `data`, `link`) | idem, `type CampoTipo` | ✅ existe |
| pergunta condicional (`mostrarSe: {campo, igual}`) | idem, `type Campo` | ✅ existe |
| SLA por categoria e "qual campo vira o resumo" (`resumoDe`) | idem, `type Categoria` | ✅ existe |
| respostas guardadas como **JSONB `[{label, value}]`** | `solicitation.answers` | ✅ existe |
| rota pública sem login, com rate limit | `POST /solicitacoes/publico` | ✅ existe |
| triagem com permissão própria | `solicitation.review` | ✅ existe |

**Ou seja: metade do pedido já está construída.** "Seções, tipos de pergunta e
respostas editáveis" descreve um formulário que já é declarativo — o que falta
é ele **morar no banco em vez do código**.

### 1.1. ⚠️⚠️ O achado que decide a fatia 1: a lista de categorias está DUPLICADA

`backend/app/modules/solicitations/domain/solicitation.py` tem um
`CATEGORIES: frozenset` com os 11 slugs, **e o backend valida contra ela**. O
comentário no próprio arquivo diz: *"Devem bater com
web/lib/solicitacaoForm.ts"*.

**Consequência hoje:** acrescentar uma categoria exige **deploy dos dois
lados**, na ordem certa. É exatamente isso que impede o formulário de ser
produto — e é a primeira coisa que esta spec desmonta.

### 1.2. ✅ A decisão mais difícil já está tomada, e está certa

⚠️ **`answers` guarda `{label, value}` — o TEXTO da pergunta, não o id dela.**
Isso parece redundância e é a peça que torna o formulário editável **seguro**:
a solicitação carrega o **retrato** do que foi perguntado no dia. Apagar uma
pergunta amanhã não apaga nem falsifica o que alguém respondeu ontem.

**Nada do histórico precisa de migração**, e nenhuma fatia desta spec pode
"melhorar" isso trocando `label` por `question_id`. Se um dia alguém quiser
relatório agregado por pergunta, acrescenta-se o id **ao lado**, sem tirar o
texto.

---

## 2. O que falta, e o tamanho de cada peça

| pedido da Camila | o que falta de verdade |
|---|---|
| "seções, tipos e respostas editáveis" | tirar a definição do código e pôr no banco + tela de edição |
| "criar novos formulários dentro do time" | ⚠️ **a solicitação não tem `team_id`** — ela pertence ao workspace |
| "atrelar uma tarefa a uma solicitação" | ⚠️ hoje é **texto livre** (`task_ref`), por escolha registrada |
| "resposta automática de alteração de status" | ⚠️⚠️ **não há envio de e-mail em lugar nenhum do projeto**, e o solicitante **não tem login** |

### 2.1. ⚠️ A solicitação não tem time

`Solicitation` tem `workspace_id` e nada de `team_id`. A fila de triagem é do
workspace inteiro, filtrada só por status. Para "cada equipe o seu formulário",
o time entra **pelo formulário** — e é ele que decide quem vê a solicitação na
fila.

### 2.2. ⚠️ `task_ref` é texto livre, e o motivo está escrito

O comentário do modelo: *"link ou identificador da tarefa criada. Texto livre:
a criação é manual, então não há id garantido pra validar contra a tabela
task."* A fatia E troca isso por um vínculo real — e **não apaga** o texto
antigo (§7.E).

### 2.3. ⚠️⚠️ Não existe e-mail neste projeto

Varredura em 22/08: nenhum `smtp`, `sendgrid`, `resend`, `send_mail`. Todas as
notificações são **in-app**, e o solicitante do formulário público **não entra
no app** — é por isso que o formulário coleta nome, e-mail e telefone.

**Decisão da Camila (22/08):** o backend dispara um **webhook para o n8n**, e o
n8n manda o e-mail por uma conta Google que ela já tem. *"Mas essa pode ser a
última parte."*

⚠️⚠️ **E ISSO SERIA A PRIMEIRA CHAMADA HTTP DE SAÍDA DO BACKEND.** Conferido:
não há `httpx`, `requests` nem `aiohttp` em `app/`. O backend só recebe. As
consequências estão na fatia F, e elas não são detalhe: um POST sem timeout
dentro da transação de aprovar **trava a aprovação** quando o n8n cair.

---

## 3. O modelo novo

Três tabelas novas, e dois campos na que existe.

```
solicitation_form         (o formulário)
  id, workspace_id, team_id, slug, title, description,
  is_published, created_by, created_at, updated_at, deleted_at

solicitation_section      (a seção — hoje é a "categoria")
  id, workspace_id, form_id, title, emoji, sla_text,
  summary_question_id, position, deleted_at

solicitation_question     (a pergunta)
  id, workspace_id, section_id, label, kind, required,
  options JSONB, placeholder, help,
  show_if_question_id, show_if_value, position, deleted_at
```

⚠️ **FK COMPOSTA CARREGANDO `workspace_id`**, como toda tabela deste schema. É
a regra que impede uma consulta futura de cruzar tenant sem ninguém notar.

⚠️ **`kind` É `String(20)` COM LISTA NO DOMÍNIO, e não ENUM nativo.** Mesmo
motivo do `notification.type`: o enum do código é a fonte de verdade, e
acrescentar um tipo de pergunta não pode exigir migração. Os seis primeiros
valores são os que o `CampoTipo` já tem.

⚠️ **`deleted_at` EM TODAS AS TRÊS.** Apagar uma pergunta não pode ser
destrutivo — não por causa das respostas (§1.2 já as protege), mas porque
"apaguei sem querer" num formulário público é um estrago que a pessoa descobre
por um solicitante confuso, dias depois.

**Em `solicitation`:**

```
form_id      FK -> solicitation_form   (NULL = solicitação antiga, ver §3.1)
task_id      FK -> task                (NULL = sem tarefa; ver fatia E)
```

### 3.1. ⚠️ As solicitações que já existem

Elas têm `category` (slug em texto) e **não têm** `form_id`. A migração de
dados cria **um formulário — o atual, do time de Marketing** — com as 11 seções
e as perguntas de hoje, e liga as solicitações existentes a ele **pelo slug da
categoria**.

⚠️ **`form_id` NASCE NULLABLE, e continua nullable.** Solicitação de um
formulário que foi apagado depois não pode virar linha órfã inválida — ela é
histórico, e o `answers` dela já se explica sozinho.

---

## 4. Os status crescem

**Decisão da Camila:** acrescentar **"Em andamento"** e **"Concluída"**.

```
hoje:   PENDING --> APPROVED (terminal)
                \-> REJECTED (terminal, exige justificativa)

fica:   PENDING --> APPROVED --> IN_PROGRESS --> DONE
                \-> REJECTED
```

⚠️ **ISSO MEXE NUMA REGRA QUE ERA MÍNIMA DE PROPÓSITO.** O docstring do domínio
diz: *"A máquina de estados é mínima de propósito… Não há 'reabrir': se a
triagem errou, o solicitante reenvia."* A mudança **não** traz reabertura —
`REJECTED` continua terminal e sem volta. O que muda é que `APPROVED` **deixa
de ser terminal**.

⚠️ **`can_review()` PRECISA SER LIDA DE NOVO, e não só estendida.** Hoje ela é
`status == PENDING`, e serve para "pode aprovar/rejeitar". Com quatro estados,
"pode avançar" e "pode aprovar" viram perguntas diferentes. Uma função só com
um nome antigo é como duas regras divergem.

⚠️ **A fila de triagem filtra por status hoje.** Dois estados novos entram nos
filtros da tela e no índice `solicitation(workspace_id, status, created_at)` —
o índice **não** muda (o campo é o mesmo), mas a tela precisa dizer os cinco.

---

## 5. Vincular a tarefa

`solicitation.task_id` FK de verdade, e o botão "Criar tarefa a partir desta
solicitação" pré-preenche título e descrição com o `summary` e as respostas.

⚠️ **O `task_ref` DE TEXTO NÃO É APAGADO.** Ele continua na tabela e continua
aparecendo **quando não há `task_id`** — é o histórico de quem colou um link à
mão. Migrar por adivinhação (tentar casar URL com id) é o tipo de conversão que
erra em silêncio.

⚠️ **E A TAREFA PODE SER APAGADA.** `task_id` precisa de `ON DELETE SET NULL`
ou de leitura tolerante — solicitação apontando para tarefa que sumiu não pode
derrubar a fila. Como a exclusão de tarefa é **soft** (ADR 0005), o caso comum
é "a tarefa existe mas está deletada": a tela mostra "a tarefa vinculada foi
excluída", e não um link quebrado.

---

## 6. As telas

**Decisão da Camila:** os dois caminhos.

- **`/solicitar`** passa a listar os formulários publicados, agrupados por time;
- **`/solicitar/<slug>`** abre um formulário direto, para divulgação.

⚠️ **A LISTA PÚBLICA EXPÕE OS TIMES E O QUE CADA UM FAZ.** É consequência
aceita da escolha, e vale saber: hoje `/solicitar` não revela estrutura interna
nenhuma. `is_published` é o controle — formulário em rascunho não aparece na
lista nem responde pela URL.

**`/solicitacoes`** (a fila) ganha os dois status novos e o vínculo da tarefa.

**Tela nova de edição do formulário** — arrastar seções e perguntas, escolher o
tipo, marcar obrigatório, definir a condicional.

⚠️ **PERMISSÃO NOVA.** `solicitation.review` é "triar", e não serve para
editar formulário — quem responde a fila não é necessariamente quem define o
que se pergunta. Entra `solicitation_form.manage`, em ADMIN e MANAGER (ADR
0009).

---

## 7. Fatias

| # | fatia | entrega | risco |
|---|---|---|---|
| **A** | ✅ modelo + CRUD do formulário | as três tabelas, migração de dados com o formulário de hoje, API de leitura/escrita. **Nada muda na tela** | médio |
| **B** | o público lê do banco | `/solicitar/<slug>` e a lista; `POST /publico` passa a receber `form_id`. ⚠️ **mata o `frozenset` do §1.1** | **alto** |
| **C** | tela de edição | seções, perguntas, tipos, condicional, publicar/despublicar | médio |
| **D** | os status novos | §4, mais os filtros da fila | baixo |
| **E** | vincular tarefa | §5, com o `task_ref` sobrevivendo | baixo |
| **F** | ✅ webhook para o n8n | §8 e §8.1. **Última**, por decisão da Camila | médio |

⚠️ **DUAS FATIAS NASCERAM DA CONVERSA E NÃO ESTAVAM NESTA TABELA:**

| # | fatia | entrega |
|---|---|---|
| **C2-c** | ✅ a fila lê o rótulo do banco | a fila ainda lia `CATEGORIA_POR_SLUG`, estático. Funcionava só porque a 0017 copiou os mesmos slugs — a primeira seção criada pelo editor apareceria como slug cru e "❓" |
| **G** | ✅ cabeçalho editável | título e descrição (que já existiam no banco e a tela ignorava) e os três campos de identificação, que eram fixos e obrigatórios. *"não é todo formulário que chama fazae"* |

⚠️ **A FATIA B É A DE MAIOR RISCO DO LOTE**, e não a C. Ela troca a fonte do
formulário público — a única rota de escrita sem credencial da API — enquanto
ele está no ar sendo usado. Ela precisa de: o formulário migrado conferido
campo a campo contra o `solicitacaoForm.ts`, e um caminho de volta.

---

## 8. O webhook para o n8n (fatia F)

O backend faz `POST` para uma URL de `.env` a cada mudança de status, com
`{solicitation_id, status_anterior, status_novo, requester_*, form, summary}`.

⚠️⚠️ **PRIMEIRA CHAMADA DE SAÍDA DO BACKEND — as quatro regras:**

1. **FORA DA TRANSAÇÃO, e depois do commit.** Dentro dela, um n8n lento segura
   a linha no banco; um n8n fora do ar **desfaz a aprovação**.
2. **`timeout` curto e obrigatório.** Sem timeout, o pedido da pessoa que
   clicou "Aprovar" fica pendurado no tempo de resposta de um serviço externo.
3. **Falha NÃO derruba a operação** — mesmo espírito do `_emit_safely` das
   notificações, que já trata emissão como best-effort e registra no log.
4. **URL ausente = recurso desligado**, e não erro. Ambiente sem `N8N_*`
   configurado (o de teste, por exemplo) não pode falhar por isso.

⚠️ **E O QUE ISSO SIGNIFICA NA PRÁTICA:** o aviso é **best-effort**. Se o n8n
estiver fora do ar naquele minuto, aquele e-mail **não sai e ninguém saberá**.
Se isso for inaceitável, a alternativa é uma fila de reenvio — que é bem maior
que esta fatia, e por isso está em §9.

### 8.1. O contrato, como ficou (27/08)

⚠️⚠️ **A CAMILA MONTOU O FLUXO DO N8N CONTRA ESTES NOMES**, antes de o backend
existir. Os `{{ $json.… }}` dos templates de e-mail apontam para eles — mudar
um campo aqui quebra a mensagem que chega na caixa de alguém, **sem erro
nenhum no meio do caminho**. Há teste (`test_aviso_de_status_db.py`) preso a
este formato exatamente por isso.

`POST` na `N8N_WEBHOOK_URL`, com `X-Webhook-Token`:

```json
{
  "evento": "solicitacao.status_mudou",
  "enviado_em": "<ISO-8601 UTC>",
  "solicitacao": {
    "id": "<uuid>", "protocolo": "ABC12345",
    "status_anterior": "APPROVED", "status_novo": "IN_PROGRESS",
    "status_novo_label": "Em andamento",
    "resumo": "…", "categoria": "foto", "categoria_titulo": "Fotografia",
    "categoria_prazo": "5 dias úteis", "motivo_recusa": null,
    "criada_em": "<ISO-8601>"
  },
  "solicitante": {
    "nome": "…", "email": "…",
    "telefone": null, "area": null, "polo": null
  },
  "formulario": { "slug": "marketing", "titulo": "…", "time": "Marketing" }
}
```

Três garantias que os templates podem assumir, e uma que não:

- **`nome` e `email` nunca são nulos** — é a razão de eles ficarem fora do
  cabeçalho configurável da fatia G.
- **`categoria_titulo` nunca é nulo** — cai no slug cru se a seção sumir.
- **`status_novo_label` vem pronto**, e não é o n8n que traduz: o rótulo é
  decisão do produto, e uma segunda tabela divergiria da tela.
- ⚠️ **`telefone`, `area`, `polo` e `formulario` inteiro PODEM ser nulos** —
  os três primeiros pela fatia G, o último nas solicitações órfãs.

⚠️ **`categoria_prazo` NÃO ESTAVA NO §8 ORIGINAL.** Ele entrou porque a
mensagem de aprovação precisava dizer o prazo que a própria seção promete —
sem ele, ou o e-mail não fala de prazo, ou alguém inventa um.

---

## 9. Fora de escopo, e por quê

- **Fila de reenvio / garantia de entrega do e-mail.** Ver §8. Entra se a perda
  ocasional incomodar de verdade.
- **Página de acompanhamento pelo solicitante.** Foi oferecida e a Camila
  escolheu o e-mail. Se um dia entrar, o e-mail passa a carregar o link.
- **Reabertura de solicitação rejeitada.** Continua não existindo, e continua
  sendo decisão (§4).
- **Relatório por pergunta.** Depende de id na resposta — ver §1.2.
- **Formulário condicional entre seções** (pular a seção X se a Y for "não").
  Hoje o `mostrarSe` é entre campos da mesma seção; nada pede mais que isso.

---

## 10. Decisões da Camila (22/08)

| # | decisão |
|---|---|
| 1 | Aviso por **e-mail de verdade**, disparado por **webhook para o n8n**, com conta Google dela — e é a **última** fatia |
| 2 | Status ganham **"Em andamento"** e **"Concluída"** |
| 3 | **Os dois** caminhos: página que lista os formulários **e** URL por formulário |
| 4 | `solicitation_form.manage` em **ADMIN e MANAGER** |
| 5 | O time do formulário de hoje é o **Marketing**, `b8387155-9688-4e58-b596-8d46906a68dd` |
| 6 | **A fila segue o formulário**, e o time dele — e dá para filtrar por formulário dentro do próprio time |

## 11. As três decisões que destravaram a fatia A (22/08)

### 11.1. Quem edita: **ADMIN e MANAGER**

⚠️ **E "MANAGER" AQUI É ESCOPADO, e não global** — é o que a ADR 0009 já faz
com todo papel que não é `ADMIN`. Um MANAGER de Design não edita o formulário
do Marketing. A alternativa (permissão global para MANAGER) daria a qualquer
gestor o poder de mudar a porta de entrada de outro time, e isso não é o que
"cada equipe cria o seu" quer dizer.

### 11.2. O time do formulário atual

`b8387155-9688-4e58-b596-8d46906a68dd` (Marketing). É o valor que a migração de
dados da fatia A grava no `solicitation_form` que nasce do
`solicitacaoForm.ts`.

⚠️ **UUID CRAVADO EM MIGRATION É DÍVIDA, e vale saber disso na hora de
escrever.** Ele só é válido **neste** banco: um workspace novo, ou um ambiente
recriado do zero, não tem esse time. A migração precisa ser **tolerante** — se
o time não existir, ela **não** cria o formulário e **não** falha; o ambiente
começa sem formulário nenhum, que é o estado correto para um banco vazio.
Migration que estoura em ambiente limpo é migration que ninguém consegue rodar
duas vezes.

### 11.3. A fila segue o FORMULÁRIO

Palavras dela: *"a fila é de acordo com o formulário e o time que a pessoa criou
a solicitação (pois também pode ser de formulários diferentes dentro do próprio
time)"*.

Traduzindo para o modelo — e são **duas** coisas, não uma:

| pergunta | resposta |
|---|---|
| **quem VÊ** a solicitação na fila? | quem alcança o **time do formulário**. O `team_id` não vive na solicitação: ele vem por `solicitation.form_id → solicitation_form.team_id` |
| **como eu separo** dentro do meu time? | filtro por **formulário** na tela da fila — porque um time pode ter vários |

⚠️⚠️ **E ISSO MUDA O `_base_select`, que é a base de tudo.** Hoje a fila filtra
só por `workspace_id`; passa a precisar de um `JOIN` com o formulário para
saber o time, e do filtro de alcance da ADR 0035. **É a mudança mais perigosa
da fatia A** — errar para o lado frouxo mostra a um time a solicitação de
outro, e errar para o lado apertado esconde a fila de quem devia triar.

⚠️ **E AS SOLICITAÇÕES ANTIGAS NÃO PODEM SUMIR NO CAMINHO.** Elas ganham
`form_id` na migração (§3.1) — mas se alguma ficar sem, um `JOIN` interno a
apaga da fila **em silêncio**. O `JOIN` precisa ser `LEFT`, e solicitação sem
formulário continua visível a quem tem `solicitation.review` no workspace.
Este parágrafo é o teste que a fatia A precisa ter.
