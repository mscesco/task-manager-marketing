"""@mencao na EDICAO de comentario: so quem entrou na edicao e notificado.

O teste central e `test_edicao_sem_mexer_em_mencao_nao_notifica`: sem o delta,
corrigir uma virgula num comentario com quatro mencoes notifica as quatro de
novo -- e corrigir virgula E o uso mais comum de editar.

Complementa `test_mentions_in_comment_db.py`, que cobre a CRIACAO.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.tasks.application.comment_service import CommentService
from app.shared.exceptions.base import AuthorizationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """Raiz R + subtimes A e B. O autor e MANAGER da raiz e criador da task.

    dentro -- OPERATOR da raiz, alcanca a task
    fora   -- OPERATOR de B; NAO alcanca task interna de A

    ⚠️ Sao precisos DOIS subtimes: tarefa da RAIZ todo mundo alcanca, entao a
    task "fora de escopo" tem de estar num subtime (A) que `fora` (B) nao ve.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    autor = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=autor, team_id=r, role="MANAGER")
    dentro = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=dentro, team_id=r, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=outro, team_id=r, role="OPERATOR")
    fora = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=fora, team_id=b, role="OPERATOR")

    proj = await f.make_project(db, workspace_id=ws, created_by=autor, team_id=r)
    task = await f.make_task(
        db, workspace_id=ws, created_by=autor, team_id=r, project_id=proj,
        title="Brief",
    )
    ctx = dict(
        workspace_id=ws, user_id=autor,
        memberships=(mship(r, "MANAGER"),),
        team_tree=(node(r), node(a, r), node(b, r)),
    )
    return ws, r, a, b, autor, dentro, outro, fora, task, ctx


async def _conta(db, recipient_id, tipo):
    return len(
        (
            await db.execute(
                select(Notification).where(
                    Notification.recipient_id == recipient_id,
                    Notification.type == tipo,
                )
            )
        ).scalars().all()
    )


