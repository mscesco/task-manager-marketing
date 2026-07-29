"""Spec 029 / Fatia 1 -- criar, editar e remover time VAZIO, pela ROTA.

Por que pela rota e nao pelo service: a licao da Spec 028 foi que 12 testes
de service continuaram verdes com o gate da rota revertido. Aqui o gate E o
objeto de teste (D1), entao o teste precisa atravessar o `require_permission`.

O caso que mais importa e o `test_nao_remove_time_com_tarefa_na_lixeira`:
tarefa com `deleted_at` sumiu da tela mas mantem a foreign key, e o banco
recusaria o DELETE. Se a guarda filtrar soft delete, a tela promete algo que
a transacao nao entrega.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TeamNode, TenantContext, set_tenant
from app.db.models import Team
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f

pytestmark = pytest.mark.integration


def _client(db, ctx: TenantContext) -> AsyncClient:
    """App com sessao/UoW/auth apontando para o teste."""
    app = create_app()

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


async def _mundo(db, *, papel: str = "ADMIN"):
    """Workspace com raiz + um subtime vazio, e um ator no papel pedido."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="copy")
    ator = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=ator, team_id=raiz, role=papel)
    floresta = (
        TeamNode(team_id=raiz, parent_team_id=None),
        TeamNode(team_id=sub, parent_team_id=raiz),
    )
    ctx = TenantContext(
        workspace_id=ws,
        user_id=ator,
        roles=frozenset({papel}),
        permissions=permissions_for_roles(frozenset({papel})),
        memberships=(Membership(team_id=raiz, role=papel),),
        team_tree=floresta,
    )
    return ws, raiz, sub, ator, ctx


async def _existe(db, team_id: uuid.UUID) -> bool:
    achado = await db.execute(select(Team.id).where(Team.id == team_id))
    return achado.scalar_one_or_none() is not None


# ---------------------------------------------------------------
# D1 -- quem pode o que
# ---------------------------------------------------------------
async def test_manager_cria_subtime(db) -> None:
    """D1: criar desceu de workspace.manage (ADMIN) para team.manage."""
    ws, raiz, _sub, _ator, ctx = await _mundo(db, papel="MANAGER")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/workspaces/current/teams",
            json={
                "name": "Influenciadores",
                "slug": "influenciadores",
                "parent_team_id": str(raiz),
            },
        )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Influenciadores"


async def test_manager_nao_remove(db) -> None:
    """D1: remover segue restrito a ADMIN (workspace.manage)."""
    _ws, _raiz, sub, _ator, ctx = await _mundo(db, papel="MANAGER")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 403
    assert await _existe(db, sub)


async def test_admin_remove_time_vazio(db) -> None:
    _ws, _raiz, sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 204
    assert not await _existe(db, sub)


# ---------------------------------------------------------------
# D6 -- editar mexe no nome, nunca no slug
# ---------------------------------------------------------------
async def test_manager_edita_nome_slug_nao_muda(db) -> None:
    _ws, _raiz, sub, _ator, ctx = await _mundo(db, papel="MANAGER")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/workspaces/current/teams/{sub}",
            json={"name": "Copywriting", "slug": "copywriting"},
        )
    assert resp.status_code == 200
    corpo = resp.json()
    assert corpo["name"] == "Copywriting"
    # O slug do payload e IGNORADO -- nao esta no schema de entrada.
    assert corpo["slug"] == "copy"


async def test_editar_sem_descricao_preserva_a_atual(db) -> None:
    """`description` ausente nao apaga o que ja estava la."""
    _ws, _raiz, sub, _ator, ctx = await _mundo(db, papel="MANAGER")
    await db.execute(
        text("UPDATE team SET description = 'texto antigo' WHERE id = :i"),
        {"i": sub},
    )
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/workspaces/current/teams/{sub}", json={"name": "Novo"}
        )
    assert resp.status_code == 200
    assert resp.json()["description"] == "texto antigo"


# ---------------------------------------------------------------
# D3 -- so remove time vazio. A contagem INCLUI a lixeira.
# ---------------------------------------------------------------
async def test_nao_remove_time_com_tarefa_viva(db) -> None:
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 409
    assert resp.json()["error"]["details"]["tarefas"] == 1
    assert "1 tarefa" in resp.json()["error"]["message"]
    assert await _existe(db, sub)


