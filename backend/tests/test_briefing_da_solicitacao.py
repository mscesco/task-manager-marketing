"""Briefing e titulo da tarefa criada a partir de uma solicitacao (sem banco)."""

from __future__ import annotations

from datetime import UTC, datetime

from app.modules.solicitations.domain.briefing import (
    briefing,
    titulo_da_tarefa,
)


class _Falso:
    category = "arte"
    summary = "Banner do processo seletivo"
    requester_name = "Maria do Polo"
    requester_email = "maria@polo.ex"
    requester_phone = "11999990000"
    requester_department = "Coordenação"
    requester_polo = "Taboão"
    batch_id = "abc12345-0000-0000-0000-000000000000"
    batch_seq = 2
    batch_total = 3
    answers = [{"label": "O que precisa?", "value": "um banner"}]  # noqa: RUF012 -- dublê

    # 02:30 UTC de 27/08 = 23:30 de 26/08 em Brasilia: o briefing diz 26/08.
    created_at = datetime(2026, 8, 27, 2, 30, tzinfo=UTC)


def test_titulo_e_cortado_em_255() -> None:
    """`task.title` e `String(255)` e o `summary` vai ate 500."""

    class Longo(_Falso):
        summary = "x" * 500

    assert len(titulo_da_tarefa(Longo())) == 255


def test_briefing_NAO_escreve_None_quando_o_formulario_nao_pergunta() -> None:
    """Campo que o formulario nao pergunta (`None`) nao vira o texto "None"."""

    class SemLugar(_Falso):
        requester_phone = None
        requester_department = None
        requester_polo = None

    texto = briefing(SemLugar(), "Criar uma arte")
    assert "None" not in texto
    # A linha inteira some em vez de ficar vazia. A assercao e sobre o rotulo
    # ("Polo:"), porque "Polo" aparece em "Maria do Polo" e em "Protocolo".
    assert "Área:" not in texto
    assert "Polo:" not in texto
    # O que o formulário PERGUNTOU continua lá.
    assert _Falso.requester_email in texto


def test_briefing_com_UM_dos_dois_mostra_so_ele() -> None:
    """Meio-termo: pergunta área e não polo."""

    class SoArea(_Falso):
        requester_polo = None

    texto = briefing(SoArea())
    assert "Área: Coordenação" in texto
    assert "Polo:" not in texto


def test_briefing_traz_protocolo_posicao_e_respostas() -> None:
    texto = briefing(_Falso(), "Criar uma arte")
    assert texto.startswith("[Criar uma arte] Banner do processo seletivo")
    assert "ABC12345 (2/3)" in texto
    assert "O que precisa?" in texto
    assert "um banner" in texto


def test_envio_de_UM_item_nao_mostra_a_posicao() -> None:
    """"(1/1)" seria ruído -- só faz sentido quando há irmãs."""

    class Sozinho(_Falso):
        batch_seq = 1
        batch_total = 1

    assert "(1/1)" not in briefing(Sozinho())
