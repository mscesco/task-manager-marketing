# Spec 053 — Seguir tarefas e a tela de notificações

**Status:** escrita e **aprovada em 17/09/2026**. Todas as decisões de §4
vieram de dez rodadas de perguntas respondidas por ela no mesmo dia, e as oito
propostas da §9 foram aprovadas como escritas. **As seis fatias (A–F) foram
entregues em 17/09, no PR #61.** Falta a conferência dela na tela.
**Escopo:** backend (regras de seguidor, avisos novos, junção de avisos, filtros
de notificação e uma migration) e front (seguir no detalhe e na criação, filtro
em Minhas tarefas, textos do sino e a tela `/notificacoes`).
**Depende de:** a limpeza de 17/09 (branch `limpeza/links-e-codigo-morto`)
mergeada. Ela tira rotas e funções mortas das quais esta spec não depende, mas
os mesmos arquivos são mexidos (`collaboration_router.py`, `api.ts`,
`TaskModal.tsx`), e a fatia A precisa sair de uma `main` que já tem a limpeza.
**Placar na abertura:** a medir quando a fatia A começar, na `main` com a
limpeza. Na branch da limpeza, o front mede **1424**.

Os nomes seguem a regra do projeto (código novo em inglês, tela em
português): o código continua chamando de `watcher` (tabela, rotas, relação),
e a TELA diz **seguir**. Não se renomeia a tabela nem
a rota — endpoint é contrato.

---

## 1. De onde vem

Ela, em 17/09, ao ver que as rotas de observador existiam sem tela:

> *"os observadores eu vou incluir, por favor. Mas lembre que esse sim, por ser
> algo 'novo' acho que entra em spec (...) Quero que me pergunte absolutamente
> tudo o que precisar para fazer essa spec, até que não sobre nenhuma brecha"*

E, ao saber que o sino não tem texto para três tipos de aviso:

> *"entra na spec e se possível eu queria que tivesse um 'ver todas' no dropdown
> das notificações que leva pra uma tela que mostre pelo menos as notificações
> dos últimos 7 dias, ou uma paginação com as notificações, sabe? porque a
> galera que recebe muitas acaba perdendo"*

---

## 2. O que existe — medido em 17/09

### 2.1. Seguidor (observador) no backend

A funcionalidade existe inteira desde a Entrega 4 (Spec 004, ADR 0011) e
**nunca teve tela**.

- **Tabela** `task_watcher` (`backend/app/db/models/collaboration.py:98-125`):
  `id`, `workspace_id`, `task_id`, `user_id`, `created_at`, com
  `UNIQUE(task_id, user_id)`. Não guarda quem inscreveu.
- **Rotas** (`backend/app/modules/tasks/api/collaboration_router.py`):
  `GET/POST /tasks/{id}/watchers` e `DELETE /tasks/{id}/watchers/{user_id}`. O
  POST responde 201 quando cria e 200 quando já existia; o DELETE responde 200
  com a lista, ou 404 se o par não existia. Todas devolvem só ids.
- **Regras** (`collaboration_service.py:245-283`):
  - seguir a si mesmo exige só ver a tarefa;
  - inscrever outra pessoa exige `task.assign` — perguntado de forma **ampla**
    (`has_permission`, "tem em algum time") — mais `assert_editable`, e que o
    alvo alcance a tarefa (422);
  - tirar outra pessoa exige o mesmo par, **sem** checar alcance.
- **Arquivada:** o backend aceita seguir e deixar de seguir.
- **Detalhe da tarefa:** `GET /tasks/{id}` já devolve `watcher_ids`. A listagem
  não traz esse campo (ADR 0025).
- **`/me/assignments`** já tem a relação `watcher` (`me_router.py`).
- **Perda de alcance da PESSOA:** quando a pessoa muda de time,
  `_remover_relacoes_perdidas` (`member_service.py`) tira dela os vínculos de
  responsável **e** de observador e emite `ACCESS_LOST`.
- **Perda de alcance da TAREFA:** quando a tarefa troca de time (`PATCH
  team_id`) ou de projeto (`POST /move`), **nada** é revalidado — nem
  seguidores, nem responsáveis.
- **Histórico:** a ADR 0012 deixou seguir fora do histórico.
- **Duplicar:** não copia seguidores (Spec 033, D11).

