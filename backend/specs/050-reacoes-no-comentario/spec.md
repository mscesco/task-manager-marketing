# Spec 050 — Reações no comentário

**Status:** escrita em 15/09/2026, a partir do item 10 do documento de 10/09
(`~/Documents/gestor-de-tarefas-permissoes.html`, passo 4) e das respostas dela
na mesma data. **As três perguntas de desenho foram respondidas em 15/09**
(§8). A quarta — a fonte do seletor — foi respondida no mesmo dia: catálogo
próprio, gerado do `emojibase-data`.
**Fatias A, B e C entregues em 15/09 — a spec está completa.**
**Escopo:** backend (tabela, rotas, contagem na listagem, notificação) e front
(botão de reagir, seletor, fileira de reações). Nenhuma tela nova — tudo mora
no comentário do detalhe da tarefa.
**Depende de:** Spec 049 mergeada (#55). Não usa nada dela: reagir não é
permissão (§4.1).
**Placar na abertura:** backend **1504**, front **1367**, `tsc --noEmit` limpo,
`next build` ok — medido em 15/09 na fatia H da 049, que é a árvore de `main`.

---

## 1. O que ela pediu

O documento de 10/09 descreve o item assim:

> *"Componente novo, e a primeira coisa neste produto em que quem vê pode
> escrever sem ter permissão de nada. Emoji livre, uma por pessoa por
> comentário, trocável, contagem agregada, notifica o autor."*

Em 15/09, respondendo às perguntas abertas:

- **notificação:** *"a notificação é a cada reação"*;
- **quem reagiu:** *"dá pra ver quem reagiu"*;
- **comentário apagado:** *"as reações são apagadas junto"*;
- **reagir ao próprio:** *"não notifica se reagir ao proprio comentario"*;
- **o gesto, no modelo do WhatsApp:** *"quando voce passa o mouse pelo
  comentário aparece uma bolinha ao lado que clica e aparece o seletor de
  reações, recomendando o joia e o coração em primeiro, mas aparecendo os
  outros"*.

E, sobre as três perguntas da primeira versão desta spec:

1. *"apagar igual o comentário uai"* — §4.6;
2. *"livre"* — §4.3;
3. *"não"* (trocar de emoji não notifica de novo) — §4.5.

---

## 2. O que existe hoje (lido no código em 15/09)

- **Nada de reação.** Nem tabela, nem rota, nem tela. A busca por `reaction`
  no código não acha nada.
- **Comentário** — `Comment` em `app/db/models/collaboration.py`: soft-delete
  (`SoftDeleteMixin`), réplica de um nível (`parent_comment_id`), e
  `UNIQUE (id, workspace_id)` já existe (`uq_comment_id_workspace`), então a FK
  composta da tabela nova tem onde se apoiar.
- **Rotas** — `app/modules/tasks/api/comment_router.py`, sob
  `/tasks/{task_id}/comments`. ⚠️ **Nenhuma usa `require_permission`**, de
  propósito: *"quem vê, comenta"*, e a alçada mora no `CommentService`. É o
  mesmo desenho do seguidor (`collaboration_router.py`, ADR 0011).
- **Listagem** — `CommentRepository.list_for_task` devolve ativos **e** os
  apagados que têm réplica ativa (o *tombstone*, D5 da 019).
- **Apagar comentário** tem **dois caminhos**, e os dois são soft-delete:
  1. `CommentService.delete_comment` — o autor ou quem modera;
  2. `CommentRepository.soft_delete_for_task_subtree` — **SQL cru**, quando a
     tarefa é apagada (cascata da ADR 0005). ⚠️ Não passa pelo serviço.
- ⚠️ **E há um caminho de VOLTA:** `backend/scripts/restaurar_quadro.sql` (passo
  2a) faz `UPDATE comment SET deleted_at = NULL` nos comentários que sumiram
  junto com o quadro.
- **Notificação** — `NotificationEmitter` (`app/modules/notifications/
  application/notification_emitter.py`) é o ponto único de emissão: um método
  por tipo, best-effort num savepoint, payload com snapshot de exibição. `type`
  é `String(40)`, então **tipo novo não precisa de migration**.
  O sino (`web/components/NotificationBell.tsx`) monta o texto por tipo e cai
  em *"Atualização em…"* para tipo desconhecido; o destino
  (`lib/notificacoes.ts`) é `/tarefa/<id>` para qualquer tipo com tarefa.
- **Seletor de emoji** — `web/components/EmojiPicker.tsx`: grade de 84 emojis
  curados, sem dependência, **só insere no texto**.
- **O comentário na tela** — `LinhaComentario` dentro de `TaskDetail.tsx`
  (~linha 2923): avatar, nome, hora, "(editado)", lápis e lixeira à direita.
  `temAcao = !c.is_deleted && me != null` já decide se há ação.
- **Nenhuma biblioteca de emoji** no backend (`pyproject.toml`) nem no front
  (`package.json`).

---

## 3. O que a spec entrega

Uma pessoa que vê a tarefa passa o mouse num comentário, clica na bolinha,
escolhe um emoji — qualquer um. Embaixo do comentário aparece a fileira de
reações (`👍 3  ❤️ 1`), com a dela marcada. Passar o mouse numa reação mostra
quem reagiu. Clicar de novo no próprio emoji tira. O autor do comentário recebe
uma notificação quando alguém reage — menos quando reage ao próprio.

---

## 4. Decisões

### 4.1. Reagir não é permissão

Mesmo desenho do comentar: **quem vê a tarefa, reage**. A rota não leva
`require_permission`; o serviço carrega a tarefa com `assert_visible` (404 para
quem não vê — não vaza que existe) e o comentário com `_load_active`.

⚠️ **Nenhum verbo entra no mapa da 049**, e isso é decisão, não esquecimento: o
documento de 10/09 chama isto de *"a primeira coisa em que quem vê pode
escrever sem ter permissão de nada"*. Um verbo `comment.react` seria concedido
a todos os papéis e não recusaria ninguém — permissão que não separa é ruído no
mapa que a 049 acabou de limpar.

**Reage-se em qualquer comentário ativo**, de topo ou réplica. **Não** se reage
em comentário apagado (o tombstone não tem botão, como já não tem lápis).

### 4.2. Uma reação por pessoa por comentário — no banco

`UNIQUE (comment_id, user_id)`. Reagir de novo **troca** o emoji; não soma.

⚠️ **A regra mora no banco, e não só no serviço.** Dois cliques rápidos são duas
requisições; um `SELECT` seguido de `INSERT` no serviço deixaria as duas
passarem. A escrita é um `INSERT … ON CONFLICT (comment_id, user_id) DO UPDATE
SET emoji = …` — uma operação, sem janela.

### 4.3. Emoji livre — decisão dela, 15/09

**Qualquer emoji**, e só emoji. O servidor recusa com 422 o que não for
exatamente **um** emoji: texto, dois emojis, espaço em volta.

**A validação usa a biblioteca `emoji` (2.15.0)**, e não uma regra escrita à
mão. Medido num container em 15/09:

| entrada | aceita? |
|---|---|
| `👍` `❤️` `👍🏽` `👨‍👩‍👧` `🇧🇷` `#️⃣` | sim |
| `a` `1` `👍👍` `" 👍"` `😀x` | não |

Reconhecer emoji à mão não tem regra simples: 👍🏽 é emoji + tom de pele,
👨‍👩‍👧 são cinco code points colados por ZWJ, 🇧🇷 são duas letras regionais.
Uma faixa de Unicode escrita aqui aceitaria lixo ou recusaria emoji de verdade.

⚠️⚠️ **A biblioteca vai em `dependencies`, e NÃO em `dev`.** É a lição do
`httpx` escrita no próprio `pyproject.toml`: a imagem de produção roda `pip
install .`, sem o extra, e um import que só existe no `dev` derruba a API no
deploy com os cinco portões verdes. O sexto portão (a imagem importa?) é quem
pega — conferir no CI da fatia A.

⚠️ **Normalizar antes de gravar.** A mesma medição mostrou que `❤` (sem o
seletor de variação U+FE0F) **também** é aceito. Sem normalizar, `❤` e `❤️`
virariam duas pílulas diferentes para o mesmo coração — e qual das duas cada
pessoa manda depende do teclado dela. O servidor grava sempre a forma
*fully-qualified*.

**O que a lista livre muda no seletor** está na §4.7 e na pergunta 4 da §8.

### 4.4. A contagem vem na listagem, agregada no backend

`CommentResponse` ganha `reactions`:

```json
"reactions": [
  {"emoji": "👍", "user_ids": ["…", "…", "…"]},
  {"emoji": "❤️", "user_ids": ["…"]}
]
```

- **`user_ids`, e não só a contagem:** ela pediu para ver quem reagiu, e a
  `LinhaComentario` já tem o mapa `members` para trocar id por nome. A contagem
  é `user_ids.length`; "eu reagi" é `user_ids.includes(me.id)`. Nada disso
  precisa de campo próprio.
- **Ordem:** pela reação mais antiga com cada emoji (o emoji que chegou
  primeiro fica à esquerda, e não pula quando outro passa na frente em número).
  ⚠️ **Trocar conta como reação nova no emoji de destino** — a ordem lê o
  `updated_at`, e não o `created_at`. Com o `created_at`, quem trocou 👍 por 🎉
  entraria no 🎉 com a hora do 👍, e a pílula nova podia nascer à esquerda de
  pílulas mais antigas. Reagir de novo com o **mesmo** emoji não regrava nada
  (a pílula não muda de lugar sem nada ter mudado).
- ⚠️ **Uma consulta por PÁGINA, e não por comentário.** A listagem já é
  paginada; as reações dos comentários da página vêm num único `SELECT … WHERE
  comment_id IN (…)`. Mesmo desenho de `assignee_ids_for_tasks` (ADR 0025).
- **Tombstone devolve `reactions: []`** — ver §4.6.
- **As rotas de reagir e tirar devolvem o `CommentResponse` inteiro** do
  comentário tocado, para a tela trocar a linha sem recarregar o thread.

### 4.5. Notificação quando a reação nasce, para o autor

Tipo novo **`TASK_COMMENT_REACTED`**, método novo `NotificationEmitter.
comment_reacted`, no molde de `comment_on_task`.

- **Destinatário:** só o autor do comentário.
- **Não emite** se quem reagiu é o autor (decisão dela).
- **Emite quando a reação NASCE** — a linha é criada. **Trocar o emoji não
  emite** (decisão dela, §8, pergunta 3).
  ⚠️ Consequência dita inteira: **tirar e pôr de novo emite**, porque tirar
  apaga a linha e o banco não lembra que ela existiu. Lembrar exigiria guardar
  reação removida — estado a mais para evitar um aviso raro.
  ⚠️ **Quem diz "nasceu" é o banco**, e não uma leitura antes: o `INSERT … ON
  CONFLICT … RETURNING (xmax = 0)` responde se foi inserção ou troca na mesma
  operação. Um `SELECT` antes teria a mesma janela do §4.2 — dois cliques
  rápidos gerariam duas notificações.
- **Tirar a reação não emite nada**, e **não apaga a notificação já enviada**:
  notificação é registro histórico (D2 da Spec 018), e o sino não tem como
  "desnotificar" quem já leu.
- ⚠️ **Filtro de visibilidade:** o autor pode ter perdido o alcance da tarefa
  (trocou de time) desde que comentou. Mesma regra das menções
  (`_emitir_mencoes`, filtro 3): **só notifica quem enxerga a tarefa**, senão o
  aviso leva a um 404 e vaza o título no payload.
- **Payload:** `{actor_name, task_title, emoji}`.
- **Texto no sino:** *"Fulana reagiu com 👍 ao seu comentário em "Tarefa""*.
  O destino continua `/tarefa/<id>` — `destinoDaNotificacao` não muda.

### 4.6. Comentário apagado leva as reações — do mesmo jeito que ele

Decisão dela: *"apagar igual o comentário"*.

⚠️ **O comentário não é apagado do banco: é marcado** (`deleted_at`), e há um
caminho que o desmarca (`restaurar_quadro.sql`). Então "igual ao comentário" é:
**as reações seguem o comentário** — somem quando ele some, voltam se ele
voltar.

**Como:** as linhas de reação **ficam**, e a listagem só as devolve para
comentário ativo. Nenhum dos dois caminhos de apagar (§2) muda — nem o serviço,
nem o SQL cru da cascata de tarefa —, e o quadro restaurado pelo script volta
com os comentários **e** as reações.

- ⚠️ **Não é uma segunda marca `deleted_at` na reação.** Seriam dois lugares
  (serviço e SQL cru) para lembrar de marcar, e um terceiro (o script) para
  lembrar de desmarcar — exatamente o que "igual ao comentário" já dá de graça
  olhando a marca dele.
- **Na tela:** comentário apagado, com ou sem tombstone, **não mostra reação**
  e não tem bolinha.
- **Nas rotas:** reagir ou tirar reação de comentário apagado é **404** (o
  `_load_active` já recusa).
- A FK `comment_reaction → comment` leva `ON DELETE CASCADE`: se um dia um
  comentário for apagado de verdade, as reações não seguram a linha.

### 4.7. O gesto, no modelo do WhatsApp

- **A bolinha:** aparece ao lado do comentário quando o mouse está sobre ele.
  ⚠️ **E também quando o foco de teclado está dentro dele** (`:focus-within`) —
  botão que só existe no hover é inalcançável por teclado, e o `web/AGENTS.md`
  §2 exige o caminho. Alvo de 24px no mínimo (§3), `aria-label="Reagir ao
  comentário"`.
- **O seletor:** abre na bolinha. **👍 e ❤️ primeiro**, maiores, numa linha só;
  **os outros depois**. Escolher fecha o seletor. `Escape` fecha; clicar fora
  fecha. ⚠️ Com emoji livre, "os outros" são **todos** — perto de 1.900 sem
  contar tom de pele. Grade desse tamanho sem categoria e sem busca não se usa;
  de onde vêm categoria e busca em português é a pergunta 4 da §8.
- **A fileira:** embaixo do texto, uma pílula por emoji — `👍 3`. A pílula com a
  reação da própria pessoa fica marcada (borda e fundo de destaque, **e** o
  rótulo acessível diz "você reagiu" — o `web/AGENTS.md` §8 proíbe sinal só por
  cor).
- **Quem reagiu:** passar o mouse (ou focar) numa pílula mostra os nomes —
  *"Ana, Bruno e você"*.
- **Clicar numa pílula:**
  - na **sua**, tira a reação;
  - na de **outro emoji**, reage com ele (troca a sua, se tinha).
  É o atalho do Slack/GitHub para "+1" sem abrir o seletor. ⚠️ O WhatsApp não
  tem este atalho — se ela preferir o comportamento puro, a pílula só mostra
  quem reagiu. Não virou pergunta porque não muda contrato nenhum.
- **Otimista:** a pílula muda no clique e volta, com mensagem na linha, se a
  requisição falhar (padrão `erroLinha` da `LinhaComentario`).
- **Sem responsivo** — o `web/AGENTS.md` §1 registra *"zero responsivo"*: não há
  hover no toque, e não é regressão desta spec.

---

## 5. Contrato

Nomes em inglês; endpoints são contrato.

| Método | Caminho | Corpo | Resposta |
|---|---|---|---|
| `PUT` | `/tasks/{task_id}/comments/{comment_id}/reaction` | `{"emoji": "👍"}` | `200` + `CommentResponse` |
| `DELETE` | `/tasks/{task_id}/comments/{comment_id}/reaction` | — | `200` + `CommentResponse` |
| `GET` | `/tasks/{task_id}/comments` | — | `CommentListResponse`, cada item com `reactions` |

- **`PUT` e não `POST`:** a operação é "a minha reação neste comentário passa a
  ser X" — idempotente, e trocar é o mesmo gesto que criar. `reaction` no
  singular porque é **a** reação de quem chama.
- **`DELETE` devolve 200 com corpo**, e não 204: a tela precisa da fileira
  atualizada. ⚠️ Rota nova copia o vizinho (`AGENTS.md` §3.1) — aqui o vizinho é
  `remove_watcher`, que também devolve corpo no `DELETE`.
- **`DELETE` sem reação é 200**, e não 404: tirar o que não existe chega ao
  mesmo estado. Evita erro no duplo clique.
- **Erros:** tarefa invisível ou comentário inexistente/apagado/de outra tarefa
  → `404`; o que não for exatamente um emoji → `422`.
  ⚠️ O 422 sai do **serviço**, e não de um `@model_validator` do Pydantic —
  `AGENTS.md` §9: *"`@model_validator` devolve 500"*.

### Banco — migration `0025`

```
comment_reaction
  id            uuid pk
  workspace_id  uuid not null  -> workspace
  comment_id    uuid not null
  user_id       uuid not null
  emoji         varchar(16) not null
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

  FK (comment_id, workspace_id) -> comment (id, workspace_id)  ON DELETE CASCADE
  FK (user_id, workspace_id)    -> users   (id, workspace_id)  ON DELETE CASCADE
  UNIQUE (comment_id, user_id)  -- cobre a busca por comment_id
```

- `updated_at` ordena a fileira e registra a troca (§4.4); `created_at` fica
  como registro de quando a pessoa reagiu pela primeira vez.
- **`varchar(16)`:** o maior emoji da biblioteca tem **10 code points**
  (medido), e o `varchar` do Postgres conta caractere. A validação é quem
  garante o conteúdo; o tamanho só barra lixo que escapasse dela.
- **Conta desativada:** as reações ficam, como os comentários dela ficam.

---

## 6. Fatias

Um PR, um commit por fatia, CI conferido a cada commit.

- **A — o backend de reagir.**
  - `emoji==2.15.0` em `dependencies` (§4.3);
  - migration `0025` e modelo `CommentReaction`;
  - validar e normalizar o emoji no serviço;
  - `PUT` e `DELETE` (§5), no `CommentService`;
  - `reactions` na listagem, uma consulta por página, só de comentário ativo
    (§4.4, §4.6).

  **Testes:** serviço **e** HTTP (`AGENTS.md` §9: *"teste de serviço não sabe se
  a rota existe"*). Os que carregam a fatia:
  - dois `PUT` do mesmo par terminam com **uma** linha;
  - `❤` e `❤️` viram a **mesma** pílula;
  - texto, dois emojis e espaço em volta → 422;
  - quem não vê a tarefa leva 404 nos dois verbos;
  - apagar o **comentário** esconde as reações; apagar a **tarefa** (o SQL cru)
    também; e desmarcar o comentário as traz de volta.

  **Sabotagem:** tirar o `UNIQUE` da migration e ver o teste de duplo clique cair.

- **B — a notificação.**
  - `TASK_COMMENT_REACTED` e `NotificationEmitter.comment_reacted` (§4.5);
  - no front: o tipo em `NotificationType` (`lib/api.ts`), o `emoji` no tipo do
    `payload`, e o texto no `NotificationBell`.

  **Testes:** reagir ao próprio não emite; autor sem alcance da tarefa não
  recebe; trocar **não** emite; tirar e pôr de novo emite; tirar não emite.
  **Sabotagem:** notificar sem olhar se a reação nasceu (tirar o `if nasceu`)
  e ver o teste de troca cair.
  ⚠️ **Não a exclusão do autor**, que era a sabotagem escrita aqui antes: ela
  mora em **dois** lugares (o service sai cedo para não carregar a tarefa, e o
  emissor recusa de novo, como em todo tipo). Tirar uma das duas deixa os testes
  verdes — prova a redundância, e não a trava.
  **Front:** o texto do sino saiu de dentro do `NotificationBell` para
  `lib/notificacoes.ts` (`textoDaNotificacao`), porque não tinha teste nenhum e a
  fronteira da Spec 027 põe decisão em `lib/`. As três frases que já existiam
  ganharam teste junto, para provar que a mudança de casa não alterou nenhuma.

- **C — a tela.** ✅ **Entregue em 15/09.**
  - **O catálogo** (`web/lib/emojiCatalogo.generated.ts`, 1.914 emojis) é gerado
    do `emojibase-data/pt` por `web/scripts/gen-emoji-catalogo.mjs`, com nome,
    etiquetas e grupo em português. A fonte é dependência de **desenvolvimento**:
    só o gerador a lê, e nada dela vai para o pacote da tela.
  - ⚠️⚠️ **A forma canônica NÃO é "tirar o U+FE0F"**, e essa era a armadilha da
    fatia: 👍 vem da fonte como `👍️` e precisa perdê-lo, mas `#️⃣` e 🏳️‍🌈 também
    o têm e precisam mantê-lo. Quem decide é o campo `type` (1 = apresentação de
    emoji → a sequência do `hexcode`; 0 = apresentação de texto, como ❤ ☺ © →
    `hexcode` + U+FE0F).
  - **Dois guardiões, com perguntas diferentes:**
    `emojiCatalogo.generated.test.ts` pergunta se o arquivo está em dia com a
    fonte; `backend/tests/test_emoji_catalogo_front.py` passa **cada** emoji por
    `normalize_emoji` e exige que ele volte igual — é o que impede o seletor de
    oferecer o que o `PUT` recusaria (422) ou gravaria em outra forma.
  - **Um grupo por vez** na grade, mais a busca: desenhar os 1.914 seriam 1.914
    botões no DOM de cada comentário aberto.
  - **Revisão dela na tela, 16/09** — *"tá mal feito a reação"*, os botões
    *"muito avulsos"*, e pedido de animação de abrir e fechar:
    - as três ações (reagir, editar, apagar) entraram numa **cápsula** com
      contorno (`CapsulaDeAcoes`), que aparece com o mouse na linha, com o foco
      de teclado dentro dela, ou com o seletor aberto. ⚠️ **Editar e apagar
      passaram a aparecer só no hover também** — antes ficavam sempre à mostra;
    - o "🙂+" virou o ícone `SmilePlus`, e a lixeira 🗑 virou `Trash2`;
    - ⚠️ **o seletor era `absolute` e nascia cortado** pela borda do detalhe da
      tarefa, com barra de rolagem horizontal — o mesmo defeito que o
      `PillSelect` já tinha tido. Passou a usar o `AnchoredPanel`, que traz a
      animação dos outros seletores;
    - ⚠️ **o `AnchoredPanel` fechava a qualquer rolagem, inclusive a de dentro
      dele** — na grade de emojis, rolar fechava o painel. Passou a ignorar a
      rolagem interna. E o teste pegou um segundo defeito no conserto: rolagem
      da janela chega com o `Window` como alvo, e `contains(window)` levanta.
  - ⚠️ **Cobertura, dita inteira:** os testes de componente que já existiam
    simulam a lista de comentários **vazia**, então nenhum deles desenha
    comentário — a fileira e o seletor são exercitados só pelos testes novos
    (`components/__tests__/Reacoes.test.tsx`) e pelo smoke na tela.
  - a decisão em `lib/` (Spec 027, fronteira do teste): agrupar e ordenar a
    fileira, montar "Ana, Bruno e você", decidir o que o clique na pílula faz;
  - `setCommentReaction`/`deleteCommentReaction` em `lib/api.ts`, com teste de
    corpo (`AGENTS.md` §9: corpo montado campo a campo);
  - a `LinhaComentario` ganha a bolinha, o seletor e a fileira (§4.7);
  - o seletor de reação é **componente próprio**, e não o `EmojiPicker` com uma
    flag: um insere texto no cursor, o outro escreve no servidor.

  **Smoke (👁):** passar o mouse mostra a bolinha; `Tab` também; reagir, trocar e
  tirar; a pílula própria marcada; nomes no hover; comentário apagado sem
  bolinha e sem fileira; o sino do autor com o texto certo.

---

## 7. Riscos

- ⚠️ **Dependência nova de runtime** (§4.3). O `pip install` não falha quando a
  lista está errada — falha o import, na imagem de produção. Portão: o job
  "imagem de produção (importa o app?)" do CI.
- ⚠️ **O `CommentResponse` muda de forma, e todo chamador de `listComments`
  passa a receber `reactions`.** Campo novo, não removido — nada quebra, mas
  todo teste que monta `Comment` à mão no front precisa do campo (o `tsc` pega).
- **Emoji novo do Unicode** (a cada ano sai um lote): o servidor só o aceita
  depois de atualizar a biblioteca. Quem mandar um emoji mais novo que ela leva
  422. Atualizar é trocar a versão no `pyproject.toml`.
- ⚠️ **Hover em lista longa.** A bolinha só aparece com o mouse em cima; num
  thread de 40 comentários isso é bom (a tela não enche de botão), e é o motivo
  do `:focus-within` ser obrigatório, não enfeite.
- **Notificação a cada reação num comentário popular** vira muitas linhas no
  sino do autor. Foi a escolha dela; se incomodar, agrupar é mudança só no
  emissor e no sino, sem mexer no contrato.

---

## 8. Perguntas

### Respondidas em 15/09

1. **Comentário apagado: apagar ou esconder as reações?** — *"apagar igual o
   comentário uai"*. Como o comentário é marcado e não removido, as reações
   seguem a marca dele (§4.6).
2. **Emoji livre ou lista fechada?** — *"livre"*. Recomendei lista; ela manteve
   o documento de 10/09 (§4.3).
3. **Trocar de emoji notifica de novo?** — *"não"* (§4.5).

### A quarta — respondida em 15/09

4. **De onde vêm as categorias e a busca em português do seletor?** Com emoji
   livre, o seletor mostra perto de 1.900 emojis, e a biblioteca do backend não
   serve: medido em 15/09, ela **não traz nome em português nem categoria** (só
   `en` e `alias`).
   - **a) `emoji-mart`** (`emoji-mart` 5.6.0 + `@emoji-mart/react` 1.1.1 +
     `@emoji-mart/data` 1.2.1). Seletor pronto, com categorias, busca e
     tradução para português (`i18n/pt.json`), compatível com React 18.
     ⚠️ **Custo:** três dependências novas no front, e **paradas** — a última
     versão é de abril de 2024 (o `@emoji-mart/react`, de janeiro de 2023). O
     visual é o dele, não o do produto, e ajustar tema é por variável CSS.
   - **b) Catálogo próprio gerado.** Um script gera, a partir de um conjunto
     de dados de emoji com português e categorias, um arquivo commitado no
     front — o mesmo desenho do `permissions.generated.ts` da 049. O seletor é
     nosso, com os tokens do produto.
     ⚠️ **Custo:** mais trabalho na fatia C (grade, abas de categoria, busca,
     teclado), e a fonte de dados precisa ser escolhida e medida antes.
   - **c) OpenMoji** (sugestão dela, 15/09). Medido no pacote `openmoji` 17.0.0
     (abril de 2026, **mantido**), licença **CC BY-SA 4.0**:
     - ✅ **tem categorias**: 12 grupos e 100 subgrupos, com 3.953 emojis Unicode
       (1.923 sem tom de pele);
     - ⚠️ **não tem português**: o nome e as etiquetas são em inglês
       (`annotation: "thumbs up"`, `tags: "+1, good, hand, like…"`). A busca em
       português continua precisando de outra fonte;
     - ⚠️ **é um conjunto de DESENHOS**, e não só dados. Usar as imagens muda o
       emoji de todo mundo para o traço do OpenMoji (igual em qualquer sistema)
       e exige **crédito visível** pela licença. Usar só os dados (grupos) mantém
       o emoji nativo de cada sistema;
     - ⚠️ traz **542 itens que não são Unicode** (`extras-openmoji`,
       `extras-unicode`) — o servidor os recusa, e o gerador tem de tirá-los;
     - ⚠️ o `emoji` dele vem com um U+FE0F a mais em alguns casos (👍 é `👍️`), então
       a ponte com o que o servidor grava é pelo `hexcode`, e não pelo texto.
   - **Resposta dela, 15/09:** *"se não tiver nenhuma aberta que possamos usar,
     pode deixar catálogo próprio mesmo"*.

   **Tem uma aberta, e ela resolve o que faltava — fonte do catálogo próprio:
   `emojibase-data`** (17.0.0, novembro de 2025, licença **MIT**). Medido no
   pacote em 15/09, `pt/data.json`:
   - 1.949 emojis, com **nome em português** (`👍` → *"polegar para cima"*) e
     **etiquetas em português** (*"joia"*, *"beleza"*, *"valeu"*, *"concordo"*…)
     — a busca por "joia" acha o 👍;
   - **grupo** de cada emoji, com os nomes dos grupos também em português
     (*"sorrisos e emoção"*, *"pessoas e corpo"*…);
   - tons de pele (`skins`) por emoji.

   ⚠️ O mesmo cuidado do OpenMoji: o campo `emoji` às vezes traz um U+FE0F a
   mais (👍 vem `👍️`). O gerador tem de passar cada emoji pela mesma
   normalização do servidor, senão o seletor manda uma forma e a pílula mostra
   outra.

   **Desenho da fatia C:** um script gera, do `pt/data.json`, um arquivo
   commitado no front (emoji normalizado, nome, etiquetas, grupo) — como o
   `permissions.generated.ts` da 049 —, e o seletor é nosso, com os tokens do
   produto e o emoji nativo de cada sistema. Sem dependência de runtime no
   front: o pacote só é lido pelo gerador. O OpenMoji fica de fora — ele não
   traz português, e as imagens mudariam o emoji de todo mundo.
