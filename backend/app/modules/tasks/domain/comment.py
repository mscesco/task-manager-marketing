"""Dominio de comentarios de task -- regras PURAS, sem DB nem ORM.

Concentra o que da pra testar sem banco (Entrega 14):
    - validacao de conteudo (strip, 1..CONTENT_MAX);
    - regra de threading de 1 nivel (D4);
    - autorizacao de edicao/delecao (D2/D3);
    - mascaramento de tombstone (D5).

O service so orquestra: carrega do banco e chama estas funcoes.
"""

from __future__ import annotations

import uuid

from app.shared.exceptions.base import ValidationError

#: Teto de tamanho do comentario (D8). A coluna e String sem limite no banco;
#: o teto mora aqui, na validacao.
CONTENT_MAX = 5000

#: Texto que substitui o conteudo de um comentario apagado que ainda aparece
#: no thread por ter replicas vivas (D5).
TOMBSTONE_TEXT = "[comentário removido]"


def normalize_content(raw: str) -> str:
    """Aplica strip e valida o tamanho. Levanta ValidationError (422) se o
    conteudo ficar vazio ou exceder CONTENT_MAX (D8)."""
    content = (raw or "").strip()
    if not content:
        raise ValidationError(
            "Comentario nao pode ser vazio.",
            details={"field": "content"},
        )
    if len(content) > CONTENT_MAX:
        raise ValidationError(
            f"Comentario excede {CONTENT_MAX} caracteres.",
            details={"field": "content", "max": CONTENT_MAX},
        )
    return content


def assert_reply_target(
    *,
    parent_task_id: uuid.UUID,
    parent_parent_comment_id: uuid.UUID | None,
    task_id: uuid.UUID,
) -> None:
    """Valida o alvo de uma replica -- threading de 1 nivel (D4).

    O pai (ja carregado e ATIVO pelo service) deve ser da MESMA task e ser de
    TOPO (parent_comment_id None). Replica-de-replica ou pai de outra task ->
    ValidationError (422).
    """
    if parent_task_id != task_id:
        raise ValidationError(
            "Comentario-pai e de outra tarefa.",
            details={"field": "parent_comment_id"},
        )
    if parent_parent_comment_id is not None:
        raise ValidationError(
            "So da pra responder um comentario de topo (1 nivel).",
            details={"field": "parent_comment_id"},
        )


def can_edit(*, author_id: uuid.UUID, actor_id: uuid.UUID) -> bool:
    """So o autor edita o proprio comentario (D2). Nem moderador edita alheio."""
    return author_id == actor_id


def can_delete(
    *,
    author_id: uuid.UUID,
    actor_id: uuid.UUID,
    actor_can_moderate: bool,
) -> bool:
    """Autor apaga o proprio; moderador (task.delete) apaga de qualquer um (D3)."""
    return author_id == actor_id or actor_can_moderate


def mask_content(content: str, *, is_deleted: bool) -> str:
    """Conteudo a exibir: o original, ou o tombstone se apagado (D5)."""
    return TOMBSTONE_TEXT if is_deleted else content