### 2.2. Seguidor no front

**Não existe.** `web/lib/api.ts` não tem nenhuma função de observador, e o tipo
`Task` ignora o `watcher_ids` que o backend manda. Minhas tarefas mantém o
rótulo `watcher: "Acompanho"` (`web/app/minhas-tarefas/page.tsx:61-68`) para
quem foi inscrito por API ou n8n. O filtro "Que acompanho" saiu com o
comentário *"Voltar aqui QUANDO existir o botao de acompanhar"*.

### 2.3. Notificações

- **Tipos** (`notifications/domain/notification.py:16-34`): `TASK_ASSIGNED`,
  `TASK_COMMENTED`, `TASK_MENTIONED`, `TASK_DUE_SOON`, `TASK_OVERDUE`,
  `ACCESS_LOST`, `TASK_COMMENT_REACTED`. A coluna `type` é `String(40)`: tipo
  novo não exige migration.
- **Emissor** (`notification_emitter.py`): um método por tipo, grava dentro de
  `begin_nested()` e nunca derruba a ação que o disparou.
- **Destinatários de comentário:** responsáveis + criador, menos o autor e menos
  os mencionados (`comment_service.py:227-246`). **Não confere alcance** — ao
  contrário de menção e reação, que conferem.
- **Leitura:** `GET /notifications?unread_only&page&size`, `GET /unread-count`,
  `POST /read-all` (sem filtro) e `POST /{id}/read`. O repositório
  (`notification_repository.py`) não filtra por tipo, tarefa ou projeto.
- **Modelo:** não tem `updated_at`, e o docstring diz *"nasce e só muda
  read_at"*. A migration `0002_notifications.py` criou índices por
  `(recipient_id, read_at)`, `(recipient_id, created_at DESC)` e
  `(workspace_id)`. **Nada é apagado, nunca.**
- **Sino** (`web/components/NotificationBell.tsx`): consulta a cada 30 s,
  mostra as 20 mais novas e não tem "ver todas". Quem recebe muitos avisos perde
  os anteriores — é a queixa dela.
- **Texto** (`web/lib/notificacoes.ts:64-79`): só quatro tipos têm frase.
  `TASK_DUE_SOON`, `TASK_OVERDUE` e `ACCESS_LOST` caem em `Atualização em "uma
  tarefa"`. **É defeito em produção**, e esta spec o conserta.
- ⚠️ **Texto que promete o que o código não faz:** `notificacoes.ts:11-13` diz
  que *"watcher recebe aviso de comentário"*. Não recebe.

### 2.4. Onde os eventos acontecem

- **Mudança de coluna** é `PATCH /tasks/{id}` com `column_id` ou `status`
  (`task_service.update`). ⚠️ **`POST /move` NÃO muda coluna**: ele troca pai ou
  projeto.
- ⚠️ **O mesmo `update` é chamado em LOOP** por `BoardService.apagar_coluna`
  (`board_service.py:1335-1345`), uma vez por tarefa, com o mesmo ator e sem
  marca de lote. Emitir o aviso "dentro do `update`" pegaria o lote de colunas —
  que a decisão D16 exclui.
- **Cascata ao concluir a mãe:** `complete_descendants` faz um UPDATE por SQL,
  sem ORM e sem histórico por filha.
- **Prazo:** o front manda `start_date`, `due_date` e `due_time` **juntos em
  todo PATCH de datas** (`TaskDetail.tsx:934-938`). "O prazo mudou" tem de
  comparar valores, e não `fields_set`. E `due_time` não entra no diff do
  histórico hoje.
- **Descrição:** `PATCH description`, uma vez por edição (Salvar, clicar fora ou
  Ctrl+Enter — Spec 052, fatia D).
- **Arquivar à mão:** `POST /tasks/{id}/archive|unarchive`, com cascata na
  subárvore e uma linha de histórico só na raiz.
- **Job `archive-stale`** (n8n): outro método, `archive_stale`. O ator é um
  admin resolvido pelo job.
- **Reativar** no front é um PATCH `status: BACKLOG` **seguido** de `unarchive`
  (`api.ts`). Um gesto, dois eventos.
