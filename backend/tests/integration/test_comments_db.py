"""Comentarios em tasks (Entrega 14) -- testes de integracao contra Postgres.

Cobre: criar+listar em ordem; threading (replica ok, replica-de-replica e
pai-de-outra-task -> 422); edicao so do autor; delecao por autor/moderador/
terceiro; tombstone; visibilidade (D6: 404 fora da lente); "ve por created_by
comenta mas nao edita" (D1); cascata no soft-delete da task (D11); isolamento
entre workspaces.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.db.models import Comment
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.application.task_service import (
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

PAGE = PageParams(page=1, size=50)


async def _tree(db):
    """Workspace com raiz R e dois subtimes A e B (irmaos)."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    return ws, r, a, b


def _forest(r, a, b):
    return (node(r), node(a, r), node(b, r))


async def test_cria_e_lista_em_ordem(db) -> None:
    ws, r, a, b = await _tree(db)
    mgr = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=r, role="MANAGER")
    task = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r)

    ctx = dict(workspace_id=ws, user_id=mgr,
               memberships=(mship(r, "MANAGER"),), team_tree=_forest(r, a, b))
    with acting_as(**ctx):
        svc = CommentService(db)
        c1 = await svc.create_comment(task_id=task.id, content="primeiro")
        c2 = await svc.create_comment(task_id=task.id, content="segundo")
        c3 = await svc.create_comment(task_id=task.id, content="terceiro")

        # created_at vem de func.now() -> CONSTANTE na mesma transacao, entao no
        # teste os tres empatam. Em producao cada comentario nasce numa
        # request/transacao distinta, com created_at distinto. Carimba instantes
        # crescentes pra refletir isso e a ordem ser deterministica.
        base_ts = datetime(2026, 1, 1, tzinfo=UTC)
        for i, cid in enumerate((c1.id, c2.id, c3.id)):
            await db.execute(
                update(Comment)
                .where(Comment.id == cid)
                .values(created_at=base_ts + timedelta(seconds=i))
                .execution_options(synchronize_session=False)
            )

        page = await svc.list_comments(task_id=task.id, params=PAGE)

    assert page.total == 3
    assert [c.content for c in page.items] == ["primeiro", "segundo", "terceiro"]
    assert all(c.is_deleted is False for c in page.items)


async def test_threading_um_nivel(db) -> None:
    ws, r, a, b = await _tree(db)
    mgr = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=r, role="MANAGER")
    task = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r)
    outra = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r, title="outra")

    with acting_as(workspace_id=ws, user_id=mgr,
                   memberships=(mship(r, "MANAGER"),), team_tree=_forest(r, a, b)):
        svc = CommentService(db)
        topo = await svc.create_comment(task_id=task.id, content="pergunta")
        # replica valida
        rep = await svc.create_comment(
            task_id=task.id, content="resposta", parent_comment_id=topo.id
        )
        assert rep.parent_comment_id == topo.id

        # replica-de-replica -> 422
        with pytest.raises(ValidationError):
            await svc.create_comment(
                task_id=task.id, content="trineto", parent_comment_id=rep.id
            )

        # pai de OUTRA task -> 422
        with pytest.raises(ValidationError):
            await svc.create_comment(
                task_id=outra.id, content="x", parent_comment_id=topo.id
            )

        # conteudo vazio -> 422
        with pytest.raises(ValidationError):
            await svc.create_comment(task_id=task.id, content="   ")


