# Spec 056 — Base: uma tabela que a equipe monta

**Status:** escrita em 05/10/2026, a partir do pedido dela com o print do Notion
("Calendário geral", da equipe de mídia social) e de três rodadas de perguntas
respondidas em 05 e 06/10 (§4, D1 a D27). **Fatias 0 a H entregues em
07/10** (branch `spec-056/base`). Falta o smoke na tela e, no deploy, o
`curl -N` na VPS e o agendamento da rotina no n8n (`DEPLOY.md`).
**Escopo:** backend (módulo novo, migration, canal ao vivo, verbos novos) e front
(lista de bases, tabela editável, visões, calendário, quadro).
**Placar na abertura:** backend **1883** (medido na fatia 0, em 06/10, sobre a
`main` em `1c58369`). Depois da fatia 0: **2022**. Rebase sobre o #66 (reativar
conta, +25): **2047**. Depois da fatia A: **2054**; front **1581**. Depois da
fatia B: **2081** (drift limpo). Depois da fatia C: **2127**. Depois da fatia D:
**2142** — o backend da spec está completo. Fatia E (primeira do front):
front **1613** (+32), `next build` limpo. Fatia F (visões, quadro,
calendário): front **1640**. Fatia G (ao vivo): backend **2159**, front
**1649**. Fatia H (Ctrl+Z na tela): front **1664**.

---

## 1. De onde vem

