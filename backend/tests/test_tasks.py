"""Tasks, logica pura: label LTREE, path/depth, datas e hora, diff do PATCH
para o historico e builders de historico. Escrita real no Postgres fica em
`tests/integration/`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, time

import pytest

from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.tasks.application.task_service import (
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
from app.modules.tasks.domain.dates import validate_dates
from app.modules.tasks.domain.history import (
    TaskHistoryEventType,
    build_created_entry,
    build_deleted_entry,
    build_field_update_entry,
    build_move_entry,
    build_status_change_entry,
)
from app.shared.exceptions.base import ValidationError


# --------------------------------------------------------
# Stub mínimo para testes puros
# --------------------------------------------------------
@dataclass
class _FakeTask:
    """Stand-in mínimo para Task. Suficiente pra _diff_for_update."""

    id: uuid.UUID
    title: str = "Original"
    description: str = ""
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    due_time: time | None = None
    path: str = ""
    depth: int = 0


def _fake_task(**kwargs) -> _FakeTask:
    return _FakeTask(id=uuid.uuid4(), **kwargs)


# --------------------------------------------------------
# Filtros
# --------------------------------------------------------
def test_task_filters_default_excludes_archived() -> None:
    f = TaskFilters()
    assert f.include_archived is False
    assert f.root_only is False
    assert f.project_id is None


# --------------------------------------------------------
# _label_for
# --------------------------------------------------------
def test_label_for_format() -> None:
    """Label = 't' + uuid.hex, sem hifen (invalido em LTREE)."""
    task_id = uuid.UUID("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")
    label = TaskService._label_for(task_id)
    assert label == "tf81d4fae7dec11d0a76500a0c91e6bf6"
    assert label.startswith("t")
    assert len(label) == 33  # 't' + 32 hex chars


# --------------------------------------------------------
# _compute_path_and_depth
# --------------------------------------------------------
def test_compute_path_and_depth_root() -> None:
    """Raiz: path = label, depth = 0."""
    path, depth = TaskService._compute_path_and_depth(None, "tabc123")
    assert path == "tabc123"
    assert depth == 0


def test_compute_path_and_depth_with_parent() -> None:
    """Com pai: path = pai.path + '.' + label, depth = pai.depth + 1."""
    parent = _fake_task(path="troot.tlevel1", depth=1)
    path, depth = TaskService._compute_path_and_depth(parent, "tchild")  # type: ignore[arg-type]
    assert path == "troot.tlevel1.tchild"
    assert depth == 2


# --------------------------------------------------------
# validate_dates (TaskService e ProjectService usam a mesma)
# --------------------------------------------------------
@pytest.mark.parametrize(
    ("start", "due"),
    [
        (None, None),
        (date(2026, 1, 1), None),
        (None, date(2026, 1, 1)),
        (date(2026, 1, 1), date(2026, 1, 1)),
        (date(2026, 1, 1), date(2026, 6, 1)),
    ],
)
def test_validate_dates_aceita(start: date | None, due: date | None) -> None:
    validate_dates(start, due)


def test_validate_dates_rejects_start_after_due() -> None:
    with pytest.raises(ValidationError) as exc:
        validate_dates(date(2026, 6, 1), date(2026, 1, 1))
    assert exc.value.details["field"] == "due_date"


# --------------------------------------------------------
# _validate_hora
#
# A regra fica no servico, nao no schema: um `@model_validator` no Pydantic
# devolve 500 e nao 422 neste projeto (ver `TaskUpdateRequest`).
# --------------------------------------------------------
def test_validate_hora_sem_hora_sempre_passa() -> None:
    TaskService._validate_hora(None, None)
    TaskService._validate_hora(date(2026, 8, 19), None)


def test_validate_hora_com_data_e_hora_passa() -> None:
    TaskService._validate_hora(date(2026, 8, 19), time(18, 0))


def test_validate_hora_recusa_hora_sem_data() -> None:
    """Hora sem data vira dado orfao: invisivel na tela e pronta para
    reaparecer com o dia errado no primeiro PATCH que preencher `due_date`."""
    with pytest.raises(ValidationError) as exc:
        TaskService._validate_hora(None, time(18, 0))
    assert exc.value.details["field"] == "due_time"


def test_validate_hora_meia_noite_NAO_e_ausencia() -> None:
    """`time(0, 0)` e uma hora, distinta de `None`. Um `if not due_time:` no
    lugar de `is not None` faria "vence dia 19" e "vence dia 19 a
    meia-noite" colidirem."""
    TaskService._validate_hora(date(2026, 8, 19), time(0, 0))
    with pytest.raises(ValidationError):
        TaskService._validate_hora(None, time(0, 0))


