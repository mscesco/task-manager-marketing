# Spec 052 — Descrição legível, links com nome e formatação

**Status:** escrita em 16/09/2026, a partir do pedido dela com o projeto
"CBV - CICLO 2026/2028" na tela, das três respostas do mesmo dia e das duas
perguntas que a escrita levantou (§8, respondidas também em 16/09).
**Fatias A e B entregues em 16/09.**
**Escopo:** backend (duas tabelas de links, uma migration, rotas) e front
(descrição do projeto, links de projeto e tarefa, formatação nas descrições).
**Depende de:** Spec 051 mergeada (#58). As permissões de escrita dos links
usam o verbo no time do item, que ela consolidou.
**Placar na abertura:** backend **1778**, front **1436** (medidos na 051).

---

## 1. De onde vem

Ela, em 16/09, com a tela do projeto aberta:

> *"a descrição desse projeto é enorme e só tem uma linha aparecendo.
> Conseguimos arquitetar algo para 'anexar' links, pra deixar uma aba separada
> com nome e link, e quando confirmar aparecer somente o nome como hiperlink
> sabe? (...) ainda só consigo colar aqui porque dei aquele clique duplo pra
> copiar, porque nem vejo esse resto."*

> *"conseguimos deixar esses campos de escrita maior como descrição e
> comentário, descrição de tarefa e afins com algum tipo de formatação? tipo,
> deixar como md e liberar negrito, hiperlink e afins?"*

A descrição que motivou tem dois links no começo (pasta do Drive, banco de
imagens) e depois objetivo, escopo, responsabilidades e réguas — tudo num
parágrafo só, e a tela mostra uma linha.

---

## 2. O que existe — medido em 16/09

### 2.1. Descrição do projeto
- **Leitura:** `web/app/projetos/[id]/page.tsx:159` — um `<span>` no cabeçalho,
  `maxWidth: 420`, `whiteSpace: nowrap`, `textOverflow: ellipsis`, com o texto
  inteiro só no `title`. **Sem "ver mais", sem quebra de linha, sem link
  clicável.** É por isso que ela só consegue ler copiando.
- **Lista de projetos:** `web/app/projetos/page.tsx:385` — o mesmo corte numa
  linha.
- **Edição:** `projetos/[id]/page.tsx:333`, `<textarea rows={3}>` no painel de
  editar.

### 2.2. Descrição da tarefa
- **Leitura:** `web/components/TaskDetail.tsx:2139` — `whiteSpace: pre-wrap`
  (as quebras ficam) e `linkify` (URL `http`/`https` vira link, mostrando o
  endereço inteiro).
- **Edição:** `web/components/TaskModal.tsx` (campo `description`).
- **Duplicar tarefa** copia a descrição (`lib/duplicacaoTarefa.ts:92`).
- **Descrição gerada por sistema:** criar tarefa a partir de solicitação grava o
  briefing (`solicitations/domain/briefing.py`) — várias linhas curtas
  ("Solicitante: …", "Protocolo: …"), e **depende das quebras de linha** para
  ser lido.

### 2.3. Formatação
**Não existe em lugar nenhum.** O `package.json` do front não tem biblioteca de
Markdown. Comentários têm dois tokens próprios (`@[nome](uuid)` para menção e
`[gif:URL]`), tratados em `CommentText.tsx` — **fora do escopo desta spec**
(decisão 2), mas relevantes para quando entrarem (§6).

### 2.4. Links
Não há entidade de link. Todo link hoje é URL solta no texto.

---

## 3. Os problemas

1. **A descrição do projeto não se lê.** Não é falta de formatação: é o
   componente que corta em uma linha.
2. **Link importante some no texto.** A pasta do Drive e o banco de imagens são
   o que as pessoas mais abrem, e estão enterrados no começo de um parágrafo
   longo, como endereço cru.
3. **Texto longo sem estrutura.** Objetivo, escopo, responsáveis e prazos viram
   um bloco só; não há como destacar nada.

---

## 4. As decisões

### 4.1. A descrição do projeto sai do cabeçalho

Vira um bloco **"Sobre o projeto"** logo abaixo do cabeçalho:
- mostra as **primeiras 4 linhas** e um **"Ver mais"** que abre o resto (e
  "Ver menos" para fechar); texto curto não mostra o botão;
- **mantém as quebras de linha** e deixa os links clicáveis — o mesmo
  tratamento que a descrição da tarefa já tem;
- projeto **sem descrição** não mostra o bloco.

O cabeçalho fica com status, prioridade, datas e os links (§4.2).

⚠️ **"4 linhas" é visual, não contagem de caracteres:** um corte por
`line-clamp`, e o "Ver mais" só aparece quando o texto de fato passa do corte
(medido no navegador, não adivinhado pelo tamanho da string).

⚠️ **Só no projeto** — ela, em 16/09: *"Não, na tarefa pode deixar como é
hoje"*. A descrição da tarefa continua inteira no detalhe.

### 4.2. Links com nome — no projeto e na tarefa (decisão 1)

**O modelo.** ⚠️⚠️ **REVISTO EM 16/09, antes da fatia B, por pergunta dela:**
*"Precisa ser uma tabela nova? não dá pra usar attachments?"*. A primeira versão
desta seção pedia duas tabelas novas (`project_link`, `task_link`). O schema v5
já tinha `attachment` — "anexo de arquivo de tarefa" —, **nunca usada** por
rota, serviço ou tela, e **vazia em produção** (ela mediu no Adminer:
`count(*) = 0`). A `0026` a **reforma** num anexo genérico:

    attachment
      id, workspace_id
      task_id OU project_id        exatamente um (CHECK)
      kind                         LINK ou FILE (CHECK)
      title                        o nome que aparece (era file_name)
      url                          até 2048; obrigatória para LINK (CHECK)
      storage_key, mime_type,      obrigatórias para FILE (CHECK);
      file_size                    nenhum FILE existe ainda
      position                     a ordem da lista
      uploaded_by, created_at

- FKs compostas com `workspace_id`; a de **tarefa** passou de `RESTRICT` a
  `CASCADE`, e a de **projeto** nasce `CASCADE`.
- **Sem `deleted_at` próprio:** o anexo segue o dono. Tarefa ou projeto
  apagados (soft delete) somem das telas e levam os links junto.
- **Até 20 links por item.** Uma lista maior deixa de ser "os links
  principais" e vira pasta — e a pasta é um link.
- ⚠️ **As regras de dono e de tipo moram no BANCO** (CHECKs), porque uma tabela
  para dois donos e dois tipos perde o que duas tabelas davam de graça.
- ⚠️ **A `0026` PARA se a tabela tiver linhas**, na subida e na descida: só é
  barato reformar a tabela vazia.
- **Ganho:** o upload de arquivo, se um dia entrar, cai na mesma lista, sem
  outra mudança de modelo.

**As rotas.**

    GET /projects/{id}/links     -> lista, na ordem
    PUT /projects/{id}/links     -> SUBSTITUI a lista inteira
    GET /tasks/{id}/links
    PUT /tasks/{id}/links

⚠️ **`PUT` com a lista inteira, e não criar/editar/apagar um por um.** A tela
edita a lista num painel só (acrescentar, renomear, reordenar, remover) e
salva de uma vez; uma rota por operação obrigaria a tela a calcular a
diferença, e um erro no meio deixaria a lista pela metade. Aqui é uma
transação: ou a lista nova inteira, ou nada.

**Quem lê e quem escreve** — as regras que já valem para editar o item,
**sem verbo novo**:

| | ler | escrever (`PUT`) |
|---|---|---|
| projeto | quem enxerga o projeto (`ProjectService.get`, 404 fora) | `project.update` no time do projeto (403) |
| tarefa | quem enxerga a tarefa (404 fora) | quem edita a tarefa (`assert_editable`) + `task.update` no time dela |

⚠️ **Links entram no `can_update` que já existe** para o botão de editar. Não
nasce `can_edit_links`: quem edita o projeto edita os links dele.

**Validação no servidor** (422 com o campo): título vazio depois de aparar;
URL que não começa com `http://` ou `https://` (recusa `javascript:`, `data:`
e afins — é a trava de segurança, e mora no servidor, não só na tela); mais de
20 itens.

**Na tela.**
- **Projeto:** os links aparecem **no cabeçalho, como botões pequenos só com o
  nome** e um ícone de link; clicar abre numa aba nova. Editados no painel
  "Editar projeto", numa seção "Links".
- **Tarefa:** aparecem no detalhe da tarefa, **logo abaixo da descrição**, do
  mesmo jeito. Editados no modal de editar tarefa, abaixo da descrição.
- **O editor da lista:** cada linha tem nome e endereço, com mover para cima/
  baixo e remover; "+ Adicionar link" no fim. Endereço sem `http` ganha
  `https://` na frente ao sair do campo (colar `drive.google.com/...` é o caso
  comum).
- **Endereço completo** aparece no `title` do botão (ao passar o mouse).

### 4.3. Formatação nas descrições (decisões 2 e 3)

**Onde:** descrição do **projeto** e descrição da **tarefa**. Comentários
ficam para depois (decisão 2).

**O quê:** um Markdown pequeno —
- **negrito** (`**texto**`), *itálico* (`*texto*`);
- títulos pequenos (`##`, `###` — `#` é rebaixado a `##`, para a descrição não
  competir com o título da página);
- listas com marcador e numeradas;
- link com nome (`[Pasta principal](https://…)`) e URL solta continua virando
  link;
- **quebra de linha simples vira quebra de linha.** ⚠️ Isso não é o padrão do
  Markdown, que junta linhas soltas num parágrafo — e **precisa ser assim**:
  as descrições que já existem, e o briefing das solicitações (§2.2), são
  linhas curtas que dependem da quebra. Sem isso, todo briefing viraria uma
  linha só no dia do deploy.

**O que NÃO entra:** HTML escrito à mão (é ignorado e aparece como texto),
imagens, tabelas, blocos de código. Links só `http`, `https` e `mailto`; todo
link abre em aba nova com `rel="noopener noreferrer"`.

⚠️ **A segurança mora na lista do que é permitido, e não na do que é
proibido:** o renderizador desenha só os elementos acima e descarta o resto.

**Como se edita (decisão 3):** o campo continua sendo texto, com
- uma **barra de botões** acima: **B**, *I*, título, lista, lista numerada,
  link — cada um escreve a marcação em volta do que está selecionado (ou no
  cursor);
- atalhos **Ctrl+B**, **Ctrl+I** e **Ctrl+K** (link);
- duas abas, **"Escrever"** e **"Visualizar"**, para ver como vai ficar antes de
  salvar.

⚠️ **O texto é guardado como está, com a marcação.** Não há conversão nem
migration de dados: o que já existe continua sendo texto válido, e só passa a
ser desenhado com formatação.

**Onde o texto aparece resumido,** a marcação é removida antes de cortar — hoje
só a lista de projetos (`projetos/page.tsx:385`). Um resumo com `**` e `##`
parece defeito.

**Bibliotecas (três, só no front):** `react-markdown`, `remark-gfm` (listas,
URL solta vira link) e `remark-breaks` (a quebra de linha simples). Sem
`rehype-raw`: é ele que liberaria HTML, e ele fica de fora de propósito.

### 4.4. Duplicar tarefa copia os links

`lib/duplicacaoTarefa.ts` já copia a descrição; os links da tarefa de origem
vão junto, na mesma ordem. ✅ **Confirmado por ela (§8, pergunta A).**

⚠️ **E os links NÃO aparecem no card do quadro** (§8, pergunta B): só no
detalhe da tarefa.

---

## 5. As fatias

**Fatia A — a descrição do projeto legível** (§4.1). Só front: o bloco "Sobre o
projeto" com "Ver mais", quebras de linha e links clicáveis (o mesmo `linkify`
da tarefa). Resolve o problema de hoje sem esperar o resto.

