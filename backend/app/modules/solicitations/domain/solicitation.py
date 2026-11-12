"""Dominio de Solicitacao: status, categorias e regras de transicao.

    PENDING --aprovar--> APPROVED <--> IN_PROGRESS <--> DONE
    PENDING --rejeitar-> REJECTED   (terminal, exige justificativa)

A triagem so acontece em PENDING; os tres estados da direita sao andamento e
andam para os dois lados. REJECTED nao reabre: o solicitante reenvia.
"""

from __future__ import annotations

from enum import StrEnum


class SolicitationStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    #: Alguem esta tocando o pedido.
    IN_PROGRESS = "IN_PROGRESS"
    #: Entregue. Terminal na pratica, nao na regra.
    DONE = "DONE"


#: Os estados de um pedido aceito. Use este conjunto em vez de `== APPROVED`.
#: Estado novo aqui exige mexer junto no CHECK e no indice parcial do banco.
ACEITOS: frozenset[str] = frozenset(
    {
        SolicitationStatus.APPROVED.value,
        SolicitationStatus.IN_PROGRESS.value,
        SolicitationStatus.DONE.value,
    }
)


def can_review(status: str) -> bool:
    """So solicitacao PENDING pode ser aprovada/rejeitada.

    Reaprovar um pedido em andamento reescreveria quem decidiu e quando.
    """
    return status == SolicitationStatus.PENDING


def pode_andar(atual: str, novo: str) -> bool:
    """A solicitacao pode ir de `atual` para `novo`?

    So dentro dos aceitos, nos dois sentidos (inclusive DONE -> IN_PROGRESS).
    De PENDING nao se anda (pularia a triagem) e de REJECTED tambem nao.
    """
    return atual in ACEITOS and novo in ACEITOS and atual != novo
