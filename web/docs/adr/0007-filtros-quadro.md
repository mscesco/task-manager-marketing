# 0007 — Filtros do quadro (busca, prazo, subtime)

## Status

Accepted

## Contexto

Com o quadro crescendo (tasks avulsas + tasks de projeto no panorama geral,
ADR 0006), ficou difícil achar uma tarefa. A Entrega 13 adiciona filtros no
`Board.tsx` — o mesmo componente que renderiza o quadro geral e o de projeto
(ADR 0005), então o filtro vale para os dois.

Restrições assumidas desde o início: **não** reabrir o bug E6
(`out_of_scope`/404 no detalhe de task de subtime) e **não** mexer em
`task.team_id` (toda task nasce no time raiz pelo pin, ADR 0001). Qualquer
filtro que dependesse do time DA TASK acordaria essa dívida.

## Decisão

Três filtros, todos **client-side**, aplicados em memória sobre o lote já
carregado pelo `GET /tasks` — nenhum bate na API ao mudar:

- **Busca por texto:** só no **título** (decisão da Camila — não busca em
  descrição). Sem acento e sem caixa (`normalizar` via NFD).
- **Prazo:** `todos` / `atrasadas` / `em-dia`. Task **sem data** aparece em
  qualquer filtro de prazo. Task `COMPLETED` nunca é atrasada (já foi
  entregue). Comparação é string ISO vs string ISO (`due_date` é date pura;
  nada de `new Date`, que escorregaria 1 dia por UTC).
- **Subtime:** filtra tasks onde **algum responsável** pertence ao subtime
  escolhido. Resolve a pertença pelo `team_id` do membro (vindo do `/members`,
  Fatia 2 — backend ADR 0026), **não** pelo `team_id` da task. O dropdown
  lista só times não-raiz (`listSubteams`). Task **sem responsável** (ou só com
  responsáveis de outro subtime) **some** ao filtrar por subtime — decisão da
  Camila.

Composição dos eixos:

- O toggle **"Mostrar arquivadas"** SOMA (alarga o conjunto `visiveis`).
- Busca, prazo e subtime **ESTREITAM** e se combinam em **AND** (conjunto
  `raizes`). Os contadores e o `porStatus` saem de `raizes`, não de `visiveis`,
  pra não mentir quando há filtro ativo. O cabeçalho mostra "X de Y" só quando
  algum filtro está ligado.
- Quando `raizes` fica vazio com filtro ligado, aparece `SemResultado` (com
  "Limpar filtros" que zera os três); sem filtro e sem tasks, `EmptyState`.

## Consequências

**Positivas:** achar tarefa sem ida ao servidor; o subtime filtra por pessoa
sem tocar no time da task — o E6 segue dormente. Reaproveita o mapa de
membros já carregado pro selo do card.

**Negativas / armadilhas:**

- O filtro de subtime depende do backend já devolver `team_id` no `/members`
  (Fatia 2). Sem isso, `memberTeam.get(id)` é `undefined`, nada casa, e o
  filtro parece quebrado sem erro. Não é bug do front.
- A lista de membros (`listMembers`) é **memoizada** e só limpa no
  `clearTokens` (logout). Trocou alguém de subtime no meio da sessão, o
  dropdown e o filtro ficam defasados até relogar. Aceitável hoje (troca de
  subtime é rara, via admin); revisitar se virar incômodo.
- Busca só por título: procurar por algo que está só na descrição não acha.
  Decisão consciente, não esquecimento.

## Alternativas consideradas

- **Filtrar no backend (querystring no `GET /tasks`).** Rejeitada por ora: o
  lote do quadro é pequeno (size 100) e os filtros são baratos em memória;
  mandar pro backend exigiria novos parâmetros e invalidaria o cache local a
  cada tecla digitada na busca.
- **Filtrar subtime pelo `team_id` da task.** Rejeitada: acordaria o E6 e
  contradiz o pin no raiz (ADR 0001). Por isso o filtro é por responsável.
- **Busca incluindo descrição.** Adiada; a Camila quis título só, por ruído.

## Relacionados

- Front **0001** (pin time raiz), **0005** (board compartilhado),
  **0006** (projeto-pasta).
- Backend **0026** (`/members` expõe subtime), **0025** (listagem traz
  `assignee_ids` em lote — é o que alimenta o filtro de subtime).
