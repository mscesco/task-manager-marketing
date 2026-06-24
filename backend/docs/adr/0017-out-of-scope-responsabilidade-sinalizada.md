# ADR 0017 — `out_of_scope`: responsabilidade vence privacidade, sinalizada

Accepted

## Contexto

`GET /me/assignments` lista tasks onde sou assignee/creator/watcher. A Entrega 4
garante que, **no momento do assign**, o designado alcança a task (senão 422).
Mas o vínculo é uma foto e a lente de time do usuário muda depois (troca de
equipe, assign feito por admin, task movida). Logo a relação "assignee ⟹
enxerga" **não vale para sempre**. Surge a divergência: estou ligado a uma task
que minha lente atual não mostra.

## Decisão

A task **aparece** em `/me/assignments` mesmo fora da lente atual, marcada com
`out_of_scope: true`. É um campo **derivado por requisição**:
`out_of_scope = not task_visible(task, projeto, lente_de_visibilidade_atual)`.

## Alternativas rejeitadas

- **Esconder o que está fora da lente.** Falha silenciosa: a pessoa é
  responsável por algo que sumiu da tela. Pior resultado operacional possível.
- **Mostrar sem marcar.** Reabre o vazamento de time fechado na Entrega 3 — a
  pessoa vê conteúdo de um subtime alheio sem nenhum sinal de exceção.

## Consequências

- **Positiva:** atende as duas necessidades (não perder responsabilidade, não
  furar privacidade em silêncio). O front escolhe como tratar a etiqueta.
- **Custo:** `out_of_scope` não é cacheável ingenuamente (muda com o time do
  usuário). É recalculado a cada request via o guard puro `task_visible`.
- **Assimetria preservada:** ver `out_of_scope` **não** concede edição. A
  edição segue presa à lente (ADR 0013). Mesma regra do `created_by`.
- Para **admin** (lente = todos) nada é `out_of_scope`.
