"""Dominio de Solicitacao: status, categorias e regras de transicao.

A maquina de estados e minima de proposito:

    PENDING --aprovar--> APPROVED   (terminal)
    PENDING --rejeitar-> REJECTED   (terminal, exige justificativa)

Nao ha "reabrir": se a triagem errou, o solicitante reenvia (o
formulario e publico e barato). Adicionar reabertura depois nao
quebra este contrato.

CATEGORIES espelha o menu do formulario (fonte: PDF "Novo Fluxo
de Solicitacao | FazAe"). O backend valida contra esta lista --
categoria fora dela num endpoint PUBLICO e lixo ou sonda.
"""

from __future__ import annotations

from enum import StrEnum


class SolicitationStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


# Slugs de categoria. Devem bater com web/lib/solicitacaoForm.ts.
CATEGORIES: frozenset[str] = frozenset(
    {
        "arte",         # Criar uma arte
        "foto",         # Sessao de fotos (secao existia no PDF fora do menu)
        "video",        # Gravar ou editar um video
        "divulgacao",   # Divulgar acao, campanha ou comunicado
        "evento",       # Organizar um evento
        "site",         # Criar ou atualizar pagina no site
        "email",        # Comunicacao por e-mail ou WhatsApp
        "lancamento",   # Lancar um curso, campanha ou projeto
        "revisao",      # Revisar ou atualizar material existente
        "impressao",    # Impressao de material (somente sede)
        "outro",        # Outro assunto
    }
)


def can_review(status: str) -> bool:
    """So solicitacao PENDING pode ser aprovada/rejeitada."""
    return status == SolicitationStatus.PENDING
