"""Dominio de Solicitacao: status, categorias e regras de transicao.

A maquina de estados (Spec 043, fatia D acrescentou os dois ultimos):

    PENDING --aprovar--> APPROVED <--> IN_PROGRESS <--> DONE
    PENDING --rejeitar-> REJECTED   (terminal, exige justificativa)

⚠️ A TRIAGEM E UMA PORTA SO: `can_review` continua exigindo PENDING. Os tres
estados da direita sao ANDAMENTO, e nao uma segunda triagem -- passar por eles
nao reescreve quem aprovou nem quando.

⚠️ E ENTRE OS TRES ANDA-SE PARA OS DOIS LADOS. Marcar "concluida" por engano e
comum; sem a volta, a saida seria mexer no banco.

Nao ha "reabrir" um REJECTED: se a triagem errou, o solicitante reenvia (o
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
    #: Spec 043, fatia D. Alguem esta tocando o pedido.
    IN_PROGRESS = "IN_PROGRESS"
    #: Spec 043, fatia D. Entregue. Terminal na pratica, nao na regra.
    DONE = "DONE"


#: Os estados de um pedido ACEITO -- o trabalho acontece dentro deste conjunto.
#:
#: ⚠️⚠️ ELE EXISTE PARA NAO REPETIR `== APPROVED` PELO CODIGO, e a razao e
#: concreta: quando a fatia D acrescentou IN_PROGRESS e DONE, havia CINCO
#: lugares comparando com APPROVED sozinho -- dois CHECKs no banco, um indice
#: parcial, o filtro "sem tarefa" e a guarda do `mark_task`. Cada um que
#: ficasse para tras viraria um defeito diferente e silencioso: pedido em
#: andamento sumindo do filtro, tarefa que nao pode ser marcada, indice que
#: para de ser usado.
#:
#: ⚠️ QUEM ACRESCENTAR UM ESTADO NOVO tem de decidir se ele entra aqui -- e a
#: migration precisa mexer no CHECK e no indice parcial JUNTO. Este conjunto e
#: a fonte de verdade do codigo; o banco tem a propria copia, e a migration
#: `0018` e onde as duas se encontram.
ACEITOS: frozenset[str] = frozenset(
    {
        SolicitationStatus.APPROVED.value,
        SolicitationStatus.IN_PROGRESS.value,
        SolicitationStatus.DONE.value,
    }
)


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
    """So solicitacao PENDING pode ser aprovada/rejeitada.

    ⚠️ E A FATIA D NAO MUDOU ISTO, de proposito. IN_PROGRESS e DONE vem DEPOIS
    da aprovacao: sao andamento, e nao uma segunda triagem. Deixar reaprovar um
    pedido em andamento reescreveria `reviewed_by_user_id` e `reviewed_at` --
    apagaria quem decidiu e quando, que e o registro que existe justamente para
    quando alguem cobrar.
    """
    return status == SolicitationStatus.PENDING


def pode_andar(atual: str, novo: str) -> bool:
    """A solicitacao pode ir de `atual` para `novo`?

    ⚠️ SO SE MEXE DENTRO DO CONJUNTO DOS ACEITOS, e as duas recusas importam:

      - **de PENDING nao se anda**: marcar "em andamento" sem aprovar pularia a
        triagem inteira, e o pedido chegaria ao fim sem ninguem ter decidido
        que ele valia;
      - **de REJECTED nao se anda**: reabrir por aqui deixaria a rejeicao e a
        justificativa penduradas num pedido vivo. Nao ha reabertura neste
        produto -- quem foi recusado reenvia, e o formulario e publico e
        barato.

    ⚠️ E DENTRO DOS ACEITOS ANDA-SE PARA OS DOIS LADOS, inclusive voltando de
    DONE para IN_PROGRESS: marcar concluida por engano e comum, e sem a volta a
    saida seria mexer no banco.
    """
    return atual in ACEITOS and novo in ACEITOS and atual != novo