# ----------------------------------------------------------
# o pedido
# ----------------------------------------------------------
async def test_edicao_acrescenta_mencao_notifica(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 0
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=f"ok @[Fulano]({dentro})"
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1


# ----------------------------------------------------------
# o delta: so a mencao nova notifica
# ----------------------------------------------------------
async def test_edicao_sem_mexer_em_mencao_nao_notifica(db) -> None:
    """Corrigir uma virgula NAO pode renotificar quem ja estava la.

    Sabotagem alvo: ler `antigas` DEPOIS de `comment.content = clean`. Com ela,
    o conjunto sai vazio e esta assercao vira 2.
    """
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(
            task_id=task.id,
            content=f"oi @[A]({dentro}) e @[B]({outro})",
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1
        assert await _conta(db, outro, "TASK_MENTIONED") == 1
        await CommentService(db).edit_comment(
            task_id=task.id,
            comment_id=c.id,
            content=f"oi, @[A]({dentro}) e @[B]({outro})",  # so a virgula
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1
        assert await _conta(db, outro, "TASK_MENTIONED") == 1


# ----------------------------------------------------------
# so o novo
# ----------------------------------------------------------
async def test_edicao_notifica_so_o_novo(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(
            task_id=task.id, content=f"oi @[A]({dentro})"
        )
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=task.id,
            comment_id=c.id,
            content=f"oi @[A]({dentro}) e @[B]({outro})",
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1  # nao repetiu
        assert await _conta(db, outro, "TASK_MENTIONED") == 1  # novo


# ----------------------------------------------------------
# remover nao faz nada
# ----------------------------------------------------------
async def test_edicao_removendo_mencao_nao_notifica(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(
            task_id=task.id, content=f"oi @[A]({dentro})"
        )
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content="oi"
        )
        await db.flush()
        # a notificacao ja emitida PERMANECE -- nao existe des-notificar
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1


# ----------------------------------------------------------
# escopo
# ----------------------------------------------------------
async def test_mencao_fora_do_escopo_nao_notifica_na_edicao(db) -> None:
    """Mesmo filtro da criacao. O id pode ter sido COLADO no texto."""
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    # team_id=A (nao a raiz): `fora` esta em B e nao alcanca o ramo A.
    interna = await f.make_task(
        db, workspace_id=ws, created_by=autor, team_id=a, title="Interna"
    )
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=interna.id, content="ok")
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=interna.id, comment_id=c.id, content=f"ok @[X]({fora})"
        )
        await db.flush()
        assert await _conta(db, fora, "TASK_MENTIONED") == 0


# ----------------------------------------------------------
# uuid que nao e usuario: salva mesmo assim
# ----------------------------------------------------------
async def test_uuid_invalido_salva_sem_notificar(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    fantasma = uuid.uuid4()
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        novo = f"ok @[Fantasma]({fantasma})"
        dto = await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=novo
        )
        await db.flush()
        assert dto.content == novo  # o comentario salva; a mencao e que nao vale
        assert await _conta(db, fantasma, "TASK_MENTIONED") == 0


# ----------------------------------------------------------
# auto-mencao
# ----------------------------------------------------------
async def test_automencao_na_edicao_nao_notifica(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=f"ok @[Eu]({autor})"
        )
        await db.flush()
        assert await _conta(db, autor, "TASK_MENTIONED") == 0


# ----------------------------------------------------------
# editar nao reemite TASK_COMMENTED
# ----------------------------------------------------------
async def test_edicao_nao_emite_task_commented(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=dentro, assigned_by=autor
    )
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        antes = await _conta(db, dentro, "TASK_COMMENTED")
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content="ok!"
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_COMMENTED") == antes


# ----------------------------------------------------------
# edited_at continua
# ----------------------------------------------------------
async def test_edited_at_continua_sendo_gravado(db) -> None:
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        dto = await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content="ok editado"
        )
        assert dto.edited_at is not None


# ----------------------------------------------------------
# nao-autor: 403 e NADA emitido
# ----------------------------------------------------------
async def test_nao_autor_403_e_nada_emitido(db) -> None:
    """A autorizacao vem ANTES da emissao. Sabotagem alvo: mover o `can_edit`
    pra depois -- ai um estranho editaria, falharia, e a notificacao ja teria
    saido."""
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
    ctx_outro = dict(
        workspace_id=ws, user_id=outro,
        memberships=(mship(r, "OPERATOR"),),
        team_tree=(node(r), node(a, r), node(b, r)),
    )
    with acting_as(**ctx_outro), pytest.raises(AuthorizationError):
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=f"xxx @[A]({dentro})"
        )
    assert await _conta(db, dentro, "TASK_MENTIONED") == 0


# ----------------------------------------------------------
# responsavel ja notificado pelo comentario recebe a mencao
# ----------------------------------------------------------
async def test_responsavel_que_ja_recebeu_commented_recebe_mencao(db) -> None:
    """⚠️ Excecao DELIBERADA a "ninguem recebe duas notificacoes pelo MESMO
    comentario": a pessoa pode ter recebido TASK_COMMENTED quando o comentario
    nasceu (por ser responsavel) e so agora ser mencionada. Sao eventos
    diferentes, em momentos diferentes.
    """
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=dentro, assigned_by=autor
    )
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        await db.flush()
        assert await _conta(db, dentro, "TASK_COMMENTED") == 1
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=f"ok @[A]({dentro})"
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 1


# ----------------------------------------------------------
# re-acrescentar notifica de novo (aceito)
# ----------------------------------------------------------
async def test_readicionar_mencao_notifica_de_novo(db) -> None:
    """Comportamento ACEITO, nao defeito.

    Exige tres edicoes deliberadas (mencionar, tirar, repor). Fechar exigiria
    consultar as TASK_MENTIONED ja emitidas pra este comment_id -- uma leitura
    da tabela que mais cresce no produto, dentro do caminho de edicao.

    Este teste existe pra que a mudanca seja CONSCIENTE se alguem decidir
    fechar depois: ele vira vermelho, e isso e o sinal certo.
    """
    ws, r, a, b, autor, dentro, outro, fora, task, ctx = await _world(db)
    with acting_as(**ctx):
        c = await CommentService(db).create_comment(
            task_id=task.id, content=f"oi @[A]({dentro})"
        )
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content="oi"
        )
        await db.flush()
        await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content=f"oi @[A]({dentro})"
        )
        await db.flush()
        assert await _conta(db, dentro, "TASK_MENTIONED") == 2
