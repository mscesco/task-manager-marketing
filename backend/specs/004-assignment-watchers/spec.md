# Entrega 4 — Assignment + Watchers

> **Status:** Accepted
> **Módulos afetados:** `app/modules/tasks/`, `app/modules/auth/domain/permissions.py`
> **ADRs relacionados (a marcar como Accepted após aprovação):**
> - `docs/adr/0010-assignment-escopo-edicao.md`
> - `docs/adr/0011-watcher-self-service.md`
> - `docs/adr/0012-history-assignment-granularidade.md`
> - `docs/adr/0013-criador-sempre-ve.md`
>
> **Sem migration de schema.** As tabelas `task_assignment` e `task_watcher`
> já existem desde o baseline v5 (migration `0001`), com `UNIQUE(task_id,
> user_id)` e FKs compostas com `workspace_id`. `task_history.event_type`
> é `String(80)` livre — eventos novos não exigem alteração de banco.
> `/me/assignments` ficou **fora** desta entrega (evita o índice extra em
> `task_assignment(user_id)` e mantém a fatia enxuta).

---

## O que esta entrega entrega (em linguagem de produto)

Hoje uma tarefa tem time, mas não tem **gente**. Ninguém é o "responsável"
e ninguém "acompanha" uma tarefa sem ser dono dela. Esta entrega adiciona
duas relações entre pessoas e tarefas, com semânticas distintas:

- **Responsável (assignee)** — quem vai *fazer* a tarefa. Designar é uma
  ação de coordenação: quem coordena o quadro decide quem toca o quê.
- **Observador (watcher)** — quem quer *acompanhar* a tarefa sem ser
  responsável. Você se inscreve no que te interessa.

Depois desta entrega:

- Uma tarefa pode ter **N responsáveis** (a tabela é N:N; o frontend pode
  mostrar 1 ou vários — decisão de UI, não do backend).
- Qualquer pessoa que **enxerga** uma tarefa pode **se inscrever** como
  observadora dela, sozinha, sem pedir permissão a ninguém.
- Quem **coordena** uma tarefa (tem `task.assign` e a edita) pode designar
  responsáveis e inscrever terceiros como observadores.
- **Ser responsável não dá direito de editar.** Quem edita continua sendo
  definido pelo *time* da tarefa (Entrega 3). O responsável é um rótulo de
  "isto é seu pra fazer", não uma chave de edição.
- Designar/desatribuir aparece na **timeline** da tarefa; observar não
  (observador é ruído de baixa sinalização — a timeline é sobre o
  trabalho, não sobre a plateia).

### Frase-âncora

**O time decide quem edita; o assignment decide quem é responsável; o
watcher decide quem acompanha. São três eixos independentes.**

---

## Decisões fechadas (resolvidas com a dona antes desta spec)

1. **Assignment é mutação e reusa a trava de edição.** Para mexer nos
   responsáveis de uma tarefa, o **ator** precisa de `task.assign` **e**
   passar pelos dois gates existentes da tarefa: `_assert_visible_via_project`
   (404 se nem vê) e `_assert_editable` (403 se vê mas está fora do escopo
   de edição). Uma regra só: *você gerencia responsáveis das tarefas que
   você pode editar.* (ADR 0010)
2. **O responsável precisa alcançar a tarefa.** Ao designar alguém, o
   `team_id` da tarefa tem que estar na **lente de visibilidade** desse
   alguém (resolvida com os memberships dele pelo `team_scope`), ou ele
   ser admin, ou ser o dono no caso de tarefa pessoal. Senão → **422**
   (`assignee não alcança a task`). Evita responsável "morto", designado a
   uma tarefa que ele nem consegue abrir. (ADR 0010)
3. **Assignment NÃO concede edição.** O responsável só edita a tarefa se o
   `team_id` dela já estiver no escopo de edição dele pelas regras da
   Entrega 3. Designar não muda permissão de ninguém. (ADR 0010)
4. **Watcher é self-service para si; permissão para terceiros.**
   Inscrever-se a si mesmo exige apenas **enxergar** a tarefa (passa no
   gate 404). Inscrever **outra pessoa** exige `task.assign` + escopo de
   edição (mesmo gate do assignment). (ADR 0011)
5. **Pessoal é monouser.** Em tarefa de projeto pessoal, só o **dono**
   pode ser responsável ou observador; qualquer outro `user_id` → **409**
   (`pessoal é monouser`).
6. **`OPERATOR` ganha `task.assign`.** Um operador edita o quadro geral e o
   próprio subtime (Entrega 3); faltava só a permissão de designar pra
   poder distribuir trabalho nesse escopo. Concedida no mapa estático.
7. **History:** `assigned` e `unassigned` viram evento (metadata
   `{user_id, assigned_by}`); watcher add/remove **não** entram na
   timeline. (ADR 0012)
8. **Idempotência:** re-adicionar responsável/observador já existente →
   **200 no-op** (devolve o estado atual, sem duplicar nem gravar
   history). Remover quem não está lá → **404** (contrato claro). O 409
   fica reservado pra violação real (pessoal monouser).
9. **Forma da resposta:** os sub-endpoints são a fonte da verdade das
   mutações e da leitura das listas. O `GET /tasks/{id}` (detalhe) passa a
   expor `assignee_ids` e `watcher_ids` (só UUIDs). A **listagem**
   `GET /tasks` **não** inlina nada (mantém a query enxuta, sem N+1).
10. **Criador sempre vê.** Cláusula nova de *leitura* na visibilidade: o
    criador (`created_by == eu`) enxerga a tarefa que criou mesmo que o
    `team_id` esteja fora da sua lente — mas **continua sem editar** (só
    time edita). Resolve o "criar tarefa avulsa pra subtime irmão e
    conseguir acompanhar". Não atravessa a privacidade do pessoal (ninguém
    cria tarefa em pessoal alheio). (ADR 0013)

