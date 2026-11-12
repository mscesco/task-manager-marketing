"""Regras puras de comentario: conteudo, threading de 1 nivel, quem edita/apaga, tombstone."""

from __future__ import annotations

import re
import uuid

from app.shared.exceptions.base import ValidationError

#: Teto de tamanho do comentario; a coluna no banco nao tem limite.
CONTENT_MAX = 5000

#: Texto que substitui o conteudo de um comentario apagado que ainda tem replicas vivas.
TOMBSTONE_TEXT = "[comentário removido]"

#: Mencao inline @[Nome](uuid). Linear, sem catastrophic backtracking.
_MENTION_RE = re.compile(
    r"@\[[^\]]+\]\("
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)"
)


def extract_mentions(content: str) -> list[uuid.UUID]:
    """Ids mencionados no conteudo, sem repetir e na ordem. Nao valida se e membro."""
    out: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for m in _MENTION_RE.finditer(content or ""):
        try:
            uid = uuid.UUID(m.group(1))
        except ValueError:
            continue
        if uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


def normalize_content(raw: str) -> str:
    """Aplica strip e valida o tamanho. Levanta ValidationError (422) se o
    conteudo ficar vazio ou exceder CONTENT_MAX."""
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
    """Valida o alvo de uma replica -- threading de 1 nivel.

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
    """So o autor edita o proprio comentario. Nem moderador edita alheio."""
    return author_id == actor_id


def can_delete(
    *,
    author_id: uuid.UUID,
    actor_id: uuid.UUID,
    actor_can_moderate: bool,
) -> bool:
    """Autor apaga o proprio; moderador (task.delete) apaga de qualquer um."""
    return author_id == actor_id or actor_can_moderate


def mask_content(content: str, *, is_deleted: bool) -> str:
    """Conteudo a exibir: o original, ou o tombstone se apagado."""
    return TOMBSTONE_TEXT if is_deleted else content
