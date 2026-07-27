# 0025 — Listagem de tasks traz assignees em lote

## Status

Accepted (supera a "decisão 9" da spec 004 quanto à listagem)

**Emendado em 2026-07-27** — o `POST /tasks` foi retirado da cláusula de
mutações. Ver "Emenda" no fim deste documento.

## Contexto

A Entrega 10 mostra o **responsável no card do quadro** (bolinha de iniciais).
Para isso, o front precisa dos `assignee_ids` de **cada** task da página.

O `GET /tasks` (listagem) foi deliberadamente deixado **sem** colaboradores na
Entrega 4 ("decisão 9": manter a query enxuta e evitar N+1). Só o detalhe
(`GET /tasks/{id}`) trazia `assignee_ids`/`watcher_ids`. Mas o front evita o
detalhe por causa do bug E6 (ADR 0002 do web) e, mesmo sem isso, buscar 1 por
card seria N+1 — inviável num quadro.

## Decisão

A listagem passa a trazer `assignee_ids` por item, carregados em **lote**:
após paginar as tasks, uma única query
(`task_assignment WHERE task_id IN (...)`) agrupa os responsáveis por task. A
página inteira custa **+1 query**, independente da quantidade de cards — sem
N+1. O motivo original da decisão 9 (query enxuta) fica honrado: não há join
que infle linhas nem busca por card.

Detalhes do contrato:

- Novo schema `TaskListItem(TaskResponse)` com `assignee_ids: list[uuid] = []`.
  A `TaskListResponse.items` passa a ser `list[TaskListItem]`.
- **`watcher_ids` continua FORA da listagem** — só o detalhe os traz. O quadro
  não mostra observadores; trazê-los seria peso sem uso.
- As respostas de **mutação** (~~`POST`~~/`PATCH`/`/move`/`/archive`) seguem
  devolvendo `TaskResponse` puro, **sem** `assignee_ids`. Isso é proposital:
  evita que uma mutação devolva `assignee_ids=[]` e o front zere o selo ao
  mover/editar. No front, `assignee_ids` é opcional e **preservado no merge**.
  ⚠️ **`POST` saiu desta lista em 2026-07-27** — ver Emenda.

## Consequências

- O selo do card tem fonte de dados sem N+1.
- Custo da listagem: 1 query extra fixa por página (aceitável; medida contra a
  alternativa de 1 query por card).
- A "decisão 9" continua valendo para `watcher_ids` e para as mutações; só a
  listagem de assignees foi revertida.
- Front: o estado local NÃO pode sobrescrever `assignee_ids` com `undefined` ao
  aplicar o retorno de uma mutação (regra de merge documentada no quadro).

## Alternativas descartadas

- **1 fetch de assignees por card (N+1).** Funciona no dev com poucas tasks,
  degrada linearmente. Rejeitada.
- **Join de task_assignment na query da listagem.** Infla linhas (uma por
  responsável) e complica count/paginação. O lote em query separada é mais
  simples e previsível.
- **Selo só no detalhe (sem mudar a listagem).** Não atende o objetivo de ver
  o responsável de relance no quadro (decisão de produto da Camila).


---

## Emenda — 2026-07-27: `POST /tasks` sai da cláusula de mutações

### O que mudou

`POST /tasks` passa a responder **`TaskListItem`** (que já existe e já traz
`assignee_ids`) em vez de `TaskResponse`. **`PATCH`, `/move` e `/archive` não
mudam** — seguem com `TaskResponse`, e a proteção original continua de pé.

### Por que a decisão original não errou — envelheceu

Quando este ADR foi escrito, `POST` estava corretamente no mesmo balaio de
`PATCH`/`move`/`archive`: nenhuma dessas rotas **definia** responsável, então
devolver `assignee_ids` seria devolver `[]` e fazer o front zerar o selo.

A **Spec 021** mudou esse fato: passou a aceitar `assignee_ids` no corpo da
criação. A partir dali o `POST` deixou de ser uma mutação que ignora
responsáveis e virou uma que os define — mas a spec não revisitou este ADR.
O resultado foi uma rota que recebe o campo, grava, e responde fingindo que
ele não existe.

### O sintoma que revelou

Relatado pela equipe em 2026-07-27: *"ao designar responsável na criação, o
responsável não vai — tenho que abrir a tarefa e colocar de novo"*.

O responsável **ia**. O banco estava certo, e
`test_task_create_assignees_http_db.py` provava isso com um `GET` depois do
`POST`. O que falhava era a tela: o front insere o card no estado local a
partir do **corpo da resposta do POST** (`Board.aoSalvar`), e o merge

```ts
assignee_ids: saved.assignee_ids ?? existente?.assignee_ids ?? []
```

caía no terceiro ramo — `saved` sem o campo, e `existente` inexistente porque
a tarefa é nova. Na edição o merge funcionava (havia `existente`); só a
criação quebrava.

### Por que a correção foi no backend, não no front

Havia um atalho: o modal já sabia quem tinha selecionado e podia repassar a
lista adiante. Foi descartado — trata o sintoma e deixa a resposta mentirosa
de pé para **qualquer outro cliente** (o n8n, via `API_N8N.md`, cairia na mesma
armadilha). A resposta de uma criação deve descrever o que foi criado.

Efeito colateral bom: **o front não precisou de uma linha.** A regra de merge
já estava escrita para preferir o valor da resposta; faltava a resposta
cumprir o contrato que o front assumia.

### Como a resposta é montada

`assignee_ids` é lido do banco via `CollaborationService.assignee_ids_for(task)`
**antes do commit**, na mesma transação — não é eco do payload. Se um dia a
atribuição filtrar ou deduplicar, a resposta acompanha sozinha.

### Guardas de regressão

Em `tests/integration/test_task_create_assignees_http_db.py`:

- `test_http_resposta_do_post_traz_assignee_ids` — falha se o `response_model`
  voltar a `TaskResponse`.
- `test_http_resposta_do_post_sem_responsavel_traz_lista_vazia` — o campo é
  sempre previsível (`[]`, nunca ausente).
- `test_http_patch_NAO_traz_assignee_ids` — **guarda na direção oposta**: se
  alguém "consertar" isto adicionando `assignee_ids` ao `TaskResponse` inteiro,
  este teste acusa, porque o PATCH voltaria a zerar o selo.

Verificado por sabotagem: revertendo o `response_model`, os dois primeiros
falham e o teste antigo (que confere o `GET`) **continua verde** — a
demonstração de que provar persistência não prova contrato de resposta.
