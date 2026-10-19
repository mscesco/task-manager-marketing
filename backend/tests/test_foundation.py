"""Testes da foundation.

Servem de MODELO para os testes dos modulos futuros. Cobrem
as garantias mais importantes da base:
    - isolamento multi-tenant (TenantContext + BaseRepository);
    - emissao/validacao de tokens;
    - respostas HTTP da app (health e auth).

Rodar: pytest (com o venv ativo).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import current_tenant, require_tenant, tenant_scope
from app.db.models import Task
from app.db.repository import BaseRepository
from app.modules.auth.infrastructure.security import (
    TokenType,
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.shared.exceptions.base import (
    AuthenticationError,
    MissingTenantContextError,
)


# --------------------------------------------------------
# TenantContext
# --------------------------------------------------------
def test_require_tenant_fails_without_context() -> None:
    """Sem contexto de tenant, require_tenant falha alto."""
    with pytest.raises(MissingTenantContextError):
        require_tenant()


def test_tenant_context_populates_and_resets() -> None:
    """O context manager popula e depois limpa o contexto."""
    ws, usr = uuid.uuid4(), uuid.uuid4()
    with tenant_scope(ws, usr):
        principal = require_tenant()
        assert principal.workspace_id == ws
        assert principal.user_id == usr
    assert current_tenant() is None


# --------------------------------------------------------
# BaseRepository -- filtro multi-tenant
# --------------------------------------------------------
class _TaskRepo(BaseRepository[Task]):
    model = Task


def test_base_select_injects_tenant_and_soft_delete_filter() -> None:
    """O SELECT base ja nasce filtrado por workspace e deleted_at."""
    ws, usr = uuid.uuid4(), uuid.uuid4()
    with tenant_scope(ws, usr):
        repo = _TaskRepo.__new__(_TaskRepo)
        repo.session = None  # type: ignore[assignment]
        sql = str(
            repo._base_select().compile(compile_kwargs={"literal_binds": True})
        )
        assert "workspace_id" in sql
        assert "deleted_at IS NULL" in sql


def test_base_select_fails_without_tenant() -> None:
    """Sem contexto, o repository falha alto antes de qualquer query."""
    repo = _TaskRepo.__new__(_TaskRepo)
    repo.session = None  # type: ignore[assignment]
    with pytest.raises(MissingTenantContextError):
        repo._base_select()


# --------------------------------------------------------
# Seguranca -- senha e JWT
# --------------------------------------------------------
def test_password_hash_roundtrip() -> None:
    h = hash_password("segredo123")
    assert verify_password("segredo123", h)
    assert not verify_password("errado", h)


# Hashes gerados pelo `passlib` 1.7.4 (o que gravou TODAS as senhas de hoje),
# em 16/10, antes de ele sair. Se a troca para `bcrypt` direto tivesse mudado
# formato, custo ou o corte de 72 bytes, ninguem mais entraria.
_HASH_DO_PASSLIB = "$2b$12$zWiU5OT9Kcvj4sjVA.fM1uwWeGsTlhVBkAnYt5BhhNcACMWqUOq0C"
_HASH_DO_PASSLIB_100_X = "$2b$12$gH70mJeJO9CSee8BAZGLvOjxW2Z7pZKIT4kKBqmh0yrY0DevrpqpG"


def test_senha_gravada_pelo_passlib_continua_entrando() -> None:
    assert verify_password("senha-gerada-pelo-passlib", _HASH_DO_PASSLIB)
    assert not verify_password("outra", _HASH_DO_PASSLIB)
    # Acima de 72 bytes, o passlib cortava -- e o corte e o mesmo.
    assert verify_password("x" * 100, _HASH_DO_PASSLIB_100_X)
    assert verify_password("x" * 72, _HASH_DO_PASSLIB_100_X)


def test_hash_invalido_nao_levanta() -> None:
    assert verify_password("qualquer", "") is False
    assert verify_password("qualquer", "nao-e-bcrypt") is False


def test_access_token_roundtrip() -> None:
    uid, wid = uuid.uuid4(), uuid.uuid4()
    token = create_access_token(user_id=uid, workspace_id=wid)
    payload = decode_token(token, expected_type=TokenType.ACCESS)
    assert payload["sub"] == str(uid)
    assert payload["ws"] == str(wid)


def test_access_token_rejected_as_refresh() -> None:
    """Um access token nao e aceito onde se espera um refresh."""
    token = create_access_token(user_id=uuid.uuid4(), workspace_id=uuid.uuid4())
    with pytest.raises(AuthenticationError):
        decode_token(token, expected_type=TokenType.REFRESH)


# --------------------------------------------------------
# TenantContext -- roles e permissions
# --------------------------------------------------------
def test_tenant_context_carries_roles_and_permissions() -> None:
    """tenant_scope propaga roles e permissions; has_* funciona."""
    ws, usr = uuid.uuid4(), uuid.uuid4()
    with tenant_scope(
        ws,
        usr,
        roles=frozenset({"ADMIN"}),
        permissions=frozenset({"task.create", "task.delete"}),
    ):
        ctx = require_tenant()
        assert ctx.has_role("ADMIN")
        assert not ctx.has_role("OPERATOR")
        assert ctx.has_permission("task.create")
        assert not ctx.has_permission("organization.update")


def test_permissions_derived_from_roles() -> None:
    """O mapa estatico deriva permissoes da uniao dos papeis."""
    from app.modules.auth.domain.permissions import (
        permissions_for_org_role,
        permissions_for_roles,
    )

    operator = permissions_for_roles(frozenset({"OPERATOR"}))
    assert "task.create" in operator
    assert "project.delete" not in operator  # operator nao deleta projeto

    # ADMIN e papel de ORGANIZACAO (nao de time): vem do mapa de org.
    admin = permissions_for_org_role("ADMIN")
    assert "organization.update" in admin

    # Uniao de papeis acumula permissoes; papel invalido e ignorado.
    mixed = permissions_for_roles(frozenset({"OPERATOR", "MANAGER", "LIXO"}))
    assert "task.create" in mixed and "project.create" in mixed


# --------------------------------------------------------
# HTTP -- app
# --------------------------------------------------------
def test_health_endpoint() -> None:
    from starlette.testclient import TestClient

    from app.main import create_app

    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_protected_route_requires_auth() -> None:
    """Rota protegida sem token devolve 401 no formato de erro padrao."""
    from starlette.testclient import TestClient

    from app.db.session import db_manager
    from app.main import create_app

    app = create_app()
    db_manager.init()
    client = TestClient(app)
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_failed"

def test_erro_traz_o_request_id_do_log() -> None:
    """Auditoria de 16/10: o corpo lia o `X-Request-ID` da REQUISICAO, que o
    front nunca manda -- saia sempre `null`, e nada ligava a tela ao log."""
    from starlette.testclient import TestClient

    from app.main import create_app

    r = TestClient(create_app()).get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json()["request_id"]
    assert r.json()["request_id"] == r.headers["X-Request-ID"]


def test_token_de_sistema_com_acento_e_401_e_nao_500(monkeypatch) -> None:
    """Com `str`, o `compare_digest` levantava TypeError com caractere fora do
    ASCII: qualquer um na internet gerava 500 com stack no log."""
    from starlette.testclient import TestClient

    from app.core.config import settings
    from app.main import create_app

    monkeypatch.setattr(settings, "system_api_token", "token-certo")
    client = TestClient(create_app(), raise_server_exceptions=False)
    r = client.post(
        "/api/v1/system/tasks/archive-stale",
        headers={"X-System-Token": "tóken".encode()},
    )
    assert r.status_code == 401
