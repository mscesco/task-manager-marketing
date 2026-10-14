# Spec 058 — Tela inicial do time

**Status:** escrita e **aprovada em 14/10/2026** — as três decisões dela (§4) e
as seis propostas da §10, todas aceitas; na 4 ela acrescentou as bloqueadas.
**Escopo:** backend (uma rota de leitura agregada e um verbo novo) e front (a
tela `/inicio`, os cards e a troca da tela de entrada).
**Placar na abertura:** backend **2202**, front **1750** (`main` em `b0cf6eb`).
⚠️ **Nada desta spec entra na `main` antes do lançamento da Base (16/10).**

---

## 1. De onde vem

Ela, em 14/10:

> *"a intenção é fazer alguma sequência de dashboards, tipo: relação de
> usuários do time em questão com mais tarefas em ordem decrescente;
> quantidade de tarefas da semana concluídas/total (envolvendo prazo mesmo).
> Me sugira outros que podem estar ali, talvez solicitações ou coisa assim."*

Hoje, entrar no sistema cai direto no quadro. A tela inicial responde à
pergunta que o quadro não responde: **como o time está**.

---

## 2. O que existe

- **A entrada é o quadro**, em vários lugares: `app/page.tsx` (`/` → `/quadro`),
  o login, a troca obrigatória de senha, os "voltar" de `/tarefa/[id]` e de
  `/quadro/[teamId]`.
- **O time ativo da barra lateral** (Spec 048) mora em `lib/activeTeam.ts` e
  `lib/useActiveTeam.tsx`, publicado pelo `AppShell`. A tela lê
  `useActiveTeam()`, espera ele resolver, e manda o time ao servidor como
  `under_team_id` (o time e os subtimes dele). `?time=tudo` é "todos os
  times", e só as telas da lista `TEAM_PARAM_SCREENS` carregam `?time=`.
- **Ler tarefa não tem verbo.** Quem vê o quê é a LENTE
  (`team_scope.visible_team_ids`): ADMIN/MANAGER veem o time e os subtimes;
  SUPERVISOR/OPERATOR veem o próprio time e a raiz; os papéis da organização
  veem tudo.
- **Nenhum verbo separa supervisor de operador para "ver o time".** O mais
  próximo, `solicitation.read`, o supervisor não tem.
- **Não existe nenhuma rota de contagem de tarefas.** `GET /tasks` devolve o
  `total` de uma busca, e "Minhas tarefas" baixa tudo e agrupa no navegador.
- **Solicitações já contam**: `pending_total` vem dentro da listagem, com o
  recorte de time do formulário.
- **"Atrasada" tem duas regras hoje:** o front (`lib/prazo.ts::estaAtrasada`)
  usa data E hora; o aviso de prazo do backend (`deadline_notify_service`)
  ignora a hora. As duas usam o fuso fixo `America/Sao_Paulo` — a organização
  não tem campo de fuso.
- **Tarefa terminada é a que está em coluna terminal** (`DONE` ou
  `CANCELLED`, Spec 035), e não o `status`.

---

## 3. O que esta spec entrega

1. Uma tela **`/inicio`**, com cards sobre o time ativo da barra.
2. **A entrada do sistema passa a ser ela** (§10, proposta 1).
3. Uma rota **`GET /dashboard`** que devolve todos os números de uma vez.
4. Um verbo novo para o que é visão de gestão (o ranking de pessoas).

---

## 4. Decisões dela (14/10)

- **D1 — Quem vê o quê.** Gestor e supervisor veem o time inteiro, inclusive
  a carga por pessoa. O operador vê a parte pessoal e os números gerais do
  time, **sem o ranking de pessoas**.
- **D2 — De qual time:** o que está na barra lateral. "Todos os times"
  (`?time=tudo`) vale para quem a barra já oferece essa opção.
- **D3 — A semana começa na segunda** e vai até domingo, no fuso da
  organização (`America/Sao_Paulo`).

---

## 5. Os cards

Numerados como na conversa de 14/10. **A primeira entrega é 1, 2, 3, 4, 6 e
11** (§10, proposta 2). Os de histórico (5, 8) e os restantes ficam para depois
(§9).