async def test_edicao_so_autor(db) -> None:
    ws, r, a, b = await _tree(db)
    autor = await f.make_user(db, workspace_id=ws, email="autor@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=autor, team_id=r, role="OPERATOR")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=r, role="ADMIN")
    task = await f.make_task(db, workspace_id=ws, created_by=autor, team_id=r)

    with acting_as(workspace_id=ws, user_id=autor,
                   memberships=(mship(r, "OPERATOR"),), team_tree=_forest(r, a, b)):
        c = await CommentService(db).create_comment(task_id=task.id, content="v1")

    # autor edita
    with acting_as(workspace_id=ws, user_id=autor,
                   memberships=(mship(r, "OPERATOR"),), team_tree=_forest(r, a, b)):
        editado = await CommentService(db).edit_comment(
            task_id=task.id, comment_id=c.id, content="v2"
        )
        assert editado.content == "v2"
        assert editado.edited_at is not None

    # admin NAO edita comentario alheio (D2) -> 403
    with acting_as(workspace_id=ws, user_id=admin,
                   memberships=(mship(r, "ADMIN"),), team_tree=_forest(r, a, b)):
        with pytest.raises(AuthorizationError):
            await CommentService(db).edit_comment(
                task_id=task.id, comment_id=c.id, content="hack"
            )


async def test_delecao_autor_moderador_e_terceiro(db) -> None:
    ws, r, a, b = await _tree(db)
    autor = await f.make_user(db, workspace_id=ws, email="autor@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=autor, team_id=r, role="OPERATOR")
    terceiro = await f.make_user(db, workspace_id=ws, email="op2@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=terceiro, team_id=r, role="OPERATOR")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=r, role="MANAGER")
    task = await f.make_task(db, workspace_id=ws, created_by=autor, team_id=r)

    async def novo_comentario(uid, role):
        with acting_as(workspace_id=ws, user_id=uid,
                       memberships=(mship(r, role),), team_tree=_forest(r, a, b)):
            return await CommentService(db).create_comment(
                task_id=task.id, content="texto"
            )

    # terceiro (OPERATOR, sem task.delete, nao-autor) -> 403
    c1 = await novo_comentario(autor, "OPERATOR")
    with acting_as(workspace_id=ws, user_id=terceiro,
                   memberships=(mship(r, "OPERATOR"),), team_tree=_forest(r, a, b)):
        with pytest.raises(AuthorizationError):
            await CommentService(db).delete_comment(task_id=task.id, comment_id=c1.id)

    # autor apaga o proprio -> ok
    with acting_as(workspace_id=ws, user_id=autor,
                   memberships=(mship(r, "OPERATOR"),), team_tree=_forest(r, a, b)):
        await CommentService(db).delete_comment(task_id=task.id, comment_id=c1.id)

    # moderador (MANAGER tem task.delete) apaga alheio -> ok
    c2 = await novo_comentario(autor, "OPERATOR")
    with acting_as(workspace_id=ws, user_id=mgr,
                   memberships=(mship(r, "MANAGER"),), team_tree=_forest(r, a, b)):
        await CommentService(db).delete_comment(task_id=task.id, comment_id=c2.id)


async def test_tombstone_pai_apagado_com_replica(db) -> None:
    ws, r, a, b = await _tree(db)
    mgr = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=r, role="MANAGER")
    task = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r)

    with acting_as(workspace_id=ws, user_id=mgr,
                   memberships=(mship(r, "MANAGER"),), team_tree=_forest(r, a, b)):
        svc = CommentService(db)
        pai = await svc.create_comment(task_id=task.id, content="pai")
        await svc.create_comment(task_id=task.id, content="filho", parent_comment_id=pai.id)
        solto = await svc.create_comment(task_id=task.id, content="solto")

        # apaga o pai (tem replica viva) e o solto (sem replica)
        await svc.delete_comment(task_id=task.id, comment_id=pai.id)
        await svc.delete_comment(task_id=task.id, comment_id=solto.id)

        page = await svc.list_comments(task_id=task.id, params=PAGE)

    por_id = {c.id: c for c in page.items}
    # pai vira tombstone (aparece, mascarado)
    assert pai.id in por_id
    assert por_id[pai.id].is_deleted is True
    assert por_id[pai.id].content == "[comentário removido]"
    # solto (sem replica) some
    assert solto.id not in por_id


async def test_visibilidade_fora_da_lente_404(db) -> None:
    ws, r, a, b = await _tree(db)
    dono = await f.make_user(db, workspace_id=ws, email="dono@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=dono, team_id=a, role="OPERATOR")
    # task no subtime A
    task = await f.make_task(db, workspace_id=ws, created_by=dono, team_id=a)

    forasteiro = await f.make_user(db, workspace_id=ws, email="b@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=forasteiro, team_id=b, role="OPERATOR")

    # forasteiro (subtime B) nao enxerga task de A -> comentar e listar dao 404
    with acting_as(workspace_id=ws, user_id=forasteiro,
                   memberships=(mship(b, "OPERATOR"),), team_tree=_forest(r, a, b)):
        svc = CommentService(db)
        with pytest.raises(EntityNotFoundError):
            await svc.create_comment(task_id=task.id, content="intruso")
        with pytest.raises(EntityNotFoundError):
            await svc.list_comments(task_id=task.id, params=PAGE)


async def test_ve_por_created_by_comenta_mas_nao_edita_a_task(db) -> None:
    """D1: enxergar (mesmo so por created_by, ADR 0013) basta pra comentar;
    comentar nao depende de poder editar a task."""
    ws, r, a, b = await _tree(db)
    # operador do subtime B cria uma task pinada no subtime A (fora da lente
    # dele) -> ve por created_by, mas nao edita (time A nao esta no escopo).
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=op_b, team_id=a)

    with acting_as(workspace_id=ws, user_id=op_b,
                   memberships=(mship(b, "OPERATOR"),), team_tree=_forest(r, a, b)):
        # comenta (so precisa enxergar) -> ok
        c = await CommentService(db).create_comment(task_id=task.id, content="ok")
        assert c.id is not None
        # editar a TASK -> 403 (ve mas nao edita)
        with pytest.raises(AuthorizationError):
            await TaskService(db).update(
                task_id=task.id, command=UpdateTaskCommand(title="novo")
            )


async def test_cascata_soft_delete_apaga_comentarios(db) -> None:
    ws, r, a, b = await _tree(db)
    mgr = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=r, role="MANAGER")
    pai = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r)
    filha = await f.make_task(db, workspace_id=ws, created_by=mgr, team_id=r, parent=pai)

    with acting_as(workspace_id=ws, user_id=mgr,
                   memberships=(mship(r, "MANAGER"),), team_tree=_forest(r, a, b)):
        svc = CommentService(db)
        c_pai = await svc.create_comment(task_id=pai.id, content="no pai")
        c_filha = await svc.create_comment(task_id=filha.id, content="na filha")

        # deleta a task raiz (cascata: filha + comentarios das duas)
        await TaskService(db).soft_delete(task_id=pai.id)

    # comentarios das tasks da subtree ficaram com deleted_at setado (D11)
    row_pai = await db.get(Comment, c_pai.id)
    row_filha = await db.get(Comment, c_filha.id)
    assert row_pai.deleted_at is not None
    assert row_filha.deleted_at is not None


