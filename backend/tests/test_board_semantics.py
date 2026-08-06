"""Equivalencia entre a regra de aviso por COLUNA e a regra por STATUS.

Puro, sem DB. Existe porque a troca do `_STATUS_SEM_AVISO` cravado pela
semantica da coluna e uma troca de FONTE, nao de comportamento: enquanto o
quadro geral tiver as oito colunas padrao, as duas regras tem de dar a mesma
resposta para as oito. No dia em que divergirem, ou alguem mudou o produto de
proposito -- e apaga este teste com um ADR -- ou alguem quebrou sem perceber.

Mesmo papel do `test_a_lista_do_SERVICO_e_a_da_MIGRATION_concordam` da Spec
035: quando a mesma regra existe em dois lugares, o teste e o unico lugar onde
a duplicacao fica honesta.
"""

from __future__ import annotations

from app.db.models.enums import TaskStatus
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from app.modules.tasks.domain.board_semantics import avisa_prazo

#: A lista que estava CRAVADA no `DeadlineNotifyService` antes desta fatia.
#: Copiada de proposito: se o service mudar, este teste tem de continuar
#: afirmando o comportamento ANTIGO -- e a unica referencia que sobrou dele.
_STATUS_SEM_AVISO_ANTIGO = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.BLOCKED}
)


def test_a_regra_da_COLUNA_e_a_do_STATUS_concordam() -> None:
    """As oito colunas padrao respondem igual pelas duas regras."""
    for coluna in COLUNAS_PADRAO:
        esperado = coluna.legacy_status not in _STATUS_SEM_AVISO_ANTIGO
        obtido = avisa_prazo(
            semantic=coluna.semantica, notify_deadline=coluna.notify_deadline
        )
        assert obtido is esperado, coluna.nome


def test_a_flag_SOZINHA_nao_reproduz_o_comportamento_de_hoje() -> None:
    """Por que a exclusao do terminal vem da SEMANTICA e nao da flag.

    `Concluido` e `Cancelado` nascem com `notify_deadline=True`. Se a regra
    fosse so a flag, as duas voltariam a receber aviso de prazo -- 136 tarefas
    em producao, medidas em 06/08. Este teste e o que impede alguem de
    "simplificar" a regra para `notify_deadline` e achar que ficou igual,
    porque o teste acima passaria mesmo assim para seis das oito colunas.
    """
    terminais = [
        c
        for c in COLUNAS_PADRAO
        if c.legacy_status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED)
    ]
    assert len(terminais) == 2
    # A premissa: as duas colunas terminais REALMENTE nascem cobrando prazo.
    assert all(c.notify_deadline for c in terminais)
    # E mesmo assim a regra diz que nao avisam.
    assert not any(
        avisa_prazo(semantic=c.semantica, notify_deadline=c.notify_deadline)
        for c in terminais
    )
