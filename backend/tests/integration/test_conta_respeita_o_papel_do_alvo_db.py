"""Resetar senha e desativar conta respeitam o PAPEL do alvo -- revisao de 16/09.

⚠️⚠️ ESTE ARQUIVO PRENDE UMA TOMADA DE CONTA. `reset_password` devolve a senha
provisoria a quem clicou, e a unica pergunta era "voce alcanca esta pessoa?".
Um GESTOR resetava a senha de um ADMIN e entrava como ele; um MANAGER fazia o
mesmo com outro MANAGER. Em producao (PR #51) nem a pergunta de alcance existia.

As regras NAO sao novas -- sao as da troca de papel, aplicadas a conta:
    ADMIN      -> qualquer conta
    alvo ADMIN -> so ADMIN (org_role ou o vinculo ADMIN antigo)
    GESTOR     -> GESTOR e abaixo
    MANAGER    -> so SUPERVISOR e OPERATOR, sem papel de organizacao

⚠️ OS ALVOS "COM VINCULO NA ARVORE DO MANAGER" SAO O PONTO. Um ADMIN ou GESTOR
de organizacao SEM time ja era barrado para o MANAGER pela pergunta de alcance;
com um vinculo de OPERATOR no Marketing, o alcance passa -- e so a trava de
papel diz nao.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import AuthorizationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    arvore = (node(mkt), node(seo, mkt))

    async def pessoa(email, *, org_role=None, vinculos=()):
        uid = await f.make_user(db, workspace_id=ws, email=email, org_role=org_role)
        for time, papel in vinculos:
            await f.add_member(db, workspace_id=ws, user_id=uid, team_id=time, role=papel)
        return uid

    m = {
        "ws": ws, "mkt": mkt, "seo": seo, "arvore": arvore,
        # quem age
        "dona": await pessoa("dona@t.dev", org_role="ADMIN"),
        "gestor": await pessoa("gestor@t.dev", org_role="GESTOR"),
        "manager": await pessoa("manager@t.dev", vinculos=((mkt, "MANAGER"),)),
        # alvos -- os de organizacao TEM vinculo no Marketing (ver o cabecalho)
        "admin2": await pessoa("admin2@t.dev", org_role="ADMIN", vinculos=((mkt, "OPERATOR"),)),
        "gestor2": await pessoa("gestor2@t.dev", org_role="GESTOR", vinculos=((mkt, "OPERATOR"),)),
        "legado": await pessoa("legado@t.dev", vinculos=((mkt, "ADMIN"),)),
        "manager2": await pessoa("manager2@t.dev", vinculos=((mkt, "MANAGER"),)),
        "sup": await pessoa("sup@t.dev", vinculos=((seo, "SUPERVISOR"),)),
        "op": await pessoa("op@t.dev", vinculos=((seo, "OPERATOR"),)),
    }
    await db.flush()
    return m


def _como(m: dict, quem: str):
    contextos = {
        "dona": dict(memberships=(), org_role="ADMIN"),
        "gestor": dict(memberships=(), org_role="GESTOR"),
        "manager": dict(memberships=(mship(m["mkt"], "MANAGER"),), org_role=None),
    }
    return acting_as(
        workspace_id=m["ws"], user_id=m[quem], team_tree=m["arvore"], **contextos[quem]
    )


async def _recusa(coro) -> None:
    with pytest.raises(AuthorizationError):
        await coro


# ------------------------------------------------------------- GESTOR


async def test_gestor_nao_reseta_nem_desativa_admin(db) -> None:
    """⭐ A tomada de conta do relato: GESTOR -> ADMIN."""
    m = await _mundo(db)
    with _como(m, "gestor"):
        svc = MemberService(db)
        await _recusa(svc.reset_password(user_id=m["admin2"]))
        await _recusa(svc.reset_password(user_id=m["dona"]))
        await _recusa(svc.deactivate_member(user_id=m["admin2"]))
        # ⚠️ o vinculo ADMIN antigo tambem conta como admin (`is_admin`)
        await _recusa(svc.reset_password(user_id=m["legado"]))


async def test_gestor_administra_gestor_e_papeis_de_time(db) -> None:
    """Contraprova: a trava nao pode ter fechado o que o GESTOR sempre fez."""
    m = await _mundo(db)
    with _como(m, "gestor"):
        svc = MemberService(db)
        for alvo in ("gestor2", "manager", "sup", "op"):
            provisionado = await svc.reset_password(user_id=m[alvo])
            assert provisionado.temporary_password
        desativado = await svc.deactivate_member(user_id=m["op"])
        assert desativado.is_active is False


# ------------------------------------------------------------- MANAGER


async def test_manager_nao_reseta_nem_desativa_par_nem_organizacao(db) -> None:
    """⭐ MANAGER -> outro MANAGER, e -> ADMIN/GESTOR com vinculo na arvore dele.

    Todos passam na pergunta de alcance (os vinculos estao no Marketing); so a
    trava de papel os recusa.
    """
    m = await _mundo(db)
    with _como(m, "manager"):
        svc = MemberService(db)
        for alvo in ("manager2", "admin2", "gestor2", "legado"):
            await _recusa(svc.reset_password(user_id=m[alvo]))
        await _recusa(svc.deactivate_member(user_id=m["manager2"]))
        await _recusa(svc.deactivate_member(user_id=m["gestor2"]))


async def test_manager_administra_supervisor_e_operador(db) -> None:
    m = await _mundo(db)
    with _como(m, "manager"):
        svc = MemberService(db)
        assert (await svc.reset_password(user_id=m["sup"])).temporary_password
        assert (await svc.reset_password(user_id=m["op"])).temporary_password
        assert (await svc.deactivate_member(user_id=m["op"])).is_active is False


async def test_a_propria_senha_continua_livre(db) -> None:
    """Resetar a PROPRIA senha nunca passou pelas travas de outra pessoa."""
    m = await _mundo(db)
    with _como(m, "manager"):
        assert (
            await MemberService(db).reset_password(user_id=m["manager"])
        ).temporary_password


# ------------------------------------------------------------- ADMIN


async def test_admin_administra_admin(db) -> None:
    m = await _mundo(db)
    with _como(m, "dona"):
        svc = MemberService(db)
        assert (await svc.reset_password(user_id=m["admin2"])).temporary_password
        assert (await svc.reset_password(user_id=m["legado"])).temporary_password
        # nao e o ultimo: a propria dona continua ativa
        assert (await svc.deactivate_member(user_id=m["admin2"])).is_active is False