- **Excluir:** `DELETE /tasks/{id}` → `soft_delete`, com cascata na subárvore.
  **Restaurar tarefa não existe no produto.** Há só um script SQL, e para
  quadros (`backend/scripts/restaurar_quadro.sql`).
- **Histórico** (`task_history`): só aceita inserção, é gravado pelo backend e
  **não tem tela nem rota de leitura**.

---

## 3. O que esta spec entrega, em uma frase por parte

1. **Seguir:** qualquer pessoa que vê uma tarefa pode segui-la. Quem pode editar
   a tarefa também põe e tira outras pessoas.
2. **Avisos novos:** coluna, prazo, descrição, arquivar e excluir avisam quem
   segue, os responsáveis e o criador. Rajadas da mesma pessoa se juntam num
   aviso só.
3. **Trava:** nenhum aviso, de nenhum tipo, vai para quem não alcança a tarefa.
4. **O sino ganha texto** para os três tipos que não tinham, e um "Ver todas".
5. **`/notificacoes`:** tudo, paginado, com abas, filtros e "marcar estas como
   lidas".

---

## 4. Decisões dela (17/09)

### Seguir

- **D1 — Nome.** A tela diz **Seguir**:
  - botão "Seguir" / "Deixar de seguir";
  - lista "Seguidores";
  - selo "Sigo" e filtro "Que sigo" em Minhas tarefas, trocando o "Acompanho"
    de hoje.
- **D2 — Quem inscreve quem.**
  - Quem **vê** a tarefa pode seguir e deixar de seguir.
  - Quem pode **editar** a tarefa também põe e tira outras pessoas, desde que
    elas alcancem a tarefa.
- **D3 — Ninguém segue automaticamente.** Nem o criador, nem os responsáveis.
  Seguir é sempre um gesto.
- **D4 — Onde aparece:**
  - no detalhe da tarefa;
  - no filtro de Minhas tarefas;
  - na criação da tarefa.
  - **Não** aparece no card do quadro.
- **D5 — Detalhe.**
  - Uma linha **"Seguidores"** logo abaixo de "Responsáveis", com o mesmo
    desenho: pílulas com avatar e o botão `+`.
  - No topo do detalhe, o botão **"Seguir" / "Deixar de seguir"**, para o gesto
    de um clique.
- **D6 — Criação.** O campo "Seguidores" do modal de criação **nasce vazio**.
- **D7 — Minhas tarefas.**
  - "Todas" inclui as tarefas que eu sigo, com o selo "Sigo".
  - O filtro "Que sigo" volta.
- **D8 — Subtarefas:** cada uma à parte. Seguir a mãe não cobre as filhas, e a
  filha não herda seguidores.
- **D9 — Duplicar não copia seguidores.** A D11 da Spec 033 continua valendo.
- **D10 — Arquivada.** A lista de seguidores aparece, mas **não dá para entrar
  nem sair**. Arquivar não apaga seguidores: ao desarquivar, eles continuam lá.
- **D11 — Desativado.** Aparece riscado, com "(desativado)", como nos
  responsáveis. Dá para tirá-lo, e ele não recebe nada.
- **D12 — Perde acesso porque a TAREFA mudou de time ou de projeto:** sai da
  lista de seguidores **automaticamente**.
- **D13 — Histórico.** Entrar e sair como seguidor **é gravado** no histórico,
  sempre, inclusive a saída automática de D12. **Isso revoga a ADR 0012 na parte
  de observador.**
  - A tela de histórico **não** entra nesta spec: vira spec própria, que já
    nasce com esses eventos.

### Avisos

- **D14 — Eventos que avisam:**
  - comentário novo;
  - mudança de coluna;
  - edição do **prazo** (data ou hora, inclusive tirar o prazo);
  - edição da **descrição**;
  - **arquivar e desarquivar à mão**;
  - **excluir** a tarefa.
  - **Não avisam:** título, prioridade, responsáveis, links, projeto e prazo
    chegando.
- **D15 — Destinatários dos avisos de tarefa: seguidores + responsáveis +
  criador**, menos quem fez a ação.
  - Deixar de seguir **não** silencia responsável nem criador.
  - Um só aviso por pessoa, mesmo que ela tenha os três papéis.
  - A menção continua tendo prioridade: quem foi mencionado num comentário
    recebe só o aviso da menção (Spec 019, D3).
