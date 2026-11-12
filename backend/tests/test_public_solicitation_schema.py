"""Envio publico de solicitacao: o que o schema exige antes do servico."""

import uuid

import pytest
from pydantic import ValidationError

from app.modules.solicitations.api.schemas import PublicSolicitationCreateRequest


def _envio(**over) -> dict:
    corpo = {
        "workspace_slug": "ws",
        "form_id": str(uuid.uuid4()),
        "requester_name": "Maria",
        "requester_email": "maria@polo.ex",
        "items": [
            {
                "category": "acesso",
                "summary": "Preciso de acesso",
                "answers": [{"label": "Qual sistema?", "value": "o CRM"}],
            }
        ],
    }
    corpo.update(over)
    return {k: v for k, v in corpo.items() if v is not None}


def test_envio_valido_passa() -> None:
    PublicSolicitationCreateRequest.model_validate(_envio())


@pytest.mark.parametrize(
    "over",
    [
        {"requester_name": None},
        {"requester_name": "M"},
        {"requester_email": None},
        {"requester_email": "nao-e-email"},
    ],
)
def test_nome_e_email_sao_obrigatorios_em_todo_formulario(over) -> None:
    """Nao entram no cabecalho configuravel: a fila e organizada por quem
    pediu, e o aviso de mudanca de status precisa do endereco."""
    with pytest.raises(ValidationError):
        PublicSolicitationCreateRequest.model_validate(_envio(**over))