async def test_nao_remove_time_com_tarefa_na_lixeira(db) -> None:
    """O furo do D3: soft delete some da tela, nao do banco.

    A FK `fk_task_team` continua ativa, entao o banco recusaria o DELETE.
    Se a guarda filtrasse `deleted_at IS NULL`, a resposta seria 204 seguido
    de IntegrityError -- e nao um 409 com mensagem util.
    """
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.execute(
        text("UPDATE task SET deleted_at = now() WHERE id = :i"), {"i": task.id}
    )
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 409, (
        "tarefa na lixeira tem de bloquear igual a viva -- "
        f"veio {resp.status_code}: {resp.text[:200]}"
    )
    assert resp.json()["error"]["details"]["tarefas"] == 1
    assert await _existe(db, sub)


async def test_nao_remove_time_com_projeto(db) -> None:
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    await f.make_project(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 409
    assert resp.json()["error"]["details"]["projetos"] == 1


async def test_nao_remove_time_com_membro(db) -> None:
    """`user_team` e CASCADE -- sem esta guarda os vinculos sumiriam calados."""
    ws, _raiz, sub, _ator, ctx = await _mundo(db)
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=outro, team_id=sub, role="OPERATOR"
    )
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 409
    assert resp.json()["error"]["details"]["membros"] == 1


async def test_nao_remove_time_com_filho(db) -> None:
    ws, _raiz, sub, _ator, ctx = await _mundo(db)
    await f.make_team(db, workspace_id=ws, parent_team_id=sub, slug="neto")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
    assert resp.status_code == 409
    assert resp.json()["error"]["details"]["filhos"] == 1


# ---------------------------------------------------------------
# D5 -- a raiz e intocavel pela tela, inclusive para ADMIN
# ---------------------------------------------------------------
async def test_admin_nao_remove_raiz(db) -> None:
    """A recusa tem de vir da guarda de RAIZ, nao da de "nao vazio".

    A raiz sempre tem pelo menos um subtime e um membro, entao um 409 sozinho
    nao prova nada: se a guarda de raiz sumisse, a contagem recusaria do mesmo
    jeito e o teste seguiria verde pelo motivo errado. (Foi o que a sabotagem
    dessa guarda revelou.) Por isso conferimos a MENSAGEM.
    """
    _ws, raiz, _sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/workspaces/current/teams/{raiz}")
    assert resp.status_code == 409
    assert "time principal" in resp.json()["error"]["message"]
    assert await _existe(db, raiz)


async def test_admin_nao_edita_raiz(db) -> None:
    _ws, raiz, _sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/workspaces/current/teams/{raiz}", json={"name": "Outro"}
        )
    assert resp.status_code == 409
    assert "time principal" in resp.json()["error"]["message"]


# ---------------------------------------------------------------
# Slug volta a ficar livre depois da remocao
# ---------------------------------------------------------------
async def test_slug_liberado_apos_remocao(db) -> None:
    """Sem soft delete de time, o UNIQUE(workspace_id, slug) libera sozinho."""
    _ws, raiz, sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        apagou = await c.delete(f"/api/v1/workspaces/current/teams/{sub}")
        assert apagou.status_code == 204
        recriou = await c.post(
            "/api/v1/workspaces/current/teams",
            json={"name": "Copy", "slug": "copy", "parent_team_id": str(raiz)},
        )
    assert recriou.status_code == 201


async def test_remover_time_inexistente_404(db) -> None:
    _ws, _raiz, _sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(
            f"/api/v1/workspaces/current/teams/{uuid.uuid4()}"
        )
    assert resp.status_code == 404


# ---------------------------------------------------------------
# Contagens em lote na listagem (Spec 029 / Fatia 4)
# ---------------------------------------------------------------
async def test_listagem_traz_contagens_em_lote(db) -> None:
    """A tela precisa saber quem esta vazio sem uma query por linha."""
    ws, raiz, sub, ator, ctx = await _mundo(db)
    await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=outro, team_id=sub, role="OPERATOR"
    )
    vazio = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="vazio")
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/workspaces/current/teams")
    assert resp.status_code == 200
    por_id = {t["id"]: t for t in resp.json()["items"]}

    assert por_id[str(sub)]["tarefas"] == 1
    assert por_id[str(sub)]["membros"] == 1
    assert por_id[str(vazio)]["tarefas"] == 0
    assert por_id[str(vazio)]["membros"] == 0
    # A raiz tem dois filhos (sub + vazio) e o ator como membro.
    assert por_id[str(raiz)]["filhos"] == 2
    assert por_id[str(raiz)]["membros"] == 1


