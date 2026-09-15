"""Spec 050, fatia A -- reacoes no comentario, pelo servico e pela rota.

O que este arquivo prova, em ordem de importancia:

    1. UMA reacao por pessoa por comentario -- dois PUTs terminam numa linha
    2. o banco diz se a reacao NASCEU (a fatia B notifica so nesse caso)
    3. quem nao ve a tarefa leva 404 -- inclusive mandando lixo (404 antes de 422)
    4. comentario apagado esconde as reacoes, e desmarca-lo as traz de volta
       (as reacoes seguem a marca do comentario, spec §4.6)
    5. `❤` e `❤️` sao a mesma pilula
    6. a ROTA existe: PUT e DELETE devolvem a fileira

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Comment, CommentReaction
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.application.task_service import TaskService
from app.modules.tasks.infrastructure.comment_reaction_repository import (
    CommentReactionRepository,
)
from app.shared.exceptions.base import EntityNotFoundError, ValidationError
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration

PAGE = PageParams(page=1, size=50)


async def _mundo(db) -> dict:
    """Raiz R com subtimes A e B; a tarefa e o comentario moram em A.

    ⚠️ A TAREFA ESTA NO SUBTIME, e nao na raiz: operador de subtime alcanca o
    proprio time E a raiz. Com a tarefa na raiz, o `forasteiro` de B a veria e
    o teste de 404 nao testaria nada.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    arvore = (node(r), node(a, r), node(b, r))

    pessoas: dict[str, tuple] = {}
    for nome, time, papel in (
        ("autora", r, "MANAGER"),
        ("ana", a, "OPERATOR"),
        ("bruno", a, "OPERATOR"),
        ("forasteiro", b, "OPERATOR"),
    ):
        uid = await f.make_user(db, workspace_id=ws, email=f"{nome}@t.dev")
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=time, role=papel)
        pessoas[nome] = (uid, (Membership(team_id=time, role=papel),))

    task = await f.make_task(
        db, workspace_id=ws, created_by=pessoas["autora"][0], team_id=a
    )
    # ⚠️ IDS, e nao o objeto `Task`. Um rollback da UoW (o 422 pela rota) ou um
    # `expire_all()` expira o objeto, e ler `task.id` depois dispara um lazy
    # load fora do async -- `MissingGreenlet`. A primeira rodada caiu nisso.
    m = {
        "ws": ws, "arvore": arvore, "pessoas": pessoas,
        "task_id": task.id, "team_a": a,
    }
    with _como(m, "autora"):
        comentario = await CommentService(db).create_comment(
            task_id=task.id, content="o que acham?"
        )
    m["comentario"] = comentario.id
    return m


def _id(m: dict, quem: str):
    return m["pessoas"][quem][0]


def _como(m: dict, quem: str):
    user_id, vinculos = m["pessoas"][quem]
    return acting_as(
        workspace_id=m["ws"],
        user_id=user_id,
        memberships=vinculos,
        team_tree=m["arvore"],
    )


def _fileira(dto) -> dict:
    """{emoji: [user_id, ...]} -- para comparar sem depender de desempate."""
    return {r.emoji: list(r.user_ids) for r in dto.reactions}


async def _linhas(db, comment_id) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(CommentReaction)
        .where(CommentReaction.comment_id == comment_id)
    )


# ------------------------------------------------------------- 1 e 5


async def test_reagir_de_novo_troca_e_nao_soma(db) -> None:
    """⭐ Uma por pessoa: a segunda reacao da ana TROCA a primeira."""
    m = await _mundo(db)
    cid = m["comentario"]
    with _como(m, "ana"):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="👍"
        )
    with _como(m, "bruno"):
        # ⚠️ `❤` SEM o U+FE0F: o servidor grava a forma completa.
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="❤"
        )
    with _como(m, "ana"):
        dto = await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="❤️"
        )

    fileira = _fileira(dto)
    assert set(fileira) == {"❤️"}, "o 👍 da ana devia ter sido trocado"
    assert set(fileira["❤️"]) == {_id(m, "ana"), _id(m, "bruno")}
    assert await _linhas(db, cid) == 2


