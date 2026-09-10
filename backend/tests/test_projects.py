"""Testes do submodulo Projects.

Cobertura nesta suite (pura logica, sem DB):
    - validacoes do CreateProjectCommand (defaults);
    - validacao de datas (_validate_dates).

⚠️ ESTA SUITE ERA MAIOR ATE 10/09. Cobria tambem `_assert_not_personal`,
`_assert_visible_to_current_user` e a constante `PERSONAL_PROJECT_TITLE` --
as tres do projeto pessoal, e as tres sairam com ele. Nao foram apagadas por
estarem fracas: o comportamento que elas afirmavam deixou de existir.

Testes que exercitam escrita real no Postgres (criar projeto,
listar, archive, etc.) ficam na suite de integracao separada,
executada contra o banco task_manager_dev -- ver README.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.tasks.application.project_service import (
    CreateProjectCommand,
    ProjectFilters,
    ProjectService,
    UpdateProjectCommand,
)
from app.shared.exceptions.base import ValidationError


# --------------------------------------------------------
# --------------------------------------------------------
# Constantes e defaults
# --------------------------------------------------------
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