- **D16 — Só o gesto direto avisa.** Não avisam:
  - a cascata de conclusão para as subtarefas;
  - as tarefas movidas por apagar coluna no lote;
  - o arquivamento automático do job `archive-stale`.
- **D17 — Ser posto ou tirado por outra pessoa avisa quem foi posto ou tirado:**
  "Ana colocou você para seguir X" / "Ana tirou você de X".
- **D18 — Junção de avisos.** Avisos do mesmo autor, na mesma tarefa, do mesmo
  tipo e para o mesmo destinatário, em até **10 minutos** e **ainda não lidos**,
  viram **um** aviso, atualizado para o estado final.
  - **Vale para:** coluna, prazo, descrição, arquivar/desarquivar e
    colocar/tirar como seguidor.
  - **Quando o estado final é igual ao inicial, o aviso some.** Mover de A para
    B e de volta para A some; colocar e tirar como seguidor se anulam.
  - **Comentário e menção nunca se juntam:** cada um tem conteúdo próprio.
- **D19 — Trava: nenhum aviso, de nenhum tipo, vai para quem não alcança a
  tarefa** no momento do envio. Isso inclui os tipos que já existem. O aviso de
  comentário hoje não confere, e passa a conferir.
  - Responsáveis que perderam acesso **continuam** responsáveis, como hoje.
    Tirá-los esbarra na ADR 0031 e fica como pendência (§8).

### Sino e tela de notificações

- **D20 — O sino ganha texto** para `TASK_DUE_SOON`, `TASK_OVERDUE` e
  `ACCESS_LOST`, e um link **"Ver todas"** no rodapé do dropdown.
- **D21 — `/notificacoes` mostra TUDO, paginado.**
  - Mais novas primeiro, agrupadas por dia (Hoje, Ontem, 15/09…).
  - Nada é apagado: não há rotina de limpeza.
- **D22 — Filtros:**
  - abas **Não lidas / Todas**;
  - **por tipo**;
  - **por tarefa ou projeto**.
- **D23 — Filtro por tarefa ou projeto:** um campo "Tarefa ou projeto" que
  sugere enquanto se digita, **só entre as tarefas e projetos que aparecem nas
  minhas notificações**. Cada aviso também tem o atalho "só desta tarefa". O
  filtro fica na URL.
- **D24 — Ações:**
  - "Marcar todas como lidas";
  - abrir um aviso leva à tarefa e o marca como lido.
  - **Sem** "marcar como não lida" e **sem** apagar aviso.
- **D25 — "Marcar todas" respeita o filtro.** Com filtro ativo, o botão diz
  "Marcar estas N como lidas" e marca só essas.
- **D26 — Acesso só pelo sino.** O menu lateral não muda.
- **D27 — Aviso de tarefa inacessível**, no sino e na tela: aparece **apagado e
  sem link**, com "tarefa excluída ou sem acesso", **sem o título**.

---

## 5. Os textos dos avisos

Proposta para a revisão. Todos seguem a forma dos quatro que existem
(`${ator} … "${tarefa}"`), no masculino universal da tela.

| Tipo (código) | Texto |
|---|---|
| `TASK_DUE_SOON` *(existe, sem texto)* | `"X" vence em 20/09` · no dia: `"X" vence hoje` (o job avisa de hoje a hoje+2, e o payload só traz a data) |
| `TASK_OVERDUE` *(existe, sem texto)* | `"X" está atrasada` |
| `ACCESS_LOST` *(existe, sem texto)* | `Ana mudou seu time: você deixou de ter acesso a 3 tarefas` · com uma: `a 1 tarefa` |
| `TASK_COLUMN_CHANGED` | `Ana moveu "X" de Em andamento para Concluído` |
| `TASK_DUE_CHANGED` | `Ana mudou o prazo de "X" para 20/09 18:00` · sem prazo: `Ana tirou o prazo de "X"` |
| `TASK_DESCRIPTION_CHANGED` | `Ana editou a descrição de "X"` |
| `TASK_ARCHIVED` | `Ana arquivou "X"` |
| `TASK_UNARCHIVED` | `Ana desarquivou "X"` |
| `TASK_DELETED` | `Ana excluiu "X"` |
| `TASK_WATCH_ADDED` | `Ana colocou você para seguir "X"` |
| `TASK_WATCH_REMOVED` | `Ana tirou você de "X"` |
| qualquer tipo, tarefa inacessível (D27) | `Ana moveu uma tarefa` + selo "tarefa excluída ou sem acesso" |

