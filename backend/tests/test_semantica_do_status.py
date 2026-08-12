"""O mapa `status -> semantica` da ADR 0042, e a duplicacao que ele assume.

Puro, sem DB. `SEMANTICA_POR_STATUS` e escrito a mao e NAO derivado de
`COLUNAS_PADRAO`, por decisao da ADR 0042 D3: aquela lista e um LAYOUT DE
QUADRO e esta e uma CLASSIFICACAO DE STATUS. Derivar uma da outra faria "mudar
as colunas com que o quadro nasce" mudar, em silencio, "o que cada status
significa".

O preco dessa separacao e uma duplicacao, e este arquivo e o unico lugar onde
ela fica honesta -- mesmo papel de
`test_board_semantics.py::test_a_regra_da_COLUNA_e_a_do_STATUS_concordam` e de
`test_a_lista_do_SERVICO_e_a_da_MIGRATION_concordam` da Spec 035.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE, COLUNAS_PADRAO
from app.modules.tasks.domain.board_semantics import (
    SEMANTICA_POR_STATUS,
    STATUS_POR_SEMANTICA,
    semantica_do_status,
    status_da_coluna,
)


def test_o_mapa_cobre_todo_o_enum() -> None:
    """Os oito status tem semantica.

    ⚠️ Um `KeyError` em producao aqui nao aparece como erro de configuracao:
    aparece como tarefa que nao consegue mudar de coluna. Status novo no enum
    sem linha no mapa tem de quebrar no CI.
    """
    faltando = [s for s in TaskStatus if s not in SEMANTICA_POR_STATUS]
    assert faltando == [], f"status sem semantica: {faltando}"


def test_o_mapa_concorda_com_as_colunas_padrao() -> None:
    """A copia escrita a mao e a lista de defaults dizem a mesma coisa.

    Se este teste ficar vermelho, ou alguem mudou o produto de proposito -- e
    apaga o teste com um ADR -- ou alguem quebrou sem perceber.
    """
    for coluna in COLUNAS_PADRAO:
        assert semantica_do_status(coluna.legacy_status) == coluna.semantica, (
            coluna.nome
        )


def test_o_mapa_concorda_com_as_colunas_base() -> None:
    """As quatro colunas de quadro criado por pessoa tambem batem.

    ⚠️ NAO E REDUNDANTE com o teste acima. `COLUNAS_BASE` e um conjunto
    proprio, nao um recorte de `COLUNAS_PADRAO`: os dois podem divergir sem
    que nenhum outro teste note.
    """
    for coluna in COLUNAS_BASE:
        assert semantica_do_status(coluna.legacy_status) == coluna.semantica, (
            coluna.nome
        )


def test_as_colunas_base_cobrem_as_quatro_semanticas_uma_vez() -> None:
    """Uma coluna por semantica, e as quatro marcadas como destino.

    E o que faz o degrau 2 da ADR 0042 responder desde o nascimento do quadro:
    sem `is_default_target` em todas, um quadro novo ja nasceria sem resposta
    para os quatro status que ele nao conhece.
    """
    semanticas = [c.semantica for c in COLUNAS_BASE]
    assert sorted(semanticas, key=lambda s: s.value) == sorted(
        ColumnSemantic, key=lambda s: s.value
    )
    assert all(c.is_default_target for c in COLUNAS_BASE)
    assert all(c.legacy_status is not None for c in COLUNAS_BASE)


def test_a_composicao_dos_dois_mapas_PERDE_status_de_proposito() -> None:
    """`status -> semantica -> status` nao e identidade, e nao deve ser.

    ⚠️ ESTE TESTE AFIRMA A PERDA, e por isso ele existe. Quatro status caem em
    `IN_PROGRESS` e dois em `OPEN`; compor os mapas devolve o canonico da
    semantica. E exatamente o que a ADR 0042 D2 manda GRAVAR num quadro que nao
    tem coluna para o status pedido -- `BLOCKED` entra, `IN_PROGRESS` sai.

    Alguem que "simplifique" `SEMANTICA_POR_STATUS` para a inversa de
    `STATUS_POR_SEMANTICA` faz este teste falhar, e e o unico lugar onde essa
    troca apareceria.
    """
    perdem = {
        TaskStatus.PLANNED: TaskStatus.BACKLOG,
        TaskStatus.IN_REVIEW: TaskStatus.IN_PROGRESS,
        TaskStatus.EXTERNAL_APPROVAL: TaskStatus.IN_PROGRESS,
        TaskStatus.BLOCKED: TaskStatus.IN_PROGRESS,
    }
    for pedido, esperado in perdem.items():
        assert STATUS_POR_SEMANTICA[semantica_do_status(pedido)] == esperado

    preservam = {
        TaskStatus.BACKLOG,
        TaskStatus.IN_PROGRESS,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELLED,
    }
    for status in preservam:
        assert STATUS_POR_SEMANTICA[semantica_do_status(status)] == status


@pytest.mark.parametrize("coluna", COLUNAS_PADRAO, ids=lambda c: c.nome)
def test_round_trip_nas_oito_colunas_devolve_o_mesmo_status(coluna) -> None:  # type: ignore[no-untyped-def]
    """`status -> coluna -> status` e identidade no Quadro geral.

    ⚠️ E O TESTE QUE PROVA QUE PRODUCAO NAO SE MEXE. As oito colunas tem
    `legacy_status`, entao o degrau 1 responde sempre e o degrau 2 nunca e
    alcancado. Vermelho aqui = a ADR 0042 vazou para o quadro que ela nao
    deveria tocar.
    """
    obtido = status_da_coluna(
        legacy_status=coluna.legacy_status, semantic=coluna.semantica
    )
    assert obtido == coluna.legacy_status


def test_round_trip_nas_quatro_colunas_base_devolve_o_canonico() -> None:
    """Num quadro de quatro colunas, os quatro status sem coluna viram o
    canonico da semantica -- e os outros quatro nao mudam."""
    alvo_por_semantica = {c.semantica: c for c in COLUNAS_BASE}
    esperado = {
        TaskStatus.BACKLOG: TaskStatus.BACKLOG,
        TaskStatus.PLANNED: TaskStatus.BACKLOG,
        TaskStatus.IN_PROGRESS: TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW: TaskStatus.IN_PROGRESS,
        TaskStatus.EXTERNAL_APPROVAL: TaskStatus.IN_PROGRESS,
        TaskStatus.BLOCKED: TaskStatus.IN_PROGRESS,
        TaskStatus.COMPLETED: TaskStatus.COMPLETED,
        TaskStatus.CANCELLED: TaskStatus.CANCELLED,
    }
    for pedido, saida in esperado.items():
        coluna = alvo_por_semantica[semantica_do_status(pedido)]
        obtido = status_da_coluna(
            legacy_status=coluna.legacy_status, semantic=coluna.semantica
        )
        assert obtido == saida, pedido.value
