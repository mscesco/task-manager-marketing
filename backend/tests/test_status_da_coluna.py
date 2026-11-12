"""A direcao `coluna -> status`. Puro, sem DB.

A ordem entre as duas regras e a decisao inteira: a ponte (`legacy_status`)
responde primeiro, a semantica so quando nao ha ponte. Inverter a ordem ainda
devolve um status valido, entao nada mais quebra: o estrago aparece como card
pulando de coluna. Este arquivo e o unico portao dessa ordem.

Nao prova nada sobre a rota: que o `PATCH /tasks/{id}` chama esta funcao e
grava a coluna e assunto de `tests/integration/test_patch_column_id_db.py`.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from app.modules.tasks.domain.board_semantics import (
    STATUS_POR_SEMANTICA,
    status_da_coluna,
)


def test_a_ponte_manda_sobre_a_semantica() -> None:
    """As tres colunas que a semantica sozinha apagaria: todas tem semantica
    `IN_PROGRESS`, e derivar por ela primeiro perderia Aprovacao Interna,
    Aprovacao Externa e Bloqueado de uma vez."""
    for ponte in (
        TaskStatus.IN_REVIEW,
        TaskStatus.EXTERNAL_APPROVAL,
        TaskStatus.BLOCKED,
    ):
        assert (
            status_da_coluna(
                legacy_status=ponte, semantic=ColumnSemantic.IN_PROGRESS
            )
            == ponte
        )


def test_planejado_nao_vira_backlog() -> None:
    """O outro colapso da semantica: `OPEN` cobre Backlog E Planejado."""
    assert (
        status_da_coluna(
            legacy_status=TaskStatus.PLANNED, semantic=ColumnSemantic.OPEN
        )
        == TaskStatus.PLANNED
    )


@pytest.mark.parametrize(
    ("semantica", "esperado"),
    [
        (ColumnSemantic.OPEN, TaskStatus.BACKLOG),
        (ColumnSemantic.IN_PROGRESS, TaskStatus.IN_PROGRESS),
        (ColumnSemantic.DONE, TaskStatus.COMPLETED),
        (ColumnSemantic.CANCELLED, TaskStatus.CANCELLED),
    ],
)
def test_sem_ponte_a_semantica_responde(
    semantica: ColumnSemantic, esperado: TaskStatus
) -> None:
    """Coluna criada por gente (`legacy_status` NULL).

    A tabela esta escrita aqui A MAO, e nao importada de
    `STATUS_POR_SEMANTICA`: um teste que le o mesmo dicionario que a funcao
    afirma apenas que o dicionario e igual a si mesmo.
    """
    assert status_da_coluna(legacy_status=None, semantic=semantica) == esperado


def test_toda_semantica_tem_resposta() -> None:
    """Semantica nova sem entrada no mapa vira `KeyError` (500) em producao:
    o unico jeito de a funcao explodir."""
    assert set(STATUS_POR_SEMANTICA) == set(ColumnSemantic)


def test_as_oito_colunas_padrao_fazem_round_trip() -> None:
    """`coluna -> status` devolve o `legacy_status` de cada uma das 8: no
    quadro padrao, todas com ponte, nenhuma tarefa muda de status."""
    for coluna in COLUNAS_PADRAO:
        assert (
            status_da_coluna(
                legacy_status=coluna.legacy_status, semantic=coluna.semantica
            )
            == coluna.legacy_status
        ), coluna.nome
