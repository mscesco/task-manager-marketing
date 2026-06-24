# ADR 0018 — A query de `/me/assignments` pula a lente de time (mas não tenant/soft-delete/pessoal)

Accepted

## Contexto

A listagem normal (`list_page_with_filters`) aplica, sobre o `_base_select`
(tenant + soft-delete), duas camadas:

- **(A)** nunca mostrar pessoal alheio;
- **(B)** lente de time (visibilidade por equipe).

`/me/assignments` precisa mostrar tasks **fora da lente** (é o ponto do
`out_of_scope`, ADR 0017). Se eu reusasse `list_page_with_filters`, a camada
(B) esconderia justamente as tasks que esta tela deve revelar marcadas.

## Decisão

Método novo de repositório (`list_my_relations`) que parte do `_base_select`
(tenant + soft-delete), **mantém a camada (A)** (pessoal alheio nunca) e
**omite a camada (B)** (lente de time). O recorte passa a ser pela **relação**:

- `assignee`: `EXISTS` em `task_assignment (workspace_id, user_id = eu, task_id)`
- `creator`: `task.created_by = eu`
- `watcher`: `EXISTS` em `task_watcher (workspace_id, user_id = eu, task_id)`

unidas por `OR` conforme o filtro `relation`. Os três `EXISTS`/igualdades são
computados **sempre** (mesmo fora do filtro) para preencher `relations` de cada
item. O `out_of_scope` é calculado na aplicação (não no SQL), via o guard puro
`task_visible` com a lente atual — reusando código, sem duplicar regra de time.

## Alternativas rejeitadas

- **Reusar `list_page_with_filters` e "desligar" a lente com flag.** Polui o
  caminho mais quente do sistema (listagem geral) com um modo de exceção.
  Risco de alguém ligar o modo sem querer e vazar time. Separar é mais seguro.
- **Calcular `out_of_scope` no SQL.** Recriaria a lógica de lente em SQL, em
  paralelo ao guard puro já testado. Fonte de divergência. Melhor buscar as
  linhas e marcar na aplicação com a função que já existe.

## Consequências

- **Índices obrigatórios** (migration 0006): `(workspace_id, user_id)` em
  `task_assignment` e `task_watcher`. Sem eles, a tela mais aberta vira scan.
  Composto porque toda query é escopada por workspace.
- Duas responsabilidades separadas: o SQL recorta por relação + tenant + soft
  delete + pessoal; a aplicação marca `out_of_scope`. Cada uma testável.
- O `_base_select` (camada de tenant/soft-delete) **não** é furado — o
  isolamento multi-tenant continua intacto.