# --------------------------------------------------------
# _diff_for_update
# --------------------------------------------------------
def test_diff_no_changes_returns_empty() -> None:
    """PATCH sem mudancas reais -> 0 entries."""
    task = _fake_task(title="Mesmo")
    cmd = UpdateTaskCommand(title="Mesmo")
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert entries == []


def test_diff_single_field_change() -> None:
    task = _fake_task(title="Antigo")
    cmd = UpdateTaskCommand(title="Novo")
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert len(entries) == 1
    assert entries[0].event_type == TaskHistoryEventType.UPDATED
    assert entries[0].field_name == "title"


def test_diff_multiple_fields() -> None:
    task = _fake_task(title="A", description="X", priority=PriorityLevel.LOW)
    cmd = UpdateTaskCommand(
        title="B", description="Y", priority=PriorityLevel.HIGH
    )
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert len(entries) == 3
    fields = {e.field_name for e in entries}
    assert fields == {"title", "description", "priority"}


def test_diff_status_uses_dedicated_event() -> None:
    """Status muda -> STATUS_CHANGED, nao UPDATED."""
    task = _fake_task(status=TaskStatus.BACKLOG)
    cmd = UpdateTaskCommand(status=TaskStatus.IN_PROGRESS)
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert len(entries) == 1
    assert entries[0].event_type == TaskHistoryEventType.STATUS_CHANGED


def test_diff_status_to_completed_marks_completed_at_changed() -> None:
    task = _fake_task(status=TaskStatus.IN_PROGRESS)
    cmd = UpdateTaskCommand(status=TaskStatus.COMPLETED)
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert entries[0].metadata["completed_at_changed"] is True


def test_diff_status_out_of_completed_marks_changed() -> None:
    task = _fake_task(status=TaskStatus.COMPLETED)
    cmd = UpdateTaskCommand(status=TaskStatus.IN_PROGRESS)
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert entries[0].metadata["completed_at_changed"] is True


def test_diff_status_between_non_completed_not_flagged() -> None:
    """Mudar entre dois status nao-COMPLETED nao mexe completed_at."""
    task = _fake_task(status=TaskStatus.BACKLOG)
    cmd = UpdateTaskCommand(status=TaskStatus.IN_PROGRESS)
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert entries[0].metadata["completed_at_changed"] is False


def test_diff_title_whitespace_only_does_not_match() -> None:
    """Title novo com so whitespace eh ignorado (so title efetivo conta).

    Nota: a validacao 'title vazio' acontece DEPOIS do diff, no update.
    Aqui, se o new_title.strip() resultar em algo igual ao task.title,
    nao gera entry.
    """
    task = _fake_task(title="Original")
    cmd = UpdateTaskCommand(title="   Original   ")
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert entries == []


@pytest.mark.parametrize("campo", ["start_date", "due_date"])
def test_diff_clearing_a_date_writes_history(campo) -> None:
    """`None` presente no PATCH limpa a data, e a limpeza entra no historico."""
    task = _fake_task(**{campo: date(2026, 8, 19)})
    cmd = UpdateTaskCommand(fields_set=frozenset({campo}))
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert [(e.field_name, e.old_value, e.new_value) for e in entries] == [
        (campo, {"value": "2026-08-19"}, {"value": None})
    ]


@pytest.mark.parametrize("campo", ["start_date", "due_date"])
def test_diff_omitted_date_writes_nothing(campo) -> None:
    task = _fake_task(**{campo: date(2026, 8, 19)})
    entries = TaskService._diff_for_update(task, UpdateTaskCommand())  # type: ignore[arg-type]
    assert entries == []


