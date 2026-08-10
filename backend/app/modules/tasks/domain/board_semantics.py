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

from app.db.models.enums import ColumnSemantic, TaskStatus

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


#: ⚠️ ADR 0041 -- O STATUS DE UMA COLUNA SEM PONTE. Usado SO quando
#: `legacy_status` e NULL, que e como nasce coluna criada por gente. Nas 8
#: colunas padrao a ponte responde primeiro e este mapa nao e consultado.
#:
#: ⚠️ NAO E DERIVAVEL DE `is_default_target`: aquela flag responde "para onde
#: vai a tarefa desta semantica DENTRO DE UM QUADRO", e um quadro de subtime
#: pode nao ter nenhuma coluna marcada. Este mapa e fixo e responde mesmo para
#: quadro malformado.
#:
#: ⚠️ `OPEN -> BACKLOG` e nao `PLANNED`: as duas colunas padrao `OPEN` sao
#: Backlog e Planejado, e Backlog e a marcada como `is_default_target`. Trocar
#: por `PLANNED` faria toda coluna aberta de quadro novo nascer como planejada.
STATUS_POR_SEMANTICA: Final[dict[ColumnSemantic, TaskStatus]] = {
    ColumnSemantic.OPEN: TaskStatus.BACKLOG,
    ColumnSemantic.IN_PROGRESS: TaskStatus.IN_PROGRESS,
    ColumnSemantic.DONE: TaskStatus.COMPLETED,
    ColumnSemantic.CANCELLED: TaskStatus.CANCELLED,
}


def status_da_coluna(
    *, legacy_status: TaskStatus | None, semantic: ColumnSemantic
) -> TaskStatus:
    """O status que uma tarefa recebe ao ser posta NESTA coluna (ADR 0041).

    ⚠️ A ORDEM E A DECISAO INTEIRA, e ela e o contrario da leitura ingenua da
    ADR 0036:

      1. `legacy_status` preenchido -> e ele. Exato, sem perda. Cobre as 8
         colunas padrao, que sao 100% da producao hoje.
      2. `legacy_status` NULL -> `STATUS_POR_SEMANTICA`.

    ⚠️ INVERTER A ORDEM APAGA QUATRO STATUS. A semantica e 8:4 nos defaults --
    `IN_PROGRESS` cobre Em Andamento, Aprovacao Interna, Aprovacao Externa e
    Bloqueado; `OPEN` cobre Backlog e Planejado. Derivar por ela primeiro faz
    uma tarefa em Aprovacao Externa virar `IN_PROGRESS` e pular de coluna na
    tela de todo mundo. ⚠️ **Nenhum portao pega isso**: o status resultante e
    um status VALIDO, entao `pytest`, `tsc` e `build` passam.

    ⚠️ MESMA ESCOLHA JA FEITA NO CAMINHO INVERSO:
    `TaskRepository.complete_descendants` resolve a coluna `COMPLETED` por
    `legacy_status`, e nao pela semantica `DONE`, com a justificativa escrita
    no docstring desde a Spec 035. Esta funcao e a simetrica dela.

    ⚠️ UM LUGAR SO. Se esta regra aparecer numa segunda funcao, as duas vao
    divergir e nada no banco impede que divirjam -- e o mesmo motivo pelo qual
    `TERMINAL_SEMANTICS` e `archival.TERMINAL_STATUSES` tem teste de
    equivalencia.
    """
    if legacy_status is not None:
        return legacy_status
    return STATUS_POR_SEMANTICA[semantic]
