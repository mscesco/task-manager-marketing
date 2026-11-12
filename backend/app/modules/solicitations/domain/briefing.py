"""O pedido virando texto de tarefa.

Mesmo formato do botao "Copiar briefing" da fila (`copiarBriefing`, em
`app/solicitacoes/page.tsx`); as duas copias podem divergir sem grande custo.
"""

from __future__ import annotations

from typing import Protocol
from zoneinfo import ZoneInfo

# Mesmo fuso de `tasks/domain/dashboard.py:TIMEZONE`, sem importar o modulo de tarefas.
_FUSO = ZoneInfo("America/Sao_Paulo")


class _Pedido(Protocol):
    """O que este modulo precisa de uma solicitacao.

    Protocol em vez do modelo para o teste passar um objeto simples, sem banco.
    """

    category: str
    summary: str
    requester_name: str
    requester_email: str
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    batch_id: object
    batch_seq: int
    batch_total: int
    answers: list[dict]
    created_at: object


def titulo_da_tarefa(pedido: _Pedido, rotulo: str | None = None) -> str:
    """`[Categoria] resumo`, cortado em 255 (`task.title` e `String(255)`)."""
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
    # `created_at` e UTC; a data mostrada e a de Brasilia.
    recebida = pedido.created_at.astimezone(_FUSO).strftime("%d/%m/%Y")

    # Sem f-string com campo opcional: `f"{None}"` escreveria "None" na tarefa.
    contato = " · ".join(
        p
        for p in (
            pedido.requester_name,
            pedido.requester_email,
            pedido.requester_phone,
        )
        if p
    )
    # A linha some inteira quando o formulario nao pergunta nenhum dos dois.
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
    for resposta in pedido.answers:
        linhas.append(str(resposta.get("label", "")))
        linhas.append(str(resposta.get("value", "")))
        linhas.append("")
    return "\n".join(linhas).strip()
