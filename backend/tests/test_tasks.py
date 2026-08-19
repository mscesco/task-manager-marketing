"""Testes do submodulo Tasks.

Cobertura nesta suite (pura logica, sem DB):
    - Defaults dos commands.
    - _label_for (formato t<hex>).
    - _compute_path_and_depth (raiz e com pai).
    - _validate_dates (todas as combinacoes).
    - _diff_for_update:
        * PATCH sem mudancas -> 0 entries
        * PATCH 1 campo -> 1 entry
        * PATCH N campos -> N entries
        * PATCH status -> STATUS_CHANGED
        * PATCH title igual -> 0 entries (sem fantasma)
    - Builders de history (CREATED, MOVED, DELETED com cascade).

Testes que exercitam escrita real no Postgres (hierarquia, move
cascateado, history) ficam na suite de integracao separada.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, time

import pytest

from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    MoveTaskCommand,
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
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
    path: str = ""
    depth: int = 0


def _fake_task(**kwargs) -> _FakeTask:
    return _FakeTask(id=uuid.uuid4(), **kwargs)


# --------------------------------------------------------
# Commands / defaults
# --------------------------------------------------------
def test_create_command_defaults() -> None:
    """CreateTaskCommand tem defaults previsiveis."""
    cmd = CreateTaskCommand(project_id=uuid.uuid4(), title="X")
    assert cmd.title == "X"
    assert cmd.description == ""
    assert cmd.parent_task_id is None
    assert cmd.team_id is None
    assert cmd.status == TaskStatus.BACKLOG
    assert cmd.priority == PriorityLevel.MEDIUM
    assert cmd.start_date is None
    assert cmd.due_date is None


def test_update_command_defaults_all_none() -> None:
    """UpdateTaskCommand -- todos None significa 'nao mexer'."""
    cmd = UpdateTaskCommand()
    assert all(
        v is None
        for v in (
            cmd.title,
            cmd.description,
            cmd.status,
            cmd.priority,
            cmd.team_id,
            cmd.start_date,
            cmd.due_date,
        )
    )


def test_move_command_defaults_all_none() -> None:
    """MoveTaskCommand sem args = no-op silencioso."""
    cmd = MoveTaskCommand()
    assert cmd.parent_task_id is None
    assert cmd.project_id is None


def test_task_filters_default_excludes_archived() -> None:
    f = TaskFilters()
    assert f.include_archived is False
    assert f.root_only is False
    assert f.project_id is None


# --------------------------------------------------------
# _label_for
# --------------------------------------------------------
def test_label_for_format() -> None:
    """Label = 't' + uuid.hex (ADR 0002)."""
    task_id = uuid.UUID("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")
    label = TaskService._label_for(task_id)
    assert label == "tf81d4fae7dec11d0a76500a0c91e6bf6"
    assert label.startswith("t")
    assert len(label) == 33  # 't' + 32 hex chars


def test_label_for_no_hyphens() -> None:
    """Label nao pode conter hifens (invalido em LTREE)."""
    for _ in range(20):
        label = TaskService._label_for(uuid.uuid4())
        assert "-" not in label
        assert all(c.isalnum() or c == "_" for c in label)


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
# _validate_dates
# --------------------------------------------------------
def test_validate_dates_none_combinations() -> None:
    TaskService._validate_dates(None, None)
    TaskService._validate_dates(date(2026, 1, 1), None)
    TaskService._validate_dates(None, date(2026, 1, 1))


def test_validate_dates_equal_dates_ok() -> None:
    d = date(2026, 1, 1)
    TaskService._validate_dates(d, d)


def test_validate_dates_start_before_due_ok() -> None:
    TaskService._validate_dates(date(2026, 1, 1), date(2026, 6, 1))


def test_validate_dates_rejects_start_after_due() -> None:
    with pytest.raises(ValidationError) as exc:
        TaskService._validate_dates(date(2026, 6, 1), date(2026, 1, 1))
    assert exc.value.details["field"] == "due_date"


# --------------------------------------------------------
# _validate_hora  (Spec 038, fatia B)
#
# ⚠️ POR QUE ESTA REGRA E DO SERVICO, E NAO DO SCHEMA. Um `@model_validator` no
# Pydantic devolveria **500 e nao 422** neste projeto -- medido, e anotado no
# `TaskUpdateRequest` para a exclusao mutua entre `status` e `column_id`.
# --------------------------------------------------------
def test_validate_hora_sem_hora_sempre_passa() -> None:
    """`None` em `due_time` e o estado de 100% das tarefas ate 18/08."""
    TaskService._validate_hora(None, None)
    TaskService._validate_hora(date(2026, 8, 19), None)


def test_validate_hora_com_data_e_hora_passa() -> None:
    TaskService._validate_hora(date(2026, 8, 19), time(18, 0))


def test_validate_hora_recusa_hora_sem_data() -> None:
    """⚠️ HORA SOZINHA NAO SITUA NADA, e guardada vira dado orfao.

    Ela ficaria invisivel na tela (que so desenha hora ao lado de data), viva no
    banco, e pronta para reaparecer com o dia errado no primeiro PATCH que
    preenchesse `due_date`.
    """
    with pytest.raises(ValidationError) as exc:
        TaskService._validate_hora(None, time(18, 0))
    assert exc.value.details["field"] == "due_time"


def test_validate_hora_meia_noite_NAO_e_ausencia() -> None:
    """⚠️ `time(0, 0)` E UMA HORA, e o teste existe por causa do desenho.

    Este e o caso que fez o `timestamptz` ser recusado: com um timestamp unico,
    "vence dia 19" e "vence dia 19 a meia-noite" sao o mesmo valor. Aqui sao
    estados distintos -- `None` contra `time(0, 0)` -- e uma implementacao que
    tratasse meia-noite como "sem hora" (um `if not due_time:` no lugar de
    `is not None`) faria os dois voltarem a colidir.
    """
    TaskService._validate_hora(date(2026, 8, 19), time(0, 0))
    with pytest.raises(ValidationError):
        TaskService._validate_hora(None, time(0, 0))


def test_update_command_aceita_due_time() -> None:
    """O campo existe no comando, com default `None`."""
    cmd = UpdateTaskCommand()
    assert cmd.due_time is None


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
