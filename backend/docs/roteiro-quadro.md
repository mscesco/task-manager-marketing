# Roteiro do quadro — de F3 até o quadro interno (Spec 036)

Registro da sessão de decisão de 06/08/2026, fechada com a Camila. Sucede a
Spec 035.

⚠️ **ISTO NÃO É UMA SPEC, e por isso não mora em `specs/`.** As pastas de
`backend/specs/NNN-*/` têm `spec.md` e `plan.md`, e cada uma cobre UMA entrega.
Este arquivo cobre quatro (F3, F3.5, F4, F5) e não descreve nenhuma delas em
detalhe suficiente para virar código. A pasta `specs/036-quadro-interno/` nasce
quando a F5 for escrita, com os dois arquivos do padrão.

⚠️ **AS DECISÕES NÃO MORAM AQUI.** Elas viraram ADR em 07/08 e é lá que se
lê o raciocínio, os trade-offs e o que foi rejeitado. Este arquivo guarda o que
não cabe em ADR: os **números medidos**, a **sequência de entrega** e as
**armadilhas** da rodada.

| decisão de 06/08 | onde vive agora |
|---|---|
| D1, D6, D7, D8, D9, D10 — lente × quadro interno, apagar, N quadros | **ADR 0034** |
| D2, D3 — `team_id` herdado do quadro, visibilidade pela lente | **ADR 0035** |
| D4, D5 — status derivado da semântica; coluna dentro do quadro | **ADR 0036** |
| D11 — cascata da varredura de arquivamento | **ADR 0037** |

O documento solto `decisoes-036-quadro-de-time.md`, que circulou fora do
repositório entre 06/08 e 07/08, é **substituído por este arquivo mais as
quatro ADRs**. Se aparecer uma cópia dele, ela está velha — ver §1.

---

## 1. ⚠️ Correções ao documento original

Três coisas que o documento solto afirmava e que não se sustentaram.

**a) "A volta é COM perda" (D11) — errado.** Ele dizia que uma subtarefa
`IN_PROGRESS` arrastada pela cascata voltaria como `BACKLOG`. Não volta:
`set_archived_subtree` não toca em `status` e o `unarchive` do pai cascateia
para baixo. Só o status do PAI é zerado, e isso é a decisão C da Spec 013,
deliberada. Detalhe na **ADR 0037 §Correção**.

**b) A D9 REVERTE uma linha da ADR 0030, e o documento não dizia isso.** A 0030
§"Sem teto de quadros" manda *"arquivar, nunca apagar"* e diz que apagar quadro
com tarefa dentro *"ou é bloqueado, ou exige destino"*. A D9 decide o
contrário: apagar leva as tarefas junto. O motivo está na **ADR 0034 §Decisão,
item 4** — a regra da coluna não transporta para o quadro, porque o único
destino possível é o quadro geral, e isso publica trabalho interno em massa.

**c) A D9 diz "soft delete, ADR 0005" como se fosse de graça. Não é.** Medido em
07/08: `Board` e `BoardColumn` usam só `UUIDPrimaryKeyMixin` e `TimestampMixin`
— **não têm `deleted_at`**. Quem tem `SoftDeleteMixin` é `Task`, `Project` e
`Comment`. Apagar quadro exige **migration**, e toda consulta de quadro passa a
precisar de `deleted_at IS NULL` — inclusive no `BoardRepository`, que usa SQL
textual e não ganha o filtro do `BaseRepository` de graça.

⚠️ **Isso respinga na F3, não na F5.** Se `GET /boards` nascer sem o filtro, ele
lista quadro apagado a partir do dia em que apagar existir. A migration deve vir
junto ou antes da F3. Detalhe na **ADR 0034 §Consequências**.

**d) "6 arquivos de produção importam `@/lib/status`" — são 8.** Medido em
07/08 contra o repositório:

