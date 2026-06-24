# 0026 — `GET /members` expõe o subtime de cada membro

## Status

Accepted

## Contexto

O filtro de subtime no quadro (front ADR 0007) precisa saber a que subtime
cada pessoa pertence, para casar tasks por responsável. O `MemberResponse`
não carregava isso.

Dois fatos do modelo tornam a coisa menos óbvia do que parece:

1. **Não há `relationship()` declarado** entre `User`, `Team` e `UserTeam`
   (as FKs são compostas, declaradas só por constraint). Então não dá pra
   "eager-load do pivô" via `selectinload` — não há o que carregar.
2. **Um usuário pode ter mais de um vínculo em `user_team`.** O invariante
   `_assert_one_subteam` (ADR 0008) limita a **um subtime**, mas o time
   **principal** (raiz, `parent_team_id IS NULL`) não conta — o seed vincula
   gente ao "marketing" raiz. Logo, quem está em raiz + subtime tem 2 linhas.

Pegar "o `team_id`" da primeira linha do pivô devolveria o **time raiz** pra
essas pessoas, e o filtro de subtime no front viraria ruído (todo mundo
"pertence" ao Marketing geral).

## Decisão

`MemberResponse` ganha **`team_id: uuid | None`** = o id do **subtime** do
membro (time não-raiz), ou `None`.

A query (`UserRepository.list_all_with_subteam`) faz um **LEFT JOIN** do
`users` com uma **subconsulta** de `user_team` JOIN `team` filtrada por
`team.parent_team_id IS NOT NULL`. Ou seja: só vínculos com time não-raiz
entram. Pelo invariante de um-subtime, a subconsulta tem **0 ou 1 linha por
usuário** → sem duplicação, sem ambiguidade. O time principal é ignorado de
propósito.

Contrato e caminhos:

- `MemberService.list_members` passa a devolver `list[MemberWithSubteam]`
  (`user` + `subteam_id`); o router monta o `MemberResponse` explícito com
  `team_id=subteam_id`.
- `team_id` tem **default `None`** no schema. Nas respostas de **mutação**
  (`POST /members`, `deactivate`) o `MemberResponse`/`MemberCreatedResponse`
  é construído sem o campo → sai `None`. Só a **listagem** resolve o subtime.
  (`model_validate(user)` num `User` sem o atributo também cai no default.)
- Tenant: a subconsulta filtra `user_team.workspace_id` explicitamente e o
  `_base_select()` escopa o `users`. Sem cruzamento entre workspaces.

## Consequências

**Positivas:** o front filtra por subtime sem novos endpoints (reusa
`/members`); a regra "raiz não rotula" fica no SQL, não na aplicação; query
única, sem N+1.

**Negativas / armadilhas:**

- `list_all_with_subteam` herda de `list_all` o fato de **não** filtrar
  `is_active` — membro **desativado** ainda aparece na listagem (já era assim
  antes; não foi alterado). Para o filtro de subtime isso é inofensivo (uma
  task de um inativo do subtime X ainda é do escopo de X). Se um dia o
  dropdown de **responsável** precisar esconder inativos, é outra decisão.
- Se alguém "simplificar" a query tirando o `parent_team_id IS NOT NULL`, o
  time raiz volta a rotular e o filtro do front quebra silenciosamente. Esse
  predicado é load-bearing.

## Alternativas consideradas

- **Declarar `relationship()` e `selectinload`.** Exige `primaryjoin`/
  `foreign_keys` por causa das FKs compostas — complexidade sem ganho frente
  ao LEFT JOIN explícito.
- **Endpoint separado `/members/{id}/subteam`.** Rejeitada: N+1 no front e
  dessincronia com a lista.
- **Devolver TODOS os times do membro (lista).** Desnecessário: o produto só
  precisa do subtime, e o invariante garante no máximo um.

## Relacionados

- Backend **0008** (um subtime por usuário — é o que torna `subteam_id`
  determinístico), **0025** (assignees em lote).
- Front **0007** (filtros do quadro — o consumidor deste `team_id`).

## Testes

`tests/integration/test_member_subteam_db.py`: raiz+subtime escolhe o
subtime; só-subtime idem; só-raiz e sem-vínculo dão `None`; sem duplicação;
isolamento entre workspaces.