✅ **Entregue em 16/09.** Front **1442**, `tsc` limpo, `next build` ok. Backend
não mudou.
- `components/SobreOProjeto.tsx`: corte de 4 linhas (`line-clamp-4`),
  `whitespace-pre-wrap` + `wrap-anywhere`, `linkify`. O botão aparece se
  `scrollHeight > clientHeight` com o corte aplicado — medido em
  `useLayoutEffect` (sem pular um quadro) e de novo num `ResizeObserver` (a
  largura muda, o corte muda). ⚠️ **Mede só FECHADO:** aberto não há corte e a
  medida empataria, apagando o "Ver menos" recém-usado.
- `app/projetos/[id]/page.tsx`: a descrição saiu da linha da meta; o bloco vem
  logo abaixo dela, e some quando não há descrição.
- ⚠️ **As quatro classes conferidas no CSS do build** (`line-clamp-4`,
  `wrap-anywhere`, `whitespace-pre-wrap`, `leading-relaxed`): Tailwind v4 só
  gera o que encontra, e classe inexistente não dá erro em portão nenhum.
- **Testes:** `SobreOProjeto.test.tsx` (6) — o jsdom não faz layout, então a
  medida é simulada; o que se prova é a decisão sobre ela. **O corte visual é
  conferência na tela, nos dois temas.**