async def test_contagem_da_listagem_inclui_a_lixeira(db) -> None:
    """Mesma regra do DELETE: soft delete some da tela, nao do banco.

    Se a listagem contasse so as vivas, a tela habilitaria o botao de remover
    num time que o banco recusa -- o furo do D3, agora pelo outro lado.
    """
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.execute(
        text("UPDATE task SET deleted_at = now() WHERE id = :i"), {"i": task.id}
    )
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/workspaces/current/teams")
    por_id = {t["id"]: t for t in resp.json()["items"]}
    assert por_id[str(sub)]["tarefas"] == 1


# ===============================================================
# Fatia 3 -- esvaziar e remover (D3-B)
# ===============================================================
async def _conta(db, sql: str, **p) -> int:
    return (await db.execute(text(sql), p)).scalar_one()


async def test_esvaziar_preserva_tarefas_e_arquiva(db) -> None:
    """O criterio que separa esta spec de "apagar tarefas": o dado sobrevive."""
    ws, raiz, sub, ator, ctx = await _mundo(db)
    t = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200
    assert resp.json()["tarefas_vivas"] == 1

    linha = (
        await db.execute(
            text("SELECT team_id, is_archived FROM task WHERE id = :i"), {"i": t.id}
        )
    ).one()
    assert linha.team_id == raiz, "a tarefa tem de migrar para o time principal"
    assert linha.is_archived is True, "e sair do quadro geral (D4)"
    assert not await _existe(db, sub)


async def test_esvaziar_grava_historico_archived(db) -> None:
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    t = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.commit()
    async with _client(db, ctx) as c:
        await c.post(f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover")
    n = await _conta(
        db,
        "SELECT count(*) FROM task_history "
        "WHERE task_id = :i AND event_type = 'archived'",
        i=t.id,
    )
    assert n == 1, "o arquivamento em lote tem de deixar rastro"


async def test_esvaziar_move_tarefa_da_lixeira_sem_arquivar(db) -> None:
    """A soft-deletada precisa migrar (segura a FK), mas nao vira 'arquivada'.

    Sem a migracao, `fk_task_team` recusaria o DELETE e a transacao inteira
    cairia -- o time nunca sairia.
    """
    ws, raiz, sub, ator, ctx = await _mundo(db)
    t = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.execute(
        text("UPDATE task SET deleted_at = now() WHERE id = :i"), {"i": t.id}
    )
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200
    assert resp.json()["tarefas_na_lixeira"] == 1
    assert resp.json()["tarefas_vivas"] == 0

    linha = (
        await db.execute(
            text("SELECT team_id, is_archived FROM task WHERE id = :i"), {"i": t.id}
        )
    ).one()
    assert linha.team_id == raiz
    assert linha.is_archived is False
    n = await _conta(
        db,
        "SELECT count(*) FROM task_history "
        "WHERE task_id = :i AND event_type = 'archived'",
        i=t.id,
    )
    assert n == 0, "tarefa na lixeira nao gera evento de arquivamento"
    assert not await _existe(db, sub)


async def test_esvaziar_move_projetos(db) -> None:
    ws, raiz, sub, ator, ctx = await _mundo(db)
    p = await f.make_project(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200
    dono = (
        await db.execute(
            text("SELECT team_id FROM project WHERE id = :i"), {"i": p}
        )
    ).scalar_one()
    assert dono == raiz


async def test_esvaziar_sobe_membro_e_rebaixa_supervisor(db) -> None:
    """SUPERVISOR vira OPERATOR: `member.manage.subteam` ficaria orfao."""
    ws, raiz, sub, _ator, ctx = await _mundo(db)
    sup = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=sub, role="SUPERVISOR"
    )
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200
    papel = (
        await db.execute(
            text("SELECT role FROM user_team WHERE user_id = :u AND team_id = :t"),
            {"u": sup, "t": raiz},
        )
    ).scalar_one()
    assert str(papel) in ("UserTeamRole.OPERATOR", "OPERATOR")


async def test_membro_ja_na_raiz_so_perde_o_subtime(db) -> None:
    """Sem esta regra, criar o vinculo duplicado violaria o UNIQUE.

    Caso real medido em 29/07: a pessoa que opera a tela e MANAGER na raiz e
    OPERATOR num subtime ao mesmo tempo (a raiz nao conta na regra de "um
    subtime por pessoa").
    """
    ws, raiz, sub, ator, ctx = await _mundo(db)
    # o proprio ator tambem entra no subtime -> vinculo duplo
    await f.add_member(
        db, workspace_id=ws, user_id=ator, team_id=sub, role="OPERATOR"
    )
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200, resp.text[:300]
    n = await _conta(
        db,
        "SELECT count(*) FROM user_team WHERE user_id = :u",
        u=ator,
    )
    assert n == 1, "continua com um vinculo so -- o da raiz"
    papel = (
        await db.execute(
            text("SELECT role FROM user_team WHERE user_id = :u"), {"u": ator}
        )
    ).scalar_one()
    assert str(papel) in ("UserTeamRole.ADMIN", "ADMIN"), (
        "o papel na raiz nao pode ser rebaixado pelo esvaziamento"
    )


async def test_esvaziar_o_time_onde_o_ator_e_membro(db) -> None:
    """O caso que `move_member_subteam` reprovaria.

    Ela tem uma trava de "um membro nao pode mover a si mesmo", que dispara
    ANTES de qualquer outra checagem. Se o esvaziamento reusasse aquela
    funcao, quem esta no time nunca conseguiria remove-lo.
    """
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=ator, team_id=sub, role="OPERATOR"
    )
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 200, resp.text[:300]
    assert not await _existe(db, sub)


