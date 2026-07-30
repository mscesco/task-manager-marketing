"""Spec 030 Fatia 2 -- revogacao de sessao, contra Postgres real, PELA ROTA.

POR QUE PELA ROTA, E NAO PELO SERVICE:
    A licao da Spec 028 foi que 12 testes de service ficaram verdes com o gate
    da rota revertido. Aqui e pior: a revogacao vive em TRES pontos
    independentes (ver abaixo), e nenhum deles esta no service que a suite de
    service exercitaria.

POR QUE ESTE ARQUIVO NAO USA O `_client` DE test_http_status_db.py:
    Aquele harness sobrescreve `get_tenant_context` por um contexto fixo --
    exatamente a dependency que precisa ser exercida aqui. Este arquivo
    sobrescreve SO a sessao e a UoW, e manda `Authorization: Bearer <token>`
    de verdade, para o token atravessar o caminho real.

OS TRES PONTOS DE CHECAGEM (e por que sao tres, nao dois):
    1. `get_tenant_context`      -- toda rota de negocio
    2. `get_user_allowing_pending` -- /auth/me, /auth/change-password, /auth/logout
    3. `AuthService.refresh`     -- nao passa por dependency nenhuma
    Um teste que passe com qualquer um dos tres removido nao esta provando o
    que parece. Ha uma sabotagem para cada.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.db.models import User, Workspace
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.infrastructure.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

_SENHA = "senha-de-teste-1"
_NOVA = "senha-de-teste-2"


@pytest.fixture(autouse=True)
def _zera_limitadores():
    """Esvazia os baldes de rate limit entre os testes deste arquivo.

    Necessario porque `login_limiter` e `refresh_limiter` sao singletons de
    MODULO: vivem no processo, nao na app. Como todo teste sai do mesmo
    "IP", o 11o login da sessao inteira levava 429 e derrubava testes que
    nada tem a ver com rate limit.

    ⚠️ Isto e a prova, em ambiente controlado, do que o docstring de
    `app/core/rate_limit.py` descreve: o balde e por PROCESSO. Com
    `--workers 2` em producao existem dois baldes independentes e o limite
    efetivo e ate 2x o configurado.
    """
    from app.core.rate_limit import login_limiter, refresh_limiter

    login_limiter._hits.clear()
    refresh_limiter._hits.clear()
    yield
    login_limiter._hits.clear()
    refresh_limiter._hits.clear()


def _client(db) -> AsyncClient:
    """App real, so com sessao/UoW apontando para o teste.

    ⚠️ NAO sobrescreve `get_tenant_context`: e ele que se quer testar.
    """
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _pessoa(db, *, pendente: bool = False):
    """Workspace + time + usuario com senha real, pronto para logar."""
    ws_id = await f.make_workspace(db)
    ws = await db.get(Workspace, ws_id)
    team = await f.make_team(db, workspace_id=ws_id)
    uid = await f.make_user(db, workspace_id=ws_id)
    user = await db.get(User, uid)
    user.password_hash = hash_password(_SENHA)
    user.must_change_password = pendente
    await f.add_member(
        db, workspace_id=ws_id, user_id=uid, team_id=team, role="MANAGER"
    )
    await db.flush()
    return ws, team, user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(c: AsyncClient, ws: Workspace, user: User) -> dict:
    r = await c.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": _SENHA,
            "workspace_slug": ws.slug,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------
# 1-2. Troca de senha derruba as outras sessoes
# ------------------------------------------------------------------
async def test_troca_de_senha_derruba_outra_sessao(db) -> None:
    """Criterio 1: dois browsers, troca num, o outro cai no proximo clique."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        sessao_a = await _login(c, ws, user)
        sessao_b = await _login(c, ws, user)

        # A sessao B funciona antes da troca.
        antes = await c.get("/api/v1/auth/me", headers=_auth(sessao_b["access_token"]))
        assert antes.status_code == 200

        # A pessoa troca a senha na sessao A.
        troca = await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(sessao_a["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )
        assert troca.status_code == 200, troca.text

        # A sessao B morreu -- e a mensagem diz POR QUE (licao da Spec 029:
        # conferir a mensagem, nao so o status; 401 tambem e "usuario inativo").
        depois = await c.get("/api/v1/auth/me", headers=_auth(sessao_b["access_token"]))
        assert depois.status_code == 401
        assert "revogada" in depois.text.lower()


async def test_troca_de_senha_invalida_refresh_antigo(db) -> None:
    """Criterio 2: o refresh guardado antes da troca para de renovar.

    Este e o buraco central da Spec 030: sem a checagem em AuthService.refresh,
    o refresh sobrevive a troca de senha e renova a sessao para sempre.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        sessao = await _login(c, ws, user)

        ok = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert ok.status_code == 200

        await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(ok.json()["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )

        morto = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert morto.status_code == 401
        assert "revogada" in morto.text.lower()


async def test_par_emitido_no_change_password_ja_vale(db) -> None:
    """Criterio 9: quem troca a senha nao se desloga por acidente.

    Loga de novo com a senha nova e o par novo tem de funcionar de primeira.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        sessao = await _login(c, ws, user)
        await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(sessao["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )
        novo = await c.post(
            "/api/v1/auth/login",
            json={
                "email": user.email,
                "password": _NOVA,
                "workspace_slug": ws.slug,
            },
        )
        assert novo.status_code == 200, novo.text
        me = await c.get(
            "/api/v1/auth/me", headers=_auth(novo.json()["access_token"])
        )
        assert me.status_code == 200


# ------------------------------------------------------------------
# 3-4. Reset pelo gestor
# ------------------------------------------------------------------
async def test_reset_pelo_gestor_derruba_sessao_do_alvo(db) -> None:
    """Criterio 3: e a acao de resposta a 'a conta de fulano vazou'."""
    from app.core.tenant import Membership, TeamNode
    from app.modules.users.application.member_service import MemberService
    from tests.integration.conftest import acting_as

    ws, team, alvo = await _pessoa(db)
    gestor = await f.make_user(db, workspace_id=ws.id)
    await f.add_member(
        db, workspace_id=ws.id, user_id=gestor, team_id=team, role="ADMIN"
    )
    await db.commit()

    async with _client(db) as c:
        sessao = await _login(c, ws, alvo)
        assert (
            await c.get("/api/v1/auth/me", headers=_auth(sessao["access_token"]))
        ).status_code == 200

        with acting_as(
            workspace_id=ws.id,
            user_id=gestor,
            memberships=(Membership(team_id=team, role="ADMIN"),),
            team_tree=(TeamNode(team_id=team, parent_team_id=None),),
        ):
            await MemberService(db).reset_password(user_id=alvo.id)
        await db.commit()

        morta = await c.get(
            "/api/v1/auth/me", headers=_auth(sessao["access_token"])
        )
        assert morta.status_code == 401
        assert "revogada" in morta.text.lower()


async def test_reset_pelo_gestor_nao_derruba_terceiros(db) -> None:
    """Criterio 3 (a outra metade): o incremento e por pessoa, nao global."""
    from app.core.tenant import Membership, TeamNode
    from app.modules.users.application.member_service import MemberService
    from tests.integration.conftest import acting_as

    ws, team, alvo = await _pessoa(db)
    outro_id = await f.make_user(db, workspace_id=ws.id)
    outro = await db.get(User, outro_id)
    outro.password_hash = hash_password(_SENHA)
    await f.add_member(
        db, workspace_id=ws.id, user_id=outro_id, team_id=team, role="MANAGER"
    )
    await db.commit()

    async with _client(db) as c:
        sessao_outro = await _login(c, ws, outro)

        with acting_as(
            workspace_id=ws.id,
            user_id=outro_id,
            memberships=(Membership(team_id=team, role="MANAGER"),),
            team_tree=(TeamNode(team_id=team, parent_team_id=None),),
        ):
            await MemberService(db).reset_password(user_id=alvo.id)
        await db.commit()

        viva = await c.get(
            "/api/v1/auth/me", headers=_auth(sessao_outro["access_token"])
        )
        assert viva.status_code == 200


# ------------------------------------------------------------------
# 5-6. Logout
# ------------------------------------------------------------------
async def test_logout_invalida_refresh(db) -> None:
    """Criterio 4: hoje 'Sair' e so clearTokens() no browser -- nao mais."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        sessao = await _login(c, ws, user)

        saiu = await c.post(
            "/api/v1/auth/logout", headers=_auth(sessao["access_token"])
        )
        assert saiu.status_code == 204

        morto = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert morto.status_code == 401

        # O access da mesma sessao tambem morre.
        me = await c.get("/api/v1/auth/me", headers=_auth(sessao["access_token"]))
        assert me.status_code == 401


async def test_logout_derruba_todos_os_aparelhos(db) -> None:
    """D4: sair no notebook mata a sessao esquecida na maquina compartilhada.

    E o comportamento escolhido, nao um efeito colateral -- se algum dia
    alguem trocar isto por denylist de `jti`, este teste fica vermelho e
    obriga a reabrir a D4.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        compartilhada = await _login(c, ws, user)
        notebook = await _login(c, ws, user)

        await c.post("/api/v1/auth/logout", headers=_auth(notebook["access_token"]))

        esquecida = await c.get(
            "/api/v1/auth/me", headers=_auth(compartilhada["access_token"])
        )
        assert esquecida.status_code == 401


async def test_logout_de_um_nao_afeta_outro_usuario(db) -> None:
    """Criterio 5."""
    ws, team, user = await _pessoa(db)
    outro_id = await f.make_user(db, workspace_id=ws.id)
    outro = await db.get(User, outro_id)
    outro.password_hash = hash_password(_SENHA)
    await f.add_member(
        db, workspace_id=ws.id, user_id=outro_id, team_id=team, role="MANAGER"
    )
    await db.commit()

    async with _client(db) as c:
        s_user = await _login(c, ws, user)
        s_outro = await _login(c, ws, outro)

        await c.post("/api/v1/auth/logout", headers=_auth(s_user["access_token"]))

        viva = await c.get("/api/v1/auth/me", headers=_auth(s_outro["access_token"]))
        assert viva.status_code == 200


async def test_logout_funciona_com_troca_de_senha_pendente(db) -> None:
    """Criterio 8: quem esta preso no gate precisa conseguir sair.

    Se o logout usasse a dependency estrita, a pessoa com senha provisoria
    pendente levaria 409 e ficaria sem saida.
    """
    ws, _team, user = await _pessoa(db, pendente=True)
    await db.commit()
    async with _client(db) as c:
        sessao = await _login(c, ws, user)
        # Confirma que o gate esta mesmo ativo nesta sessao.
        bloqueada = await c.get(
            "/api/v1/tasks", headers=_auth(sessao["access_token"])
        )
        assert bloqueada.status_code == 409

        saiu = await c.post(
            "/api/v1/auth/logout", headers=_auth(sessao["access_token"])
        )
        assert saiu.status_code == 204


# ------------------------------------------------------------------
# 7. O teste que protege o dia do deploy
# ------------------------------------------------------------------
async def test_token_sem_claim_tv_continua_valido(db) -> None:
    """Criterio 6 -- O TESTE MAIS IMPORTANTE DESTE ARQUIVO.

    Todo token emitido ANTES do deploy da Spec 030 nao tem o claim `tv`. As
    24 contas ativas estao logadas neste momento (medido em 30/07). Se o
    claim ausente for tratado como invalido em vez de 0, o `alembic upgrade`
    desloga o workspace inteiro de uma vez.

    Forja um token no formato ANTIGO -- sem `tv` -- e exige 200.
    """
    import jwt
    from datetime import UTC, datetime, timedelta

    from app.core.config import settings

    ws, _team, user = await _pessoa(db)
    await db.commit()

    agora = datetime.now(UTC)
    token_antigo = jwt.encode(
        {
            "sub": str(user.id),
            "ws": str(ws.id),
            "type": "access",
            "iat": agora,
            "exp": agora + timedelta(minutes=15),
            "jti": str(uuid.uuid4()),
            # SEM "tv" -- de proposito.
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    async with _client(db) as c:
        r = await c.get("/api/v1/auth/me", headers=_auth(token_antigo))
        assert r.status_code == 200, (
            "Token no formato antigo (sem claim `tv`) foi recusado. "
            "Isto deslogaria as 24 contas no instante do deploy."
        )


async def test_token_com_tv_defasado_e_recusado(db) -> None:
    """A outra ponta do criterio 6: `tv` presente e ANTIGO tem de morrer.

    Sem este teste, um `token_version_of` que devolvesse 0 sempre passaria no
    teste acima e deixaria a revogacao inteira sem efeito.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()

    user.token_version = 5
    await db.flush()
    await db.commit()

    defasado = create_access_token(
        user_id=user.id, workspace_id=ws.id, token_version=4
    )
    async with _client(db) as c:
        r = await c.get("/api/v1/auth/me", headers=_auth(defasado))
        assert r.status_code == 401
        assert "revogada" in r.text.lower()


async def test_rota_de_negocio_recusa_token_revogado(db) -> None:
    """Fecha o ponto 1 (`get_tenant_context`) de forma isolada.

    ⚠️ ESTE TESTE EXISTE POR CAUSA DE UMA SABOTAGEM. Todos os outros deste
    arquivo batem em `/auth/me`, que usa a dependency LENIENTE
    (`get_user_allowing_pending`). Sabotar `get_tenant_context` deixava a
    suite inteira verde -- ou seja, o caminho por onde passa TODA rota de
    negocio estava sem cobertura. Este bate numa rota de negocio de verdade.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        sessao = await _login(c, ws, user)
        viva = await c.get("/api/v1/tasks", headers=_auth(sessao["access_token"]))
        assert viva.status_code == 200

        await c.post("/api/v1/auth/logout", headers=_auth(sessao["access_token"]))

        morta = await c.get("/api/v1/tasks", headers=_auth(sessao["access_token"]))
        assert morta.status_code == 401
        assert "revogada" in morta.text.lower()


async def test_refresh_com_tv_defasado_e_recusado(db) -> None:
    """Fecha o ponto 3 (AuthService.refresh) de forma isolada.

    Existe separado do teste de troca de senha porque, la, a checagem da
    dependency poderia mascarar a ausencia desta.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()

    user.token_version = 3
    await db.flush()
    await db.commit()

    defasado = create_refresh_token(
        user_id=user.id, workspace_id=ws.id, token_version=2
    )
    async with _client(db) as c:
        r = await c.post(
            "/api/v1/auth/refresh", json={"refresh_token": defasado}
        )
        assert r.status_code == 401
        assert "revogada" in r.text.lower()
