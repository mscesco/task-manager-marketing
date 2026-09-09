# Spec 046 — Várias raízes de verdade

**Status:** escrita em 02/09/2026, com as §§4.3 e 4.4 respondidas no mesmo dia.
✅ **Nenhuma decisão de produto em aberto** — as quatro fatias estão liberadas
para escrever, **depois da Spec 045** (ver "Depende de").
**Escopo:** backend (o índice, a checagem de domínio, o ciclo de vida de time) **e**
frontend (o pin da raiz, que hoje assume que existe uma).
**Depende de:** **Spec 045 inteira** — sem a permissão carregando o time, criar a
segunda raiz abre um buraco de autorização em silêncio (§3).
**Placar na abertura:** Front **1082** em 60 arquivos, `tsc --noEmit` limpo —
medido em 02/09. Backend não medido (Docker Desktop desligado); última conhecida
**1014**, migrations `0021`.
**Não faz parte desta spec:** as telas de organização e de time (Spec 047).

---

## 1. A dívida, com data e dona

A Camila decidiu em **31/08/2026** por várias raízes de verdade — Marketing, TI e
Design como irmãos, sem pai comum. A [Spec 044 §6](../044-uma-pessoa-em-varios-times/spec.md)
registrou a decisão e a marcou como spec própria.

Esta é ela. E ela **não** é a spec difícil: a difícil é a 045, que torna seguro o
que esta permite.

---

## 2. O que já existe — medido em 02/09, abrindo os arquivos

⚠️ **Criar time raiz já funciona pela API**: basta `parent_team_id` nulo
([workspaces/api/router.py:114](../../app/modules/workspaces/api/router.py)). O que
impede várias raízes **não é a API** — são quatro pontos abaixo.

| ponto | onde | o que faz |
|---|---|---|
| o índice único parcial | `organization.py:86` | `team_unica_raiz_por_workspace`, `WHERE parent_team_id IS NULL` |
| ⚠️ **a checagem de domínio** | `workspace_service.py:213` | `if parent_team_id is None and root_exists(): raise ConflictError` — **barra antes do banco** |
| a consulta que a sustenta | `team_repository.py:120` | `root_exists()`, usada por `create` **e** `move` |
| o seed do workspace | `team_seed_service.py:94` | lookup por slug + parent NULL, com o comentário: *"identifica O time principal, e não 'um dos' times de topo"* |
| ⚠️⚠️ **o pin da raiz no front** | `web/lib/api.ts:648` | `teams.find(t => t.parent_team_id === null)` — §3 |
| menção sem dependência | `boards.py:80` | só cita a técnica do índice parcial. **Não precisa mudar.** |

⚠️ **Dropar o índice não basta.** A `ConflictError` de `workspace_service.py:213`
é o que a pessoa vê hoje ao tentar criar a segunda raiz, e ela existe justamente
para o `IntegrityError` cru não virar 500. As duas saem juntas, ou a mensagem
"Este workspace já possui um time principal" continua barrando com o índice já
removido.

✅ **O que já sobrevive a N raízes, conferido:**

- `root_of()` sobe pelos pais e devolve a raiz **daquela subárvore**
  ([team_scope.py:56](../../app/modules/auth/domain/team_scope.py)) — já é por
  árvore, não "a raiz".
- `visible_team_ids` faz `X + root_of(X)` para SUPERVISOR/OPERATOR e
  `T + descendentes` para comando: as duas continuam corretas com árvores irmãs.
- `listSubteams` no front é `parent_team_id !== null` — continua certo.

---

## 3. ⚠️⚠️ O defeito latente: o front escolhe uma raiz por sorteio

`getRootTeamId` faz `teams.find(t => t.parent_team_id === null)`. Com três raízes,
`find` devolve **a primeira da ordem em que a API respondeu** — e essa ordem não é
contrato de ninguém.

Esse valor não é rótulo: é o `team_id` que o `createTask` fixa no corpo
([api.ts:1294](../../../web/lib/api.ts)). **Tarefa criada no quadro geral nasceria
numa raiz arbitrária**, possivelmente de outra área, sem erro, sem aviso e sem
teste vermelho.

