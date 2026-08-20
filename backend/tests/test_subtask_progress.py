"""Regras da checklist de subtarefa -- teste PURO (Spec 042).

⚠️ CADA TESTE AQUI CORRESPONDE A UM DEFEITO QUE JA FOI PARA A TELA, e os
quatro estao documentados em `domain/subtask_progress.py` e no gemeo do front
(`web/lib/subtarefas.ts::progresso`). Este arquivo e a trava que impede a
regra de ser "simplificada" de volta.

⚠️ A PARIDADE COM A QUERY NAO E TESTADA AQUI. Este arquivo prova a regra; o
teste de integracao (`tests/integration/`) prova que
`TaskRepository.subtask_progress_for_tasks` devolve o MESMO numero. Os dois
sao obrigatorios -- e a mesma dupla pure-domain + SQL de `archival.py` e
`board_semantics.py`, e o motivo de existir e que sem o par a query faz uma
coisa, o unitario prova outra, e os dois ficam verdes.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import ColumnSemantic
from app.modules.tasks.domain.subtask_progress import (
    SEMANTICA_CONCLUIDA,
    FilhaMin,
    Progresso,
    progresso,
)


def viva(semantic: ColumnSemantic | None) -> FilhaMin:
    return FilhaMin(semantic=semantic, is_archived=False)


def arquivada(semantic: ColumnSemantic | None) -> FilhaMin:
    return FilhaMin(semantic=semantic, is_archived=True)


def test_sem_filha_da_zero_sobre_zero_e_nao_estoura():
    """0/0 e o contrato, nao um vazio especial.

    A tela decide nao desenhar contador nem barra a partir de `total == 0`.
    Devolver `None` obrigaria todo chamador a tratar dois formatos.
    """
    assert progresso([]) == Progresso(concluidas=0, total=0)


def test_conta_pela_coluna_DONE():
    """Regra (a) + (b): a semantica da COLUNA decide, e a semantica e `DONE`."""
    assert progresso(
        [
            viva(ColumnSemantic.DONE),
            viva(ColumnSemantic.DONE),
            viva(ColumnSemantic.IN_PROGRESS),
        ]
    ) == Progresso(concluidas=2, total=3)


def test_cancelada_NAO_conta_como_concluida():
    """⚠️ Regra (b). `DONE` e nao terminal.

    Trocar por "terminal" faria subtarefa CANCELADA aparecer como entregue na
    barra. E a mesma distincao que o enum ja registra: DONE e CANCELLED nao
    sao intercambiaveis.
    """
    assert progresso(
        [viva(ColumnSemantic.DONE), viva(ColumnSemantic.CANCELLED)]
    ) == Progresso(concluidas=1, total=2)


def test_arquivada_sai_do_numerador_E_do_denominador():
    """⚠️ Regra (c).

    A checklist responde "quanto falta do trabalho vivo". Contar o que saiu do
    fluxo faria a porcentagem CAIR quando alguem arquiva -- o oposto de
    arquivar.
    """
    assert progresso(
        [
            viva(ColumnSemantic.DONE),
            viva(ColumnSemantic.IN_PROGRESS),
            arquivada(ColumnSemantic.DONE),
            arquivada(ColumnSemantic.IN_PROGRESS),
        ]
    ) == Progresso(concluidas=1, total=2)


def test_filha_so_arquivada_da_zero_sobre_zero():
    """⚠️ Consequencia DELIBERADA da regra (c), e ela ja confundiu antes.

    A tela desenha as linhas (a checklist mostra as arquivadas quando a caixa
    esta marcada) e NAO desenha contador nem barra -- nao ha trabalho vivo
    sobre o que informar progresso.
    """
    assert progresso(
        [arquivada(ColumnSemantic.DONE), arquivada(ColumnSemantic.DONE)]
    ) == Progresso(concluidas=0, total=0)


def test_coluna_desconhecida_nao_conclui_mas_entra_no_total():
    """⚠️ Regra (d).

    Sumir do denominador inflaria a porcentagem em silencio: duas filhas, uma
    concluida e uma sem coluna resolvida, mostrariam 100%.
    """
    assert progresso([viva(ColumnSemantic.DONE), viva(None)]) == Progresso(
        concluidas=1, total=2
    )


@pytest.mark.parametrize(
    "semantic",
    [s for s in ColumnSemantic if s is not ColumnSemantic.DONE],
)
def test_nenhuma_outra_semantica_conta_como_concluida(semantic: ColumnSemantic):
    """Trava de futuro: semantica NOVA no enum nasce nao-concluida.

    Sem isto, acrescentar um valor ao `ColumnSemantic` poderia mudar o numero
    de 170 cards sem nenhum teste reclamar.
    """
    assert progresso([viva(semantic)]) == Progresso(concluidas=0, total=1)


def test_a_constante_e_a_unica_semantica_concluida():
    """A regra le a constante, e nao um literal no meio do `if`.

    A regra (b) ja foi trocada por engano uma vez; a constante nomeada existe
    para que a troca apareca em um lugar so.
    """
    assert SEMANTICA_CONCLUIDA is ColumnSemantic.DONE