async def test_esvaziar_recusa_time_com_filho(db) -> None:
    ws, _raiz, sub, _ator, ctx = await _mundo(db)
    await f.make_team(db, workspace_id=ws, parent_team_id=sub, slug="neto")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 409
    assert await _existe(db, sub)


async def test_esvaziar_recusa_a_raiz(db) -> None:
    _ws, raiz, _sub, _ator, ctx = await _mundo(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{raiz}/esvaziar-e-remover"
        )
    assert resp.status_code == 409
    assert "time principal" in resp.json()["error"]["message"]


async def test_manager_nao_esvazia(db) -> None:
    """Mesmo gate do DELETE simples: e a mesma acao destrutiva (D1)."""
    _ws, _raiz, sub, _ator, ctx = await _mundo(db, papel="MANAGER")
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/workspaces/current/teams/{sub}/esvaziar-e-remover"
        )
    assert resp.status_code == 403
    assert await _existe(db, sub)


async def test_previa_conta_vivas_e_lixeira_separadas(db) -> None:
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    morta = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    await db.execute(
        text("UPDATE task SET deleted_at = now() WHERE id = :i"), {"i": morta.id}
    )
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=outro, team_id=sub, role="OPERATOR"
    )
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.get(
            f"/api/v1/workspaces/current/teams/{sub}/previa-remocao"
        )
    assert resp.status_code == 200
    corpo = resp.json()
    assert corpo["tarefas_vivas"] == 1
    assert corpo["tarefas_na_lixeira"] == 1
    assert corpo["membros"] == 1
    assert await _existe(db, sub), "previa e somente leitura"


async def test_falha_no_meio_nao_deixa_time_semi_esvaziado(db) -> None:
    """Atomicidade: erro depois de arquivar nao pode deixar rastro.

    Simulamos o pior caso -- a operacao chega ao fim e o commit falha. Sem
    transacao unica, as tarefas ficariam arquivadas e o time continuaria de
    pe, um estado que ninguem sabe consertar pela tela.
    """
    ws, _raiz, sub, ator, ctx = await _mundo(db)
    t = await f.make_task(db, workspace_id=ws, created_by=ator, team_id=sub)
    # O id ANTES do rollback: `session.rollback()` expira os objetos ORM, e ler
    # `t.id` depois dispara um refresh preguicoso -> MissingGreenlet. Armadilha
    # conhecida do projeto; este teste esbarrou nela de primeira.
    task_id = t.id
    await db.commit()

    from app.core.tenant import set_tenant
    from app.db.unit_of_work import UnitOfWork
    from app.modules.workspaces.application.workspace_service import TeamService

    set_tenant(ctx)
    with pytest.raises(RuntimeError):
        async with UnitOfWork(db) as uow:
            await TeamService(uow.session).esvaziar_e_remover(team_id=sub)
            raise RuntimeError("falha simulada antes do commit")

    # Sem commit, o UoW faz rollback: nada aplicado.
    linha = (
        await db.execute(
            text("SELECT is_archived, team_id FROM task WHERE id = :i"),
            {"i": task_id},
        )
    ).one()
    assert linha.is_archived is False, "a tarefa nao pode ficar arquivada"
    assert linha.team_id == sub, "nem ter mudado de time"
    assert await _existe(db, sub), "e o time continua de pe"