⚠️ E há uma **dívida documentada que já venceu**, escrita no próprio arquivo:

> *"se a raiz não for achada, cai-se no null e o backend deriva o time pela
> membership — hoje idêntico ao pin (sem subtimes). **QUANDO subtimes existirem,
> trocar este null por erro duro**, senão a herança silenciosa volta."*

Subtimes existem desde a Entrega 13. A troca nunca aconteceu.

**Ordem obrigatória: consertar o front ANTES de permitir a segunda raiz.** É a
mesma regra da [Spec 044 §3](../044-uma-pessoa-em-varios-times/spec.md) —
consertar o consumidor antes de deixar o dado existir. Invertida, a janela entre
as fatias é uma janela de tarefas nascendo na área errada em produção.

⚠️ **`getRootTeamId` mora em `lib/`, então tem guardião** (o `include` do vitest
cobre `lib/**`). O teste que falta é o do caso que hoje não existe: `listTeams`
devolvendo duas raízes.

---

## 4. As decisões

### 4.1. Quem cria e quem apaga área

Decisão da Camila (02/09): **a fronteira passa a ser o nível, não a ação.**

| ação | quem | hoje |
|---|---|---|
| criar área (raiz) | ADMIN e GESTOR — papel de **organização** | `team.manage` (`router.py:112`) |
| apagar / esvaziar área | ADMIN só | `workspace.manage` (`router.py:185`, `:222`) |
| criar / renomear subtime | MANAGER, na própria árvore | `team.manage` |

⚠️ O gate de criar muda de `team.manage` para permissão de organização — o que
significa que **um MANAGER deixa de criar área** e passa a criar só subtime. É
mudança de permissão, não de rota.

⚠️ **Dívida de documentação, encontrada em 02/09:** o docstring do módulo
([workspaces/api/router.py:18](../../app/modules/workspaces/api/router.py)) diz que
criar equipe exige `workspace.manage`. Está desatualizado desde a **Spec 029/D1** —
o gate é `team.manage`. Corrigir nesta spec, já que é este o arquivo que muda.
`AGENTS.md` §10.

### 4.2. Para onde vai o conteúdo de `esvaziar-e-remover`

O docstring diz que move o conteúdo *"para o time principal"*
([router.py:222](../../app/modules/workspaces/api/router.py)). Com N raízes isso
deixa de ser um endereço.

**Decisão: o destino é a raiz da mesma árvore** — `root_of(team_id)`, que já existe
e já é por subárvore. Nunca atravessa áreas: esvaziar um subtime do Marketing não
pode empurrar tarefa para o TI.

A rota já recusa esvaziar a própria raiz (409) e já recusa se houver subtime filho.
Com N raízes essas duas recusas continuam valendo sem mudança.

### 4.3. ✅ O que é "o quadro geral" quando há N raízes

**Respondido pela Camila em 02/09:**

> *"O quadro geral é o quadro principal que abre junto com o time raiz. É o
> primeiro quadro do time raiz."*

Ou seja: **"o quadro geral" deixa de ser um objeto único do workspace e passa a
ser uma propriedade da área.** Cada raiz tem o seu, criado junto com ela.

⭐ **E isso já é representável, sem nada novo no modelo:** o quadro geral de uma
área é o `Board` com `is_default` daquele time raiz, e o índice parcial
`board_um_padrao_por_time` ([boards.py:84](../../app/db/models/boards.py)) já
garante que existe **um só** por time. O conceito que a Camila descreveu é
exatamente o que a tabela já diz — não há migração nesta decisão.

**O que muda por consequência:**

- `default_board_and_column_for_status`
  ([board_repository.py:76](../../app/modules/tasks/infrastructure/board_repository.py))
  filtra `parent_team_id IS NULL` no SQL para achar "o quadro da raiz". Com N
  raízes isso passa a devolver **N candidatos** — ela precisa receber a **área**.
  ⚠️ É a mesma consulta que a **Spec 044 fatia 4** deixou como fonte do time da
  tarefa (`TaskService._time_do_quadro_alvo` devolve a raiz justamente porque é
  onde esta consulta põe a tarefa). Se uma passar a exigir área e a outra não, a
  tarefa nasce num quadro pertencendo a outro time — que é a linha que
  `_assert_time_do_quadro` existe para matar.
