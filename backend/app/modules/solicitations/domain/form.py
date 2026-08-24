"""Dominio do FORMULARIO de solicitacao (Spec 043, fatia A).

⚠️ POR QUE ESTE MODULO EXISTE. Ate aqui o formulario morava em
`web/lib/solicitacaoForm.ts` -- 926 linhas de TypeScript -- e a lista de
categorias estava DUPLICADA aqui no backend, como um `frozenset` que o
`POST /publico` validava. O comentario daquele frozenset dizia, com todas as
letras: "Devem bater com web/lib/solicitacaoForm.ts".

Consequencia: categoria nova exigia deploy dos DOIS lados, na ordem certa. E
por isso que o formulario nao era produto -- ninguem que nao mexe em codigo
conseguia acrescentar uma pergunta.

⚠️ E O QUE **NAO** MUDA: a resposta continua sendo guardada como
`{label, value}` em `solicitation.answers`, com o TEXTO da pergunta e nao o id
dela. Isso parece redundancia e e a peca que torna o formulario editavel
SEGURO: a solicitacao carrega o RETRATO do que foi perguntado no dia. Apagar
uma pergunta amanha nao falsifica o que alguem respondeu ontem.

**Nenhuma fatia desta spec pode "melhorar" isso trocando `label` por
`question_id`.** Se um dia houver relatorio agregado por pergunta, o id entra
AO LADO do texto, nunca no lugar dele.
"""

from __future__ import annotations

from enum import StrEnum


class QuestionKind(StrEnum):
    """Os tipos de pergunta que o formulario publico sabe desenhar.

    ⚠️ ESTES SEIS SAO OS QUE O FRONT JA TEM (`CampoTipo` em
    `web/lib/solicitacaoForm.ts`). A lista nasce igual de proposito: a fatia B
    troca a FONTE do formulario, e mudar os tipos no mesmo movimento seria
    trocar duas coisas de uma vez num caminho publico.

    ⚠️ E ELE E `String(20)` NO BANCO, e nao ENUM nativo -- mesmo motivo do
    `notification.type`: acrescentar um tipo de pergunta nao pode exigir
    migration. Este enum e a fonte de verdade do CODIGO, e so dele.
    """

    TEXTO = "texto"
    TEXTO_LONGO = "textoLongo"
    ESCOLHA = "escolha"
    MULTI = "multi"
    DATA = "data"
    LINK = "link"


#: Tipos que exigem `options` preenchido.
#:
#: ⚠️ SEM OPCOES, UMA PERGUNTA DE ESCOLHA E UM BECO SEM SAIDA: ela aparece no
#: formulario publico com zero alternativas e, se for obrigatoria, TRAVA o
#: envio -- e quem responde nao tem como saber por que. A recusa mora no
#: servico (`ValidationError`), e nao num validador do Pydantic: validador
#: custom neste projeto devolve 500 em vez de 422.
KINDS_COM_OPCOES: frozenset[str] = frozenset(
    {QuestionKind.ESCOLHA.value, QuestionKind.MULTI.value}
)


def exige_opcoes(kind: str) -> bool:
    """O tipo precisa de `options` com ao menos uma alternativa?"""
    return kind in KINDS_COM_OPCOES


def kind_valido(kind: str) -> bool:
    """`kind` esta entre os tipos que o formulario sabe desenhar?"""
    return kind in {k.value for k in QuestionKind}