| # | Card | O que mostra | Quem vê |
|---|---|---|---|
| 1 | **Carga por pessoa** | tarefas ABERTAS de cada membro, em ordem decrescente, com a parte atrasada destacada | verbo novo (D1) |
| 2 | **A semana** | "14 de 20 com prazo nesta semana concluídas", com a barra de progresso | todos |
| 3 | **Atrasadas** | quantas, e as 5 mais antigas, clicáveis | todos |
| 4 | **Próximos 7 dias** | quantas vencem em cada dia, de hoje a hoje+6 | todos |
| 6 | **Fila de solicitações** | pendentes de triagem e a idade da mais antiga, com link para a fila | `solicitation.read` |
| 11 | **Minhas** | as minhas atrasadas e as que vencem hoje | todos |

**Para o operador** (D1), a tela fica: 11 em cima (o que é dele), depois 2, 3
e 4 (o time). Para gestor e supervisor: 2, 3 e 6 em cima (o que pede ação),
depois 1, 4 e 11.

### 5.1. As definições — o que cada número CONTA

⚠️ **Este é o ponto que mais pode mentir na tela**, e por isso vai escrito:

- **Aberta** = em coluna **não terminal** (nem `DONE` nem `CANCELLED`), não
  arquivada, não apagada.
- **Cobra prazo** = em coluna com `notify_deadline` ligado — a mesma pergunta
  do selo de prazo do quadro (`avisaPrazo`, `lib/coluna.ts`). ⚠️ É assim que
  **"bloqueada"** entra (decisão dela, §10.4): a coluna Bloqueado nasce com o
  aviso de prazo desligado, e o mesmo vale para qualquer coluna que a pessoa
  crie assim ("Aguardando cliente"). Olhar o `status = BLOCKED` não serviria —
  quadro de quatro colunas não tem esse status.
- **Atrasada** = aberta, **cobra prazo**, com prazo, e **a regra do front**: sem hora, vence no
  fim do dia (`due_date < hoje`); com hora, `data + hora < agora`. A tela e o
  painel não podem discordar do selo vermelho do card no quadro.
- **Concluída** = em coluna `DONE`, **arquivada ou não** (§10, proposta 6),
  não apagada.
- **O total da semana** = concluídas + abertas que **cobram prazo**.
  **Cancelada e bloqueada ficam fora** (§10, proposta 4): "14 de 20" é de
  tarefas que ainda valia a pena fazer agora.
- **Da semana** = `due_date` entre segunda e domingo da semana corrente.
- **Subtarefas contam** (§10, proposta 3): o trabalho existe nelas, e o
  responsável de uma subtarefa está mesmo ocupado com ela.
- **Tarefa com dois responsáveis conta para os dois** no card 1. A carga
  conta TODA tarefa aberta (inclusive a bloqueada: ainda é dela); a parte
  destacada é a das atrasadas.
- **Do time** = a mesma conta de `under_team_id` da listagem de tarefas (o
  time e os subtimes), e **dentro da lente** de quem pergunta. A tela nunca
  conta tarefa que a pessoa não poderia abrir.

---

## 6. Consequências técnicas

### 6.1. A rota

`GET /api/v1/dashboard?under_team_id=<id>` (ausente = todos os times da lente).

- Devolve todos os cards numa resposta: um pedido por abertura da tela, e não
  seis.
- As contagens são feitas **no banco** (`COUNT … GROUP BY`), sobre a mesma
  consulta-base da listagem de tarefas (`_time_efetivo_em`, a lente e
  `_sob_o_time`) — **copiada do irmão, e não escrita de novo** (AGENTS.md §3).
  Uma segunda regra de "o que a pessoa vê" divergiria da primeira.
- **"Agora" vem do servidor**, no fuso da organização, e a resposta diz qual
  semana usou (`week_start`, `week_end`). O front não recalcula: mostra.
- O card 1 só vem na resposta para quem tem o verbo; o 6, para quem tem
  `solicitation.read` **no time pedido**. Sem o verbo, o campo vem `null` — a
  tela esconde o card, e o servidor não calcula o que não vai mostrar.