- `getRootTeamId` no front (§3) deixa de fazer sentido como "a raiz" e vira "a
  raiz da área que estou olhando".

### 4.4. ✅ A área vai para a URL — `/quadro/[teamId]`

**Decidido pela Camila em 02/09.** O quadro geral de uma área é alcançado pela
rota que já existe, com o id daquela área.

⭐ **A rota já está lá, e já faz o trabalho.** `web/app/quadro/[teamId]/page.tsx`
lê o time da URL, confere a lente (`computeLens`, a mesma que monta o menu),
mostra o nome do time e trata as guardas de rota. Esta decisão **não cria rota
nova**.

⭐ **E em boa parte ela REMOVE uma trava, em vez de acrescentar.** Hoje essa rota
recusa o id da raiz de propósito — o comentário diz *"id da RAIZ → avisa que o
lugar dela é o quadro geral"*. Essa guarda existe **só porque há uma raiz**; com
N áreas ela deixa de fazer sentido.

**Por que esta e não "área ativa":**

- **A URL diz a verdade.** Com estado de "área ativa", duas pessoas abrem o mesmo
  link e veem quadros diferentes, e a mesma pessoa vê coisas diferentes em dois
  navegadores. Não é gosto: é o mesmo endereço significando coisas diferentes.
  Aqui o link é compartilhável e o botão de voltar funciona.
- **O produto já roteia quadro por time.** O `/quadro` estático é a exceção — e é
  exceção porque só há uma raiz. Esta decisão **tira um caso especial**, não
  acrescenta um conceito.
- **"Área ativa" seria estado novo e invisível**: precisa morar em algum lugar,
  envelhece, e não aparece quando está errado.

⚠️ **E a armadilha do `next build` está do outro lado.** O `useSearchParams` sem
fronteira de `Suspense` derruba o build em rota **estática** — o comentário em
`quadro/[teamId]/page.tsx` registra que isso foi **medido em 13/08**, e que
aquela rota é segura por ser dinâmica. Ou seja: o risco mora no `/quadro`
estático, que é justamente o que a alternativa recusada preservaria.

**O que sobra decidir é pequeno: o que `/quadro` puro faz.** Ele redireciona para
a área da pessoa. Para quem tem mais de uma, escolhe um padrão de entrada (a
última visitada, ou a primeira por nome). ⚠️ A diferença para "área ativa" é que
isto é só um **default de entrada** — a URL onde a pessoa chega continua dizendo
qual área é.

---

## 5. As fatias

Ordem não negociável nas duas primeiras — ver §3.

**Fatia 1 — o front para de assumir que existe uma raiz (front). ✅ ENTREGUE (09/09).**
`getRootTeamId` deixa de ser `find` e passa a exigir um alvo explícito, ou a falhar
alto quando houver ambiguidade — cumprindo a dívida da ADR 0001 do front
(`web/docs/adr/0001-pin-time-raiz-criacao.md`), que mandava trocar o `null` por
erro duro. Teste novo: `listTeams` com duas raízes.
**Vai antes de qualquer coisa no backend.**

**Fatia 2 — a segunda raiz passa a ser criável (backend). ✅ ENTREGUE (09/09).**
Cai o índice `team_unica_raiz_por_workspace` **e** a checagem de
`workspace_service.py:213` — as duas juntas (§2). `root_exists()` sai ou vira
`roots_of_workspace()`. O seed do `team_seed_service` para de identificar "O time
principal" por parent NULL.
⚠️ **Remove índice → precisa do portão de DRIFT** (`AGENTS.md` §5).
⚠️ O gate de criar muda para permissão de organização (4.1).

