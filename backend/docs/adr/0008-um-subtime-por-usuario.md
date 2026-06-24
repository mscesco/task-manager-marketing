# 0008 — Um subtime por usuário

## Status

Proposed

## Contexto

A tarefa herda, por padrão, o subtime de quem a cria. Mas o vínculo
usuário↔time é N:N (`user_team`): em tese, uma pessoa poderia estar em
vários subtimes ao mesmo tempo. Se isso fosse permitido, "o subtime do
criador" seria ambíguo (qual deles?) e o default exigiria uma regra de
desempate inventada.

## Decisão

**Uma pessoa pertence a no máximo um subtime** (um `team` com
`parent_team_id` preenchido). Pode, além disso, ter vínculo com o time
principal.

- O default de time da tarefa fica determinístico: o subtime do criador.
- Sem subtime → default é o time geral (principal). Sem time nenhum →
  criação exige `team_id` explícito (422 se ausente).
- **Enforcement:** validação no fluxo de adicionar membro a time. Não dá
  pra expressar como constraint de banco limpa, porque "é subtime" depende
  do `parent_team_id` do time referenciado, que não está na linha do
  `user_team`. Apoio via trigger.
- Tentativa de pôr alguém num segundo subtime → 422.

## Consequências

**Positivas:** default de time sem ambiguidade; modelo mental simples
("você é de um subtime"); lente de visibilidade trivial de calcular.

**Negativas:** não cobre o caso (raro neste cliente) de alguém atuar em
dois subtimes — teria que ser modelado depois, se surgir; enforcement
fica no serviço + trigger, não numa constraint declarativa.

## Alternativas rejeitadas

- **Permitir N subtimes + flag de "subtime principal" no `user_team`:**
  coluna nova e cerimônia pra um caso que não existe hoje. Overengineering.
- **Permitir N subtimes + escolha explícita na criação:** joga a
  ambiguidade pro usuário em toda criação. Atrito desnecessário.