- **Sabotagem:** sem as duas guardas do "aberto" → cai exatamente o teste do
  "Ver menos".

**Fatia B — links com nome** (§4.2, §4.4).
- Backend: a reforma da `attachment` na migration **`0026`**; rotas `GET`/`PUT`
  de projeto e tarefa; validação; testes de serviço e **linhas na matriz de
  permissões** (`PUT` de links do Marketing e do Comercial, por papel, com a
  coluna `DUAS_ARVORES`).
- Front: os botões no cabeçalho do projeto e no detalhe da tarefa; o editor de
  lista no painel do projeto e no modal da tarefa; duplicar copia.
- ⚠️ **Deploy: migration ANTES do código** — o código novo lê a tabela
  reformada, e o velho nunca a consulta. Escrito no `DEPLOY.md` no mesmo commit.

✅ **Entregue em 16/09.** Backend **1849**, front **1465**, `tsc` limpo,
`next build` ok, `ruff` 50 antes e depois, **drift limpo** (upgrade vazio num
banco descartável em `head`, que também desceu e subiu a `0026`).
- **Backend:** `alembic/versions/0026_anexo_de_projeto_e_tarefa.py`;
  `Attachment` em `db/models/collaboration.py`;
  `tasks/infrastructure/attachment_repository.py` (lê, substitui e copia — todo
  filtro diz `kind = 'LINK'`, para um dia não apagar arquivo ao salvar links);
  `tasks/application/link_service.py` (`validar_links` pura; as permissões de
  ler e escrever); `tasks/api/links_router.py` (as quatro rotas).
