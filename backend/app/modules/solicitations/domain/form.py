"""Dominio do formulario de solicitacao.

A resposta e guardada como `{label, value}` com o texto da pergunta, e nao o id:
a solicitacao carrega o retrato do que foi perguntado, e editar o formulario
depois nao altera respostas antigas. Se precisar do id, ele entra ao lado do texto.
"""

from __future__ import annotations

from enum import StrEnum


class QuestionKind(StrEnum):
    """Os tipos de pergunta que o formulario publico sabe desenhar.

    `String(20)` no banco, e nao ENUM nativo: tipo novo nao exige migration.
    """

    TEXTO = "texto"
    TEXTO_LONGO = "textoLongo"
    ESCOLHA = "escolha"
    MULTI = "multi"
    DATA = "data"
    LINK = "link"


#: Tipos que exigem `options` preenchido; sem opcoes, uma pergunta obrigatoria
#: trava o envio. A recusa fica no servico porque validador custom do Pydantic
#: aqui devolve 500 em vez de 422.
KINDS_COM_OPCOES: frozenset[str] = frozenset(
    {QuestionKind.ESCOLHA.value, QuestionKind.MULTI.value}
)


def exige_opcoes(kind: str) -> bool:
    """O tipo precisa de `options` com ao menos uma alternativa?"""
    return kind in KINDS_COM_OPCOES


def kind_valido(kind: str) -> bool:
    """`kind` esta entre os tipos que o formulario sabe desenhar?"""
    return kind in {k.value for k in QuestionKind}