| arquivo | usos de `STATUSES` | observação |
|---|---|---|
| `app/minhas-tarefas/page.tsx` | 9 | 1195 linhas, zero teste de componente |
| `components/TaskDetail.tsx` | 4 | + 3 de `STATUS_TEXT` |
| `components/Board.tsx` | 4 | |
| `app/arquivadas/page.tsx` | 4 | + 3 de `STATUS_TEXT` |
| `components/TaskModal.tsx` | 2 | `<select>` inicia em `"BACKLOG"` cravado, linha 104 |
| `components/Badge.tsx` | — | usa `STATUS_TEXT` |
| `components/TaskCard.tsx` | — | usa `PRIORITY_*`, `deadlineTone`, `diasParado` |
| `app/projetos/[id]/page.tsx` | — | usa `PRIORITY_LABEL` |
| `lib/exclusao.ts` | — | usa `plural` |

Os cinco primeiros são os que a fatia do front (F4) quebra de verdade. Os
outros quatro entram porque o módulo vai ser partido em "puro e síncrono" e
"vindo da API" — **orce F4 por 8 arquivos, não por 6.**

---

## 2. Números medidos em produção (06/08/2026)

Seis semanas de histórico (primeiro registro 25/06), 536 tarefas vivas.

| status | transições | vivas | primeiro uso |
|---|---|---|---|
| COMPLETED | 260 | 219 | 25/06 |
| IN_PROGRESS | 178 | 85 | 25/06 |
| PLANNED | 136 | 45 | 25/06 |
| IN_REVIEW | 32 | 11 | 25/06 |
| BACKLOG | 31 | 170 | 25/06 |
| BLOCKED | 8 | 5 | 22/07 |
| EXTERNAL_APPROVAL | 6 | 0 | 23/07 |
| CANCELLED | 2 | 1 | 23/07 |

**Nenhum status está morto** — é o dado que tirou o colapso de status do
caminho crítico (ADR 0036).

Outros números da mesma rodada:

- **136** tarefas em `Concluído` com prazo vencido e coluna com
  `notify_deadline = 1`. É o tamanho do defeito que a F1a evitou: trocar
  `_STATUS_SEM_AVISO` pela flag crua dispararia 136 avisos falsos na primeira
  madrugada. A regra correta é
  `semantic IN (DONE, CANCELLED) OR notify_deadline = false`.
- **220 = 220** na equivalência da regra velha contra a nova.
- **0** filhas ativas a serem arrastadas pela cascata da F1b com
  `stale_archive_days = 20`.
- ⚠️ `Bloqueado` tem **zero** tarefas com prazo vencido — o teste de
  equivalência passa **sem provar nada** sobre o caso do `BLOCKED`. Esse caso se
  monta à mão.

As invariantes de acompanhamento estão em `backend/scripts/invariantes.sql`.

---

## 3. Sequência de entrega

Cada item é uma entrega com portão próprio. **Duas por sessão, no máximo** — a
sessão de 05/08 emendou três "pequenas" e custou 58 testes vermelhos.

| # | fatia | estado |
|---|---|---|
| F1a | aviso de prazo lê `notify_deadline`/`semantic` da COLUNA | ✅ produção 06/08 |
| F1b | varredura de arquivamento cascateia a subárvore (ADR 0037) | ✅ produção 06/08 |
| F2 | coluna procurada DENTRO do quadro da tarefa (ADR 0036, D5) | ✅ commitado 06/08 |
| — | **arreio de quadro**: `make_board`, `make_task(board_id=)` | ✅ 07/08 |
| — | **ADRs 0034–0037** | ✅ 07/08 |
| F3 | `GET /api/v1/boards` filtrado pela lente | pendente |
| **F3.5** | **`board_id`/`column_id`/nome do quadro no `TaskResponse`** | **pendente — não estava no roteiro** |
| F4 | `Board.tsx` parametrizado por colunas vindas da API | pendente |
| F5 | quadro interno: migration, CRUD de coluna, permissão | pendente |

**Fora do roteiro, com gatilho escrito:** colapso de status para quatro, drop do
`legacy_status`, teste de componente do `TaskDetail`.

### ⚠️ F3.5 — a fatia que faltava