- **Duplicar** copia os links da tarefa **e das subtarefas copiadas**, na mesma
  transação (`TaskService.duplicate` e `_copiar_subarvore`). Na cópia, o modal
  não mostra editor — diz que os links vão junto.
- **Front:** `lib/links.ts` (completar `https://`, erros, "mudou?", reordenar),
  `components/LinksDoItem.tsx` (os botões com o nome), `EditorDeLinks.tsx`
  (controlado; erros só depois de tentar salvar). Projeto: botões na linha da
  meta, editor no painel de editar. Tarefa: botões abaixo da descrição no
  detalhe, editor abaixo da descrição no modal. Os links salvam **no mesmo
  botão** do formulário, e só se mudaram; mudar só os links não faz PATCH da
  tarefa. O detalhe aberto se atualiza pelo evento `LINKS_MUDARAM`.
- **Matriz:** 8 linhas (ler e substituir, tarefa e projeto, Marketing e
  Comercial) — todas as 48 previsões bateram, e cada linha bate com a de
  `task.update`/`project.update`: sem regra própria.
- **Testes:** `test_validar_links.py` (13), `test_links_db.py` (10: ordem,
  substituir, lista vazia, projeto separado, duplicar com subtarefa, tarefa
  apagada, e **6 casos em que o banco recusa** anexo fora da regra passando por
  fora do serviço); front `links.test.ts` (15) e `LinksDaTarefa.test.tsx` (8).
- **Nenhum teste antigo caiu.**
- **Sabotagens:** modal achando que os links sempre mudam e sempre fazendo PATCH
  → caem os 2 testes do modal; `replace_project_links` sem o verbo no time →
  cai exatamente `project.links[substituir os do Comercial]-DUAS_ARVORES`.
- ⚠️ **Não coberto por teste:** a aparência dos botões e do editor, nos dois
  temas.

**Fatia C — formatação nas descrições** (§4.3). Só front:
- `TextoFormatado` (o renderizador, com a lista do que é permitido) usado no
  detalhe da tarefa e no bloco "Sobre o projeto" — que troca o `linkify` da
  fatia A por ele;
- `EditorDeDescricao` (barra, atalhos, "Escrever"/"Visualizar") no
  `DescricaoEditavel` do detalhe da tarefa (fatia D), no modal de **criar**
  tarefa e no painel do projeto;
- a remoção da marcação no resumo da lista de projetos;
- testes: o que desenha e o que NÃO desenha (HTML, `javascript:`), a quebra de
  linha simples preservada, **o briefing de uma solicitação desenhado igual ao
  de hoje**, e cada botão da barra escrevendo a marcação certa.

**Fatia D — título e descrição editados no lugar** (pedido dela em 16/09, com
print do Trello). Só front. Entrou antes da C.

> *"quero trocar o botão de editar. Ele agora serve só pra trocar a descrição e
> o título né, já que prioridade, datas e afins podem ser trocadas pelas
> cápsulas."*

- **Título:** clicar edita; **Enter salva, clicar fora salva, Esc desiste**.
  Vazio volta ao original. Quebra de linha colada vira espaço.
- **Descrição:** "Descrição" com **Editar** ao lado (só com texto; sem texto, o
  próprio espaço vazio é o botão). Salvar e Cancelar; **clicar fora salva**,
  **Ctrl+Enter salva**, **Esc desiste**. ⚠️ Enter **não** salva — é a quebra
  de linha.
