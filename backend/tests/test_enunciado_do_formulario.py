"""Teto do enunciado da pergunta no editor x teto do rotulo no envio."""

from __future__ import annotations

from app.modules.solicitations.api.form_schemas import QuestionCreateRequest
from app.modules.solicitations.api.schemas import AnswerItem


def test_enunciado_de_ate_300_caracteres_cabe_no_envio() -> None:
    """O enunciado mais longo que o editor aceita cabe no rotulo da resposta;
    senao quem responde recebe 422 depois de preencher tudo."""
    teto = QuestionCreateRequest.model_fields["label"].metadata[0].max_length
    AnswerItem(label="x" * teto, value="ok")  # nao levanta
