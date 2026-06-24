# Entrega 9 (continuação) — Escrita no front: criar, mover, editar

> **Status:** Proposed (aguarda aprovação)
> **Repo afetado:** `task-manager-web/`
> **Telas afetadas:** `app/quadro/` (+ novo `components/TaskModal.tsx`)
> **ADRs relacionados:**
> - `docs/adr/0001-pin-time-raiz-criacao.md`
> - `docs/adr/0002-edicao-reusa-objeto-lista.md`
> **Pré-requisito já entregue:** E9 parcial — quatro telas só-leitura
> (login, troca de senha, quadro geral, minhas tarefas) buildadas contra
> o backend real. `lib/api.ts` centraliza o acesso à API.

---

## O que esta entrega entrega (em linguagem de produto)

Com esta entrega, no **quadro geral**, o usuário consegue:

- **Criar** uma tarefa em poucos cliques — só o título é obrigatório.
- **Mover** um card entre colunas arrastando (muda o status da tarefa).
- **Editar** uma tarefa (título, descrição, prioridade, prazo, status).

Garantias / não-surpresas:

- A criação **não pede time nem projeto**. Toda tarefa nasce no time
  **Marketing (raiz)**, que é o que mantém todo mundo enxergando e
  editando o quadro geral. Ver ADR 0001.
- O time da tarefa **não é editável** pela tela: o quadro define o time.
  (Hoje só existe o quadro geral → toda tarefa é de Marketing.)
- Arrastar dá feedback imediato (o card pula na hora); se o servidor
  recusar ou a rede cair, o card **volta** pra coluna de origem.

## Escopo

- `POST /tasks` (criar) consumido a partir de um modal no quadro.
- `PATCH /tasks/{id}` (editar e mudar status) consumido por: (a) drag
  entre colunas, que envia só `{status}`; (b) modal de edição, que envia
  os campos alterados.
- Pin do `team_id` na criação: o front resolve o time raiz uma vez
  (`GET /workspaces/current/teams` → item com `parent_team_id == null`),
  memoiza, e injeta no `POST /tasks`. Ver ADR 0001.
- Atualização otimista no drag, com reversão em erro (rede/403/4xx).
- Edição prefilla o formulário com o objeto que a listagem já trouxe —
  **sem** `GET /tasks/{id}` (contorna o bug E6 de `out_of_scope`). Ver
  ADR 0002.
- Dependência nova: `@dnd-kit/core` (drag acessível e com suporte a
  touch). Drag nativo HTML5 foi rejeitado por fragilidade no celular.

## Non-goals

- **Arquivar / desarquivar / excluir** no front — entrega futura.
  (`task.delete` só existe pra ADMIN/MANAGER; quando o botão entrar, ele
  some pra OPERATOR/SUPERVISOR, senão tomam 403.)
- **Assignment / watchers** (designar responsável) — próxima entrega.
  É o que vai variar visualmente no card; o selo de responsável nasce com ela.
- **Notificação** — depois (não construir alarme antes da porta).
- **Selo de time/projeto no card** — pós-subtime. Hoje 100% dos cards são
  Marketing; um selo "Marketing" em todo card é ruído, não informação.
- **Quadro por subtime** (tasks criadas só dentro do time + atribuídas a
  um membro do time) — pós-assignment; parqueado no plano. Depende de um
  filtro de UNIÃO (`team_id` OU assignee∈time) que **não existe** hoje.
- **Reordenar dentro da coluna** (campo `position`) — não nesta entrega.
- **Criar subtask / hierarquia / mover de projeto** pela UI — usa `/move`,
  fora deste escopo.

## Decisões

### Estruturais

1. **Um único `TaskModal`** serve criar e editar. Modo determinado pela
   presença de uma task: ausente = criar (`POST`), presente = editar
   (`PATCH`). Mesmos campos, validação igual.
2. **Estilo segue os tokens existentes** (`.btn`, `.field`, `.input`,
   `.error-box`, vars `--surface`/`--accent`/...). Sem novo design system.
3. **Todo acesso à API passa por `lib/api.ts`.** Nenhum componente monta
   URL na mão (mantém a regra da E9 parcial).

### Criação (ADR 0001)

4. **Formulário mínimo:** título (obrigatório), descrição (opcional),
   prioridade (default `MEDIUM`), prazo (`due_date`, opcional). `status`
   nasce `BACKLOG` (default do backend); a pessoa arrasta depois.
5. **Descrição é OPCIONAL.** O banco tem `description NOT NULL`, mas isso
   só proíbe SQL `NULL` — string vazia `""` passa. O Pydantic já manda
   `""` por default. Obrigar descrição recria a fricção que motivou tirar
   o seletor de time; rejeitado. Validação no front: só o título.
6. **`team_id` = time raiz (pin).** Ver ADR 0001. Projeto e pai ficam de
   fora do payload (task avulsa no time raiz).

### Mover (drag)

7. **Mover card = `PATCH /tasks/{id}` com `{status}`.** É `task.update`,
   não `/move` (que é pra pai/projeto). Todos os papéis têm `task.update`.