- **Links:** o modal de editar era o único lugar onde os links de uma tarefa
  existente se editavam, então ganharam o mesmo gesto: **Editar** (ou
  "Adicionar link"), clicar fora salva, Esc desiste. ⚠️ Link com erro **não**
  salva ao clicar fora — o editor fica aberto com o erro marcado.
- **O "Editar" do rodapé saiu, e com ele o modo editar do `TaskModal`**, que
  agora só cria e duplica. Coluna, prioridade, datas, projeto e responsáveis já
  eram das pílulas; nada ficou sem lugar.
- ⚠️ **O Esc do campo não fecha o modal do detalhe** (`stopPropagation`).
- ⚠️ **O detalhe guarda o que salvou.** `/tarefa/[id]` e `/arquivadas` não
  aplicam `onSubtaskUpsert` na tarefa aberta; sem a cópia local o título
  voltaria ao antigo logo depois do Enter.

✅ **Entregue em 16/09.** Front **1488**, `tsc` limpo, `next build` ok, a
classe `hover:bg-[var(--surface-2)]` conferida no CSS do build. Backend não
mudou.
- `lib/edicaoNoLugar.ts` (o que salvar), `lib/useSairDoBloco.ts` (clicar fora
  **ou** Tab para fora; não depende de o botão receber foco, que o Safari não
  dá), `components/TituloEditavel.tsx`, `DescricaoEditavel.tsx`,
  `LinksEditaveis.tsx`; `TaskDetail.tsx` os usa; `TaskModal.tsx` perdeu o modo
  editar; `onEditar` saiu das quatro telas.
- **Testes:** `edicaoNoLugar.test.ts` (8), `EdicaoNoLugar.test.tsx` (18). Três
  testes saíram junto com o modo editar (os dois de links do modal viraram
  testes do `LinksEditaveis`).
- **Sabotagens:** sem o `stopPropagation` no Esc do título → cai o teste do
  Esc; sem a cópia local no detalhe → cai o do título que o pai não aplica; sem
  a guarda de "já confirmei" na descrição → cai o do salvar UMA vez. ⚠️ Esse
  último passava na primeira versão do teste (dois `fireEvent` separados deixam
  o React redesenhar entre eles); reescrito com os dois eventos no mesmo `act`.
- ⚠️ **Não coberto por teste:** a aparência (título com fundo ao passar o
  mouse, campo do título do mesmo tamanho do texto), nos dois temas; o clique
  fora de verdade no navegador.

---

## 6. O que esta spec deliberadamente NÃO faz

- **Formatação nos comentários** (decisão 2). ⚠️ Quando entrar, o cuidado é a
  menção: `@[nome](uuid)` tem a forma de um link Markdown, e o comentário
  precisa tratar menção e GIF **antes** da formatação — senão a menção vira um
  link quebrado.
- **Editor visual** (ver formatado enquanto digita). Decisão 3.
- **Links em comentário, formulário ou time.**
- **Anexar arquivo.** Link aponta para onde o arquivo já mora (Drive).
- **Prévia do link** (título e imagem buscados da página). Exigiria o servidor
  buscar endereços externos — outro assunto, com outro risco.
- **Histórico da tarefa para mudança de link.** Fica registrado; entra se ela
  pedir.

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **A tela.** Os testes do front cobrem `lib/` e componentes; o
  "Ver mais" que depende de medir altura no navegador, a barra de botões na
  seleção real e os dois temas pedem conferência na tela.
- ⚠️ **Ordem do deploy da `0026`.** Nenhum teste simula "código novo, banco
  velho".
- **Descrições antigas com caracteres que viram marcação por acaso** (uma linha
  começando com `-` vira lista, `*texto*` vira itálico). Em geral é o que a
  pessoa queria; se aparecer um caso estranho, é conferência na tela, não
  teste.

---

## 8. As decisões dela, 16/09

1. **Links** — *"também na tarefa"*. Projeto e tarefa (§4.2).
2. **Formatação** — *"só as descrições por enquanto"*. Projeto e tarefa;
   comentários depois (§4.3, §6).
3. **Edição** — *"pode ser como recomenda"*: barra de botões com "Visualizar"
   (§4.3).

### As duas que sobraram, respondidas em 16/09

A. **Duplicar tarefa copia os links?** — **Sim** (§4.4).

B. **Os links da tarefa aparecem no card do quadro?** — **Não.** Ficam só no
   detalhe da tarefa.