- ⚠️ **O `ACCESS_LOST` conta tarefas em que a pessoa só observava**
  (`member_service.py:445`). Por isso o texto fala em "acesso a N tarefas" e
  não em "deixou de ser responsável", como dizem a ADR 0038 E9 e o docstring do
  emissor. Os dois textos são corrigidos na fatia A.
- ⚠️ **Datas passam por `lib/prazo.ts`** (`web/AGENTS.md` §0.1).
- ⚠️ **As colunas vão no payload como NOME**, e não como id. O aviso é retrato
  do momento: se a coluna for renomeada depois, ele continua dizendo o que
  aconteceu.

---

## 6. Consequências técnicas

### 6.1. Permissão de pôr e tirar outra pessoa (D2)

`_assert_can_manage_others` passa a perguntar **no time do item**, como a Spec
051 consolidou: `has_permission_in("task.assign", task.team_id)` +
`assert_editable`.
- Tirar outra pessoa também passa a exigir isso. O alcance **não** é conferido
  na saída, para que dê para tirar quem já não alcança.
- A metade "vê mas não tem `task.assign` → 403" dos testes atuais, que a
  pergunta ampla tornava inalcançável, volta a ser testável.

### 6.2. Arquivada é só leitura (D10)

`add_watcher` e `remove_watcher` recusam tarefa arquivada com **422**
`tarefa_arquivada`, inclusive para si mesmo. O front esconde `+`, `×` e o botão
Seguir, e mantém a lista visível.
- ⚠️ **A saída automática (D12) e a remoção por perda de alcance da pessoa
  continuam valendo em tarefa arquivada**, porque a trava é de gesto, não de
  estado. Hoje `relacoes_perdidas` **ignora** arquivadas
  (`task_repository.py:1044-1047`); isso fica como está, e a trava D19 cobre o
  vazamento.

### 6.3. Mudança de coluna só pelo gesto direto (D16)

O aviso **não** é emitido dentro de `TaskService.update`. Ele sai do **router**
do `PATCH /tasks/{id}`, depois do `update`, quando a coluna mudou. Assim:
- o loop de `apagar_coluna` (que chama o serviço, não a rota) não avisa;
- a cascata `complete_descendants` (SQL) não avisa.

O mesmo vale para prazo e descrição (mesmo PATCH) e para arquivar, desarquivar e
excluir (as rotas de gesto). O job `archive-stale` usa outro método e não passa
por essas rotas.
- ⚠️ **Guardião obrigatório:** um teste HTTP que apaga uma coluna com tarefas
  seguidas no lote e afirma **zero** avisos novos. Sem ele, mover a emissão para
  o serviço "por organização" reabre a rajada em silêncio.

### 6.4. Prazo compara valor (D14)

"O prazo mudou" = `(due_date, due_time)` **antes** ≠ **depois**. Não se usa
`fields_set`, porque o front manda os três campos em todo PATCH de datas. Mudar
só `start_date` não avisa.

### 6.5. Reativar é um gesto só

"Reativar" manda PATCH de status e depois `unarchive`. Pela D18, o aviso de
**desarquivar absorve** um aviso de coluna do mesmo autor e tarefa, ainda não
lido, dentro da janela. Quem segue recebe "Ana desarquivou X", e não dois
avisos.

### 6.6. Junção de avisos (D18) — precisa de migration

A tabela não tem como achar "o aviso não lido deste autor, tarefa, tipo e
destinatário nos últimos 10 minutos", nem como registrar que ele mudou. A
migration **0027**:
- acrescenta `notification.updated_at` (não nulo, padrão = `created_at`);
- cria um índice parcial `(recipient_id, task_id, type, actor_id, updated_at)
  WHERE read_at IS NULL`.

**Regra da junção:**
- **Mudança de coluna:** o payload guarda `from_column` do **primeiro** evento e
  atualiza `to_column`. Se `to == from`, o aviso é **apagado**.
