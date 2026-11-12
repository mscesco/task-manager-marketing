"""O mapa `status -> semantica`, e a duplicacao que ele assume. Puro, sem DB.

`SEMANTICA_POR_STATUS` e escrito a mao e NAO derivado de `COLUNAS_PADRAO`:
aquela lista e um layout de quadro e esta e uma classificacao de status.
Derivar uma da outra faria "mudar as colunas com que o quadro nasce" mudar,
em silencio, "o que cada status significa". Este arquivo confere que as duas
copias concordam.
"""

from __future__ import annotations

from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE, COLUNAS_PADRAO
from app.modules.tasks.domain.board_semantics import (
    SEMANTICA_POR_STATUS,
    semantica_do_status,
    status_da_coluna,
)


def test_o_mapa_cobre_todo_o_enum() -> None:
    """Os oito status tem semantica. Sem a linha, o `KeyError` em producao
    aparece como tarefa que nao consegue mudar de coluna."""
    faltando = [s for s in TaskStatus if s not in SEMANTICA_POR_STATUS]
    assert faltando == [], f"status sem semantica: {faltando}"


def test_o_mapa_concorda_com_as_colunas_padrao() -> None:
    """A copia escrita a mao e a lista de defaults dizem a mesma coisa."""
    for coluna in COLUNAS_PADRAO:
        assert semantica_do_status(coluna.legacy_status) == coluna.semantica, (
            coluna.nome
        )


def test_o_mapa_concorda_com_as_colunas_base() -> None:
    """As quatro colunas de quadro criado por pessoa tambem batem.

    Nao e redundante com o teste acima: `COLUNAS_BASE` e um conjunto
    proprio, nao um recorte de `COLUNAS_PADRAO`: os dois podem divergir sem
    que nenhum outro teste note.
    """
    for coluna in COLUNAS_BASE:
        assert semantica_do_status(coluna.legacy_status) == coluna.semantica, (
            coluna.nome
        )


def test_as_colunas_base_cobrem_as_quatro_semanticas_uma_vez() -> None:
    """Uma coluna por semantica, e as quatro marcadas como destino: sem
    `is_default_target` em todas, um quadro novo nasceria sem resposta para
    os quatro status que ele nao conhece."""
    semanticas = [c.semantica for c in COLUNAS_BASE]
    assert sorted(semanticas, key=lambda s: s.value) == sorted(
        ColumnSemantic, key=lambda s: s.value
    )
    assert all(c.is_default_target for c in COLUNAS_BASE)
    assert all(c.legacy_status is not None for c in COLUNAS_BASE)


def test_round_trip_nas_quatro_colunas_base_devolve_o_canonico() -> None:
    """Num quadro de quatro colunas, os quatro status sem coluna viram o
    canonico da semantica, e os outros quatro nao mudam.

    `status -> semantica -> status` nao e identidade, de proposito: quem
    "simplificar" `SEMANTICA_POR_STATUS` para a inversa de
    `STATUS_POR_SEMANTICA` derruba este teste.
    """
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
