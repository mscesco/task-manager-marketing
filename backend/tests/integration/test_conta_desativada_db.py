"""Conta desativada: nao ganha senha, e volta pelo reativar -- 06/10/2026.

⚠️⚠️ O CASO DA JULIANA, LIDO NOS LOGS DE PRODUCAO. Cadastrada as 18:15,
desativada as 18:21 (seis minutos depois, depois de um 409 ao tentar tira-la do
Marketing), e resetada QUATRO vezes ate as 19:18. Nenhuma senha servia: o login
responde a conta desativada igual a senha errada (de proposito, para nao revelar
quais e-mails tem conta), entao cada tentativa parecia pedir mais um reset. E a
conta so voltava por UPDATE no banco -- nao havia reativar.

Este arquivo prende as duas metades:
    - `reset_password` recusa conta desativada (409), e o botao some;
    - `reactivate_member` existe, com as travas de desativar, e derruba as
      sessoes de antes (`token_version` sobe).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models import User
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import AuthorizationError, BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    arvore = (node(mkt), node(seo, mkt))

    async def pessoa(email, *, org_role=None, vinculos=(), ativa=True):
        uid = await f.make_user(db, workspace_id=ws, email=email, org_role=org_role)
        for time, papel in vinculos:
            await f.add_member(db, workspace_id=ws, user_id=uid, team_id=time, role=papel)
        if not ativa:
            (await db.get(User, uid)).is_active = False
        return uid

    m = {
        "ws": ws, "mkt": mkt, "arvore": arvore,
        "dona": await pessoa("dona@t.dev", org_role="ADMIN"),
        "manager": await pessoa("manager@t.dev", vinculos=((mkt, "MANAGER"),)),
        # a Juliana: operadora no Marketing, desativada
        "juliana": await pessoa(
            "juliana@t.dev", vinculos=((mkt, "OPERATOR"),), ativa=False
        ),
        # um par do gerente, desativado: a trava de papel continua valendo
        "manager2": await pessoa(
            "manager2@t.dev", vinculos=((mkt, "MANAGER"),), ativa=False
        ),
        "ativa": await pessoa("ativa@t.dev", vinculos=((seo, "OPERATOR"),)),
    }
    await db.flush()
    return m


def _como(m: dict, quem: str):
    contextos = {
        "dona": dict(memberships=(), org_role="ADMIN"),
        "manager": dict(memberships=(mship(m["mkt"], "MANAGER"),), org_role=None),
    }
    return acting_as(
        workspace_id=m["ws"], user_id=m[quem], team_tree=m["arvore"], **contextos[quem]
    )


async def test_conta_desativada_nao_ganha_senha(db) -> None:
    """⭐ O defeito: quatro senhas que nunca iam funcionar."""
    m = await _mundo(db)
    with _como(m, "manager"):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).reset_password(user_id=m["juliana"])
    user = await db.get(User, m["juliana"])
    # nada mudou: nem a versao das sessoes, nem a troca obrigatoria
    assert user.token_version == 0


async def test_quem_nao_alcanca_leva_403_e_nao_a_noticia(db) -> None:
    """A trava de papel vem antes: o gerente nao fica sabendo que o par esta
    desativado -- ele nao poderia resetar a senha do par de qualquer jeito."""
    m = await _mundo(db)
    with _como(m, "manager"):
        with pytest.raises(AuthorizationError):
            await MemberService(db).reset_password(user_id=m["manager2"])


async def test_reativar_devolve_a_conta_e_derruba_as_sessoes_de_antes(db) -> None:
    m = await _mundo(db)
    with _como(m, "manager"):
        user = await MemberService(db).reactivate_member(user_id=m["juliana"])
    assert user.is_active is True
    # ⚠️ um token de antes da desativacao nao volta a valer
    assert user.token_version == 1


async def test_depois_de_reativar_o_reset_funciona(db) -> None:
    """O caminho que a tela vai oferecer: reativar, e entao resetar."""
    m = await _mundo(db)
    with _como(m, "manager"):
        svc = MemberService(db)
        await svc.reactivate_member(user_id=m["juliana"])
        assert (await svc.reset_password(user_id=m["juliana"])).temporary_password


async def test_reativar_quem_esta_ativo_nao_faz_nada(db) -> None:
    """Reclicar nao e erro, e nao derruba as sessoes de quem esta trabalhando."""
    m = await _mundo(db)
    with _como(m, "dona"):
        user = await MemberService(db).reactivate_member(user_id=m["ativa"])
    assert user.is_active is True
    assert user.token_version == 0


async def test_reativar_respeita_o_papel_do_alvo(db) -> None:
    """As travas de desativar: o gerente nao mexe na conta de outro gerente."""
    m = await _mundo(db)
    with _como(m, "manager"):
        with pytest.raises(AuthorizationError):
            await MemberService(db).reactivate_member(user_id=m["manager2"])
    with _como(m, "dona"):
        assert (
            await MemberService(db).reactivate_member(user_id=m["manager2"])
        ).is_active is True


async def test_os_botoes_da_conta_desativada(db) -> None:
    """Resetar e desativar fechados; reativar aberto -- e o contrario na ativa."""
    m = await _mundo(db)
    with _como(m, "manager"):
        svc = MemberService(db)
        assert await svc.acoes_da_conta(user_id=m["juliana"]) == (False, False, True)
        assert await svc.acoes_da_conta(user_id=m["ativa"]) == (True, True, False)