async def test_a_listagem_traz_a_fileira(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        svc = CommentService(db)
        await svc.set_reaction(
            task_id=m["task_id"], comment_id=m["comentario"], emoji="🎉"
        )
        page = await svc.list_comments(task_id=m["task_id"], params=PAGE)

    (unico,) = page.items
    assert _fileira(unico) == {"🎉": [_id(m, "ana")]}


async def test_a_ordem_da_fileira_segue_quem_chegou_primeiro(db) -> None:
    """A pilula nao pula de lugar -- e trocar conta como chegada nova.

    `now()` e o instante da TRANSACAO, entao no teste todas as reacoes empatam;
    carimbamos instantes crescentes para refletir requisicoes separadas.
    """
    m = await _mundo(db)
    cid = m["comentario"]
    base = datetime(2026, 1, 1, tzinfo=UTC)

    async def carimba(quem: str, segundos: int) -> None:
        await db.execute(
            update(CommentReaction)
            .where(
                CommentReaction.comment_id == cid,
                CommentReaction.user_id == _id(m, quem),
            )
            .values(updated_at=base + timedelta(seconds=segundos))
            .execution_options(synchronize_session=False)
        )

    for quem, emoji, instante in (("ana", "👍", 0), ("bruno", "❤️", 1)):
        with _como(m, quem):
            await CommentService(db).set_reaction(
                task_id=m["task_id"], comment_id=cid, emoji=emoji
            )
        await carimba(quem, instante)

    # A ana troca 👍 por 🎉 DEPOIS do bruno: o 🎉 entra a direita do ❤️.
    with _como(m, "ana"):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="🎉"
        )
    await carimba("ana", 2)

    with _como(m, "ana"):
        page = await CommentService(db).list_comments(
            task_id=m["task_id"], params=PAGE
        )
    assert [r.emoji for r in page.items[0].reactions] == ["❤️", "🎉"]


# ------------------------------------------------------------- 2


async def test_o_banco_diz_se_a_reacao_nasceu(db) -> None:
    """A fatia B notifica SO quando nasce. Trocar nao nasce; tirar e por, sim."""
    m = await _mundo(db)
    cid, ana = m["comentario"], _id(m, "ana")
    with _como(m, "ana"):
        repo = CommentReactionRepository(db)
        assert await repo.upsert(comment_id=cid, user_id=ana, emoji="👍") is True
        # mesmo emoji: nada muda, nada nasce
        assert await repo.upsert(comment_id=cid, user_id=ana, emoji="👍") is False
        # troca: a linha e a mesma
        assert await repo.upsert(comment_id=cid, user_id=ana, emoji="❤️") is False
        assert await _linhas(db, cid) == 1
        # tirar e por de novo: nasce outra vez (o banco nao lembra)
        assert await repo.remove(comment_id=cid, user_id=ana) is True
        assert await repo.upsert(comment_id=cid, user_id=ana, emoji="👍") is True


# ------------------------------------------------------------- 3


async def test_quem_nao_ve_a_tarefa_leva_404(db) -> None:
    m = await _mundo(db)
    with _como(m, "forasteiro"):
        svc = CommentService(db)
        with pytest.raises(EntityNotFoundError):
            await svc.set_reaction(
                task_id=m["task_id"], comment_id=m["comentario"], emoji="👍"
            )
        with pytest.raises(EntityNotFoundError):
            await svc.remove_reaction(
                task_id=m["task_id"], comment_id=m["comentario"]
            )
        # ⚠️ 404 ANTES de 422: mandando lixo, ele nao descobre que o
        # comentario existe.
        with pytest.raises(EntityNotFoundError):
            await svc.set_reaction(
                task_id=m["task_id"], comment_id=m["comentario"], emoji="a"
            )


async def test_comentario_de_outra_tarefa_leva_404(db) -> None:
    m = await _mundo(db)
    outra = await f.make_task(
        db, workspace_id=m["ws"], created_by=_id(m, "autora"),
        team_id=m["team_a"],
    )
    with _como(m, "ana"):
        with pytest.raises(EntityNotFoundError):
            await CommentService(db).set_reaction(
                task_id=outra.id, comment_id=m["comentario"], emoji="👍"
            )