Medido em 07/08: `grep -rn "board" app/modules/tasks/api/` devolve **zero
linhas**. `board_id` e `column_id` não estão em `TaskResponse`, `TaskListItem`
nem `TaskDetailResponse`.

Isso torna a **F4 impossível como escrita**: o front recebe a lista de colunas e
não sabe em qual colocar cada card. E deixa o selo de quadro da ADR 0034 item 6
(`/minhas-tarefas`) sem caminho.

É mudança de contrato em três schemas, com teste de que não se expõe `board_id`
de quadro fora do alcance do usuário. Vem depois da F3, porque reusa a mesma
lente.

### F3 — por que exige cuidado

É a **primeira fatia desta sequência com superfície de API e permissão
envolvida** — o primeiro lugar onde um erro vira dado exposto para quem não
deveria ver. Precisa, no mínimo: teste de que supervisor de outro subtime não vê
o quadro alheio, teste de que ADMIN vê todos, teste de tenant isolation. Os três
precisam de dois quadros no mundo do teste, o que passou a ser possível pelo
`make_board` do arreio.

⚠️ **Não é fatia para atacar logo depois de uma rodada de correções.**

### F4 — sessão própria

Antes dela, **teste de componente em `minhas-tarefas/page.tsx`** — não no
`TaskDetail`. É onde a mudança pesa (9 usos de `STATUSES`, 1195 linhas, zero
teste) e é o arquivo onde descobrir tarde custa mais caro. `STATUSES` deixa de
ser `const` síncrona e vira dado assíncrono: estado de carregando, de erro, e um
default antes de o dado chegar.

**Carona na F4:** os tokens de cor do status de **projeto**
(`projetos/page.tsx` e `projetos/[id]/page.tsx` têm hex cravado e duplicado,
fora do sistema da Spec 031, e não invertem no tema escuro). Sozinho não paga o
deploy.

### O que NÃO fazer

- **Emendar F3 e F4 na mesma sessão.** Uma é API com permissão, a outra é front.
- **Começar a F5 antes de a F4 estar no ar.** Criar quadro sem o front ler
  colunas não muda a tela de ninguém.

---

## 4. Armadilhas desta rodada

- **`semantic` e `is_default_target` são escritos e lidos por ninguém.** O
  `BoardService` grava os três na criação; a F1a matou o primeiro
  (`notify_deadline`). Os outros dois continuam órfãos.
- **A flag `notify_deadline` NÃO reproduz o comportamento de hoje sozinha.**
  `COMPLETED` e `CANCELLED` nascem com `True` nos defaults. Ver §2.
- **Query cravada em "quadro do time raiz"** (`parent_team_id IS NULL`) dá a
  resposta certa hoje e a errada no dia do segundo quadro — e a resposta errada
  não aparece na tela, aparece na tarefa que foi parar no quadro de outro time.
  Corrigida no produto pela F2 e **no arreio de teste em 07/08**; se aparecer
  uma terceira cópia, é esta.
- **A descrição do quadro de lente é texto de tela, não dado.** Criar linha de
  `board` para ele reabre a ADR 0032.
- **Comentários das linhas 36 e 92 do `docker-compose.prod.yml`** ainda dizem
  *"MODO ENSAIO (stsSeconds=300)"*; a linha efetiva (102) já está em `31536000`.
  **`DEPLOY.md` linha 117 diz "Não há CI neste projeto"** e existe CI.
  Documentação descrevendo um mundo que não existe é como alguém "conserta" de
  volta. Carona na próxima fatia que abrir cada arquivo.

---

## 5. Pendências herdadas, ainda abertas

Seletor nativo do passo 2 · `/arquivadas` com `filhosDaOrigem={[]}` cravado
(linha 252) · busca client-side com teto sem aviso · terceiro nível de time ·
catálogo de solicitação em dados · sem E2E · responsivo com um `@media` no
produto todo · "Acompanhar" sem front · reações em comentário não existem no
backend · `spec.md` da 031 desatualizada · `TaskDetail` (2186 linhas) sem teste
de componente.
