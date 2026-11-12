"""`listar_formularios(team_id)`: os formularios do time que a tela mostra.

Dois recortes combinados com AND:

    a lente / o verbo  responde "posso ver?" -- `None` para papel de organizacao
    o `team_id`        responde "estou olhando qual time?" -- vale para todos

O mundo: duas raizes, e um formulario no SUBTIME do Marketing, que e o que faz
o teste dos descendentes valer algo.

    Marketing (raiz)  -> "geral"
      SEO (subtime)   -> "arte"
    Comercial (raiz)  -> "metas"

O que a lente esconde de quem nao e da organizacao esta na matriz HTTP
(`test_fila_e_formularios_pelo_verbo_e_nao_pela_lente`).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


def mship(team_id: uuid.UUID, role: str) -> Membership:
    return Membership(team_id=team_id, role=role)


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Formularios do Time")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(marketing), node(seo, marketing), node(comercial))

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(),
        team_tree=arvore,
        org_role="ADMIN",
    ):
        svc = SolicitationFormService(db)
        await svc.criar_formulario(team_id=marketing, slug="geral", title="Geral")
        await svc.criar_formulario(team_id=seo, slug="arte", title="Arte")
        await svc.criar_formulario(team_id=comercial, slug="metas", title="Metas")

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "user": user,
        "arvore": arvore,
    }


def _como_admin(m):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


def _como_gerente_do_marketing(m):
    """Quem le formulario sem ser da organizacao: o MANAGER (`form.read`)."""
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(mship(m["marketing"], "MANAGER"),),
        team_tree=m["arvore"],
    )


async def _slugs(db, *, team_id):
    forms = await SolicitationFormService(db).listar_formularios(team_id)
    return {form.slug for form in forms}


# ------------------------------------------------- 1. o recorte da tela


async def test_recorte_pela_raiz_traz_o_formulario_do_SUBTIME(db) -> None:
    """Raiz + descendentes, e nao igualdade; e a outra raiz fica de fora
    mesmo para o admin, que a alcanca."""
    m = await _mundo(db)
    with _como_admin(m):
        slugs = await _slugs(db, team_id=m["marketing"])

    assert slugs == {"geral", "arte"}


async def test_sem_recorte_a_lista_e_da_organizacao(db) -> None:
    """`None` e resposta legitima, e por isso o parametro nao tem default."""
    m = await _mundo(db)
    with _como_admin(m):
        slugs = await _slugs(db, team_id=None)

    assert slugs == {"geral", "arte", "metas"}


# ------------------------------------------------- 2. a lente


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """O parametro ESTREITA, nunca alarga.

    O gerente do Marketing pede o Comercial explicitamente e recebe vazio --
    os dois predicados entram na mesma consulta e se combinam com AND.
    """
    m = await _mundo(db)
    with _como_gerente_do_marketing(m):
        slugs = await _slugs(db, team_id=m["comercial"])

    assert slugs == set()