8. **Drag via `@dnd-kit/core`**, não nativo. Colunas são *droppables*,
   cards são *draggables*.
9. **Atualização otimista obrigatória:** o card muda de coluna no `onDrop`
   e o `PATCH` vai por baixo. Em qualquer erro (rede, 403 futuro, 4xx), o
   card **reverte** e mostra um toast. Sem otimismo o drag "treme".
10. **O card é clicável (abre editar) E arrastável (move).** Conflito
    resolvido por *activation constraint* do dnd-kit (só inicia o drag
    após mover ~8px), pra um toque ainda abrir o modal no celular.
11. **403 não dispara hoje** (todos editam tudo em Marketing — lente de
    edição inclui a raiz). A reversão existe pelo erro de rede; o 403 é o
    seatbelt pro dia dos subtimes.

### Editar (ADR 0002)

12. **Campos editáveis:** título, descrição, prioridade, prazo, status.
13. **`team_id` NÃO é exposto.** O quadro define o time; expor permitiria
    a pessoa mover a própria task pra fora da própria lente e perder o
    acesso de edição. Consistente com o pin (decisão 6).
14. **Sem `GET /tasks/{id}`.** O modal prefilla com o objeto que a
    listagem já tem. Ver ADR 0002.
15. **PATCH parcial:** envia só o que mudou. Campo sem alteração não vai.

### Pós-mutação (estado da tela)

16. **Criar → prepend otimista** do card retornado no estado local (o
    `POST` devolve a `Task` completa). Sem refetch.
17. **Editar/mover → atualização in-place** do card no estado local com a
    `Task` devolvida pelo `PATCH`.

## Contratos consumidos (HTTP — o front não define, consome)

| Método | Path                              | Permissão     | Uso nesta entrega |
|--------|-----------------------------------|---------------|-------------------|
| GET    | /workspaces/current/teams         | autenticado   | achar o time raiz (pin) |
| POST   | /tasks                            | `task.create` | criar |
| PATCH  | /tasks/{id}                       | `task.update` | editar + mudar status (drag) |

### Payload de criação (`POST /tasks`)

`{ title, description?, priority?, due_date?, start_date?, team_id }`
— `team_id` = raiz (pin). `project_id`/`parent_task_id` omitidos.

### Payload de edição (`PATCH /tasks/{id}`)

Subconjunto de `{ title?, description?, priority?, due_date?, start_date?, status? }`.
`project_id`/`parent_task_id` **não entram** (seriam `/move`).

### Códigos que o front trata

- `0` (fetch falhou) — rede/CORS → toast "não consegui falar com o servidor".
- `403` — sem permissão de edição → reverte o card (drag) / mostra erro (modal).
- `422` — validação do backend (ex.: `start > due`) → mostra a mensagem.
- `401` — token expirado → o `AppShell` já manda pro login.

## Critérios de aceite

**Criar:**
- [ ] Botão "+ Nova tarefa" no quadro abre o modal.
- [ ] Criar só com título → 201; card aparece na coluna Backlog na hora.
- [ ] Título vazio/só espaço → bloqueado no front (não chama a API).
- [ ] Descrição em branco → cria normal (não é obrigatória).
- [ ] Prioridade e prazo escolhidos são refletidos no card/dados.
- [ ] O `POST` sai com `team_id` = time raiz (conferir no payload/rede).
- [ ] Sem o time raiz resolvível, ainda cria (fallback documentado, ADR 0001).

**Mover (drag):**
- [ ] Arrastar card de uma coluna pra outra muda o status visualmente na hora.
- [ ] O `PATCH {status}` é disparado; ao concluir, o card permanece.
- [ ] Mover pra COMPLETED reflete `completed_at` (vem do backend).
- [ ] Erro de rede no PATCH → card volta pra coluna de origem + toast.
- [ ] No celular, um toque no card abre o editar (não vira arrasto acidental).

**Editar:**
- [ ] Clicar no card abre o modal preenchido com os dados atuais.
- [ ] Alterar título/descrição/prioridade/prazo/status → `PATCH` só com o alterado.
- [ ] Card atualiza in-place após salvar (sem reload da página).
- [ ] Não há campo de time no formulário.
- [ ] Edição não dispara `GET /tasks/{id}` (conferir na aba de rede).

## Riscos

- **Pin com fallback silencioso (ADR 0001).** Se a raiz não for achada,
  cai-se na herança do backend — idêntico ao pin **hoje**, perigoso
  **quando** subtimes existirem. Mitigação: vira erro duro nessa hora
  (rastreado no ADR e no parking do plano).
- **Drag no touch.** A *activation constraint* tem que ser calibrada,
  senão ou o tap vira arrasto, ou o arrasto exige precisão demais.
- **Otimismo + reversão.** A reversão tem que cobrir rede E 4xx, não só
  403, senão um erro de validação deixa o card na coluna errada.
- **Dependência nova (`@dnd-kit/core`).** Único pacote adicionado; revisar
  no `package-lock.json` e no build da VPS.
