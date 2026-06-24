# Entrega 11 — Projetos (pasta) + minhas-tarefas clicavel

> **Status:** Entregue
> **Tipo:** front sobre backend pronto (projetos existem desde a E1; uma
> mudanca de contrato no `createSubtask`/`createTask` por causa do projeto).
> **Migration:** nenhuma.
> **ADRs:** front `0005` (board compartilhado), `0006` (projeto-pasta no raiz).

## O que entregou (linguagem de produto)

1. **Minhas tarefas** deixou de ser so visual: o card abre o painel de
   detalhe (ler, editar, designar, ver/criar subtarefas suas).
2. **Projetos** como pasta: criar um projeto, ver a lista, abrir um projeto e
   trabalhar num **quadro so dele**.
3. As tasks de projeto continuam no **quadro geral** (panorama), agora com uma
   **tag** dizendo de qual projeto sao.
4. Criar task dentro de um projeto por dois caminhos: na pagina do projeto, ou
   escolhendo o projeto no "+ Nova tarefa" do quadro geral.

## Decisões cravadas

1. **Projeto = pasta no time raiz.** Todos veem; designar e so na task;
   projeto nao tem membros proprios. — ADR 0006.
2. **Panorama + tag.** Task de projeto aparece no quadro geral com a tag do
   nome do projeto; avulsa sem tag; no quadro do projeto a tag e escondida
   (redundante). — ADR 0006.
3. **Board unico.** O kanban foi extraido pra `components/Board.tsx`,
   parametrizado por `projectId`; geral e projeto usam o mesmo. — ADR 0005.
4. **Subtarefa compartilha o `project_id` do pai** (o backend exige). O
   `createSubtask` repassa o projeto do pai. — ADR 0006.
5. **Minhas tarefas** reusa `TaskDetail`/`TaskModal`. A sublista de subtarefas
   ali mostra so as subtarefas que tambem sao suas (a fonte e a lista de
   "minhas tarefas", nao a arvore inteira) — coerente com a pagina.

## Endpoints usados

- `GET /projects` (lista; front descarta `is_personal`).
- `POST /projects` `{title, team_id}` — `team_id` = time raiz (pin).
- `GET /projects/{id}` — titulo da pagina do projeto.
- `POST /projects/{id}/archive` e `/unarchive`, `PATCH /projects/{id}` —
  na surface do `api.ts` (ainda sem UI dedicada).
- `GET /tasks?project_id=...` — quadro do projeto.
- `POST /tasks` com `project_id` — criar dentro do projeto (ou avulsa).
- `POST /tasks` com `parent_task_id` + `project_id` do pai — subtarefa.

## Limitações conhecidas (nao sao bugs)

- **Acoplamento do board.** Mudanca em `Board.tsx` afeta o quadro geral; mexer
  ali exige smoke do geral, nao so do projeto. — ADR 0005.
- **"Minhas tarefas" mostra so subtarefas suas** dentro de uma task (a fonte e
  a lista de assignments, nao a arvore completa).
- **Bolinhas de responsavel vazias** na primeira abertura em minhas-tarefas
  (o `/me/assignments` nao manda `assignee_ids`). Decisao: manter assim.

## Fora de escopo (registrado pra proxima)

- **Excluir projeto no front.** Backend deleta com **cascata** nas tasks
  (mesmo risco do excluir-task); quando entrar, **aviso de cascata obrigatorio**.
- **Mover task avulsa -> projeto** pela tela. `POST /tasks/{id}/move` aceita
  `project_id`; a UX foi adiada (criar-dentro-do-projeto cobre o caso comum).
- **Projeto restrito a um grupo de pessoas (= Times).** Exige expor Times no
  front e encarar o E6. Frente propria.

## Verificação (smoke manual)

- Minhas tarefas: clicar abre o detalhe; editar reflete na linha; designar
  funciona.
- Projetos: criar projeto persiste; pessoal nao aparece na lista; abrir um
  projeto mostra o quadro filtrado dele.
- Quadro geral **sem regressao** (arrasto persiste, abrir/criar/designar).
- Tag: task de projeto com tag no geral; avulsa sem tag; sem tag no projeto.
- Criar com projeto (no geral) -> aparece no geral com tag e no quadro do
  projeto; criar "Nenhum" -> avulsa sem tag.
- Subtarefa numa task de projeto cria **sem erro**; numa avulsa tambem.
