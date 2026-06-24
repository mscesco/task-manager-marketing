# 0002 — Edição reusa o objeto da listagem (sem `GET /tasks/{id}`)

## Status

Proposed

## Contexto

O fluxo natural de "editar" numa SPA é: clicar no item → buscar o detalhe
(`GET /tasks/{id}`) → preencher o formulário → salvar. Mas o quadro já
carrega cada task **inteira** via `GET /tasks` (o `TaskResponse` da
listagem traz título, descrição, status, prioridade, prazo, etc. — tudo
que o formulário de edição precisa).

Além de redundante, o `GET /tasks/{id}` carrega um risco conhecido: o
**bug E6** — tasks `out_of_scope` retornam **404 no detalhe**. É por causa
desse bug que a lente "out_of_scope" está escondida no front hoje. Abrir um
detalhe pode esbarrar nele em casos de borda.

## Decisão

**O modal de edição prefilla com o objeto `Task` que a listagem já tem em
memória. Não há `GET /tasks/{id}`.** Salvar dispara `PATCH /tasks/{id}`
apenas com os campos alterados; a resposta do `PATCH` (a `Task`
atualizada) substitui o card no estado local in-place.

## Consequências

**Positivas:** uma chamada a menos por edição; passa longe do bug E6 sem
depender de ele ser corrigido; o card reflete o estado salvo de imediato
(a própria resposta do PATCH).

**Negativas:** o formulário usa o snapshot do momento em que a lista foi
carregada — se outra pessoa editou a mesma task no meio tempo, o prefill
pode estar levemente stale. Aceitável no tráfego atual (time pequeno);
o `PATCH` é parcial, então só sobrescreve os campos que a pessoa mexeu, o
que limita o estrago de um prefill velho.

**Como medir:** abrir o editor e salvar **não** deve gerar nenhum
`GET /tasks/{id}` na aba de Rede — só o `PATCH`.

## Alternativas consideradas

- **`GET /tasks/{id}` ao abrir o editor.** Mais "correto" em teoria
  (dado fresco), mas redundante aqui e exposto ao bug E6. Rejeitada
  enquanto a listagem já entrega o objeto completo.
- **Refetch da lista inteira após salvar** (em vez de update in-place).
  Mais simples de raciocinar, porém uma ida ao servidor desnecessária e um
  flicker na tela. Update in-place com a resposta do PATCH é melhor.
