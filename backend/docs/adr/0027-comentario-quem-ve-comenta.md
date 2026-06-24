# 0027 — Quem vê a tarefa, comenta (e comentário fora da timeline)

## Status

Accepted

## Contexto

A Entrega 14 adiciona um thread de comentários por tarefa. A pergunta de
fundo é "quem pode comentar?". As opções: (a) só quem edita a tarefa
(escopo de time da E3), ou (b) qualquer um que enxerga a tarefa.

A E4 já resolveu um dilema parecido com o watcher: inscrever-se para
acompanhar exige só **ver** a tarefa (self-service), porque participar não é
mexer no trabalho. Comentar é da mesma natureza — é conversa, não edição.

Hoje todo mundo está no time raiz (ADR 0001), então "quem vê" é, na prática,
todo mundo. Restringir a edição silenciaria justamente observador e
responsável que estão fora da lente de edição — quem mais precisa perguntar.

## Decisão

**Criar e listar comentário exige só `assert_visible` (404), não edição.**
O mesmo gate de visibilidade da task (`TaskScopeGuards.assert_visible`)
protege todo endpoint de comentário. Comentar/ler em tarefa que você não
enxerga → 404 (não vaza nem existência). O bug E6 segue dormente: comentário
não cria caminho de leitura novo.

**Comentário NÃO entra no `task_history`.** O thread é o próprio log
(ordenado por `created_at`); a timeline é sobre mudança de campo da tarefa,
não sobre conversa (espelha "watcher fora da timeline", ADR 0012). Sem evento
`commented` em v1.

## Consequências

**Positivas:** baixa fricção pra colaborar; o gate único fecha o vazamento
do E6 no thread; a timeline não vira mural de recados.

**Negativas:** quem olha só a timeline não percebe que houve conversa — vê os
dois lado a lado só no detalhe da tarefa. Renúncia consciente.

**Armadilha:** se algum endpoint de comentário pular `assert_visible`, o
thread vira porta dos fundos pra ler tarefa de subtime alheio. O gate é a
primeira linha de TODO caso de uso, não opcional.

## Alternativas consideradas

- **Comentar exige edição (escopo de time).** Rejeitada: silencia watcher e
  responsável fora da lente de edição; contradiz a natureza "conversa".
- **Espelhar cada comentário como evento na timeline.** Rejeitada: polui a
  auditoria com texto livre e duplica o conteúdo; o thread já é o log.

## Relacionados

- E4 **0011** (watcher self-service — o análogo), **0012** (granularidade de
  history). E1 **0001** (pin raiz). Spec `012-comentarios`.