## Non-goals

- Notificações / e-mail / push para watchers (futuro).
- `/me/assignments` ("minhas tarefas") e o índice `task_assignment(user_id)`.
- Hidratar objetos `User` completos inline no `TaskResponse` (só IDs).
- Owner-override de edição (rejeitado: reabriria o vazamento de boundary
  de time que a Entrega 3 fechou; o escopo de time já cobre os casos do
  criador no quadro geral e no próprio subtime).
- Auto-atribuição em massa, sugestão de responsável, carga de trabalho.

---

## Regras (fonte da verdade)

### Assignees

- **R1.** `POST /tasks/{id}/assignees {user_id}`: exige `task.assign`
  (camada de ação) + tarefa visível (404) + editável (403) pelo ator.
- **R2.** O `user_id` designado deve ser usuário **ativo** do workspace.
  Inexistente/inativo/de outro workspace → 422.
- **R3.** O `team_id` da tarefa deve estar na lente de **visibilidade** do
  designado (ou designado é admin, ou é o dono em tarefa pessoal). Senão
  → 422 (`assignee não alcança a task`).
- **R4.** Tarefa de **projeto pessoal**: só o dono pode ser responsável;
  outro `user_id` → 409.
- **R5.** Idempotente: par `(task, user)` já existente → 200 no-op, sem
  segunda linha de history. Primeira criação → 201.
- **R6.** `assigned_by` = ator corrente; `assigned_at` = agora.
- **R7.** `DELETE /tasks/{id}/assignees/{user_id}`: mesmo gate de R1. Par
  inexistente → 404. Removido com sucesso → 200 (estado atual) ou 204.
- **R8.** Toda criação/remoção bem-sucedida grava 1 linha em
  `task_history` (`assigned`/`unassigned`).

### Watchers

- **W1.** `POST /tasks/{id}/watchers {user_id?}`: se `user_id` ausente ou
  == eu → **self-watch**, exige só visibilidade (404 se não vê). Sem
  `task.assign`.
- **W2.** `user_id` != eu → exige `task.assign` + edição (gate do
  assignment) e as mesmas regras R2/R3/R4 do designado.
- **W3.** Idempotente igual a R5. Sem history (decisão 7).
- **W4.** `DELETE /tasks/{id}/watchers/{user_id}`: remover a si mesmo
  exige só visibilidade; remover outro exige `task.assign` + edição. Par
  inexistente → 404.

### Visibilidade (alteração da Entrega 3 — ADR 0013)

- **V1.** A cláusula de visibilidade de tasks (listagem **e** gate de
  detalhe) ganha um ramo no `OR`: `Task.created_by == tenant.user_id`.
  Listagem e gate mudam **juntos**, senão lista e detalhe divergem.
- **V2.** Isso afeta **só leitura**. `_assert_editable` não muda — criador
  fora do time da tarefa continua levando 403 ao tentar editar.
- **V3.** Não cria exceção pra pessoal alheio: o criador de uma tarefa em
  pessoal só pode ser o próprio dono do pessoal (Entrega 1/3), então o
  ramo `created_by == eu` nunca expõe pessoal de outro.

---

## Contratos de endpoint (derivam no OpenAPI do FastAPI)

| Método | Rota | Permissão (ação) | Gate de escopo | Sucesso |
|--------|------|------------------|----------------|---------|
| GET | `/tasks/{id}/assignees` | autenticado | ver a task (404) | 200, lista de IDs |
| POST | `/tasks/{id}/assignees` | `task.assign` | ver+editar (404/403) | 201 (novo) / 200 (no-op) |
| DELETE | `/tasks/{id}/assignees/{user_id}` | `task.assign` | ver+editar | 200/204 (404 se ausente) |
| GET | `/tasks/{id}/watchers` | autenticado | ver a task | 200, lista de IDs |
| POST | `/tasks/{id}/watchers` | — (self) / `task.assign` (terceiro) | ver (self) / editar (terceiro) | 201 / 200 |
| DELETE | `/tasks/{id}/watchers/{user_id}` | — (self) / `task.assign` (terceiro) | ver / editar | 200/204 (404 se ausente) |

`GET /tasks/{id}` passa a responder `TaskDetailResponse` (= `TaskResponse`
+ `assignee_ids: list[UUID]` + `watcher_ids: list[UUID]`). `GET /tasks`
segue devolvendo `TaskResponse` puro.

### Mapa de erros (já coberto por `app/api/errors.py`)

- 401/403 — `AuthorizationError` (sem permissão / fora do escopo de edição).
- 404 — `EntityNotFoundError` (task não visível, ou par inexistente no DELETE).
- 409 — `ConflictError`/`BusinessRuleError` (pessoal monouser).
- 422 — `ValidationError` (assignee inexistente/inativo, ou não alcança a task).

---

## Definição de pronto

- [ ] 6 endpoints novos (`assignees` e `watchers` × GET/POST/DELETE).
- [ ] Gate de escopo reusado do `TaskService` (sem duplicar regra de time).
- [ ] Assignee validado por alcance (lente do designado), pessoal monouser.
- [ ] `assigned`/`unassigned` na timeline; watcher fora dela.
- [ ] Idempotência conforme decisão 8.
- [ ] `task.assign` concedido a `OPERATOR`.
- [ ] `created_by` sempre vê (listagem + gate, mexidos juntos).
- [ ] `TaskDetailResponse` com IDs no detalhe; listagem intocada.
- [ ] Testes de lógica pura novos verdes; sem regressão; banco validado no smoke.
