# 0029 — Edição (só autor) e moderação (reusa task.delete)

## Status

Accepted

## Contexto

Comentário precisa de edição e remoção, com alçadas claras. Editar texto
alheio fere a integridade da conversa. Remover precisa de uma válvula de
moderação sem inventar um sistema de papéis novo — a E12 já definiu que
**deletar tarefa é de ADMIN/MANAGER** (permissão `task.delete`).

## Decisão

**Editar: só o autor (D2).** `can_edit` exige `comment.user_id == ator`.
Nem moderador edita texto de terceiro. Editar seta `edited_at` (a coluna já
existe); sem janela de tempo — o `edited_at` é a pista de que houve edição.
Editar comentário já apagado → 404.

**Apagar: autor OU moderador (D3).** `can_delete` permite o autor remover o
próprio, ou quem tem **`task.delete`** (ADMIN/MANAGER) remover de qualquer um.
SUPERVISOR/OPERATOR não removem alheio. Reusa `task.delete` de propósito —
nenhuma permissão nova. Sempre soft-delete.

## Consequências

**Positivas:** integridade da conversa preservada; moderação sem novo eixo de
permissão; coerente com a alçada de exclusão da E12.

**Negativas:** edição sem trava de tempo permite reescrever comentário antigo
(só o `edited_at` denuncia). Consciente — imutabilidade após X minutos, se
vier, é outra entrega.

**Armadilha:** a checagem de moderação lê `"task.delete" in tenant.permissions`.
Se a permissão for renomeada/movida, a moderação de comentário muda junto sem
aviso. Acoplamento documentado de propósito.

## Alternativas consideradas

- **Permissão `comment.moderate` dedicada.** Rejeitada: eixo novo sem
  necessidade; quem deleta tarefa já é a autoridade de remoção do quadro.
- **Moderação só ADMIN.** Aberta à dona; padrão proposto inclui MANAGER por
  paridade com a E12.

## Relacionados

- E12 (excluir é ADMIN/MANAGER). Spec `012-comentarios` (D2, D3).
