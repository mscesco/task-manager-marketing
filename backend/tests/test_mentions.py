"""`extract_mentions`, puro: parsing de @[Nome](uuid) extrai ids, sem
repetir, e ignora texto comum e uuid invalido."""

from __future__ import annotations

import uuid

from app.modules.tasks.domain.comment import extract_mentions


def test_extrai_uma_mencao() -> None:
    uid = uuid.uuid4()
    assert extract_mentions(f"oi @[Ana]({uid}) tudo bem?") == [uid]


def test_extrai_varias_em_ordem() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert extract_mentions(f"@[A]({a}) e @[B]({b})") == [a, b]


def test_dedup_preserva_ordem() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert extract_mentions(f"@[A]({a}) @[B]({b}) @[A de novo]({a})") == [a, b]


def test_ignora_arroba_texto_simples() -> None:
    assert extract_mentions("falar com @camila e @joao") == []


def test_ignora_uuid_invalido() -> None:
    assert extract_mentions("@[X](nao-eh-uuid)") == []
    assert extract_mentions("@[X](1234)") == []


def test_sem_mencao_retorna_vazio() -> None:
    assert extract_mentions("comentario normal sem mencao") == []
    assert extract_mentions("") == []


def test_nome_com_espacos_e_acentos() -> None:
    uid = uuid.uuid4()
    assert extract_mentions(f"@[Ana Maria Souza]({uid})!") == [uid]