- **Prazo:** guarda o prazo anterior do primeiro evento e o novo do último. Se
  forem iguais, apaga.
- **Descrição:** só atualiza `updated_at`. Salvar o mesmo texto não chega a ser
  PATCH com mudança.
- **Arquivar ↔ desarquivar**, na janela, se anulam.
- **Colocar ↔ tirar como seguidor**, na janela, se anulam.

**Ordenação:** o sino e a tela passam a ordenar por `updated_at DESC`: o aviso
atualizado sobe para o topo.

⚠️ **Apagar notificação** é a primeira remoção desta tabela. O docstring do
modelo (*"nasce e só muda read_at"*) é corrigido na mesma fatia.

⚠️ **Portão de DRIFT** (AGENTS.md §5): esta fatia mexe em tabela.

### 6.7. A trava (D19) em lote

Não existe `user_can_view_task` em lote hoje: todo consumidor faz loop. A fatia A
cria `user_ids_that_can_view_task(session, task, user_ids) -> set[UUID]`, **uma
consulta** montada a partir de `task_visible` / `_lente_de_time`. Todo aviso de
tarefa passa por ela antes de gravar, inclusive os que já existem:
- comentário;
- menção e reação, que hoje fazem loop;
- prazo.

### 6.8. Saída automática por troca de time ou projeto (D12)

Depois de `PATCH team_id` e de `POST /move` (troca de projeto), o serviço
recalcula quem entre os **seguidores** deixou de alcançar a tarefa e os remove,
gravando `unwatched` no histórico com `reason: "lost_access"`.
- **Não avisa** quem saiu: o aviso mostraria o título de uma tarefa que a pessoa
  não pode mais ver.
- Responsáveis não saem (D19, pendência §8).
- ⚠️ As funções que existem (`relacoes_perdidas`, `apagar_relacoes`) giram em
  torno do **usuário**. Esta é centrada na **tarefa** e na subárvore: trocar o
  projeto da mãe troca o das filhas (`reparent_subtree`).

### 6.9. Histórico (D13)

`history.py` ganha `watched` e `unwatched`, com `metadata`:
- `target_user_id`;
- `by_self: bool`;
- `reason`: `"manual"`, `"lost_access"` ou `"created_with"`.

Sem migration, porque `event_type` é `String(80)`, como a ADR 0012 previu. A
ADR 0012 ganha nota de revogação parcial.

### 6.10. Seguidores na criação (D6)

- `watcher_ids: list[UUID]` entra em `TaskCreateRequest`, **numa linha própria
  no router** (`tasks_router.py:201-230`) e em `CreateTaskCommand`.
  - ⚠️ **O Pydantic descarta campo desconhecido em silêncio** (AGENTS.md §1).
- No front, `createTask` monta o corpo campo a campo:
  - ⚠️ **precisa de linha em `createTask` e de caso novo em
    `createTaskCorpo.test.ts`** (AGENTS.md §9).
- A validação é atômica, como `assign_many_or_fail`: quem não alcança o time
  dá 422 com `invalid_ids`, e nada é criado.
- Candidatos: `GET /members?reaches_team=`, a mesma lista de responsáveis.
- Cada seguidor que não é o autor recebe `TASK_WATCH_ADDED`, e o histórico
  grava `watched` com `reason: "created_with"`.

### 6.11. Tela de notificações — backend (D21–D25, D27)

- **`GET /notifications`** ganha `type` (repetível), `task_id`, `project_id` e
  `updated_at` na resposta, mais `task_access: "ok" | "gone"`.
  - `"gone"` = tarefa excluída **ou** fora do alcance, calculado em lote no
    servidor.
  - Com `"gone"`, o servidor **tira `task_title` do payload** da resposta (D27).
    A trava é do servidor, não da tela.
  - `project_id` exige join com `task`, porque `notification` não tem projeto.
- **`GET /notifications/targets?q=`** devolve até 10 tarefas e projetos que
  aparecem nas notificações do usuário, filtrados pelo texto e só entre os que
  ele ainda alcança (D23).
- **`POST /notifications/read-all`** aceita os **mesmos filtros** do GET
  (D25). Sem filtro, o comportamento de hoje continua.
- **`GET /notifications/unread-count`** não muda.

### 6.12. Tela de notificações — front

