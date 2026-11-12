"""Que linhas escrever em task_history, sem DB; o repository persiste.

    - eventos atomicos (CREATED, MOVED, ARCHIVED, UNARCHIVED, DELETED):
      1 linha, field_name=None, metadata com contexto;
    - UPDATED: 1 linha por campo;
    - STATUS_CHANGED: evento dedicado.
Em cascata, so a raiz ganha linha, com `cascade_count`; as filhas nao.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from enum import Enum
from typing import Any


class TaskHistoryEventType(str, Enum):
    """Tipos de evento auditados na timeline de uma task."""

    CREATED = "created"
    UPDATED = "updated"
    STATUS_CHANGED = "status_changed"
    MOVED = "moved"
    ARCHIVED = "archived"
    UNARCHIVED = "unarchived"
    DELETED = "deleted"
    ASSIGNED = "assigned"
    UNASSIGNED = "unassigned"
    WATCHED = "watched"
    UNWATCHED = "unwatched"


@dataclass(frozen=True, slots=True)
class HistoryEntry:
    """Linha a inserir em task_history (intermediario puro)."""

    event_type: TaskHistoryEventType
    field_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


def _stringify(value: Any) -> Any:
    """Converte UUID, Enum, date, datetime e time para forma serializavel em JSON."""
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    return value


def build_created_entry(
    *,
    title: str,
    project_id: uuid.UUID | None,
    parent_task_id: uuid.UUID | None,
) -> HistoryEntry:
    """Evento atomico de criacao."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.CREATED,
        metadata={
            "title": title,
            "project_id": _stringify(project_id),
            "parent_task_id": _stringify(parent_task_id),
        },
    )


def build_field_update_entry(
    *, field_name: str, old: Any, new: Any
) -> HistoryEntry:
    """Evento de update granular (1 linha por campo)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.UPDATED,
        field_name=field_name,
        old_value={"value": _stringify(old)},
        new_value={"value": _stringify(new)},
    )


def build_status_change_entry(
    *,
    old_status: Any,
    new_status: Any,
    completed_at_changed: bool,
) -> HistoryEntry:
    """Evento dedicado de mudanca de status."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.STATUS_CHANGED,
        field_name="status",
        old_value={"value": _stringify(old_status)},
        new_value={"value": _stringify(new_status)},
        metadata={"completed_at_changed": completed_at_changed},
    )


def build_move_entry(
    *,
    old_project_id: uuid.UUID | None,
    new_project_id: uuid.UUID | None,
    old_parent_task_id: uuid.UUID | None,
    new_parent_task_id: uuid.UUID | None,
) -> HistoryEntry:
    """Evento atomico de move. project_id pode ser None (avulsa)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.MOVED,
        metadata={
            "old_project_id": _stringify(old_project_id),
            "new_project_id": _stringify(new_project_id),
            "old_parent_task_id": _stringify(old_parent_task_id),
            "new_parent_task_id": _stringify(new_parent_task_id),
        },
    )


def build_archived_entry(
    *,
    automated: bool = False,
    reason: str | None = None,
    cascade_count: int = 0,
) -> HistoryEntry:
    """Evento de arquivamento.

    `automated=True` marca acao do job de auto-arquivamento. `cascade_count`
    (descendentes, sem a propria task) so entra quando > 0; sem nada, metadata None.
    """
    metadata: dict[str, Any] | None = None
    if automated:
        metadata = {"automated": True}
        if reason:
            metadata["reason"] = reason
    if cascade_count:
        metadata = {**(metadata or {}), "cascade_count": cascade_count}
    return HistoryEntry(
        event_type=TaskHistoryEventType.ARCHIVED, metadata=metadata
    )


def build_unarchived_entry(*, cascade_count: int = 0) -> HistoryEntry:
    """Evento de desarquivamento. Ver `build_archived_entry` sobre o zero."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.UNARCHIVED,
        metadata={"cascade_count": cascade_count} if cascade_count else None,
    )


def build_deleted_entry(*, cascade_count: int) -> HistoryEntry:
    """cascade_count = descendentes apagados (nao inclui a propria task)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.DELETED,
        metadata={"cascade_count": cascade_count},
    )


def build_assigned_entry(
    *, user_id: uuid.UUID, assigned_by: uuid.UUID
) -> HistoryEntry:
    """Evento de designacao de responsavel."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.ASSIGNED,
        metadata={
            "user_id": _stringify(user_id),
            "assigned_by": _stringify(assigned_by),
        },
    )


class MotivoDoSeguidor(str, Enum):
    """Por que alguem entrou ou saiu como seguidor."""

    MANUAL = "manual"  # o gesto de seguir / deixar de seguir / por / tirar
    CREATED_WITH = "created_with"  # escolhido no modal de criar tarefa
    LOST_ACCESS = "lost_access"  # saiu sozinho: deixou de alcancar a tarefa


def build_watched_entry(
    *, user_id: uuid.UUID, by: uuid.UUID, reason: MotivoDoSeguidor
) -> HistoryEntry:
    """Alguem passou a seguir a tarefa. `by_self` separa "seguiu" de "foi posto"."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.WATCHED,
        metadata={
            "target_user_id": _stringify(user_id),
            "by_self": user_id == by,
            "reason": reason.value,
        },
    )


def build_unwatched_entry(
    *, user_id: uuid.UUID, by: uuid.UUID, reason: MotivoDoSeguidor
) -> HistoryEntry:
    """Alguem deixou de seguir a tarefa.

    Com `LOST_ACCESS`, `by` e quem tirou o alcance e `by_self` e sempre falso.
    """
    return HistoryEntry(
        event_type=TaskHistoryEventType.UNWATCHED,
        metadata={
            "target_user_id": _stringify(user_id),
            "by_self": user_id == by and reason is not MotivoDoSeguidor.LOST_ACCESS,
            "reason": reason.value,
        },
    )


def build_unassigned_entry(*, user_id: uuid.UUID) -> HistoryEntry:
    """Evento de remocao de responsavel."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.UNASSIGNED,
        metadata={"user_id": _stringify(user_id)},
    )
