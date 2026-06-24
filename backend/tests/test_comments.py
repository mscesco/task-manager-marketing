"""Testes de logica PURA dos comentarios (Entrega 14) -- sem DB.

Cobrem validacao de conteudo, threading de 1 nivel, autorizacao e tombstone.
Rodam em qualquer lugar (nao exigem TEST_DATABASE_URL).
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.tasks.domain.comment import (
    CONTENT_MAX,
    TOMBSTONE_TEXT,
    assert_reply_target,
    can_delete,
    can_edit,
    mask_content,
    normalize_content,
)
from app.shared.exceptions.base import ValidationError


# --- conteudo (D8) ---
def test_normalize_strip_ok() -> None:
    assert normalize_content("  oi  ") == "oi"


def test_normalize_vazio_e_so_espaco_falham() -> None:
    for ruim in ("", "   ", "\n\t "):
        with pytest.raises(ValidationError):
            normalize_content(ruim)


def test_normalize_limite() -> None:
    assert normalize_content("a" * CONTENT_MAX) == "a" * CONTENT_MAX
    with pytest.raises(ValidationError):
        normalize_content("a" * (CONTENT_MAX + 1))


# --- threading 1 nivel (D4) ---
def test_reply_em_topo_da_mesma_task_ok() -> None:
    task = uuid.uuid4()
    # pai de topo (parent_parent None), mesma task -> nao levanta
    assert_reply_target(
        parent_task_id=task, parent_parent_comment_id=None, task_id=task
    )


def test_reply_de_reply_falha() -> None:
    task = uuid.uuid4()
    with pytest.raises(ValidationError):
        assert_reply_target(
            parent_task_id=task,
            parent_parent_comment_id=uuid.uuid4(),  # pai ja e replica
            task_id=task,
        )


def test_reply_em_pai_de_outra_task_falha() -> None:
    with pytest.raises(ValidationError):
        assert_reply_target(
            parent_task_id=uuid.uuid4(),
            parent_parent_comment_id=None,
            task_id=uuid.uuid4(),
        )


# --- autorizacao (D2/D3) ---
def test_can_edit_so_autor() -> None:
    autor = uuid.uuid4()
    outro = uuid.uuid4()
    assert can_edit(author_id=autor, actor_id=autor) is True
    assert can_edit(author_id=autor, actor_id=outro) is False


def test_can_delete_autor_ou_moderador() -> None:
    autor = uuid.uuid4()
    outro = uuid.uuid4()
    # autor apaga o proprio
    assert can_delete(author_id=autor, actor_id=autor, actor_can_moderate=False)
    # terceiro sem moderacao nao apaga
    assert not can_delete(
        author_id=autor, actor_id=outro, actor_can_moderate=False
    )
    # moderador apaga alheio
    assert can_delete(author_id=autor, actor_id=outro, actor_can_moderate=True)


# --- tombstone (D5) ---
def test_mask_content() -> None:
    assert mask_content("texto", is_deleted=False) == "texto"
    assert mask_content("texto", is_deleted=True) == TOMBSTONE_TEXT