async def test_o_que_nao_e_um_emoji_leva_422(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        svc = CommentService(db)
        for ruim in ("a", "👍👍", " 👍"):
            with pytest.raises(ValidationError):
                await svc.set_reaction(
                    task_id=m["task_id"], comment_id=m["comentario"], emoji=ruim
                )
    assert await _linhas(db, m["comentario"]) == 0


# ------------------------------------------------------------- 4


async def test_comentario_apagado_esconde_e_desmarcado_traz_de_volta(db) -> None:
    """⭐ "Apagar igual o comentario" (decisao dela): as reacoes seguem a marca.

    ⚠️ A REPLICA E NECESSARIA: comentario apagado sem replica viva nem aparece
    na listagem (D5 da 019), e o teste nao teria fileira para olhar.
    """
    m = await _mundo(db)
    cid = m["comentario"]
    with _como(m, "ana"):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="👍"
        )
    with _como(m, "bruno"):
        await CommentService(db).create_comment(
            task_id=m["task_id"], content="concordo", parent_comment_id=cid
        )
    with _como(m, "autora"):
        svc = CommentService(db)
        await svc.delete_comment(task_id=m["task_id"], comment_id=cid)
        page = await svc.list_comments(task_id=m["task_id"], params=PAGE)
        pai = next(c for c in page.items if c.id == cid)
        assert pai.is_deleted is True
        assert pai.reactions == ()
        # e nao se reage em comentario apagado
        with pytest.raises(EntityNotFoundError):
            await svc.set_reaction(task_id=m["task_id"], comment_id=cid, emoji="❤️")

    # A linha CONTINUA no banco -- e o que o `restaurar_quadro.sql` precisa.
    assert await _linhas(db, cid) == 1

    # O script desmarca o comentario; a reacao volta junto.
    await db.execute(
        update(Comment)
        .where(Comment.id == cid)
        .values(deleted_at=None)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()
    with _como(m, "autora"):
        page = await CommentService(db).list_comments(
            task_id=m["task_id"], params=PAGE
        )
    pai = next(c for c in page.items if c.id == cid)
    assert _fileira(pai) == {"👍": [_id(m, "ana")]}


async def test_apagar_a_tarefa_nao_apaga_as_reacoes(db) -> None:
    """O SQL cru da cascata de tarefa (ADR 0005) nao passa pelo servico.

    ⚠️ E exatamente por isso que a reacao nao tem marca propria: este caminho
    teria de ser lembrado. Aqui ele nao precisa saber que reacao existe.
    """
    m = await _mundo(db)
    cid = m["comentario"]
    with _como(m, "ana"):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=cid, emoji="👍"
        )
    with _como(m, "autora"):
        await TaskService(db).soft_delete(task_id=m["task_id"])

    db.expire_all()
    assert (await db.get(Comment, cid)).deleted_at is not None
    assert await _linhas(db, cid) == 1


async def test_editar_o_comentario_mantem_as_reacoes(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await CommentService(db).set_reaction(
            task_id=m["task_id"], comment_id=m["comentario"], emoji="👍"
        )
    with _como(m, "autora"):
        dto = await CommentService(db).edit_comment(
            task_id=m["task_id"], comment_id=m["comentario"], content="editado"
        )
    assert _fileira(dto) == {"👍": [_id(m, "ana")]}


async def test_tirar_reacao_que_nao_existe_nao_e_erro(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        dto = await CommentService(db).remove_reaction(
            task_id=m["task_id"], comment_id=m["comentario"]
        )
    assert dto.reactions == ()


# ------------------------------------------------------------- 6 (a rota)


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _contexto(m: dict, quem: str) -> TenantContext:
    """Como `get_tenant_context` monta -- permissoes COM escopo."""
    user_id, vinculos = m["pessoas"][quem]
    return TenantContext(
        workspace_id=m["ws"],
        user_id=user_id,
        roles=frozenset(v.role for v in vinculos),
        permissions=permissions_for_actor(memberships=vinculos, tree=m["arvore"]),
        memberships=vinculos,
        team_tree=m["arvore"],
    )


def _url(m: dict) -> str:
    return f"/api/v1/tasks/{m['task_id']}/comments/{m['comentario']}/reaction"


async def test_http_por_e_tirar_devolvem_a_fileira(db) -> None:
    m = await _mundo(db)
    await db.commit()
    async with _client(db, _contexto(m, "ana")) as cli:
        pos = await cli.put(_url(m), json={"emoji": "❤"})
        tirou = await cli.delete(_url(m))
        tirou_de_novo = await cli.delete(_url(m))

    assert pos.status_code == 200, pos.text
    assert pos.json()["reactions"] == [
        {"emoji": "❤️", "user_ids": [str(_id(m, "ana"))]}
    ]
    assert tirou.status_code == 200, tirou.text
    assert tirou.json()["reactions"] == []
    # duplo clique no "tirar" nao vira erro
    assert tirou_de_novo.status_code == 200, tirou_de_novo.text


async def test_http_422_e_404(db) -> None:
    m = await _mundo(db)
    await db.commit()
    async with _client(db, _contexto(m, "ana")) as cli:
        lixo = await cli.put(_url(m), json={"emoji": "oi"})
    async with _client(db, _contexto(m, "forasteiro")) as cli:
        de_fora = await cli.put(_url(m), json={"emoji": "👍"})

    assert lixo.status_code == 422, lixo.text
    assert de_fora.status_code == 404, de_fora.text


async def test_http_a_listagem_traz_reactions(db) -> None:
    """O campo novo existe no contrato da listagem, e nao so no PUT."""
    m = await _mundo(db)
    await db.commit()
    async with _client(db, _contexto(m, "ana")) as cli:
        await cli.put(_url(m), json={"emoji": "👍"})
        lista = await cli.get(f"/api/v1/tasks/{m['task_id']}/comments")

    assert lista.status_code == 200, lista.text
    assert lista.json()["items"][0]["reactions"] == [
        {"emoji": "👍", "user_ids": [str(_id(m, "ana"))]}
    ]
