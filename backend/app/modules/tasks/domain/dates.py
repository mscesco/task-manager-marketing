"""Regras de data comuns a projeto e tarefa."""

from __future__ import annotations

from datetime import date

from app.shared.exceptions.base import ValidationError


def validate_dates(start_date: date | None, due_date: date | None) -> None:
    """Garante start_date <= due_date quando ambos informados.

    Era copiada igual em `ProjectService` e `TaskService` (revisao de 07/10).
    """
    if start_date is not None and due_date is not None and start_date > due_date:
        raise ValidationError(
            "Data de inicio nao pode ser posterior a data limite.",
            details={"field": "due_date"},
        )