Ela, em 05/10, com o print de uma base do Notion: data, plataforma, formato,
título, status, área, objetivo, etiqueta e responsável. Abas no topo ("Todo o
conteúdo", "Calendário", "Por status", "Por plataforma") e um texto fixo acima
da tabela ("Direcional padrão").

> *"gostaria de saber se algo assim é possível fazer e incluir no sistema (…)
> sem essa lente de times nem nada, só inclui a lente de quem pode ver é quem
> está no time principal, igual projeto"*

E, ao pedir esta spec:

> *"destrinchar bem a questão de permissão (…) para permitir um futuro em que
> precise ligar ou desligar permissões específicas e acabar com os papéis"*

É por isso que a §5 é a maior seção. Uma base é a primeira coisa do sistema que
nasce **depois** da Spec 049, e pode nascer do jeito que o resto ainda vai ter
que ficar.

---

## 2. O que existe

- **Campo que a pessoa define, guardado em JSONB:** o formulário de solicitação
  (Spec 025, D10; Spec 043). `solicitation_question.options` é uma lista JSONB, e
  a justificativa da D10 vale aqui inteira: uma coluna no banco por campo seria
  uma migration por ajuste.
- **Permissão como verbo, com escopo:** `permissions.py` (Spec 049, fatia A: um
  verbo por ação) e `ActorPermissions` (Spec 045, fatia C) com `can`, `can_in` e
  `teams_with` (Spec 051, fatia A).
- **Cadeado vindo do servidor, por item:** `can_update` e `can_delete` são
  `computed_field` no schema de projeto e tarefa (Spec 051, fatia A). A tela não
  deduz nada do papel.
- **Matriz HTTP ator × ação**, com o ator `DUAS_ARVORES` (Spec 051, fatia 0).
- **Tipo dos verbos gerado para o front:** `web/lib/permissions.generated.ts`,
  vindo de `ALL_PERMISSIONS`, guardado por um pytest (Spec 049).
- **Rotina diária chamada pelo n8n:** `POST /system/tasks/archive-stale`. Ela
  configura o n8n.
- **Editor de texto rico que guarda Markdown:** a descrição da tarefa (Spec 052).
- **Nada em tempo real.** Toda tela atualiza quando a pessoa age ou recarrega.
  A API roda com **2 workers** (`entrypoint.sh`), atrás do Traefik, **no mesmo
  domínio** do front (`/api`). A CSP de produção libera `ws:` só em
  desenvolvimento (`next.config.mjs`).
- **Os tokens moram no `localStorage`** e vão no cabeçalho `Authorization` (a revisão de
  segurança de 23/09 deixou assim, por decisão dela). Isso pesa na §10.

---

## 3. O que esta spec entrega

1. **Base**: uma tabela que pertence a um time raiz, com colunas que a equipe
   cria, linhas, e um texto livre no topo.
2. **Visões salvas e compartilhadas**: tabela, calendário e quadro, cada uma com
   filtro, ordenação, agrupamento e colunas visíveis.
3. **Edição ao vivo**: quem está com a base aberta vê a mudança do outro sem
   recarregar.
4. **Desfazer (Ctrl+Z)** por um dia para tudo o que se apaga ou se perde.
5. **Permissão inteira em verbos**, inclusive LER, sem nenhuma checagem por
   papel ou por lente (§5).

---

## 4. Decisões dela (05/10)

| | Decisão |
|---|---|
| **D1** | O nome na tela é **Base**. "Planilha" promete fórmula; "Controle" não diz o que é. |
| **D2** | Nasce **zerada**: uma coluna de título, nenhuma linha, uma visão de tabela. |
| **D3** | **Quem cria:** supervisor de algum subtime ou gerente do time raiz em questão. Operador não. No nível da organização (admin e gestor), todos. |
| **D4** | **Quem exclui e restaura:** qualquer um que pode criar. |
| **D5** | Base excluída fica **10 dias** recuperável e depois é apagada de vez. |
| **D6** | A base pertence a **um** time raiz. Quem é daquela árvore vê e edita, igual projeto. |
| **D7** | A linha é **só linha**: não abre página, sem comentário e sem histórico. |
| **D8** | A coluna **Pessoa** oferece todos os membros da árvore. Quem sai aparece como **usuário inativo**. |
| **D9** | Anexo: **só link**. Imagem e arquivo, não. |
| **D10** | **Sem notificação.** |
| **D11** | Edição **ao vivo**. |
| **D12** | Ctrl+Z com conflito: **recusa e avisa** (opção b). Desfazer nunca apaga o trabalho de outra pessoa. |
| **D13** | **Desfazer por 1 dia** vale para linha apagada, opção apagada, coluna apagada e troca de tipo. Depois some. |
| **D14** | **Visões compartilhadas**: quem cria uma visão, cria para todos. |
| **D15** | **Texto livre no topo** da base, com o editor da descrição de tarefa. |
| **D16** | **Sem importação do Notion** nesta spec. |
| **D17** | **Opção apagada:** as linhas que a tinham ficam vazias (com desfazer, D13). |
| **D18** | **Trocar o tipo de uma coluna:** permitido; **zera** os valores (com desfazer, D13). |
| **D19** | **Quem pode criar edita todas as bases** da árvore: nome e texto do topo (`base.update`). O operador não. |
| **D20** | **Supervisor no time raiz não existe** (`team_scope.assert_role_permitido_no_nivel` recusa desde a Spec 045). Se sobrar algum vínculo antigo, ele ganha os verbos pela regra do §5.3, sem tratamento especial. |
| **D21** | **Sem modelo pronto** ao criar: só "Base em branco". |
| **D22** | Na coluna Pessoa, ela deixou o rótulo a meu critério (§7.4). |
| **D23** | **Teto de linhas com paginação quando precisar** (§8.1). |
| **D24** | **Trocar o tipo de coluna é editar coluna** (`base_column.update`), sem verbo próprio: basta estar na árvore, independente do papel. |
| **D25** | **A visão padrão não se apaga**: a base sempre tem pelo menos uma visão de tabela. |
| **D26** | **Excluir base pede para digitar o nome dela.** |
| **D27** | **Tudo se desfaz por 1 dia, inclusive editar célula**, mesmo depois de fechar a aba. A base guarda a **ação** de cada pessoa (com o valor de antes), não cópias dos dados, e o Ctrl+Z roda a ação ao contrário (§9). Ideia dela, em 06/10. |

---

## 5. Permissões

### 5.1. O princípio: verbo, nunca papel e nunca lente

Esta é a regra que a base inteira segue, e é ela que prepara o futuro que ela
pediu:

> **Toda ação na base, inclusive LER, é um verbo. O serviço pergunta
> `can_in(verbo, time_da_base)`. Nenhuma linha de código pergunta qual é o papel
> da pessoa, nem usa a lente (`visible_team_ids`) para decidir.**

Por que isso importa:

- **A lente no lugar do verbo foi a causa comum dos furos da revisão de 16/09**
  (tarefa, comentário, projeto e solicitação). Ela só aparece com pessoa em duas
  árvores, e a matriz não tinha esse ator. Com a base nascendo em verbos, esse
  erro não tem por onde entrar.
- **"Acabar com os papéis" é trocar a ORIGEM dos verbos**, e não os pontos que
  os conferem. Hoje o verbo vem do mapa estático `_ROLE_PERMISSIONS`. Amanhã
  pode vir de uma tabela de concessões por pessoa, ou de "pacotes" editáveis
  que substituem os papéis. Se todo ponto de checagem já pergunta um verbo,
  essa troca muda **um lugar** (`permissions_for_actor`), e nenhum serviço,
  rota ou tela. Se algum ponto perguntar "é gerente?", essa troca vira caça.
- **Por isso mesmo LER é verbo**, embora hoje todo mundo da árvore leia. Ver
  tarefa ainda é decidido pela lente; a base é a primeira que não.

### 5.2. O catálogo de verbos

Um verbo por ação, separando **estrutura** (o que a base é) de **conteúdo** (o
que se escreve nela). A separação é a fronteira mais provável de um futuro
"desligar": deixar alguém preencher linhas sem mexer em coluna.

| Verbo | O que protege |
|---|---|
| `base.read` | Ver a base na lista, abrir, receber o canal ao vivo |
| `base.create` | Criar base |
| `base.update` | Renomear a base e editar o texto do topo (D15) |
| `base.delete` | Excluir a base (vai para os 10 dias, D5) |
| `base.restore` | Restaurar base excluída, e ver a lista das excluídas |
| `base_column.create` | Criar coluna |
| `base_column.update` | Renomear, reordenar, mudar largura, criar e editar **opção**, **trocar o tipo** (D18) |
| `base_column.delete` | Apagar coluna e apagar opção (D17) |
| `base_row.create` | Criar linha |
| `base_row.update` | Editar célula |
| `base_row.delete` | Apagar linha |
| `base_view.create` | Criar visão |
| `base_view.update` | Mudar filtro, ordenação, agrupamento, colunas visíveis e nome de uma visão |
| `base_view.delete` | Apagar visão |

⚠️ **`base.restore` é separado de `base.delete`**, embora hoje caiam nos mesmos
papéis (D4). Restaurar é desfazer um estrago; apagar é fazer um. São as duas
perguntas que um dia podem ter respostas diferentes.

⚠️ **Apagar opção está em `base_column.delete`, e criar opção em
`base_column.update`.** Apagar opção esvazia células (D17), e é isso que a deixa
do lado de "apagar", não o fato de mexer em JSONB.

⚠️ **Trocar o tipo está em `base_column.update`**, embora zere valores (D18,
D24). Se um dia precisar de resposta diferente, vira `base_column.retype`, um
verbo próprio, sem mexer em mais nada.

**Desfazer (§9) não tem verbo próprio:** desfazer uma ação exige o verbo da
ação original, conferido **de novo na hora do desfazer**. Quem perdeu o verbo
entre apagar e desfazer não desfaz.

### 5.3. Onde cada verbo vale: o escopo

A base tem `team_id`, e ele é **sempre um time raiz** (D6). O serviço recusa,
com 422, criar base com `team_id` de subtime.

A regra de escopo que já existe em `permissions_for_actor` resolve D3 e D6
**sem mecanismo novo**:

| Papel | Alcance dos verbos | Inclui a raiz? |
|---|---|---|
| ADMIN / MANAGER (comando) | o time do vínculo + descendentes | sim, o vínculo é na raiz (Spec 024) |
| SUPERVISOR / OPERATOR (execução) | o time do vínculo + a raiz daquela árvore | **sim** |
| ADMIN / GESTOR de organização | todos, sem escopo | sim |

Então, para uma base da raiz R:
- `can_in("base.create", R)` é verdadeiro para o supervisor de **qualquer**
  subtime de R, que é exatamente a D3.
- `can_in("base_row.update", R)` é verdadeiro para o operador de qualquer
  subtime de R, que é a D6 ("quem está no time principal").

⚠️⚠️ **NENHUM verbo de base entra em `_OWN_TEAM_ONLY`.** Se entrar, o supervisor
e o operador passam a ter o verbo só no próprio subtime, e a base mora na raiz:
eles perdem tudo, inclusive ler. Um teste guarda isso (§13, fatia A).

⚠️ **Pessoa em duas árvores** (Marketing e Comercial): vê as bases das duas
raízes, e em cada uma tem os verbos que o papel **naquela** árvore lhe dá. Ao
criar, escolhe a raiz (só aparecem as raízes em que tem `base.create`, de
`teams_with`).

### 5.4. A matriz de hoje: papel × verbo

| Verbo | ADMIN org | GESTOR org | MANAGER | SUPERVISOR | OPERATOR |
|---|:-:|:-:|:-:|:-:|:-:|
| `base.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `base.create` | ✓ | ✓ | ✓ | ✓ | · |
| `base.update` | ✓ | ✓ | ✓ | ✓ | · |
| `base.delete` | ✓ | ✓ | ✓ | ✓ | · |
| `base.restore` | ✓ | ✓ | ✓ | ✓ | · |
| `base_column.*` (3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `base_row.*` (3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `base_view.*` (3) | ✓ | ✓ | ✓ | ✓ | ✓ |

- **`base.update` com o grupo de criar** (D19): o nome e o texto do topo são a
  orientação da base ("Direcional padrão"), e quem orienta é quem coordena.
  Vale para **todas** as bases da árvore, não só as que a pessoa criou: não
  existe "dono" de base.
- **Colunas, linhas e visões para todos** vem do pedido: *"permissão pra mexer
  também, todo mundo pode mexer"*.

⚠️ **O GESTOR APAGA BASE, e isso é exceção à regra da Spec 049, fatia D** ("a
diferença entre ADMIN e GESTOR é o delete"). A exceção é dela (D3: *"na
permissão de organização todos podem"*) e vai escrita no comentário do mapa,
como as outras duas exceções (apagar tarefa e desativar pessoa). Como o GESTOR é
**lista explícita** desde a fatia C da 049, cada verbo de base precisa ser
escrito nele um a um. O teste `test_gestor_opera_mas_nao_desfaz_a_organizacao`
vai cair com `base.delete` e precisa da exceção registrada, não de ser
afrouxado.

### 5.5. Listas: `teams_with`, não lente

`GET /bases` lista as bases cujo `team_id` está em `teams_with("base.read")`
(`None` = todas, para a organização). A lista de bases excluídas usa
`teams_with("base.restore")`. Nenhuma das duas usa `visible_team_ids`.

### 5.6. Cadeados por item, vindos do servidor

Cada base devolvida pela API traz o que **aquela pessoa** pode **naquela base**:

```
can_update, can_delete,
can_create_column, can_update_column, can_delete_column,
can_create_row, can_update_row, can_delete_row,
can_create_view, can_update_view, can_delete_view
```

São `computed_field` lendo `current_tenant()`, como em projeto e tarefa. E
`GET /teams` ganha `can_create_base` por time, como já tem `can_create_project`.

⚠️ **A tela nunca deduz de papel e nunca deduz de `/auth/me`.** Hoje todo mundo
pode editar célula, e seria tentador o front simplesmente mostrar tudo. Se fizer
isso, no dia em que um verbo for desligado para alguém, a tela continua
oferecendo o botão e o servidor recusa. É o defeito que a memória da Spec 044
registrou ("um botão que a tela oferece e o servidor recusa").

### 5.7. O canal ao vivo também obedece

- **Abrir o canal** de uma base exige `base.read` naquela base.
- **Quem perde o verbo com o canal aberto** (saiu do time, conta desativada,
  papel trocado) tem o canal fechado. O servidor confere de novo o verbo a cada
  **60 segundos** e em todo evento de vínculo daquela pessoa (§10.4).
- Os eventos não carregam nada que a pessoa não poderia ler pela rota normal.

### 5.8. A matriz HTTP

A matriz ganha uma linha por rota da base, com os cinco papéis, o ator
`DUAS_ARVORES` e dois alvos: base da raiz do ator e base da **outra** raiz. A
segunda dá **404** em toda rota, inclusive leitura: base de outra árvore não
existe para quem não tem `base.read` nela, e nunca 403, que confirmaria que ela
existe.

### 5.9. O que fica pronto para o fim dos papéis, e o que falta

**Fica pronto com esta spec:**
- 14 verbos, nenhum ponto de checagem por papel ou por lente;
- cadeados por item vindos do servidor;
- matriz HTTP por verbo.

**Falta, e não é desta spec** (seria a spec de "concessões"):
- uma tabela de concessão (pessoa ou grupo × verbo × time) lida por
  `permissions_for_actor` junto do mapa;
- a tela para ligar e desligar;
- os papéis virarem "pacotes padrão" editáveis.

Nenhuma dessas três mexe em código da base.

---

## 6. O modelo de dados

Migration `0029`. Módulo novo `app/modules/bases`. Rotas em inglês
(`/bases/...`); tela em `/bases` e `/bases/[id]`.

| Tabela | Campos principais |
|---|---|
| `base` | `id`, `workspace_id`, `team_id` (raiz), `name`, `description` (Markdown, D15), `created_by`, `created_at`, `updated_at`, `deleted_at`, `deleted_by` |
| `base_column` | `id`, `base_id`, `name`, `type`, `options` (JSONB), `position`, `width`, `version`, `deleted_at`, `deleted_by` |
| `base_row` | `id`, `base_id`, `values` (JSONB: id da coluna → valor), `version`, `created_by`, `created_at`, `updated_at`, `deleted_at`, `deleted_by` |
| `base_view` | `id`, `base_id`, `name`, `layout` (`table`/`calendar`/`board`), `config` (JSONB), `position`, `is_default` (a visão com que a base nasce, e a que não se apaga: D25; uma por base, por índice único parcial) |
| `base_change` | `id`, `base_id`, `actor_id`, `kind`, `payload` (JSONB), `created_at`, `undone_at` — o diário de ações: o que cada pessoa fez, com o valor de antes (§9). Índice em (`base_id`, `actor_id`, `created_at`) |

- **`values` guarda pelo id da coluna, nunca pelo nome.** Renomear coluna não
  toca linha nenhuma.
- **Editar uma célula grava só aquela chave** (`values || {col: valor}`), nunca
  a linha inteira. Duas pessoas editando células diferentes da mesma linha não
  se atropelam. Na mesma célula, vale a última gravação, e o ao vivo mostra
  para as duas.
- **`version`** sobe a cada gravação, em linha e coluna. É o que a regra de
  conflito do desfazer lê (§9).
- **Opção** é `{id, label, color, deleted_at}` dentro de `options`. A célula
  guarda o **id** da opção. Renomear opção não toca linha.

---

## 7. Colunas

### 7.1. Os tipos

| Tipo | Valor guardado | Observação |
|---|---|---|
| `title` | texto | Uma por base, a primeira; não se apaga nem troca de tipo |
| `text` | texto | Uma linha; quebra na exibição |
| `number` | número | |
| `date` | `AAAA-MM-DD` | Só data, sem hora (o print não usa hora) |
| `select` | id de opção | |
| `multi_select` | lista de ids de opção | |
| `person` | lista de ids de usuário | D8 |
| `link` | URL | D9; só `http`/`https`, como os links da Spec 052 |
| `checkbox` | verdadeiro/falso | |

Lista fechada. Tipo novo é decisão de spec, não configuração.

### 7.2. Opção apagada (D17)

Apagar uma opção **marca** `deleted_at` nela. As células continuam guardando o
id, mas a tela mostra vazio, e filtro trata como vazio. O desfazer tira a
marca, e tudo reaparece. A rotina diária (§11) remove de vez a opção e o id das
células depois de 1 dia.

### 7.3. Trocar o tipo (D18)

Os valores da coluna vão para o `payload` do `base_change` e as células ficam
vazias. A coluna ganha o tipo novo, sem opções. O desfazer devolve tipo, opções
e valores.

### 7.4. Pessoa (D8)

A lista oferece os membros **ativos** da árvore da base (raiz e subtimes). A
célula de quem não está mais disponível continua mostrando o **nome**, com um
rótulo que diz o motivo (D22):

- conta desativada: **"Nome (inativo)"**;
- conta ativa, mas fora da árvore: **"Nome (fora do time)"**.

Chamar de inativo quem só trocou de time seria mentir. E manter o nome
preserva a informação de quem fez aquele post. Nenhuma das duas aparece mais
na lista para escolher.

---

## 8. Visões (D14)

`config` de uma visão:

- `filters`: lista de `{column_id, operator, value}`, combinados com E;
- `sorts`: lista de `{column_id, direction}`;
- `group_by`: id de uma coluna `select` (o quadro precisa dele para desenhar);
- `date_column`: id de uma coluna `date` (o calendário precisa dele);

⚠️ Os dois **não são obrigatórios ao criar** (fatia C): a visão nasce pelo
"+ Visão", e a pessoa escolhe a coluna em seguida. Sem ela, a tela pede a
escolha em vez de desenhar.
- `hidden_columns` e `column_order`.

- **Tabela:** a edição acontece aqui.
- **Calendário:** mês, com a linha no dia da `date_column`. Linhas sem data numa
  lista ao lado. Arrastar para outro dia edita a célula de data.
- **Quadro:** uma coluna por opção do `group_by`, mais "Sem valor". Arrastar
  entre colunas edita a célula.

### 8.1. Onde filtrar e ordenar, e o teto (D23)

⚠️ **Paginar e filtrar no navegador não combinam.** Se a tela recebe só 100
linhas por vez, o filtro "Status = Publicado" só enxerga essas 100. Paginação
de verdade exige que o **servidor** filtre e ordene, e ordenar JSONB por tipo
(data como data, número como número) é o ponto mais caro desta spec.

**A medida:** o print mostra uns 12 posts em 5 dias, perto de **900 linhas por
ano**. Uma base com o calendário da equipe leva anos para chegar a 5.000.

**Por isso, nesta spec:**
- a base é carregada **inteira**, e filtro e ordenação acontecem no navegador
  (milissegundos nesse volume, e o ao vivo fica simples: o evento chega e a tela
  reordena sozinha);
- **teto de 5.000 linhas** por base. A partir de **4.000**, quem tem `base.update`
  vê um aviso na base. No teto, criar linha é recusado com uma mensagem que
  explica;
- quando alguma base se aproximar do teto, **o filtro passa para o servidor, com
  paginação**, numa spec própria. **Nada do banco muda** nessa troca (os
  índices entram nela). Muda a rota de leitura e o jeito de a tela pedir as
  linhas.

O aviso dos 4.000 é o gatilho dessa spec: ele chega com mais de um ano de
folga no ritmo de hoje.

---

## 9. Desfazer: o diário de ações (D12, D13, D27)

### 9.1. A ideia

A base não guarda cópias de si mesma. Ela guarda **o que cada pessoa fez**, com
o mínimo para fazer o contrário, e o Ctrl+Z roda o contrário. A ideia é dela
(06/10), e é o desenho dos editores em geral.

⚠️ **"O contrário" precisa do valor de antes.** A ação "Status virou Cancelado"
não sabe voltar sozinha: o contrário dela é "Status virou **Publicado**". Por
isso cada entrada guarda **antes e depois de cada célula que mudou**, e só isso.

Exemplo de entrada:

> Camila, 14:32, linha *Collab Will Domênico*, coluna Status: **de** Publicado
> **para** Cancelado

**Tamanho:** dezenas de bytes por edição. Mil edições por dia dão perto de
100 KB, e a rotina diária (§11) apaga tudo o que passou de 1 dia.

### 9.2. O que cada ação guarda, e o que o Ctrl+Z faz

| Ação (`kind`) | O `payload` guarda | O Ctrl+Z faz |
|---|---|---|
| `cell.update` | por célula: linha, coluna, valor antigo, valor novo | volta o valor antigo |
| `row.create` | o id da linha | apaga a linha (marca, como em `row.delete`) |
| `row.delete` | o id (a linha fica marcada, §6) | tira a marca |
| `column.create` | o id da coluna | apaga a coluna (marca) |
| `column.update` | campos antigos e novos (nome, largura, posição) | volta os campos |
| `column.delete` | o id (a coluna fica marcada) | tira a marca |
| ~~`option.create` / `option.update`~~ | cabem em `column.update`: as opções inteiras vão no antes e depois da coluna (fatia C) | volta a coluna |
| `option.delete` | o id (a opção fica marcada) | tira a marca |
| `column.retype` | tipo e opções antigos + os valores antigos da coluna | devolve tipo, opções e valores |
| `view.*` | a configuração antes e depois | volta a configuração |

- **Colar várias células, ou arrastar um card no quadro** que muda mais de uma
  célula, é **uma** entrada com várias células. Um Ctrl+Z desfaz o grupo
  inteiro.
- **Editar célula grava ao confirmar** (Enter, Tab ou sair da célula), não a
  cada tecla. Digitar "Collab Will" é uma entrada só.
- **`column.retype` é o único que guarda volume**, e não tem outro jeito: o
  contrário de "zerar tudo" precisa saber o que havia.
- **Refazer** (Ctrl+Shift+Z ou Ctrl+Y) roda a ação de novo, com a mesma regra
  de conflito, enquanto a pessoa não fizer nada novo depois de desfazer.

A base excluída é outro caso: **10 dias** (D5), por **restaurar** na lista de
excluídas, e não por Ctrl+Z.

### 9.3. A regra de conflito (D12)

Antes de desfazer, o servidor confere se o que está lá **ainda é o que a
pessoa deixou**:

- `cell.update`: cada célula do grupo ainda tem o "valor novo" registrado. Se
  **uma** não tiver (alguém mudou depois), o grupo inteiro é recusado. Desfazer
  metade de uma colagem seria pior do que não desfazer.
- `column.retype`: todas as células da coluna continuam vazias.
- `column.update`, `option.update`, `view.*`: os campos ainda têm o "depois"
  registrado.
- Marcas (`*.delete`): a coisa continua marcada, e a base continua existindo.

Recusou: a tela avisa *"Não dá para desfazer: alguém mudou isso depois."* O
servidor nunca sobrescreve, e a entrada sai da pilha da pessoa (o próximo
Ctrl+Z tenta a anterior).

⚠️ **Conflito não é erro HTTP** (decidido na fatia C). Tirar a entrada da pilha
é uma gravação; com 409 a transação voltaria e a entrada ficaria lá, recusando
para sempre. A resposta é **200** com `{"applied": false, "conflict": true}`.
Sem o verbo da ação original é 403, e aí a entrada **fica**: devolvido o verbo,
ela volta a servir.

### 9.4. De quem é o Ctrl+Z

- **Cada pessoa desfaz o que ela mesma fez**, do mais recente para trás. O
  Ctrl+Z da Ana não desfaz o que o Bruno apagou.
- **A pilha mora no servidor**: sobrevive a recarregar, fechar a aba e trocar de
  computador, por 1 dia (D27).
- **Desfazer exige o verbo da ação original**, conferido de novo na hora (§5.2).
- **Ctrl+Z dentro de um campo de texto desfaz o texto**, não a base. A pilha da
  base só responde com o foco fora de um campo.
- **A pilha é por base.** Ctrl+Z na base A não desfaz o que a pessoa fez na B.

### 9.5. Rotas

- `POST /bases/{id}/undo`: desfaz a entrada mais recente da pessoa naquela
  base que ainda não foi desfeita.
- `POST /bases/{id}/redo`: refaz a última desfeita.
- As duas devolvem o que mudou, e o canal ao vivo (§10) avisa os outros como
  qualquer gravação.

⚠️ **Desfazer também é uma gravação**, com `version` e evento ao vivo. Ele não
vira uma entrada nova no diário: marca `undone_at` na entrada original, e o
refazer limpa a marca.

---

## 10. Ao vivo (D11)

### 10.1. O canal

**Server-Sent Events** (`GET /bases/{id}/events`), e não WebSocket:
- o servidor só precisa **avisar**; as gravações continuam sendo as rotas HTTP
  normais, com as mesmas checagens de verbo;
- é HTTP comum, no mesmo domínio e atrás do mesmo Traefik: a CSP de produção
  já permite (`connect-src 'self'`), e não precisa liberar `wss:`.

⚠️ **O token não pode ir na URL**, e o `EventSource` do navegador não manda
cabeçalho. O front abre o canal com `fetch` e lê o corpo em fluxo, levando o
`Authorization` como toda outra chamada.

### 10.2. Entre os dois workers

A API roda com 2 workers: a gravação pode cair num e a pessoa estar ouvindo no
outro. O aviso passa pelo **`LISTEN/NOTIFY` do próprio Postgres**: quem grava
faz `NOTIFY`, e cada worker repassa às conexões abertas. Sem Redis, sem serviço
novo.

### 10.3. O evento

~~`{kind, entity, id, version, actor_id, data}`, com `data` = o estado novo.~~

⚠️ **Mudou na fatia G (07/10): o aviso é só `{base_id, kind, actor_id}`, e
quem recebe RECARREGA a base.** O `NOTIFY` do Postgres tem teto de 8.000 bytes
por mensagem, e uma célula de texto pode ter 5.000 caracteres: mandar o estado
novo exigiria um segundo caminho para o que não cabe. Recarregar é um caminho
só, e nunca fica pela metade. Vários avisos seguidos viram uma recarga (300
ms). Quem gravou ignora o próprio eco pelo `actor_id`.

⚠️ **E o canal dura 60 s e se fecha (`event: end`); o front reabre.** Cada
reabertura passa de novo por `base.read` no time da base -- é a "releitura do
verbo a cada 60 s" do §5.7, sem um laço dentro do servidor. E o token que
vence também não reabre: a recarga que acompanha a reabertura passa pelo
`api()`, que renova o token.

### 10.4. Reconexão e queda

- Caiu a conexão: reconecta com espera crescente e **recarrega a base inteira**
  ao voltar. Sem tentar remendar eventos perdidos.
- Base excluída com gente dentro: chega o evento, a tela mostra *"Esta base foi
  excluída"* com o botão de restaurar para quem tem o verbo.
- Releitura do verbo a cada 60 s e em mudança de vínculo (§5.7).

### 10.5. Deploy

O Traefik não bufferiza por padrão, mas a fatia confere na VPS com `curl -N`
antes de considerar entregue. Conexões abertas ocupam um slot do worker
assíncrono, não uma thread: algumas dezenas de pessoas é folgado.

---

## 11. A rotina diária

`POST /system/bases/purge`, no mesmo desenho do `archive-stale`:
- apaga de vez bases excluídas há mais de 10 dias;
- apaga de vez linhas, colunas e opções marcadas há mais de 1 dia, e tira das
  células os ids de opção e de coluna que sumiram;
- apaga o `base_change` com mais de 1 dia.

⚠️ **Precisa de um passo dela no n8n**: agendar a chamada, como já faz com o
arquivamento. Sem isso, nada se perde, mas nada se apaga de vez.

---

## 12. A tela

- **Menu lateral:** "Bases", com a lista das bases que a pessoa lê, agrupadas
  por raiz quando ela está em mais de uma.
- **Cabeçalho da base:** nome, texto do topo (D15), abas das visões e o botão
  "+ Visão".
- **Tabela:** primeira coluna (título) fixa na rolagem horizontal; edição na
  célula; criar opção digitando; "+ Nova linha" no fim; "+" no fim das colunas.
- **Teclado** (`web/AGENTS.md`): setas entre células, Enter edita, Esc cancela,
  Tab vai para a próxima. A tabela tem papel de grade (`role="grid"`) e cada
  célula diz a coluna ao leitor de tela.
- **Cor de opção** de uma paleta fixa, com tokens para claro e escuro, e sempre
  com o texto (nunca só cor).
- **Celular:** a tabela rola na horizontal dentro do próprio quadro; o resto da
  página não rola de lado.

---

## 13. Fatias

| Fatia | O quê | Portões extras |
|---|---|---|
| **0** | Mede a suíte. Matriz HTTP com as linhas da base marcadas `pendente` (todas as rotas, 5 papéis + `DUAS_ARVORES`, raiz própria e outra raiz) | matriz |
| **A** | Os 14 verbos no mapa (com a exceção do GESTOR comentada), `permissions.generated.ts`, teste de que nenhum verbo de base está em `_OWN_TEAM_ONLY` | pytest do gerado |
| **B** | Migration `0029`, modelos, `base` e `base_column` (CRUD, opções, troca de tipo), cadeados por item, `can_create_base` em `GET /teams` | matriz |
| **C** | `base_row` (CRUD, gravação por chave, teto de 5.000 com `row_count` na base), `base_view`, `base_change` gravado em TODA ação (§9.2), `undo`/`redo` com a regra de conflito | matriz, teste por `kind` |
| **D** | Lixeira de bases (10 dias), `POST /system/bases/purge` | — |
| **E** | Front: menu, lista de bases, criar e excluir, a tabela editável (sem ao vivo: atualiza a cada 10 s), o aviso dos 4.000 | `next build` |
| **F** | Front: visões, filtro, ordenação, colunas visíveis; calendário; quadro | `next build` |
| **G** | Ao vivo: SSE, `LISTEN/NOTIFY`, releitura do verbo, reconexão; o front troca a atualização de 10 s pelo canal | `next build`, `curl -N` na VPS |
| **H** | Ctrl+Z na tela (pilha por pessoa, campo de texto fora) e os avisos de conflito | `next build` |

A fatia E já deixa a equipe usar. A G é a mais cara e a única com risco de
deploy, e por isso vai depois da tabela pronta.

Deploy: migration `0029` **antes** do código, como nas 053 e 054.

---

## 14. Fora do escopo

- Importar do Notion e exportar CSV (D16).
- Fórmula, soma, relação entre bases, rollup.
- Linha que abre como página, comentário em linha, histórico de linha (D7).
- Notificação de qualquer tipo (D10).
- Imagem e arquivo em célula (D9).
- Ordem manual de linhas (arrastar para reordenar na tabela).
- Modelo pronto ao criar (D21).
- Filtro no servidor e paginação: spec própria, quando o aviso dos 4.000
  aparecer (§8.1).
- Ligar e desligar verbos por pessoa (§5.9).
- Base fora de time raiz, ou base de subtime.

---

## 15. Propostas que nenhuma pergunta cobriu

**Todas respondidas** em 05 e 06/10 (D19 a D27). A proposta 7 (desfazer edição
de célula só com a aba aberta) **caiu**: no lugar dela entrou o diário de ações
da §9, ideia dela.
