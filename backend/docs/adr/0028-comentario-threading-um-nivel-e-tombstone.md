# 0028 — Threading de 1 nível e tombstone do comentário apagado

## Status

Accepted

## Contexto

A tabela `comment` traz `parent_comment_id` (auto-referência) e aceitaria
árvore de profundidade arbitrária. Sem regra, o thread vira nesting
ingovernável na UI. As FKs `comment_parent`/`comment_task`/`comment_user` são
`RESTRICT` — não dá hard-delete de um comentário com réplicas. E o soft-delete
de um pai com réplicas vivas orfanaria as filhas se ele sumisse da lista.

## Decisão

**Threading de 1 nível (D4).** Uma réplica só pode pendurar num comentário de
**topo** (`parent_comment_id IS NULL`) da **mesma** task. Réplica-de-réplica
ou pai de outra task → 422. A regra mora no domínio (`assert_reply_target`),
testável sem banco; a tabela continua permissiva, a aplicação trava.

**Tombstone (D5).** Apagar é sempre soft (`deleted_at`); hard-delete não
existe nesta API. Um comentário apagado **com réplicas ativas** continua no
thread como marcador (`is_deleted: true`, `content` = `"[comentário
removido]"`), pra réplica não orfanar. **Sem** réplicas ativas, some da
listagem. A condição mora no próprio SELECT (`list_for_task`) pra `total` e
`items` da paginação não divergirem.

## Consequências

**Positivas:** thread raso e legível; autor pode remover o próprio texto sem
quebrar a sub-conversa; paginação honesta.

**Negativas:** não há sub-thread profundo (decisão de produto). Se um dia o
time quiser árvore, é outra entrega (e outra UX).

**Armadilha:** a decisão tombstone-vs-omitir não pode virar 1 query por
comentário (N+1). O `EXISTS` correlacionado no SELECT resolve em uma query.
Quem "simplificar" pra checar por item degrada o thread de uma task movimentada.

## Alternativas consideradas

- **Proibir apagar pai com réplicas.** Rejeitada: pior UX, prende o autor ao
  próprio texto.
- **Árvore de profundidade livre.** Rejeitada por ora: nesting ingovernável
  sem ganho pro caso do time.

## Relacionados

- Spec `012-comentarios` (D4, D5). FKs `RESTRICT` do baseline v5.
