"""Projects, logica pura. A regra de datas esta em `test_tasks.py`
(`validate_dates` e a mesma), e a escrita real no Postgres em
`tests/integration/`.
"""

from __future__ import annotations

from app.modules.tasks.application.project_service import ProjectFilters


def test_project_filters_default_excludes_archived() -> None:
    f = ProjectFilters()
    assert f.include_archived is False
    assert f.status is None
    assert f.priority is None
