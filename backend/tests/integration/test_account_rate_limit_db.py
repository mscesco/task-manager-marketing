"""Spec 030 Fatia 3 -- freio por CONTA no login, PELA ROTA.

Os unitarios de `tests/test_rate_limit.py` provam que o trio
check/record/reset funciona. Eles NAO provam que o login o usa: a Spec 028
ensinou que 12 testes de service ficam verdes com o gate da rota revertido.
Este arquivo bate em `/api/v1/auth/login` de verdade.

O TESTE QUE JUSTIFICA A FATIA INTEIRA e
`test_bloqueia_mesmo_com_ips_diferentes`: e a unica coisa aqui que o balde
por IP, que ja existia, nao consegue fazer.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.rate_limit import (
    account_key,
    account_login_limiter,
    change_password_limiter,
    login_limiter,
)
from app.db.models import User, Workspace
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.infrastructure.security import hash_password
from tests.integration import factories as f

pytestmark = pytest.mark.integration

_SENHA = "senha-de-teste-1"
_ERRADA = "senha-errada-nao-e-essa"

#: Teto reduzido so nos testes. O valor real (10) faria cada teste gastar 11
#: bcrypt -- o equalizador de tempo roda em TODA recusa, de proposito -- e
#: somaria ~20s a suite sem provar nada a mais. A regra exercitada e a mesma.
_TETO_DE_TESTE = 3


@pytest.fixture(autouse=True)
def _baldes_limpos():
    teto_real = account_login_limiter._max
    account_login_limiter._max = _TETO_DE_TESTE
    change_password_limiter._max = _TETO_DE_TESTE
    for lim in (account_login_limiter, login_limiter, change_password_limiter):
        lim._hits.clear()
    yield
    account_login_limiter._max = teto_real
    change_password_limiter._max = teto_real
    for lim in (account_login_limiter, login_limiter, change_password_limiter):
        lim._hits.clear()


def _client(db) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _pessoa(db):
    ws_id = await f.make_workspace(db)
    ws = await db.get(Workspace, ws_id)
    team = await f.make_team(db, workspace_id=ws_id)
    uid = await f.make_user(db, workspace_id=ws_id)
    user = await db.get(User, uid)
    user.password_hash = hash_password(_SENHA)
    await f.add_member(
        db, workspace_id=ws_id, user_id=uid, team_id=team, role="MANAGER"
    )
    await db.flush()
    return ws, user


def _corpo(ws: Workspace, email: str, senha: str) -> dict:
    return {"email": email, "password": senha, "workspace_slug": ws.slug}


async def test_bloqueia_apos_o_teto_de_falhas(db) -> None:
    """Criterio 8."""
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        for _ in range(_TETO_DE_TESTE):
            r = await c.post(
                "/api/v1/auth/login", json=_corpo(ws, user.email, _ERRADA)
            )
            assert r.status_code == 401

        # A proxima e barrada pelo balde -- e a senha CERTA nao passa mais.
        bloqueada = await c.post(
            "/api/v1/auth/login", json=_corpo(ws, user.email, _SENHA)
        )
        assert bloqueada.status_code == 401


async def test_bloqueia_mesmo_com_ips_diferentes(db) -> None:
    """Criterio 8, a parte que importa -- e a razao de existir desta fatia.

    Cada tentativa sai de um IP distinto, entao o balde por IP (10/60s) nunca
    enche. So o balde por conta ve o padrao. Se este teste ficar verde com o
    freio por conta removido, e porque o teto de teste virou maior que o teto
    por IP -- conferir antes de acreditar.
    """
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        for i in range(_TETO_DE_TESTE):
            r = await c.post(
                "/api/v1/auth/login",
                json=_corpo(ws, user.email, _ERRADA),
                headers={"X-Forwarded-For": f"203.0.113.{i}"},
            )
            assert r.status_code == 401

        bloqueada = await c.post(
            "/api/v1/auth/login",
            json=_corpo(ws, user.email, _SENHA),
            headers={"X-Forwarded-For": "203.0.113.250"},
        )
        assert bloqueada.status_code == 401


async def test_acerto_zera_o_balde(db) -> None:
    """Criterio 9: quem erra, acerta e erra de novo nao acumula."""
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        for _ in range(_TETO_DE_TESTE - 1):
            await c.post("/api/v1/auth/login", json=_corpo(ws, user.email, _ERRADA))

        ok = await c.post("/api/v1/auth/login", json=_corpo(ws, user.email, _SENHA))
        assert ok.status_code == 200

        # Balde zerado: cabe uma sequencia inteira de novo.
        for _ in range(_TETO_DE_TESTE - 1):
            r = await c.post(
                "/api/v1/auth/login", json=_corpo(ws, user.email, _ERRADA)
            )
            assert r.status_code == 401
        de_novo = await c.post(
            "/api/v1/auth/login", json=_corpo(ws, user.email, _SENHA)
        )
        assert de_novo.status_code == 200


async def test_email_inexistente_responde_igual_e_tambem_enche_o_balde(db) -> None:
    """Criterio 10 -- o teste anti-enumeracao.

    Se a conta inexistente NAO enchesse o balde, o proprio freio viraria
    sonda: mandar N+1 tentativas e ver se a resposta muda diria se o e-mail
    tem conta. Status e mensagem tem de ser identicos nos dois casos, antes
    e depois do bloqueio.
    """
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        real = await c.post("/api/v1/auth/login", json=_corpo(ws, user.email, _ERRADA))
        fake = await c.post(
            "/api/v1/auth/login", json=_corpo(ws, "ninguem@aqui.com", _ERRADA)
        )
        assert real.status_code == fake.status_code == 401
        assert real.json()["error"]["message"] == fake.json()["error"]["message"]

        # Enche o balde do e-mail INEXISTENTE.
        for _ in range(_TETO_DE_TESTE):
            await c.post(
                "/api/v1/auth/login", json=_corpo(ws, "ninguem@aqui.com", _ERRADA)
            )
        bloqueado = await c.post(
            "/api/v1/auth/login", json=_corpo(ws, "ninguem@aqui.com", _ERRADA)
        )
        # Mesmo status e mesma mensagem de sempre -- nunca 429.
        assert bloqueado.status_code == 401
        assert bloqueado.json()["error"]["message"] == real.json()["error"]["message"]

        # ⚠️ ASSERCAO DE CAIXA-BRANCA, E POR UM MOTIVO.
        # As duas linhas acima passam MESMO SE o balde da conta inexistente
        # nunca encher -- a resposta e identica nos dois casos, que e
        # exatamente a propriedade desejada. Ou seja: pela resposta HTTP, este
        # comportamento e INOBSERVAVEL, e um teste so de resposta daria verde
        # com o `record` removido do ramo "usuario nao existe" (confirmado por
        # sabotagem). A unica forma de provar que o balde encheu e olhar o
        # balde.
        assert (
            account_login_limiter.check(
                account_key(email="ninguem@aqui.com", workspace_slug=ws.slug)
            ).allowed
            is False
        )


async def test_bloqueio_de_uma_conta_nao_afeta_outra(db) -> None:
    ws, user = await _pessoa(db)
    outro_id = await f.make_user(db, workspace_id=ws.id)
    outro = await db.get(User, outro_id)
    outro.password_hash = hash_password(_SENHA)
    await db.commit()

    async with _client(db) as c:
        for _ in range(_TETO_DE_TESTE):
            await c.post("/api/v1/auth/login", json=_corpo(ws, user.email, _ERRADA))

        livre = await c.post("/api/v1/auth/login", json=_corpo(ws, outro.email, _SENHA))
        assert livre.status_code == 200


async def test_caixa_do_email_nao_burla_o_freio(db) -> None:
    """A normalizacao da chave, exercitada pela rota.

    Sem `.lower()`, alternar a caixa multiplicaria o teto por quantas
    variacoes o atacante quisesse escrever.
    """
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        for _ in range(_TETO_DE_TESTE):
            await c.post(
                "/api/v1/auth/login",
                json=_corpo(ws, user.email.upper(), _ERRADA),
            )
        bloqueada = await c.post(
            "/api/v1/auth/login", json=_corpo(ws, user.email, _SENHA)
        )
        assert bloqueada.status_code == 401


async def test_balde_por_ip_continua_valendo(db) -> None:
    """Criterio 12: a fatia nova nao pode ter desligado a antiga.

    Todas as tentativas do MESMO IP, com e-mails sempre diferentes -- entao
    o balde por conta nunca enche e quem barra so pode ser o balde por IP.
    """
    ws, _user = await _pessoa(db)
    await db.commit()
    login_limiter._max_backup = login_limiter._max
    login_limiter._max = 3
    try:
        async with _client(db) as c:
            for i in range(3):
                r = await c.post(
                    "/api/v1/auth/login",
                    json=_corpo(ws, f"cada-um-diferente-{i}@x.com", _ERRADA),
                    headers={"X-Forwarded-For": "198.51.100.7"},
                )
                assert r.status_code == 401

            barrada = await c.post(
                "/api/v1/auth/login",
                json=_corpo(ws, "mais-um@x.com", _ERRADA),
                headers={"X-Forwarded-For": "198.51.100.7"},
            )
            assert barrada.status_code == 429
    finally:
        login_limiter._max = login_limiter._max_backup

# ------------------------------------------------------------ 16/10, a auditoria


async def test_login_nao_diferencia_maiusculas_no_email(db) -> None:
    """O cadastro grava em minusculas e o celular capitaliza a 1a letra:
    `Fulano@...` com a senha certa recebia 401 e enchia o freio da conta."""
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        r = await c.post("/api/v1/auth/login", json=_corpo(ws, user.email.upper(), _SENHA))
    assert r.status_code == 200


async def test_refresh_nao_tem_freio_por_ip(db) -> None:
    """A instituicao sai toda por UM IP: o 11o refresh do minuto levava 429,
    e o front deslogava quem tinha sessao valida."""
    ws, user = await _pessoa(db)
    await db.commit()
    async with _client(db) as c:
        par = (await c.post("/api/v1/auth/login", json=_corpo(ws, user.email, _SENHA))).json()
        for _ in range(login_limiter._max + 5):
            r = await c.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": par["refresh_token"]},
                headers={"X-Forwarded-For": "198.51.100.7"},
            )
            assert r.status_code == 200
            par = r.json()


async def test_troca_de_senha_freia_a_senha_atual_errada(db) -> None:
    """Quem roubasse a sessao chutava a senha atual sem limite."""
    ws, user = await _pessoa(db)
    await db.commit()
    # Lidos ANTES: cada 401 desfaz a transacao e expira os objetos.
    email, slug = user.email, ws.slug
    async with _client(db) as c:
        par = (await c.post("/api/v1/auth/login", json=_corpo(ws, email, _SENHA))).json()
        auth = {"Authorization": f"Bearer {par['access_token']}"}
        nova = {"new_password": "outra-senha-boa-1"}
        for _ in range(_TETO_DE_TESTE):
            r = await c.post(
                "/api/v1/auth/change-password",
                json={"current_password": _ERRADA, **nova},
                headers=auth,
            )
            assert r.status_code == 401
        # A proxima e barrada -- mesmo com a senha atual CERTA.
        barrada = await c.post(
            "/api/v1/auth/change-password",
            json={"current_password": _SENHA, **nova},
            headers=auth,
        )
        assert barrada.status_code == 429
        # Balde proprio: errar a senha atual nao tranca o login.
        r = await c.post(
            "/api/v1/auth/login",
            json={"email": email, "password": _SENHA, "workspace_slug": slug},
        )
        assert r.status_code == 200
