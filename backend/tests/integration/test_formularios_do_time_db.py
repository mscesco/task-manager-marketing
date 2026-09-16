"""Spec 048, fatia E -- a listagem de formularios e do time que a tela mostra.

⚠️⚠️ ESTA LISTAGEM NAO TINHA TESTE DE FILTRO NENHUM -- nem da LENTE, que existe
nela desde a Spec 043. O unico teste que a tocava
(`test_listar_formularios_NAO_cai_na_rota_de_solicitacao`) prova a ORDEM de
registro dos routers e afirma `[] == []` num mundo sem formulario.

Ou seja: a regra "quem nao alcanca o time nao ve o formulario dele" estava
escrita no codigo, comentada, e nunca verificada. Se alguem tivesse apagado o
`if visiveis is not None`, a suite inteira seguiria verde.

⚠️ E A §3.6 DA MINHA SPEC dizia que esta listagem "tambem" nao filtrava por
time. Terceira afirmacao errada da spec sobre o proprio codigo -- as outras
foram o `list_page` de projetos e a §3.5 (a fila). As tres tem a mesma origem:
escrevi a partir das notas da spec anterior em vez de abrir o arquivo.

O que faltava mesmo era o segundo recorte:

    a LENTE      responde "posso ver?"   -- `None` para papel de organizacao
    o `team_id`  responde "estou olhando qual time?" -- vale para todos

O MUNDO: DUAS raizes, e um formulario em cada -- mais um no SUBTIME do
Marketing, que e o que faz o teste dos descendentes valer algo.

    Marketing (raiz)  -> "geral"
      SEO (subtime)   -> "arte"
    Comercial (raiz)  -> "metas"

SABOTAGENS (executadas, resultado colado em cada teste).
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
        memberships=(mship(marketing, "ADMIN"), mship(comercial, "ADMIN")),
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
        memberships=(mship(m["marketing"], "ADMIN"),),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


def _como_gerente_do_marketing(m):
    """Quem LE formulario sem ser da organizacao.

    ⚠️ Ate a Spec 051 (fatia B) era o SUPERVISOR do SEO, que nao tem
    `form.read` -- o recorte era a lente, e o teste chama o servico direto. O
    recorte virou o verbo; o leitor de verdade abaixo da organizacao e o
    MANAGER.
    """
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


async def test_recorte_tira_a_outra_raiz_ate_para_o_admin(db) -> None:
    """Quem administra ALCANCA o Comercial -- a lente nao tem o que negar.

    SABOTAGEM: apagar o `if team_id is not None` -> este teste cai ("metas"
    volta a aparecer na tela do Marketing).
    """
    m = await _mundo(db)
    with _como_admin(m):
        slugs = await _slugs(db, team_id=m["marketing"])

    assert "metas" not in slugs


async def test_recorte_pela_raiz_traz_o_formulario_do_SUBTIME(db) -> None:
    """Raiz + descendentes, e nao igualdade.

    SABOTAGEM: trocar `{team_id} | descendants(...)` por `{team_id}` -> este
    teste cai, e "arte" (do SEO) desaparece da tela do Marketing.
    """
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


# ------------------------------------------------- 2. a lente, finalmente testada


async def test_a_LENTE_esconde_o_formulario_de_outra_raiz(db) -> None:
    """⚠️⚠️ A REGRA DA SPEC 043 QUE NUNCA TEVE TESTE.

    O gerente do Marketing le {Marketing, SEO}. O Comercial e outra raiz: o
    formulario dele nao e dele para ver, nem pelo titulo -- e o editor daquele
    formulario abre a partir desta lista.

    SABOTAGEM: apagar o `if leitura is not None` -> este teste cai. Antes de
    hoje, a mesma sabotagem passaria com a suite inteira verde.
    """
    m = await _mundo(db)
    with _como_gerente_do_marketing(m):
        slugs = await _slugs(db, team_id=None)

    assert "metas" not in slugs
    # E o que ele DEVE ver continua aparecendo -- sem esta metade, um filtro
    # que devolve lista vazia passaria o teste.
    assert slugs == {"geral", "arte"}


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """O parametro ESTREITA, nunca alarga.

    O gerente do Marketing pede o Comercial explicitamente e recebe vazio --
    os dois predicados entram na mesma consulta e se combinam com AND.
    """
    m = await _mundo(db)
    with _como_gerente_do_marketing(m):
        slugs = await _slugs(db, team_id=m["comercial"])

    assert slugs == set()