- **Rota `/notificacoes`**, dentro do `AppShell`.
  - `PageHeader` "Notificações", com a contagem de não lidas.
  - `Tabs` Não lidas / Todas.
  - Seletor de tipo e campo "Tarefa ou projeto".
- **Lista** agrupada por dia no fuso de Brasília, via `lib/prazo.ts`.
- **Paginação:** 20 por página, com o rodapé "X–Y de N · Anterior · Próxima".
  - ⚠️ **Não há componente de paginação compartilhado:** há duas cópias locais
    (`solicitacoes/page.tsx:274-326` e `arquivadas/page.tsx:333-355`). A fatia F
    extrai `components/Paginacao.tsx` e faz as duas telas usarem o primitivo, em
    vez de criar uma terceira cópia.
- **URL:** abas, tipo, tarefa ou projeto e página ficam na URL (`web/AGENTS.md`
  §5).
- ⚠️ **`useSearchParams` em rota estática derruba o `next build`** (AGENTS.md
  §6): `/notificacoes` precisa de `Suspense`.
- **Estados:** vazio ("Nenhuma notificação" / "Nenhuma notificação com esses
  filtros", com "Limpar filtros"), carregando e erro.

---

## 7. Fatias

Um PR para a spec inteira, um commit por fatia, com o CI conferido a cada
commit, com a branch saindo de `main`.

| Fatia | O quê | Portões extras |
|---|---|---|
| **A** | Trava em lote (§6.7) aplicada aos avisos existentes; textos de `DUE_SOON`, `OVERDUE` e `ACCESS_LOST` no sino (§5); correção de `notificacoes.ts:11-13`, do docstring do emissor e nota na ADR 0038 E9 | — |
| **B** | Backend de seguidor: permissão no time do item (§6.1), arquivada só leitura (§6.2), histórico (§6.9), `TASK_WATCH_ADDED/REMOVED`, `watcher_ids` na criação (§6.10), saída automática (§6.8) | teste HTTP de cada rota |
| **C** | Migration 0027 e junção (§6.6); seguidores entram no aviso de comentário (D15); avisos de coluna, prazo, descrição, arquivar/desarquivar e excluir, emitidos nas rotas (§6.3–6.5) | **drift**; guardião do lote de colunas |
| **D** | Front de seguir: tipos e funções em `api.ts`, linha "Seguidores" e botão no detalhe, campo na criação, filtro "Que sigo" e selo "Sigo" | `createTaskCorpo.test.ts` |
| **E** | Backend da tela: filtros, `task_access`, `targets`, `read-all` filtrado (§6.11) | teste HTTP |
| **F** | Front da tela: `/notificacoes`, "Ver todas" no sino, `Paginacao` extraída, textos dos tipos novos, aviso inacessível (D27) | `next build` (Suspense) |

**Ordem:** A → B → C → D → E → F. D depende de B. F depende de C e E.

---

## 8. Fora do escopo — e onde fica registrado

- **Tela de histórico da tarefa.** É spec própria; esta só grava (D13).
- **Responsável que perde acesso quando a tarefa muda de time continua
  responsável.** Ele para de receber avisos (D19), mas continua na tarefa, e
  tirá-lo esbarra na regra do último responsável (ADR 0031). Pendência
  registrada aqui e no docstring de §6.8.
- **Restaurar tarefa:** não existe no produto, então não há aviso de restaurar.
- **`due_time` fora do diff do histórico** (§2.4): continua fora. Esta spec
  avisa a mudança de hora, mas não corrige o histórico.
- **Card do quadro com sinal de "sigo"** (D4): fora. Exigiria `watcher_ids` na
  listagem, que a ADR 0025 deixou de fora.
- **E-mail e push:** não existem no produto.

---

## 9. Propostas que nenhuma pergunta cobriu — APROVADAS em 17/09

Nenhuma pergunta cobriu estes pontos. Foram escritos como proposta e aprovados
como estão, na revisão da spec inteira. O item 2 decide a tensão com a D27: o
aviso de exclusão **mostra** o título.

1. **Exclusão em cascata (§2.4).** Excluir a mãe exclui as filhas, mas só a
   **mãe** avisa, pela mesma regra do gesto direto (D16). Quem segue só uma
   subtarefa não fica sabendo.
2. **Aviso de exclusão × D27.** O aviso "Ana excluiu X" **mostra o título**:
   quem recebe via a tarefa até o momento da exclusão. Os avisos anteriores da
   mesma tarefa passam a aparecer sem título.
   - ⚠️ Isso **contradiz a letra** da D27 ("sem o título") para tarefa excluída.
     A alternativa é tirar o título também do aviso de exclusão, e ele vira
     "Ana excluiu uma tarefa".
3. **Saída automática (§6.8) não avisa** quem saiu.
4. **Arquivada recusa seguir a si mesmo também** (§6.2). A D10 dizia "não dá
   para entrar nem sair", e isso foi lido como valendo para todo mundo.
5. **Reativar vira um aviso só** (§6.5).
6. **20 avisos por página** na tela, e **10 sugestões** no campo de busca.
7. **Texto do `ACCESS_LOST`** fala em "acesso", e não em "responsável" (§5).
8. **Mudar só a data de início não avisa** (§6.4).

---

## 10. Critérios de aceite

1. Quem vê uma tarefa segue e deixa de seguir pelo botão do topo; a linha
   "Seguidores" atualiza sem recarregar.
2. Quem pode editar põe outra pessoa pelo `+`; a lista só oferece quem alcança
   a tarefa; a pessoa posta recebe "colocou você para seguir".
3. Quem **não** pode editar não vê o `+`. Se forçar pela API, recebe 403.
4. Tarefa arquivada mostra os seguidores sem `+`, sem `×` e sem botão; a API
   recusa com 422.
5. Criar tarefa com seguidores grava tudo numa transação. Um seguidor fora do
   alcance recusa a criação inteira com `invalid_ids`.
6. Mover a tarefa de coluna à mão avisa seguidores, responsáveis e criador,
   menos quem moveu. **Apagar a coluna no lote não avisa ninguém.**
7. Mover de A para B e voltar para A em menos de 10 minutos, sem ninguém ler,
   não deixa aviso.
8. Salvar a descrição três vezes em dois minutos deixa **um** aviso não lido.
9. Mudar só a hora do prazo avisa; mudar só a data de início não avisa.
10. Uma tarefa que muda de time tira os seguidores que não alcançam o time novo;
    o histórico registra `unwatched` com `lost_access`.
11. Um responsável que perdeu acesso **não** recebe o aviso de comentário.
12. O sino mostra textos próprios para prazo chegando, atrasada e perda de
    acesso, e tem "Ver todas".
13. `/notificacoes` pagina tudo, agrupa por dia, e filtra por aba, tipo e
    tarefa ou projeto; o filtro sobrevive a recarregar a página.
14. "Marcar estas N como lidas" com filtro marca só essas; o contador do sino
    cai exatamente N.
15. Aviso de tarefa inacessível aparece apagado, sem link e sem título.
16. Minhas tarefas: "Todas" traz as tarefas que eu sigo com o selo "Sigo"; "Que
    sigo" traz só essas.

---

## 11. Textos que esta spec corrige ou revoga

- **ADR 0012:** observador fora do histórico → **revogada** na parte de
  observador (D13).
- **Spec 004, decisão 5 / R4 / W2**, e comentários do `collaboration_service`:
  prometem 409 para projeto pessoal monouser, que não existe desde 10/09 → nota.
- **Spec 004, decisão 10 / docstring de `tests/test_collaboration.py:8`:**
  "criador sempre vê", revogado pela ADR 0038 → nota e docstring.
- **Spec 004, tabela de contratos:** diz "200/204" no DELETE de observador; o
  código sempre devolve 200 → nota.
- **Spec 023, D2:** "sem watchers" nos avisos de prazo → continua valendo
  (D14 não inclui prazo chegando).
- **`web/lib/notificacoes.ts:11-13`:** promete aviso de comentário ao observador,
  que hoje não existe → a fatia A tira a promessa, e a fatia C a torna verdade
  (e reescreve a frase).
- **`web/app/minhas-tarefas/page.tsx:77-87`:** "voltar aqui QUANDO existir o
  botão" → a fatia D volta.
- **ADR 0038 E9 e docstring de `notification_emitter.py:257`:** "deixou de ser
  responsável por N tarefas" → corrigidos para "acesso" (§5).