def test_diff_due_time_writes_history() -> None:
    task = _fake_task(due_date=date(2026, 8, 19), due_time=time(18, 0))
    cmd = UpdateTaskCommand(due_time=time(9, 30), fields_set=frozenset({"due_time"}))
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert [(e.field_name, e.old_value, e.new_value) for e in entries] == [
        ("due_time", {"value": "18:00:00"}, {"value": "09:30:00"})
    ]


def test_diff_clearing_due_time_writes_history() -> None:
    task = _fake_task(due_date=date(2026, 8, 19), due_time=time(18, 0))
    cmd = UpdateTaskCommand(fields_set=frozenset({"due_time"}))
    entries = TaskService._diff_for_update(task, cmd)  # type: ignore[arg-type]
    assert [(e.field_name, e.new_value) for e in entries] == [
        ("due_time", {"value": None})
    ]


def test_diff_team_change() -> None:
    antigo, novo = uuid.uuid4(), uuid.uuid4()
    task = _fake_task(team_id=antigo)
    entries = TaskService._diff_for_update(task, UpdateTaskCommand(team_id=novo))  # type: ignore[arg-type]
    assert [(e.field_name, e.old_value, e.new_value) for e in entries] == [
        ("team_id", {"value": str(antigo)}, {"value": str(novo)})
    ]


# --------------------------------------------------------
# Builders de history
# --------------------------------------------------------
def test_build_created_entry() -> None:
    project_id = uuid.uuid4()
    entry = build_created_entry(
        title="T1", project_id=project_id, parent_task_id=None
    )
    assert entry.event_type == TaskHistoryEventType.CREATED
    assert entry.field_name is None
    assert entry.metadata["title"] == "T1"
    assert entry.metadata["project_id"] == str(project_id)
    assert entry.metadata["parent_task_id"] is None


def test_build_field_update_entry_serializes_uuid() -> None:
    """UUID em old/new vira string serializavel."""
    old = uuid.uuid4()
    new = uuid.uuid4()
    entry = build_field_update_entry(field_name="team_id", old=old, new=new)
    assert entry.event_type == TaskHistoryEventType.UPDATED
    assert entry.old_value == {"value": str(old)}
    assert entry.new_value == {"value": str(new)}


def test_build_field_update_entry_serializes_enum() -> None:
    """Enum em old/new vira string (value)."""
    entry = build_field_update_entry(
        field_name="priority",
        old=PriorityLevel.LOW,
        new=PriorityLevel.HIGH,
    )
    assert entry.old_value == {"value": "LOW"}
    assert entry.new_value == {"value": "HIGH"}


def test_build_status_change_entry() -> None:
    entry = build_status_change_entry(
        old_status=TaskStatus.BACKLOG,
        new_status=TaskStatus.COMPLETED,
        completed_at_changed=True,
    )
    assert entry.event_type == TaskHistoryEventType.STATUS_CHANGED
    assert entry.field_name == "status"
    assert entry.old_value == {"value": "BACKLOG"}
    assert entry.new_value == {"value": "COMPLETED"}
    assert entry.metadata["completed_at_changed"] is True


def test_build_move_entry() -> None:
    old_proj = uuid.uuid4()
    new_proj = uuid.uuid4()
    entry = build_move_entry(
        old_project_id=old_proj,
        new_project_id=new_proj,
        old_parent_task_id=None,
        new_parent_task_id=None,
    )
    assert entry.event_type == TaskHistoryEventType.MOVED
    assert entry.metadata["old_project_id"] == str(old_proj)
    assert entry.metadata["new_project_id"] == str(new_proj)
    assert entry.metadata["old_parent_task_id"] is None
    assert entry.metadata["new_parent_task_id"] is None


def test_build_deleted_entry_with_cascade() -> None:
    entry = build_deleted_entry(cascade_count=3)
    assert entry.event_type == TaskHistoryEventType.DELETED
    assert entry.metadata == {"cascade_count": 3}


def test_build_deleted_entry_no_cascade() -> None:
    """Task sem filhas: cascade_count = 0."""
    entry = build_deleted_entry(cascade_count=0)
    assert entry.metadata == {"cascade_count": 0}
