"""Spec 016 -- adicionar membro existente a um time, agora pela matriz.

assign_to_team passa a chamar _assert_actor_can_assign (Spec 015): ADMIN
atribui qualquer papel; MANAGER so SUPERVISOR/OPERATOR. Adicionar e aditivo
(sem self-guard). Mantem o 409 (ja no time).

⚠️ O 422 DO SEGUNDO SUBTIME SAIU NA SPEC 044, FATIA 3. O teste que o afirmava
virou o teste do contrario, no fim deste arquivo -- e a nota la explica por
que a spec achava que ele nao existia.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    ConflictError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def test_admin_adiciona_qualquer_papel(db) -> None:
    """Matriz da Spec 016: ADMIN alcanca qualquer papel.

    A Spec 024 acrescentou um limite ORTOGONAL a esta matriz: ADMIN e
    MANAGER so existem no time raiz. A matriz continua valendo (quem o
    ator alcanca); o que a invariante decide e ONDE o papel pode ser
    aplicado. Este teste passou a cobrir as duas coisas.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    # ⚠️ SEM VINCULO NA RAIZ, e a ausencia e o ponto. Ate a Spec 044 fatia 5
    # este alvo era OPERATOR na raiz -- e virou o cadastro que a regra da
    # Camila proibe: papel na raiz MENOR que no subtime. "Ausencia nao e
    # menos" (decisao dela, 31/08), entao quem so vai existir no subtime passa.
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    outro = await f.make_user(db, workspace_id=ws, email="outro@t.dev")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        svc = MemberService(db)
        # Papel de execucao em subtime: a matriz permite e o nivel aceita.
        ut = await svc.assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )
        assert ut.team_id == seo
        assert ut.role == UserTeamRole.SUPERVISOR

        # Spec 024: ADMIN em SUBTIME e recusado -- mesmo o ator sendo ADMIN.
        # Nao e a matriz que barra (ela permite), e a invariante de nivel.
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outro, team_id=seo, role=UserTeamRole.ADMIN
            )


async def test_manager_adiciona_supervisor(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    # ⚠️ Sem vinculo na raiz -- ver a nota do teste acima (Spec 044, fatia 5).
    # ⚠️⚠️ MAS COM VINCULO NA ARVORE (Design), desde a Spec 051, fatia C: quem
    # nao e da organizacao so vincula quem ja esta naquela arvore. O alvo SEM
    # time nenhum que este teste usava nao existe fora de teste -- todo membro
    # nasce com um vinculo (Spec 014) -- e hoje so a organizacao o vincula.
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=design, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
        # ⚠️ A ARVORE, desde a Spec 051: "ja esta na arvore" pergunta a raiz de
        # cada time, e sem arvore o SEO e o Design seriam raizes de si mesmos.
        team_tree=(node(raiz), node(seo, raiz), node(design, raiz)),
    ):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR


async def test_manager_nao_adiciona_admin(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.ADMIN
            )
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.MANAGER
            )


async def test_adicionar_no_time_que_ja_esta_409(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(ConflictError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=raiz, role=UserTeamRole.OPERATOR
            )


async def test_segundo_subtime_agora_e_aceito_pelo_servico(db) -> None:
    """⭐ Spec 044, fatia 3: a trava saiu. Este teste ERA o 422 dela.

    ⚠️⚠️ A SPEC 044 §3.1 AFIRMA QUE NENHUM TESTE COBRIA O 422 -- e afirma
    errado. O grep de 31/08 procurou a FRASE "um subtime por usuario" dentro
    de `tests/`, e este arquivo nunca a escreveu: ele afirmava o
    COMPORTAMENTO, com `pytest.raises(ValidationError)`. Removida a trava,
    ele acendeu vermelho na hora -- que e exatamente o que uma rede faz.
    A licao e sobre o grep, nao sobre a cobertura: procurar por prosa nao
    encontra assercao.

    O caso e a redatora que o negocio precisa em SEO E em Midias Sociais,
    bloqueada desde a ADR 0039 (10/08).

    ⚠️ E a diferenca para os testes da fatia 1: la os dois vinculos eram
    escritos pela FACTORY, porque o servico ainda recusava. Aqui o segundo
    nasce PELO SERVICO -- que e o que esta fatia mudou.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    midias = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias-sociais"
    )
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    redatora = await f.make_user(db, workspace_id=ws, email="redatora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=midias, role="OPERATOR"
    )

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        svc = MemberService(db)
        ut = await svc.assign_to_team(
            user_id=redatora, team_id=seo, role=UserTeamRole.OPERATOR
        )
        assert ut.team_id == seo

        # A lente devolve os DOIS, e o membro nao duplica -- a fatia 1 ja
        # garantia isso com vinculos de factory; aqui o segundo veio do
        # servico, entao as duas fatias se encontram neste assert.
        membros = await svc.list_members()

    (linha,) = [m for m in membros if m.user.id == redatora]
    assert linha.subteam_ids == [midias, seo]


async def test_vinculo_repetido_no_mesmo_time_continua_409(db) -> None:
    """A trava que FICA: `UNIQUE (user_id, team_id)`.

    Contraprova do teste acima -- sem ela, "a trava saiu" poderia ser lido
    como "nao ha mais limite nenhum". Ha: o mesmo time duas vezes segue 409.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(ConflictError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.OPERATOR
            )
