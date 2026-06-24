# 0013 — O criador sempre vê a tarefa que criou (leitura)

## Status

Accepted

## Contexto

Na Entrega 3, a visibilidade de uma tarefa **avulsa** depende do `team_id`
dela estar na lente do usuário. Consequência: alguém cria uma tarefa
avulsa designada a um subtime irmão (dentro do permitido) e, no instante
seguinte, ela some da própria lente — não consegue acompanhar o que criou.
(Em tarefa de projeto não acontece: a visibilidade lá é do projeto, e quem
vê o projeto vê todas as tasks dele.)

A dona quer poder criar pra outro subtime **e** continuar acompanhando.

## Decisão

**Adicionar um ramo de leitura à visibilidade: `created_by == eu` sempre
enxerga, independente do `team_id`. Edição continua só por time.**

- A cláusula entra em DOIS lugares, que mudam juntos:
  `task_repository.list_page_with_filters` (mais um ramo no `or_(...)` da
  lente de time) e `task_service._assert_visible_via_project` (retorna
  visível se `task.created_by == tenant.user_id`).
- O ramo entra **depois** do bloqueio de pessoal alheio, nunca antes —
  não cria exceção à privacidade do pessoal. E é seguro: ninguém cria
  tarefa em pessoal de outro, então `created_by == eu` jamais aponta pra
  pessoal alheio.
- `_assert_editable` **não muda**: o criador fora do time da tarefa vê,
  mas leva 403 ao tentar editar.

## Consequências

- Resolve o caso da avulsa cross-subtime sem owner-override de edição
  (que reabriria o vazamento de boundary — ver ADR 0010).
- Mexe na query de visibilidade da Entrega 3; listagem e gate de detalhe
  têm de ser alterados na mesma mudança, senão divergem (lista mostra,
  detalhe nega ou vice-versa). Teste cobre os dois.
- Trabalho que precisa de *edição* cross-subtime continua indo pro quadro
  geral (`team = principal`), onde o escopo de time já concede edição.
