"""Testes do submodulo Projects.

Cobertura nesta suite (pura logica, sem DB):
    - validacoes do CreateProjectCommand (defaults);
    - validacao de datas (_validate_dates);
    - assercao de "nao eh pessoal" (_assert_not_personal);
    - assercao de visibilidade (_assert_visible_to_current_user);
    - constante PERSONAL_PROJECT_TITLE.

Testes que exercitam escrita real no Postgres (criar projeto,
listar, archive, etc.) ficam na suite de integracao separada,
executada contra o banco task_manager_dev -- ver README.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

import pytest

from app.core.tenant import tenant_scope
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.tasks.application.project_service import (
    PERSONAL_PROJECT_TITLE,
    CreateProjectCommand,
    ProjectFilters,
    ProjectService,
    UpdateProjectCommand,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)


# --------------------------------------------------------
# Stubs para testes puros
# --------------------------------------------------------
@dataclass
class _FakeProject:
    """Stand-in mínimo para Project nos testes puros.

    Suficiente para os asserts estaticos -- nao precisa ser
    instancia ORM real.
    """

    id: uuid.UUID
    is_personal: bool
    created_by: uuid.UUID


def _fake_project(
    *,
    is_personal: bool,
    created_by: uuid.UUID | None = None,
) -> _FakeProject:
    return _FakeProject(
        id=uuid.uuid4(),
        is_personal=is_personal,
        created_by=created_by or uuid.uuid4(),
    )


# --------------------------------------------------------
# Constantes e defaults
# --------------------------------------------------------
def test_personal_project_title_constant() -> None:
    """Title do pessoal eh fixo (decisao 20 da spec)."""
    assert PERSONAL_PROJECT_TITLE == "Pessoal"


def test_create_command_defaults() -> None:
    """CreateProjectCommand tem defaults previsiveis."""
    import uuid

    team_id = uuid.uuid4()
    cmd = CreateProjectCommand(title="Lançamento Q3", team_id=team_id)
    assert cmd.title == "Lançamento Q3"
    assert cmd.team_id == team_id
    assert cmd.description == ""
    assert cmd.status == ProjectStatus.PLANNING
    assert cmd.priority == PriorityLevel.MEDIUM
    assert cmd.start_date is None
    assert cmd.due_date is None


def test_update_command_defaults_all_none() -> None:
    """UpdateProjectCommand -- todos None significa 'nao mexer em nada'."""
    cmd = UpdateProjectCommand()
    assert cmd.title is None
    assert cmd.description is None
    assert cmd.status is None
    assert cmd.priority is None
    assert cmd.start_date is None
    assert cmd.due_date is None


def test_project_filters_default_excludes_archived() -> None:
    """include_archived eh False por padrao (decisao 7 da spec)."""
    f = ProjectFilters()
    assert f.include_archived is False
    assert f.status is None
    assert f.priority is None


# --------------------------------------------------------
# _validate_dates
# --------------------------------------------------------
def test_validate_dates_none_combinations() -> None:
    """None em qualquer dos campos eh aceito."""
    ProjectService._validate_dates(None, None)
    ProjectService._validate_dates(date(2026, 1, 1), None)
    ProjectService._validate_dates(None, date(2026, 1, 1))


def test_validate_dates_equal_dates_ok() -> None:
    """start == due eh aceito (start <= due)."""
    d = date(2026, 1, 1)
    ProjectService._validate_dates(d, d)


def test_validate_dates_start_before_due_ok() -> None:
    """start < due eh aceito."""
    ProjectService._validate_dates(date(2026, 1, 1), date(2026, 6, 1))


def test_validate_dates_rejects_start_after_due() -> None:
    """start > due levanta ValidationError com field=due_date."""
    with pytest.raises(ValidationError) as exc:
        ProjectService._validate_dates(
            date(2026, 6, 1), date(2026, 1, 1)
        )
    assert exc.value.details["field"] == "due_date"


# --------------------------------------------------------
# _assert_not_personal
# --------------------------------------------------------
def test_assert_not_personal_allows_common_project() -> None:
    """Projeto comum (is_personal=False) passa sem erro."""
    ProjectService._assert_not_personal(
        _fake_project(is_personal=False),  # type: ignore[arg-type]
        operation="deletado",
    )


def test_assert_not_personal_rejects_personal() -> None:
    """Projeto pessoal levanta BusinessRuleError com a operacao."""
    with pytest.raises(BusinessRuleError) as exc:
        ProjectService._assert_not_personal(
            _fake_project(is_personal=True),  # type: ignore[arg-type]
            operation="arquivado",
        )
    assert "arquivado" in str(exc.value)
    assert exc.value.details["is_personal"] is True


# --------------------------------------------------------
# _assert_visible_to_current_user
# --------------------------------------------------------
def test_assert_visible_allows_common_project_for_anyone() -> None:
    """Projetos comuns sao visiveis independente do created_by."""
    me = uuid.uuid4()
    other = uuid.uuid4()
    ws = uuid.uuid4()
    fp = _fake_project(is_personal=False, created_by=other)
    with tenant_scope(ws, me):
        ProjectService._assert_visible_to_current_user(fp)  # type: ignore[arg-type]


def test_assert_visible_allows_owned_personal() -> None:
    """Pessoal proprio eh visivel."""
    me = uuid.uuid4()
    ws = uuid.uuid4()
    fp = _fake_project(is_personal=True, created_by=me)
    with tenant_scope(ws, me):
        ProjectService._assert_visible_to_current_user(fp)  # type: ignore[arg-type]


def test_assert_visible_rejects_other_personal_with_404() -> None:
    """Pessoal alheio levanta EntityNotFoundError -- nao 403, nao vaza."""
    me = uuid.uuid4()
    other = uuid.uuid4()
    ws = uuid.uuid4()
    fp = _fake_project(is_personal=True, created_by=other)
    with tenant_scope(ws, me):
        with pytest.raises(EntityNotFoundError):
            ProjectService._assert_visible_to_current_user(fp)  # type: ignore[arg-type]
