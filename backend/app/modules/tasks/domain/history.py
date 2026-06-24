"""Dominio do task_history.

Encapsula a logica de "que linhas escrever em task_history" sem
depender de DB. Service constroi entries puras aqui e o
repository persiste depois.

Modelo hibrido -- ver ADR 0004:
    - eventos atomicos (CREATED, MOVED, ARCHIVED, UNARCHIVED, DELETED):
      1 linha, field_name=None, old/new_value=None, metadata com contexto;
    - eventos de update por campo (UPDATED): 1 linha por campo;
    - status_changed: evento dedicado.

Cascata de soft-delete (ADR 0005):
    - DELETED da raiz carrega `cascade_count` no metadata;
    - filhas apagadas em cascade NAO geram entries individuais.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
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


@dataclass(frozen=True, slots=True)
class HistoryEntry:
    """Linha a inserir em task_history (intermediario puro)."""

    event_type: TaskHistoryEventType
    field_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


def _stringify(value: Any) -> Any:
    """Converte tipos nao-serializaveis em JSON (UUID, date, datetime,
    Enum) para representacao serializavel.

    Mantem None, str, int, float, bool intocados.
    """
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
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
    old_project_id: uuid.UUID,
    new_project_id: uuid.UUID,
    old_parent_task_id: uuid.UUID | None,
    new_parent_task_id: uuid.UUID | None,
) -> HistoryEntry:
    """Evento atomico de move."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.MOVED,
        metadata={
            "old_project_id": _stringify(old_project_id),
            "new_project_id": _stringify(new_project_id),
            "old_parent_task_id": _stringify(old_parent_task_id),
            "new_parent_task_id": _stringify(new_parent_task_id),
        },
    )


def build_archived_entry() -> HistoryEntry:
    return HistoryEntry(event_type=TaskHistoryEventType.ARCHIVED)


def build_unarchived_entry() -> HistoryEntry:
    return HistoryEntry(event_type=TaskHistoryEventType.UNARCHIVED)


def build_deleted_entry(*, cascade_count: int) -> HistoryEntry:
    """cascade_count = descendentes apagados (nao inclui a propria task)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.DELETED,
        metadata={"cascade_count": cascade_count},
    )


def build_assigned_entry(
    *, user_id: uuid.UUID, assigned_by: uuid.UUID
) -> HistoryEntry:
    """Evento de designacao de responsavel (Entrega 4 -- ADR 0012)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.ASSIGNED,
        metadata={
            "user_id": _stringify(user_id),
            "assigned_by": _stringify(assigned_by),
        },
    )


def build_unassigned_entry(*, user_id: uuid.UUID) -> HistoryEntry:
    """Evento de remocao de responsavel (Entrega 4 -- ADR 0012)."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.UNASSIGNED,
        metadata={"user_id": _stringify(user_id)},
    )