**Fatia 3 — `esvaziar-e-remover` aprende o destino (backend). ✅ ENTREGUE (09/09).**
Aplica a 4.2: o conteúdo vai para `root_of(team_id)`, não para "o principal". A
prévia (`previa-remocao`) passa a **nomear a área de destino**, porque hoje ela diz
quantos vão e não diz para onde — e com N áreas isso deixa de ser óbvio.

**Fatia 4 — o quadro geral com N áreas.** ✅ **ENTREGUE (09/09).**

⚠️ **As fatias 2, 3 e 4 foram num PR só, a pedido da Camila** — e o motivo é a
janela que a §3 descreve ao contrário. Separadas, entre a 2 (que permite criar a
segunda área) e a 4 (que ensina o front a lidar com ela) existiria um intervalo
em que criar uma área quebraria o quadro. A spec as separa por **assunto**, não
por deploy.

⚠️ **O que a implementação descobriu, e a spec não previa:**

- **`root_id()` não virou `roots_of_workspace()`** — virou `area_de(team_id)`.
  Trocar o nome junto com o argumento foi deliberado: `root_id(team_id)`
  continuaria lendo como "a raiz", que é a ideia errada.
- **Promover subtime a área precisou de uma recusa NOVA.** A antiga era
  estrutural (o índice); removê-la sem pôr nada no lugar faria a operação da §6
  — "registrada, não feita" — passar a existir sem desenho.
- **O gate de `area.create` não cabia na rota.** `POST /teams` cria área e
  subtime; o que separa é o `parent_team_id` do corpo, que o `require_permission`
  não enxerga. A checagem foi para o serviço.
- **`default_board_and_column_for_status` recebeu `area_id` SEM default**, de
  propósito: com `= None` todo chamador continuaria compilando e errado em
  silêncio. Sem default, o `pytest` apontou os quatro.

*Backend:* `default_board_and_column_for_status` passa a **receber a área** em vez
de descobrir "a raiz" filtrando `parent_team_id IS NULL` no SQL.
⚠️ **Anda junto com o `TaskService._time_do_quadro_alvo`** (Spec 044, fatia 4):
ele devolve a raiz **porque** é onde esta consulta põe a tarefa. Se uma passar a
exigir a área e a outra não, a tarefa nasce num quadro pertencendo a outro time —
a linha que `_assert_time_do_quadro` existe para matar. **As duas mudam na mesma
fatia**, ou nenhuma.

*Front:* `/quadro/[teamId]` deixa de recusar o id da raiz, e `/quadro` puro passa
a redirecionar para a área da pessoa (4.4).
⚠️ A guarda que sai é uma linha, mas ela é a que hoje impede o quadro de área de
existir — o teste que a cobre precisa virar o teste do caso oposto, e não sumir.

---

## 6. O que esta spec deliberadamente NÃO faz

- **A permissão com escopo.** É a Spec 045, e é **pré-requisito**, não vizinha.
  ⚠️ Criar a segunda raiz sem a 045 significa um MANAGER de Marketing carregando
  `team.manage` que nenhuma porta escopa — autoridade sobre TI e Design, em
  silêncio, sem teste vermelho.
- **As telas.** Spec 047.
- **Mover área para dentro de outra.** `POST /teams/{id}/move` já existe e já é
  `workspace.manage`; com N raízes ela ganha um caso novo (promover subtime a área,
  rebaixar área a subtime) que **não** está desenhado. Fica registrado, não feito.
- **Área fechada** — raiz que esconde o próprio trabalho. Não há caso hoje.

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **A raiz sorteada da §3.** `find` devolvendo a raiz errada não levanta erro
  e não quebra teste — o teste tem de ser escrito de propósito, com duas raízes na
  lista.
- **O drift**, na fatia 2. Remover índice diverge modelo de migration sem que
  `pytest` diga nada.
- **A prévia de remoção**, que é número vindo do banco no instante da chamada e não
  tem como envelhecer bem em teste.
- ⚠️ **`useSearchParams` em rota estática** derruba o `next build` e o `npm run
  dev` não reclama (`AGENTS.md` §6). Se a 4.3 for pela saída 2, é aqui que aparece.
