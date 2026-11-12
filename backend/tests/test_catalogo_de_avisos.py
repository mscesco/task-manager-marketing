"""Todo tipo de aviso esta em exatamente um grupo da tela de preferencias."""

from __future__ import annotations

from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.domain.preferences import GRUPOS


def test_todo_tipo_de_aviso_esta_em_um_grupo() -> None:
    """Tipo sem grupo chegaria para todo mundo sem toggle; tipo em dois grupos
    faria dois toggles disputarem o mesmo aviso."""
    de_grupo = [t for g in GRUPOS for t in g.tipos]
    assert sorted(de_grupo) == sorted({t.value for t in NotificationType})
    assert len(de_grupo) == len(set(de_grupo))
