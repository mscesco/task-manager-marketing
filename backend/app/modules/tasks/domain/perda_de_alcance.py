"""Tipos da resposta do que uma pessoa deixaria orfao ao encolher a lente.

A regra mora em `TaskRepository.bloqueios_por_perda_de_alcance` (e consulta ao
banco); aqui so a forma da lista estruturada que vai no 422.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TarefaBloqueio:
    """Uma tarefa que impede a mudanca de vinculo. `subtime` e o nome do time, nao o id."""

    task_id: uuid.UUID
    titulo: str
    team_id: uuid.UUID | None
    subtime: str | None
    coluna: str


@dataclass(frozen=True, slots=True)
class RelacaoPerdida:
    """Uma relacao (responsavel e/ou observador) que sera apagada ao perder o alcance.

    Conjunto maior que o de `TarefaBloqueio`: inclui terminal, tarefa com colega e
    observador. Roda depois do bloqueio, entao so tarefa terminal fica sem responsavel.
    """

    task_id: uuid.UUID
    titulo: str
    team_id: uuid.UUID | None
    subtime: str | None
    era_responsavel: bool
    era_observador: bool
