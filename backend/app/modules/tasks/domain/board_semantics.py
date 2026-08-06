"""Semantica de coluna -- predicados PUROS (sem DB).

A regra mora aqui e a query do `DeadlineNotifyService` a repete. E a mesma
dupla pure-domain + SQL ja usada em `archival.py` e `team_scope.py`, pelo mesmo
motivo: a regra tem de ser legivel e testavel sem subir banco, e a query tem de
filtrar no Postgres em vez de trazer tudo para a memoria. O preco da duplicacao
e um teste comparando as duas
(`tests/test_board_semantics.py::test_a_regra_da_COLUNA_e_a_do_STATUS_concordam`).

⚠️ A FLAG SOZINHA NAO REPRODUZ O COMPORTAMENTO DE HOJE. Nos defaults
(`board_defaults.COLUNAS_PADRAO`), `Concluido` e `Cancelado` nascem com
`notify_deadline=True` -- so `Bloqueado` nasce com `False`. Trocar o
`_STATUS_SEM_AVISO` cravado pela flag crua faria a varredura cobrar prazo de
tarefa concluida: medido em producao em 06/08, eram **136 tarefas em
`Concluido` com prazo vencido**, e todas receberiam aviso na primeira
madrugada. A exclusao do terminal vem da SEMANTICA; a flag responde so por
"esta coluna nao cobra prazo".

⚠️ Nao importar isto em migration. Migration tem de continuar significando o
que significava no dia em que rodou; se um dia uma migration precisar da regra,
copia.
"""

from __future__ import annotations

from typing import Final

from app.db.models.enums import ColumnSemantic

#: As duas semanticas terminais. Espelham `archival.TERMINAL_STATUSES`, que diz
#: a mesma coisa do lado do `status`. Enquanto as duas direcoes coexistirem
#: (ADR 0033), elas tem de concordar -- e o teste de equivalencia e o que
#: garante isso, porque nada no banco impede que divirjam.
TERMINAL_SEMANTICS: Final[frozenset[ColumnSemantic]] = frozenset(
    {ColumnSemantic.DONE, ColumnSemantic.CANCELLED}
)


def avisa_prazo(*, semantic: ColumnSemantic, notify_deadline: bool) -> bool:
    """True se uma tarefa NESTA coluna deve receber aviso de prazo.

    Terminal nunca avisa, independente da flag. Nao e redundancia com o
    `notify_deadline`: deixar a flag decidir o terminal permitiria criar uma
    coluna `DONE` que cobra prazo -- estado sem significado nenhum, alcancavel
    por um clique no CRUD de coluna que a Spec 036 vai entregar.
    """
    if semantic in TERMINAL_SEMANTICS:
        return False
    return notify_deadline
