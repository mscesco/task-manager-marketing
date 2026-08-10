"""A direcao `coluna -> status` (ADR 0041). Puro, sem DB.

Existe porque a regra tem DUAS alineas e a ORDEM entre elas e a decisao
inteira: a ponte (`legacy_status`) responde primeiro, a semantica so quando
nao ha ponte. Inverter a ordem nao quebra nada de forma visivel -- o status
resultante continua sendo um status VALIDO -- entao `pytest`, `tsc` e `build`
passam e o estrago aparece como card pulando de coluna na tela de todo mundo.
Este arquivo e o unico portao dessa ordem.

Mesmo papel do `test_board_semantics.py` em relacao ao aviso de prazo: quando
a regra pode estar certa de duas formas e so uma reproduz o produto, o teste e
quem escolhe.

⚠️ O QUE ELE NAO PROVA: nada sobre a rota. Que o `PATCH /tasks/{id}` chama
esta funcao, valida o quadro e grava a coluna e assunto do
`tests/integration/test_patch_column_id_db.py`.
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
    """As tres colunas que a semantica sozinha apagaria.

    ⚠️ ESTE E O TESTE QUE A SABOTAGEM DERRUBA. As tres tem semantica
    `IN_PROGRESS`; derivar por ela primeiro devolveria `IN_PROGRESS` para as
    tres e o produto perderia Aprovacao Interna, Aprovacao Externa e Bloqueado
    de uma vez.
    """
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
    """Coluna criada por gente (`legacy_status` NULL) -- o caso da fatia 5.

    A tabela esta escrita aqui A MAO, e nao importada de
    `STATUS_POR_SEMANTICA`: um teste que le o mesmo dicionario que a funcao
    afirma apenas que o dicionario e igual a si mesmo.
    """
    assert status_da_coluna(legacy_status=None, semantic=semantica) == esperado


def test_toda_semantica_tem_resposta() -> None:
    """Semantica nova sem entrada no mapa vira `KeyError` em producao.

    ⚠️ E o unico jeito de a funcao explodir. Este teste e o que transforma
    "alguem acrescentou um valor no enum" em vermelho aqui, e nao em 500 no
    dia do deploy.
    """
    assert set(STATUS_POR_SEMANTICA) == set(ColumnSemantic)


def test_as_oito_colunas_padrao_fazem_round_trip() -> None:
    """`coluna -> status` devolve o `legacy_status` de cada uma das 8.

    ⚠️ E ESTE O TESTE QUE PROVA QUE PRODUCAO NAO SE MEXE no dia do deploy:
    producao tem um quadro, com as 8 colunas padrao, todas com ponte
    (`invariantes.sql`, consulta 5: `colunas_sem_ponte = 0`). Se ele passa,
    nenhuma tarefa muda de status ou de coluna por causa desta entrega.
    """
    for coluna in COLUNAS_PADRAO:
        assert (
            status_da_coluna(
                legacy_status=coluna.legacy_status, semantic=coluna.semantica
            )
            == coluna.legacy_status
        ), coluna.nome
