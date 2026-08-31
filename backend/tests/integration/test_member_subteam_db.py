"""Entrega 13, Fatia 2 -- GET /members expoe os SUBTIMES de cada membro.

Regra: subtime = time com parent_team_id != NULL. O time PRINCIPAL (raiz)
NAO rotula -- senao quem esta na raiz (ex.: managers do seed) viria com o
id do Marketing geral e o filtro de subtime no quadro perderia o sentido.

⚠️⚠️ ATE 31/08 ESTE ARQUIVO DIZIA "cada membro tem 0 ou 1", pelo invariante
da ADR 0008. A Spec 044 (fatia 1) pluraliza a listagem ANTES de a trava sair
(fatia 3), e a razao esta na docstring de `list_all_with_subteams`: com dois
subtimes o LEFT JOIN antigo devolvia DUAS LINHAS por membro e a pessoa
aparecia duplicada nas seis telas que consomem esta rota.

⚠️ E ESTE ARQUIVO ERA O UNICO LUGAR ONDE O INVARIANTE APARECIA EM `tests/`,
como DOCSTRING -- nunca como assercao (ADR 0039). Ou seja: o defeito acima
nao teria acendido nada. O teste `test_dois_subtimes_*` abaixo existe
exatamente para que a fatia 3 nao possa ser escrita sem que alguem veja isto.

Cobre: raiz+subtime, DOIS subtimes, so-subtime, so-raiz (vazio),
sem-vinculo (vazio) e isolamento entre workspaces.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.modules.users.application.member_service import MemberService
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def test_member_traz_subtimes_ignorando_raiz(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="seo"
    )

    # 1) na raiz E num subtime -> vem SO o subtime, nunca a raiz.
    dupla = await f.make_user(db, workspace_id=ws, email="dupla@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=raiz, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=design, role="OPERATOR"
    )

    # 2) so num subtime -> vem o subtime.
    so_sub = await f.make_user(db, workspace_id=ws, email="sosub@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=so_sub, team_id=seo, role="OPERATOR"
    )

    # 3) so na raiz -> sem subtime, e a raiz NAO entra na lista.
    so_raiz = await f.make_user(db, workspace_id=ws, email="soraiz@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=so_raiz, team_id=raiz, role="MANAGER"
    )

    # 4) sem vinculo nenhum.
    solto = await f.make_user(db, workspace_id=ws, email="solto@t.dev")

    with acting_as(workspace_id=ws, user_id=dupla):
        membros = await MemberService(db).list_members()

    por_id = {m.user.id: m.subteam_ids for m in membros}
    assert por_id[dupla] == [design]
    assert por_id[so_sub] == [seo]
    # ⚠️ LISTA VAZIA, e nao `None`. "Sem subtime" tem UMA representacao so --
    # quem desenha checa `len` e nao precisa saber dos dois casos.
    assert por_id[so_raiz] == []
    assert por_id[solto] == []

    ids = [m.user.id for m in membros]
    assert len(ids) == len(set(ids))


async def test_dois_subtimes_vem_juntos_e_o_membro_nao_duplica(db) -> None:
    """⚠️ O TESTE QUE NUNCA EXISTIU, e o motivo desta fatia vir antes da 3.

    O caso e a redatora que o negocio precisa em SEO E em Midias Sociais --
    o caso concreto que abriu a ADR 0039 em 10/08 e que segue bloqueado.

    ⚠️ OS VINCULOS SAO ESCRITOS PELA FACTORY, DE PROPOSITO. `MemberService`
    ainda tem `_assert_one_subteam` (sai na fatia 3) e recusaria o segundo com
    422. Este teste precisa existir ANTES daquela remocao, senao a fatia 3
    entra sem rede -- e o grep de 31/08 confirma que nenhum teste afirma o 422
    da trava, entao remove-la nao acende nada sozinha.

    O que ele prende, e que a versao antiga da consulta REPROVARIA:
      1. os dois subtimes vem, nao um deles;
      2. **o membro aparece UMA vez** -- o LEFT JOIN antigo devolvia uma linha
         por subtime, e `list_members` montava um objeto por linha.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    # ⚠️ Os slugs sao escolhidos para que a ordem ALFABETICA POR NOME
    # ("midias-sociais" < "seo") difira da ordem de INSERCAO. Sem isso o teste
    # passaria com a consulta sem `ORDER BY` dentro do agregado, e a promessa
    # de ordem estavel da docstring nao teria guardiao.
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    midias = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias-sociais"
    )

    redatora = await f.make_user(db, workspace_id=ws, email="redatora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=seo, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=midias, role="OPERATOR"
    )

    with acting_as(workspace_id=ws, user_id=redatora):
        membros = await MemberService(db).list_members()

    linhas = [m for m in membros if m.user.id == redatora]
    assert len(linhas) == 1, "membro com dois subtimes duplicou na listagem"
    assert linhas[0].subteam_ids == [midias, seo]


async def test_dois_subtimes_mais_raiz_continua_sem_a_raiz(db) -> None:
    """A raiz nao entra nem quando ha dois subtimes.

    Guarda o caso combinado: o `array_agg` roda sobre a subconsulta JA
    filtrada por `parent_team_id IS NOT NULL`. Se alguem mover o filtro para
    fora do agregado, este teste cai e o anterior nao.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    gestora = await f.make_user(db, workspace_id=ws, email="gestora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gestora, team_id=raiz, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=gestora, team_id=design, role="SUPERVISOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=gestora, team_id=seo, role="SUPERVISOR"
    )

    with acting_as(workspace_id=ws, user_id=gestora):
        membros = await MemberService(db).list_members()

    (linha,) = [m for m in membros if m.user.id == gestora]
    assert linha.subteam_ids == [design, seo]
    assert raiz not in linha.subteam_ids


async def test_subtime_nao_vaza_entre_workspaces(db) -> None:
    ws_a = await f.make_workspace(db, name="A")
    ws_b = await f.make_workspace(db, name="B")

    raiz_b = await f.make_team(db, workspace_id=ws_b, slug="marketing")
    sub_b = await f.make_team(
        db, workspace_id=ws_b, parent_team_id=raiz_b, slug="design"
    )
    u_b = await f.make_user(db, workspace_id=ws_b, email="b@t.dev")
    await f.add_member(
        db, workspace_id=ws_b, user_id=u_b, team_id=sub_b, role="OPERATOR"
    )

    u_a = await f.make_user(db, workspace_id=ws_a, email="a@t.dev")

    with acting_as(workspace_id=ws_a, user_id=u_a):
        membros = await MemberService(db).list_members()

    ids = {m.user.id for m in membros}
    assert u_a in ids
    assert u_b not in ids  # membro de outro tenant nao aparece
