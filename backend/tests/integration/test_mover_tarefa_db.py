"""Spec 062 -- mover tarefa e subtarefa para qualquer quadro e qualquer nivel.

O MUNDO (`_mundo`): duas areas, Marketing (subtimes SEO e Design) e Comercial,
cada uma com o seu Quadro geral; o Design tem um quadro avulso.
    `ator`: ADMIN de organizacao, quem move.
    `gi`  : OPERATOR do Design -- enxerga Design + Marketing, nunca o Comercial.

Uma decisao da spec por bloco de teste; as recusas no fim.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Board, Task
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.task_service import (
    RelocateCommand,
    TaskService,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _geral(db, team_id: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(
            select(Board.id).where(Board.team_id == team_id, Board.is_default.is_(True))
        )
    ).scalar_one()


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    design = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="design")
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    avulso = await f.make_board(db, workspace_id=ws, team_id=design, name="Artes")
    ator = await f.make_user(db, workspace_id=ws, email="ator@t.dev", org_role="ADMIN")
    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=gi, team_id=design, role="OPERATOR")
    ctx = dict(
        workspace_id=ws,
        user_id=ator,
        org_role="ADMIN",
        team_tree=(node(mkt), node(seo, mkt), node(design, mkt), node(com)),
    )
    return {
        "ws": ws, "mkt": mkt, "seo": seo, "design": design, "com": com,
        "geral_mkt": await _geral(db, mkt), "geral_com": await _geral(db, com),
        "avulso": avulso.id, "ator": ator, "gi": gi, "ctx": ctx,
    }


async def _arvore(db, m, *, board_id=None, team_id=None, project_id=None):
    """Mae > filha > neta, com a `gi` responsavel nas tres."""
    board_id = board_id or m["geral_mkt"]
    team_id = team_id or m["mkt"]
    mae = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=team_id,
        board_id=board_id, project_id=project_id, title="mae",
        status=TaskStatus.IN_PROGRESS,
    )
    filha = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=team_id,
        project_id=project_id, parent=mae, title="filha",
    )
    neta = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=team_id,
        project_id=project_id, parent=filha, title="neta",
    )
    for t in (mae, filha, neta):
        await f.make_assignment(
            db, workspace_id=m["ws"], task_id=t.id, user_id=m["gi"],
            assigned_by=m["ator"],
        )
    return mae, filha, neta


async def _recarregar(db, *tarefas: Task | uuid.UUID) -> list[Task]:
    ids = [t if isinstance(t, uuid.UUID) else t.id for t in tarefas]
    linhas = (
        await db.execute(
            select(Task).where(Task.id.in_(ids)).execution_options(populate_existing=True)
        )
    ).scalars().all()
    por_id = {t.id: t for t in linhas}
    return [por_id[i] for i in ids]


async def _mover(m, task_id, *, dry_run=False, **destino):
    with acting_as(**m["ctx"]):
        return await TaskService(m["db"]).relocate(
            task_id=task_id, command=RelocateCommand(**destino), dry_run=dry_run
        )


@pytest.fixture
async def m(db):
    mundo = await _mundo(db)
    mundo["db"] = db
    return mundo


# ------------------------------------------------ decisoes 1 e 2: tudo vai junto


async def test_principal_para_outro_quadro_leva_a_subarvore_e_o_time(db, m) -> None:
    mae, filha, neta = await _arvore(db, m)
    r = await _mover(m, mae.id, board_id=m["avulso"])

    assert r.mudou and r.subtarefas == 2
    mae, filha, neta = await _recarregar(db, mae, filha, neta)
    for t in (mae, filha, neta):
        assert t.board_id == m["avulso"]
        assert t.team_id == m["design"]
    # A coluna e a do mesmo status no quadro novo.
    coluna = (
        await db.execute(
            text("SELECT board_id FROM board_column WHERE id = :c"), {"c": mae.column_id}
        )
    ).scalar_one()
    assert coluna == m["avulso"]
    assert mae.status == TaskStatus.IN_PROGRESS
    assert filha.path == f"{mae.path}.{filha.path.split('.')[-1]}"


async def test_lente_de_subtime_no_quadro_geral(db, m) -> None:
    mae, filha, _ = await _arvore(db, m)
    await _mover(m, mae.id, board_id=m["geral_mkt"], team_id=m["seo"])
    mae, filha = await _recarregar(db, mae, filha)
    assert (mae.board_id, mae.team_id) == (m["geral_mkt"], m["seo"])
    assert filha.team_id == m["seo"]


async def test_vira_subtarefa_da_NETA_de_outro_quadro(db, m) -> None:
    """Em qualquer profundidade: a mae nova e uma neta no quadro avulso."""
    _, _, neta_destino = await _arvore(db, m, board_id=m["avulso"], team_id=m["design"])
    sozinha = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"],
        board_id=m["geral_mkt"], title="sozinha",
    )
    filha_dela = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"],
        parent=sozinha, title="filha dela",
    )
    await f.make_assignment(
        db, workspace_id=m["ws"], task_id=sozinha.id, user_id=m["gi"],
        assigned_by=m["ator"],
    )

    await _mover(m, sozinha.id, parent_task_id=neta_destino.id)

    sozinha, filha_dela = await _recarregar(db, sozinha, filha_dela)
    assert sozinha.parent_task_id == neta_destino.id
    assert sozinha.depth == 3 and filha_dela.depth == 4
    assert sozinha.path.startswith(neta_destino.path + ".")
    assert filha_dela.path.startswith(sozinha.path + ".")
    for t in (sozinha, filha_dela):
        assert (t.board_id, t.team_id) == (m["avulso"], m["design"])


async def test_subtarefa_vira_principal(db, m) -> None:
    mae, filha, neta = await _arvore(db, m)
    await _mover(m, filha.id, board_id=m["geral_mkt"])
    filha, neta = await _recarregar(db, filha, neta)
    assert filha.parent_task_id is None and filha.depth == 0
    assert neta.depth == 1 and neta.path.startswith(filha.path + ".")


# ---------------------------------------------------------- decisao 4: projeto


async def test_principal_em_outra_area_perde_o_projeto(db, m) -> None:
    proj = await f.make_project(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"]
    )
    mae, filha, _ = await _arvore(db, m, project_id=proj)
    r = await _mover(m, mae.id, board_id=m["geral_com"])
    assert r.projeto_depois is None and r.projeto_antes is not None
    mae, filha = await _recarregar(db, mae, filha)
    assert mae.project_id is None and filha.project_id is None


async def test_principal_na_mesma_area_mantem_o_projeto(db, m) -> None:
    proj = await f.make_project(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"]
    )
    mae, _, _ = await _arvore(db, m, project_id=proj)
    await _mover(m, mae.id, board_id=m["avulso"])
    (mae,) = await _recarregar(db, mae)
    assert mae.project_id == proj


async def test_subtarefa_herda_o_projeto_da_mae_nova(db, m) -> None:
    proj = await f.make_project(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"]
    )
    destino, _, _ = await _arvore(db, m, project_id=proj)
    solta, _, _ = await _arvore(db, m)
    await _mover(m, solta.id, parent_task_id=destino.id)
    (solta,) = await _recarregar(db, solta)
    assert solta.project_id == proj


# ----------------------------------------- decisoes 3 e 6: quem sai, quem assume


async def _responsaveis(db, task_id) -> set[uuid.UUID]:
    linhas = await db.execute(
        text("SELECT user_id FROM task_assignment WHERE task_id = :t"), {"t": task_id}
    )
    return set(linhas.scalars().all())


async def test_quem_nao_alcanca_sai_com_aviso_e_quem_move_assume(db, m) -> None:
    mae, filha, neta = await _arvore(db, m)
    await f.make_watcher(db, workspace_id=m["ws"], task_id=filha.id, user_id=m["gi"])

    r = await _mover(m, mae.id, board_id=m["geral_com"])

    assert [(p.user_id, p.tarefas) for p in r.saem] == [(m["gi"], 3)]
    assert r.assume == 3
    for t in (mae, filha, neta):
        assert await _responsaveis(db, t.id) == {m["ator"]}
    segue = await db.scalar(
        text("SELECT count(*) FROM task_watcher WHERE user_id = :u"), {"u": m["gi"]}
    )
    assert segue == 0
    avisos = await db.scalar(
        text("SELECT count(*) FROM notification WHERE recipient_id = :u"),
        {"u": m["gi"]},
    )
    assert avisos == 1, "UM aviso por movimentacao, nao um por tarefa"


async def test_quem_ainda_tem_outro_responsavel_nao_ganha_quem_move(db, m) -> None:
    mae, _, _ = await _arvore(db, m)
    outra = await f.make_user(db, workspace_id=m["ws"], email="outra@t.dev")
    await f.add_member(db, workspace_id=m["ws"], user_id=outra, team_id=m["com"], role="OPERATOR")
    await f.make_assignment(
        db, workspace_id=m["ws"], task_id=mae.id, user_id=outra, assigned_by=m["ator"]
    )
    r = await _mover(m, mae.id, board_id=m["geral_com"])
    assert await _responsaveis(db, mae.id) == {outra}
    assert r.assume == 2  # filha e neta, que so tinham a gi


async def test_PREVIA_conta_igual_e_nao_grava_nada(db, m) -> None:
    # Ids guardados ANTES: desfazer o savepoint expira os objetos da sessao.
    ids = [t.id for t in await _arvore(db, m)]
    previa = await _mover(m, ids[0], board_id=m["geral_com"], dry_run=True)

    assert previa.task is None
    assert [(p.user_id, p.tarefas) for p in previa.saem] == [(m["gi"], 3)]
    assert previa.assume == 3 and previa.subtarefas == 2
    mae, filha, neta = await _recarregar(db, *ids)
    for t in (mae, filha, neta):
        assert (t.board_id, t.team_id) == (m["geral_mkt"], m["mkt"])
        assert await _responsaveis(db, t.id) == {m["gi"]}
    avisos = await db.scalar(
        text("SELECT count(*) FROM notification WHERE recipient_id = :u"),
        {"u": m["gi"]},
    )
    assert avisos == 0


# ------------------------------------------------------------------- recusas


async def test_nada_mudou_e_no_op(db, m) -> None:
    mae, _, _ = await _arvore(db, m)
    r = await _mover(m, mae.id, board_id=m["geral_mkt"])
    assert not r.mudou


async def test_para_dentro_de_si_mesma_ou_das_proprias_subtarefas(db, m) -> None:
    mae, _, neta = await _arvore(db, m)
    for alvo in (mae.id, neta.id):
        with pytest.raises(ValidationError):
            await _mover(m, mae.id, parent_task_id=alvo)


async def test_tarefa_ou_mae_ARQUIVADA_e_recusada(db, m) -> None:
    mae, _, _ = await _arvore(db, m)
    outra, _, _ = await _arvore(db, m)
    outra.is_archived = True
    await db.flush()
    with pytest.raises(ValidationError):
        await _mover(m, mae.id, parent_task_id=outra.id)
    with pytest.raises(ValidationError):
        await _mover(m, outra.id, board_id=m["avulso"])


async def test_lente_que_nao_e_do_quadro_avulso_e_recusada(db, m) -> None:
    mae, _, _ = await _arvore(db, m)
    with pytest.raises(ValidationError):
        await _mover(m, mae.id, board_id=m["avulso"], team_id=m["seo"])


# -------------------------------------------------------------- pela rota


def _client(db, m, *, como: uuid.UUID | None = None) -> AsyncClient:
    """Como o `ator` (ADMIN), ou como a `gi` (OPERATOR do Design)."""
    app = create_app()
    if como is None:
        ctx = TenantContext(
            workspace_id=m["ws"], user_id=m["ator"], roles=frozenset({"ADMIN"}),
            permissions=permissions_for_actor(
                memberships=(), tree=m["ctx"]["team_tree"], org_role="ADMIN"
            ),
            team_tree=m["ctx"]["team_tree"], org_role="ADMIN",
        )
    else:
        vinculos = (Membership(team_id=m["design"], role="OPERATOR"),)
        ctx = TenantContext(
            workspace_id=m["ws"], user_id=como, roles=frozenset({"OPERATOR"}),
            permissions=permissions_for_actor(
                memberships=vinculos, tree=m["ctx"]["team_tree"], org_role=None
            ),
            memberships=vinculos, team_tree=m["ctx"]["team_tree"],
        )

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_rota_previa_e_depois_move(db, m) -> None:
    mae, _, _ = await _arvore(db, m)
    mae_id = mae.id
    # A previa nao confirma, e o UoW desfaz a transacao inteira na saida --
    # sem o commit, o mundo do teste iria junto.
    await db.commit()
    corpo = {"board_id": str(m["geral_com"])}
    async with _client(db, m) as cli:
        previa = await cli.post(
            f"/api/v1/tasks/{mae_id}/relocate", json={**corpo, "dry_run": True}
        )
        assert previa.status_code == 200, previa.text
        assert previa.json()["task"] is None
        assert previa.json()["saem"][0]["nome"]
        assert previa.json()["assume"] == 3

        feito = await cli.post(f"/api/v1/tasks/{mae_id}/relocate", json=corpo)
    assert feito.status_code == 200, feito.text
    assert feito.json()["task"]["board_id"] == str(m["geral_com"])


async def test_busca_acha_qualquer_nivel_com_o_caminho(db, m) -> None:
    mae, filha, neta = await _arvore(db, m)
    async with _client(db, m) as cli:
        r = await cli.get(f"/api/v1/boards/{m['geral_mkt']}/tasks/search?q=net")
    assert r.status_code == 200, r.text
    assert [(h["title"], h["caminho"]) for h in r.json()] == [("neta", ["mae", "filha"])]


async def test_busca_tira_a_propria_tarefa_e_as_subtarefas_dela(db, m) -> None:
    mae, filha, neta = await _arvore(db, m)
    outra = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["mkt"],
        board_id=m["geral_mkt"], title="outra",
    )
    async with _client(db, m) as cli:
        r = await cli.get(
            f"/api/v1/boards/{m['geral_mkt']}/tasks/search?exclude_task_id={filha.id}"
        )
    assert {h["title"] for h in r.json()} == {"mae", "outra"}
    assert outra.id  # usada


async def test_busca_respeita_a_lente(db, m) -> None:
    """A `gi` (OPERATOR do Design) nao ve as internas do SEO no Quadro geral."""
    await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["seo"],
        board_id=m["geral_mkt"], title="interna do seo",
    )
    await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["design"],
        board_id=m["geral_mkt"], title="interna do design",
    )
    async with _client(db, m, como=m["gi"]) as cli:
        r = await cli.get(f"/api/v1/boards/{m['geral_mkt']}/tasks/search?q=interna")
    assert [h["title"] for h in r.json()] == ["interna do design"]


async def test_busca_em_quadro_fora_da_lente_e_404(db, m) -> None:
    async with _client(db, m, como=m["gi"]) as cli:
        r = await cli.get(f"/api/v1/boards/{m['geral_com']}/tasks/search")
    assert r.status_code == 404


# ------------------------------------------------- revisao de 05/11 (antes do deploy)


async def test_quem_nao_edita_uma_FILHA_nao_move_a_mae(db, m) -> None:
    """Editar a origem vale para a subarvore: a filha do Design tambem muda de
    quadro e time, e um SUPERVISOR do SEO nao edita o Design."""
    sup = await f.make_user(db, workspace_id=m["ws"], email="sup@t.dev")
    await f.add_member(db, workspace_id=m["ws"], user_id=sup, team_id=m["seo"], role="SUPERVISOR")
    mae = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["seo"],
        board_id=m["geral_mkt"], title="mae do seo",
    )
    await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["design"],
        parent=mae, title="filha do design",
    )
    destino = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["seo"],
        board_id=m["geral_mkt"], title="destino do seo",
    )
    with acting_as(
        workspace_id=m["ws"], user_id=sup, memberships=(mship(m["seo"], "SUPERVISOR"),),
        team_tree=m["ctx"]["team_tree"],
    ):
        with pytest.raises(AuthorizationError):
            await TaskService(db).relocate(
                task_id=mae.id,
                command=RelocateCommand(parent_task_id=destino.id),
                dry_run=True,
            )


async def test_busca_nao_mostra_o_titulo_de_ancestral_fora_da_lente(db, m) -> None:
    """A filha do Design e visivel para a `gi`; a mae, do SEO, nao."""
    mae_seo = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["seo"],
        board_id=m["geral_mkt"], title="segredo do seo",
    )
    await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"], team_id=m["design"],
        parent=mae_seo, title="filha do design",
    )
    async with _client(db, m, como=m["gi"]) as cli:
        r = await cli.get(f"/api/v1/boards/{m['geral_mkt']}/tasks/search?q=filha")
    assert [(h["title"], h["caminho"]) for h in r.json()] == [("filha do design", ["…"])]


async def test_excluir_id_inexistente_nao_e_404(db, m) -> None:
    async with _client(db, m) as cli:
        r = await cli.get(
            f"/api/v1/boards/{m['geral_mkt']}/tasks/search?exclude_task_id={uuid.uuid4()}"
        )
    assert r.status_code == 200
