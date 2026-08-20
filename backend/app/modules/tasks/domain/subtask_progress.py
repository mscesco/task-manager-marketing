"""Progresso da checklist de subtarefa -- predicado PURO (sem DB).

Espelha a agregacao de `TaskRepository.subtask_progress_for_tasks`. E a mesma
dupla pure-domain + SQL ja usada em `archival.py`, `team_scope.py` e
`board_semantics.py`, pelo mesmo motivo: a regra tem de ser legivel e testavel
sem subir banco, e a query tem de agregar no Postgres em vez de trazer a
subarvore inteira para a memoria. O preco da duplicacao e um teste comparando
as duas (`tests/test_subtask_progress.py`).

⚠️ AS QUATRO REGRAS ABAIXO VIERAM CADA UMA DE UM DEFEITO NA TELA. Elas ja
existem no front, em `web/lib/subtarefas.ts::progresso` e em
`web/components/Board.tsx:1120-1140`. Trocar qualquer uma troca o numero em
todos os cards do quadro.

  (a) CONTA PELA COLUNA, e nao por `status`. Em 10/08/2026 o contador do card
      lia coluna e o do detalhe lia `status`, e a MESMA tarefa mostrava "2/2"
      no card e "(0/2)" no painel, com a barra em 0%.

  (b) `DONE`, e nao terminal. Cancelada NAO conta como concluida -- e a mesma
      distincao que o enum registra ("DONE e CANCELLED nao sao
      intercambiaveis"). Usar terminal faria subtarefa cancelada aparecer como
      entregue na barra.

  (c) ARQUIVADA SAI DO NUMERADOR E DO DENOMINADOR. A checklist responde
      "quanto falta do trabalho vivo"; contar o que saiu do fluxo faria a
      porcentagem CAIR quando alguem arquiva -- o oposto de arquivar.
      ⚠️ Consequencia deliberada: filha so arquivada da total 0, e a tela nao
      desenha contador nem barra.

  (d) COLUNA DESCONHECIDA NAO CONTA COMO CONCLUIDA, mas ENTRA no denominador.
      Sumir do denominador inflaria a porcentagem em silencio.

⚠️ FILHA DIRETA, NAO SUBARVORE. O contador do card e do painel conta filhas de
UM nivel (o front indexa por `parent_task_id`). Profundidade nao e limitada em
task -- `task_service.py:770` diz isso com todas as letras --, entao "filha
direta" e "subarvore" sao conjuntos DIFERENTES de verdade. Quem precisa da
subarvore inteira e o filtro por pessoa, que tem consulta propria.

⚠️ ISTO NAO SERVE AO AVISO DE EXCLUSAO. A cascata do soft-delete (ADR 0005)
leva a subarvore INTEIRA, arquivada ou nao -- outro numero. Essa troca ja foi
feita uma vez no front e o aviso destrutivo sumiu em silencio para tarefa de
filhas so arquivadas.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from app.db.models.enums import ColumnSemantic

#: A unica semantica que conta como concluida na checklist. Constante nomeada
#: (e nao o literal no meio do `if`) porque a regra (b) ja foi trocada por
#: engano uma vez -- ver o cabecalho.
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