async def test_isolamento_entre_workspaces(db) -> None:
    # comentario de um workspace nao aparece/alcanca no outro
    ws_a, r_a, a_a, b_a = await _tree(db)
    mgr_a = await f.make_user(db, workspace_id=ws_a)
    await f.add_member(db, workspace_id=ws_a, user_id=mgr_a, team_id=r_a, role="MANAGER")
    task_a = await f.make_task(db, workspace_id=ws_a, created_by=mgr_a, team_id=r_a)
    with acting_as(workspace_id=ws_a, user_id=mgr_a,
                   memberships=(mship(r_a, "MANAGER"),), team_tree=_forest(r_a, a_a, b_a)):
        await CommentService(db).create_comment(task_id=task_a.id, content="do A")

    ws_b = await f.make_workspace(db, name="B")
    mgr_b = await f.make_user(db, workspace_id=ws_b, email="b@t.dev")
    r_b = await f.make_team(db, workspace_id=ws_b)
    await f.add_member(db, workspace_id=ws_b, user_id=mgr_b, team_id=r_b, role="MANAGER")

    # ator do ws_b tentando ler a task do ws_a -> 404 (nem existe pra ele)
    with acting_as(workspace_id=ws_b, user_id=mgr_b,
                   memberships=(mship(r_b, "MANAGER"),), team_tree=(node(r_b),)):
        with pytest.raises(EntityNotFoundError):
            await CommentService(db).list_comments(task_id=task_a.id, params=PAGE)
