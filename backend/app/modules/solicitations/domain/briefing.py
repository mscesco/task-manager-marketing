"""O pedido virando TEXTO DE TAREFA (Spec 043, fatia E).

⚠️⚠️ ESTE FORMATO NAO FOI INVENTADO AQUI -- ele e o do botao "Copiar
briefing", que existe na fila desde a Spec 025. E a prova de que o fluxo real
era copia-e-cola: copiar, sair da fila, abrir o quadro, criar a tarefa, colar,
voltar e marcar "tarefa criada". Seis passos, e o ultimo era o que mais se
esquecia -- dai o filtro "aprovadas sem tarefa" ter valor.

Manter o MESMO texto e deliberado: quem ja se acostumou com a tarefa colada a
mao encontra exatamente a mesma coisa na criada pelo botao.

⚠️ E HA UMA COPIA DESTE FORMATO NO FRONT (`copiarBriefing`, em
`app/solicitacoes/page.tsx`), que continua servindo para quem prefere colar em
outro lugar -- um e-mail, o WhatsApp. Elas podem divergir, e a divergencia e
barata: o pior caso e um texto copiado ficar diferente de um texto de tarefa.
Nao vale um request so para copiar.
"""

from __future__ import annotations

from typing import Protocol


class _Pedido(Protocol):
    """O que este modulo precisa de uma solicitacao -- e so isso.

    ⚠️ PROTOCOL EM VEZ DO MODELO para o teste poder passar um objeto simples,
    sem banco. As funcoes aqui sao formatacao pura, e amarra-las ao
    SQLAlchemy faria cada teste delas precisar de um Postgres.
    """

    category: str
    summary: str
    requester_name: str
    requester_email: str
    #: ⚠️ OS TRES SAO `str | None` DESDE A FATIA G, e este Protocol MENTIA:
    #: declarava `str`, o que fez o mypy calar sobre exatamente o defeito que a
    #: revisao de 31/08 achou -- o f-string abaixo escrevia o literal "None" na
    #: descricao de uma tarefa que alguem ia ler.
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    batch_id: object
    batch_seq: int
    batch_total: int
    answers: list[dict]
    created_at: object


def titulo_da_tarefa(pedido: _Pedido, rotulo: str | None = None) -> str:
    """`[Categoria] resumo`, cortado no limite do titulo de tarefa.

    ⚠️ O CORTE E EM 255 e nao e capricho: `task.title` e `String(255)` e o
    `summary` do pedido pode ter ate 500, mais o rotulo entre colchetes. Sem o
    corte, a criacao explodiria no BANCO -- depois de o pedido ja ter sido
    aprovado, e com a tarefa meio criada.
    """
    nome = rotulo or pedido.category
    return f"[{nome}] {pedido.summary}".strip()[:255]


def briefing(pedido: _Pedido, rotulo: str | None = None) -> str:
    """O pedido inteiro como texto -- o mesmo do botao "Copiar briefing"."""
    protocolo = str(pedido.batch_id).split("-")[0].upper()
    de_varias = (
        f" ({pedido.batch_seq}/{pedido.batch_total})"
        if pedido.batch_total > 1
        else ""
    )
    recebida = getattr(pedido.created_at, "strftime", lambda _: "")("%d/%m/%Y")

    # ⚠️⚠️ NADA DE f-STRING COM CAMPO OPCIONAL AQUI. `f"{None}"` produz o
    # literal **"None"**, e este briefing vira a DESCRICAO de uma tarefa no
    # quadro -- alguem le "Solicitante: Maria · maria@x · None" e "Área: None ·
    # Polo: None" enquanto tenta fazer o trabalho.
    #
    # Achado pela revisao de 31/08. Ele passou por dois motivos somados: o
    # `Protocol` acima declarava os tres como `str` (o mypy calou), e TODAS as
    # fixtures de teste preenchiam os cinco campos -- o caso `None` nunca era
    # exercitado. Os dois foram corrigidos junto com isto.
    contato = " · ".join(
        p
        for p in (
            pedido.requester_name,
            pedido.requester_email,
            pedido.requester_phone,
        )
        if p
    )
    # ⚠️ A LINHA INTEIRA SOME quando o formulario nao pergunta nenhum dos dois.
    # "Área:  · Polo: " vazio e pior que a ausencia: parece campo perdido.
    lugar = " · ".join(
        f"{rotulo_do_campo}: {valor}"
        for rotulo_do_campo, valor in (
            ("Área", pedido.requester_department),
            ("Polo", pedido.requester_polo),
        )
        if valor
    )

    linhas = [
        f"{titulo_da_tarefa(pedido, rotulo)}",
        f"Solicitante: {contato}",
        *([lugar] if lugar else []),
        f"Protocolo: {protocolo}{de_varias} · Recebida em {recebida}",
        "",
    ]
    # ⚠️ AS RESPOSTAS SAO O RETRATO DO DIA (`{label, value}`), com o TEXTO da
    # pergunta. E por isso que a tarefa continua legivel mesmo depois de alguem
    # editar o formulario -- ela carrega o que foi perguntado, e nao um
    # ponteiro para o que se pergunta hoje.
    for resposta in pedido.answers:
        linhas.append(str(resposta.get("label", "")))
        linhas.append(str(resposta.get("value", "")))
        linhas.append("")
    return "\n".join(linhas).strip()
