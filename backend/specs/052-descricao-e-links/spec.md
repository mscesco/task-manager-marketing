# Spec 052 — Descrição legível, links com nome e formatação

**Status:** escrita em 16/09/2026, a partir do pedido dela com o projeto
"CBV - CICLO 2026/2028" na tela, e das três respostas do mesmo dia (§8).
Nenhuma fatia entregue.
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

### 4.2. Links com nome — no projeto e na tarefa (decisão 1)

**O modelo.** Duas tabelas, uma por dono, com o mesmo formato:

    project_link / task_link
      id, workspace_id, project_id | task_id,
      title      texto, 1 a 120 caracteres
      url        texto, http:// ou https://, até 2048 caracteres
      position   inteiro (a ordem da lista)
      created_at, updated_at

- FK composta com `workspace_id`, como o resto do schema;
  `ON DELETE CASCADE` no dono.
- **Sem `deleted_at` próprio:** o link segue o dono. Tarefa ou projeto
  apagados (soft delete) somem das telas e levam os links junto, que voltam se
  o dono voltar pelo script de resgate.
- **Até 20 links por item.** Uma lista maior deixa de ser "os links
  principais" e vira pasta — e a pasta é um link.

⚠️ **Duas tabelas, e não uma com "tipo de dono":** a FK de verdade para o dono
é o que garante que não sobra link de tarefa apagada do banco, e o repositório
de cada módulo fica com uma consulta simples.

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
vão junto, na mesma ordem. ⚠️ **Proposta minha, confirmar (§8, pergunta A).**

---

## 5. As fatias

**Fatia A — a descrição do projeto legível** (§4.1). Só front: o bloco "Sobre o
projeto" com "Ver mais", quebras de linha e links clicáveis (o mesmo `linkify`
da tarefa). Resolve o problema de hoje sem esperar o resto.

**Fatia B — links com nome** (§4.2, §4.4).
- Backend: as duas tabelas e a migration **`0026`**; rotas `GET`/`PUT` de
  projeto e tarefa; validação; testes de serviço e **linhas na matriz de
  permissões** (`PUT` de links do Marketing e do Comercial, por papel, com a
  coluna `DUAS_ARVORES`).
- Front: os botões no cabeçalho do projeto e no detalhe da tarefa; o editor de
  lista no painel do projeto e no modal da tarefa; duplicar copia.
- ⚠️ **Deploy: migration ANTES do código** — tabela nova que o código novo lê
  (o motivo da `0025`). Com o código antes, abrir projeto ou tarefa daria erro
  até a migration rodar. Vai escrito no `DEPLOY.md` no mesmo commit.

**Fatia C — formatação nas descrições** (§4.3). Só front:
- `TextoFormatado` (o renderizador, com a lista do que é permitido) usado no
  detalhe da tarefa e no bloco "Sobre o projeto" — que troca o `linkify` da
  fatia A por ele;
- `EditorDeDescricao` (barra, atalhos, "Escrever"/"Visualizar") no modal da
  tarefa e no painel do projeto;
- a remoção da marcação no resumo da lista de projetos;
- testes: o que desenha e o que NÃO desenha (HTML, `javascript:`), a quebra de
  linha simples preservada, **o briefing de uma solicitação desenhado igual ao
  de hoje**, e cada botão da barra escrevendo a marcação certa.

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

### As que sobram

A. **Duplicar tarefa copia os links?** Recomendo **sim** (§4.4): a descrição
   já é copiada, e os links são parte do mesmo contexto.

B. **Os links da tarefa aparecem no card do quadro?** Recomendo **não**: o card
   já tem responsáveis, prazo, prioridade e subtarefas, e os links estão a um
   clique, no detalhe.
