"""Spec 050, fatia B -- TASK_COMMENT_REACTED: reagiram ao seu comentario.

O que este arquivo prova, na ordem das decisoes dela (15/09):

    1. reagir ao comentario de alguem notifica o AUTOR, com o emoji no payload
    2. reagir ao PROPRIO comentario nao notifica
    3. trocar o emoji nao notifica (nem reagir de novo com o mesmo)
    4. tirar nao notifica -- e tirar e por de novo notifica (o banco nao lembra)
    5. o emoji do payload e o NORMALIZADO
    6. autor que perdeu o alcance da tarefa nao recebe (404 e vazamento de titulo)

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.db.models import Notification, UserTeam
from app.modules.tasks.application.comment_service import CommentService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

TIPO = "TASK_COMMENT_REACTED"


async def _mundo(db) -> dict:
    """A autora e a ana sao OPERATOR do subtime A; a tarefa e de A."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    autora = await f.make_user(db, workspace_id=ws, email="autora@t.dev")
    ana = await f.make_user(db, workspace_id=ws, email="ana@t.dev")
    for uid in (autora, ana):
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=a, role="OPERATOR")
    task = await f.make_task(
        db, workspace_id=ws, created_by=autora, team_id=a, title="Banner home"
    )
    m = {
        "ws": ws, "r": r, "a": a, "b": b, "autora": autora, "ana": ana,
        "arvore": (node(r), node(a, r), node(b, r)), "task_id": task.id,
    }
    with _como(m, "autora"):
        comentario = await CommentService(db).create_comment(
            task_id=task.id, content="o que acham?"
        )
    m["comentario"] = comentario.id
    return m


def _como(m: dict, quem: str):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m[quem],
        memberships=(mship(m["a"], "OPERATOR"),),
        team_tree=m["arvore"],
    )


async def _reagir(db, m: dict, quem: str, emoji: str) -> None:
    with _como(m, quem):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=m["comentario"], emoji=emoji
        )


async def _avisos(db, recipient_id) -> list[Notification]:
    await db.flush()
    return list(
        (
            await db.execute(
                select(Notification)
                .where(
                    Notification.recipient_id == recipient_id,
                    Notification.type == TIPO,
                )
                .order_by(Notification.created_at, Notification.id)
            )
        ).scalars().all()
    )


async def test_reagir_notifica_o_autor(db) -> None:
    m = await _mundo(db)
    await _reagir(db, m, "ana", "👍")

    (aviso,) = await _avisos(db, m["autora"])
    assert aviso.actor_id == m["ana"]
    assert aviso.task_id == m["task_id"]
    assert aviso.comment_id == m["comentario"]
    assert aviso.payload["emoji"] == "👍"
    assert aviso.payload["task_title"] == "Banner home"
    # quem reagiu nao recebe nada
    assert await _avisos(db, m["ana"]) == []


async def test_reagir_ao_proprio_comentario_nao_notifica(db) -> None:
    """Decisao dela: *"não notifica se reagir ao proprio comentario"*."""
    m = await _mundo(db)
    await _reagir(db, m, "autora", "🎉")
    assert await _avisos(db, m["autora"]) == []


async def test_trocar_o_emoji_nao_notifica(db) -> None:
    """Decisao dela (pergunta 3): trocar nao notifica de novo."""
    m = await _mundo(db)
    await _reagir(db, m, "ana", "👍")
    await _reagir(db, m, "ana", "❤️")  # troca
    await _reagir(db, m, "ana", "❤️")  # mesmo emoji: nada muda
    assert len(await _avisos(db, m["autora"])) == 1


async def test_tirar_nao_notifica_e_por_de_novo_notifica(db) -> None:
    """⚠️ Consequencia dita na spec: o banco nao lembra da reacao removida."""
    m = await _mundo(db)
    await _reagir(db, m, "ana", "👍")
    with _como(m, "ana"):
        await CommentService(db).remove_reaction(
            task_id=m["task_id"], comment_id=m["comentario"]
        )
    assert len(await _avisos(db, m["autora"])) == 1

    await _reagir(db, m, "ana", "👍")
    assert len(await _avisos(db, m["autora"])) == 2


async def test_o_emoji_do_aviso_e_o_normalizado(db) -> None:
    """Sem isso o sino diria `❤` e a pilula `❤️`, para a mesma reacao."""
    m = await _mundo(db)
    await _reagir(db, m, "ana", "❤")
    (aviso,) = await _avisos(db, m["autora"])
    assert aviso.payload["emoji"] == "❤️"


async def test_autor_que_perdeu_o_alcance_nao_recebe(db) -> None:
    """⚠️ A autora saiu do subtime A depois de comentar e foi para o B.

    Ela nao enxerga mais a tarefa: o aviso levaria a um 404 e o payload vazaria
    o titulo. Mesma regra das mencoes. A reacao da ana continua valendo -- o
    que nao sai e so a notificacao.
    """
    m = await _mundo(db)
    await db.execute(
        delete(UserTeam).where(
            UserTeam.user_id == m["autora"], UserTeam.team_id == m["a"]
        )
    )
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["autora"], team_id=m["b"], role="OPERATOR"
    )

    with _como(m, "ana"):
        dto = await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=m["comentario"], emoji="👍"
        )
    assert [r.emoji for r in dto.reactions] == ["👍"]
    assert await _avisos(db, m["autora"]) == []
