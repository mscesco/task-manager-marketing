"""Schemas da leitura PUBLICA do formulario (Spec 043, fatia B).

⚠️ ELES SAO MENORES QUE OS AUTENTICADOS DE PROPOSITO, e a diferenca e o
assunto deste arquivo: `team_id`, `created_by` e `is_published` NAO saem daqui.
Quem esta de fora nao precisa da estrutura interna de times para preencher um
pedido, e um schema publico que "aproveita" o autenticado vaza campo por
descuido -- basta alguem acrescentar um la um dia.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class PublicFormResumo(BaseModel):
    """Uma linha da lista publica de formularios."""

    slug: str
    title: str
    description: str
    #: Nome do time dono, para agrupar a lista. ⚠️ O NOME, e nao o id: agrupar
    #: por "Marketing" e util para quem escolhe; o id nao diz nada a ninguem de
    #: fora e so serviria para mapear a estrutura interna.
    team_name: str


class PublicQuestion(BaseModel):
    """Uma pergunta, como o formulario publico precisa dela."""

    id: uuid.UUID
    label: str
    kind: str
    required: bool
    options: list[str]
    placeholder: str | None
    help: str | None
    #: ⚠️ O ID DA OUTRA PERGUNTA, e nao o texto dela. A condicional e resolvida
    #: no cliente comparando com o valor respondido; mandar o texto obrigaria a
    #: casar por string, que quebra no dia em que alguem corrigir uma virgula
    #: no enunciado.
    show_if_question_id: uuid.UUID | None
    show_if_value: str | None


class PublicSection(BaseModel):
    slug: str
    title: str
    emoji: str
    sla_text: str | None
    #: Qual resposta vira o resumo na fila de triagem.
    #:
    #: ⚠️ ELE VAI PARA O CLIENTE porque e o cliente que monta o `summary` no
    #: envio -- o mesmo papel que o `resumoDe` tem hoje no TypeScript. Sem ele,
    #: a fila mostraria o assunto e mais nada, e quem tria precisaria abrir
    #: cada solicitacao para saber do que se trata.
    summary_question_id: uuid.UUID | None
    questions: list[PublicQuestion] = Field(default_factory=list)


class PublicFormDetail(BaseModel):
    """O formulario inteiro, pronto para desenhar."""

    id: uuid.UUID
    slug: str
    title: str
    description: str
    sections: list[PublicSection] = Field(default_factory=list)
