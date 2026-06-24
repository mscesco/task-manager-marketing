# 0001 — Pin do time raiz na criação de tasks pelo quadro

## Status

Proposed

## Contexto

O quadro geral é o quadro do time de Marketing inteiro (~30 pessoas). A
decisão de produto é: qualquer um cria tarefa ali e qualquer um pode
mover/editar qualquer card. O que muda por tarefa é o **responsável**
(assignment, entrega futura), não o time dono.

O backend resolve o time de uma task nova assim (`team_scope.default_team_id`):
se o criador está num **subtime**, a task herda o subtime; senão, herda o
time principal. Hoje ninguém está em subtime, então tudo cai no Marketing
raiz e o modelo "todos editam tudo" funciona — porque a lente de **edição**
de qualquer membro inclui a raiz da árvore (`root_of`).

O problema é o futuro anunciado: **subtimes serão alocados depois**. No dia
que isso acontecer, a herança automática passa a carimbar tasks novas com
o **subtime** de quem cria. Aí:
- a task some do alcance de edição de quem é de outro subtime;
- mover/editar entre subtimes começa a dar **403 silenciosamente**;
- e isso acontece sem ninguém tocar no código — só por alocar gente em
  subtime.

Ou seja: confiar na herança silenciosa é uma bomba-relógio. O "geral"
deixa de ser geral no momento menos esperado.

## Decisão

**O front resolve o id do time raiz (o `team` com `parent_team_id == null`,
via `GET /workspaces/current/teams`), memoiza, e injeta `team_id = raiz`
explicitamente em todo `POST /tasks` feito pelo quadro geral.**

Toda tarefa criada pelo quadro nasce **dona do Marketing raiz**,
independente de quem cria estar ou não num subtime. Como a lente de edição
de qualquer membro inclui a raiz, todo mundo continua editando o quadro
geral mesmo depois de subtimes existirem.

- `project_id` e `parent_task_id` ficam fora do payload (task avulsa).
- `team_id` na UI **não é editável** (decisão complementar na spec): o
  quadro define o time. Expor permitiria a pessoa tirar a própria task da
  própria lente.

## Consequências

**Positivas:** o "geral" permanece geral de forma permanente, não
temporária; o pin desacopla "em que subtime estou" de "quem é dono da
task"; o id da raiz buscado uma vez serve também ao futuro filtro do
quadro geral (`GET /tasks?team_id = raiz`). Investimento único, paga duas
features.

**Negativas:** uma chamada extra (`/workspaces/current/teams`) para
descobrir a raiz, memoizada. E o front passa a depender de uma premissa de
dados: existir exatamente um time com `parent_team_id == null`.

**Como medir:** na aba de Rede, todo `POST /tasks` do quadro sai com
`team_id` = id da raiz.

### Fallback (dívida documentada)

Se a raiz **não** for encontrada, o front omite `team_id` e o backend
deriva pela membership. **Hoje isso é idêntico ao pin** (sem subtimes,
todos derivam Marketing). **Quando subtimes existirem, este fallback vira
perigoso** (reabre a herança silenciosa). Ação nesse momento: trocar o
fallback por um **erro duro** ("não consegui identificar o time raiz"),
em vez de criar a task no time errado em silêncio.

## Alternativas consideradas

- **Confiar na herança do backend (não pinar).** Custo zero agora, mas
  quebra silenciosamente quando subtimes forem alocados — o pior tipo de
  quebra. Rejeitada por fragilidade no futuro já anunciado.
- **Seletor de time no formulário.** Reintroduz a fricção de categorizar
  que o time odeia (vinha do Notion), e ainda abre brecha: a criação não
  valida lente de time no `team_id` escolhido, então daria pra plantar
  task em time alheio. Rejeitada.
- **Segurar a alocação de subtimes** até existir quadro por time. Adia o
  problema sem resolver; depende de disciplina humana pra não quebrar.
  Rejeitada como garantia.
