"""Progresso da checklist de subtarefa -- predicado puro (sem DB).

Espelha `TaskRepository.subtask_progress_for_tasks` e o front
(`web/lib/subtarefas.ts::progresso`); `tests/test_subtask_progress.py` compara.

  (a) conta pela coluna, nao por `status`;
  (b) so `DONE` conclui (cancelada nao);
  (c) arquivada sai do numerador e do denominador;
  (d) coluna desconhecida entra no denominador, mas nao conclui.

So filhas diretas, nao a subarvore. Nao serve ao aviso de exclusao, que conta
a subarvore inteira.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from app.db.models.enums import ColumnSemantic

#: A unica semantica que conta como concluida na checklist (regra b).
SEMANTICA_CONCLUIDA: Final[ColumnSemantic] = ColumnSemantic.DONE


@dataclass(frozen=True, slots=True)
class FilhaMin:
    """O minimo que a regra precisa saber de uma filha direta.

    `semantic` e `None` quando a coluna nao foi resolvida -- ver regra (d).
    """

    semantic: ColumnSemantic | None
    is_archived: bool


@dataclass(frozen=True, slots=True)
class Progresso:
    """(concluidas, total) de uma checklist. `total` ja exclui arquivada."""

    concluidas: int
    total: int


def progresso(filhas: Iterable[FilhaMin]) -> Progresso:
    """Conta a checklist de UM pai, a partir das filhas DIRETAS dele.

    Sem filha viva -> `Progresso(0, 0)`. A tela nao desenha contador nem barra
    nesse caso; devolver 0/0 e o contrato, nao um vazio especial.
    """
    concluidas = 0
    total = 0
    for filha in filhas:
        if filha.is_archived:  # regra (c)
            continue
        total += 1  # regra (d): desconhecida entra aqui de qualquer forma
        if filha.semantic is SEMANTICA_CONCLUIDA:  # regras (a) e (b)
            concluidas += 1
    return Progresso(concluidas=concluidas, total=total)