- ⚠️ **A regra de "atrasada" com hora** precisa existir em SQL
  (`due_date + COALESCE(due_time, '23:59:59')` contra o agora de São Paulo).
  Ela ganha teste que compara com `estaAtrasada` nos mesmos casos de borda
  (meia-noite, `"18:00:00"` com segundos).

### 6.2. O verbo novo

`team_workload.read` — "ver a carga de trabalho do time, por pessoa".

- **ADMIN, MANAGER, SUPERVISOR** (no time) e **ADMIN, GESTOR** (na
  organização). **O OPERATOR não tem** (D1).
- Entra em `permissions.py` e gera `web/lib/permissions.generated.ts`, como
  todos. **Não entra em `_OWN_TEAM_ONLY`**: o supervisor de um subtime vê a
  carga do time que ele já enxerga pela lente — o verbo libera o card, e a
  lente continua decidindo QUAIS tarefas entram nele.

### 6.3. A tela

- `app/inicio/page.tsx`, dentro do `AppShell`, como as outras.
- `/inicio` entra em `TEAM_PARAM_SCREENS`, para a barra levar `?time=`.
- Cada card é um componente que **só desenha**; a ordem dos cards, os textos e
  "esconde se `null`" moram em `lib/painelDoTime.ts` (puro, testado — a
  fronteira da Spec 027).
- Clicar num número leva à lista que ele conta: "Atrasadas" → "Minhas
  tarefas" ou o quadro filtrado; "Fila" → `/solicitacoes`.
- **Sem ao vivo.** A tela recarrega ao abrir e ao voltar para a aba
  (`visibilitychange`), como a recarga de reserva da Base.

### 6.4. A entrada

Se aprovada a proposta 1 da §10: `/`, o login e a troca obrigatória de senha
passam a ir para `/inicio`. Os "voltar" de `/tarefa/[id]` e `/quadro/[teamId]`
**continuam indo para o quadro** — quem veio de uma tarefa quer voltar ao
trabalho, não ao painel.

---

## 7. Fatias

| Fatia | O quê | Portões extras |
|---|---|---|
| **A** | o verbo `team_workload.read` e o `permissions.generated.ts` | matriz de permissões |
| **B** | `GET /dashboard`: a consulta-base copiada, as contagens, a regra de atrasada em SQL, os campos `null` sem verbo | teste HTTP; casos de borda de prazo |
| **C** | `lib/painelDoTime.ts`: ordem por papel, textos, o que esconde | teste puro |
| **D** | `/inicio` e os seis cards | `next build`; conferência na tela dela |
| **E** | a entrada: `/`, login e troca de senha vão para `/inicio`; "Início" no menu | — |

Sem migration: nada novo é gravado.

---

## 8. Fora do escopo

- Gráficos de tendência (concluídas por semana nas últimas 8 semanas, card 8)
  e tempo parado em aprovação (card 5): dependem de ler o histórico.
- Personalizar quais cards aparecem.
- Exportar os números.
- Comparar times entre si.
- Mudar o fuso: continua `America/Sao_Paulo` fixo, como o resto do sistema.

---

## 9. Para depois (já conversados)

5 (paradas em aprovação), 7 (solicitações do mês por formulário), 8
(concluídas por semana), 9 (por coluna do quadro), 10 (sem responsável).

---

## 10. Propostas que nenhuma pergunta cobriu — APROVADAS EM 14/10

1. **A tela inicial SUBSTITUI o quadro como entrada**, e o quadro fica a um
   clique ("Início" é o primeiro item do menu, "Quadros" continua logo abaixo).
2. **Primeira entrega: cards 1, 2, 3, 4, 6 e 11.**
3. **Subtarefas contam** em todos os cards (§5.1).
4. **Cancelada fica fora** do total da semana: "14 de 20" é de tarefas que
   ainda valia a pena fazer. **Ela acrescentou: bloqueada também** (§5.1).
5. **Card 1 mostra todos os membros do time, inclusive quem está com zero** —
   quem está livre é tão útil de ver quanto quem está cheio. Até 10 na tela, com
   "Ver todos".
6. **Arquivada conta como concluída** na semana, se foi concluída nela: a
   rotina de arquivamento tira do quadro tarefas terminadas, e sem isto o
   número da semana cairia sozinho no meio dela.
