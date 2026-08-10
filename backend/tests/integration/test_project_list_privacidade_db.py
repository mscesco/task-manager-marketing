"""Privacidade na LISTAGEM de projeto -- a rede que faltava embaixo da E1.

⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UM ERRO QUE QUASE FOI COMETIDO, e ele nao
protege a Spec 037: protege contra a implementacao ERRADA dela.

O ADR 0038 e a primeira versao do `plan.md` diziam que o furo do `created_by`
(ADR 0013) estava em QUATRO pontos, e listavam `project_service.py:215` e
`task_repository.py:117` / `:130` entre eles. Aberto o codigo, os tres sao
outra coisa -- sao o filtro de PESSOAL ALHEIO:

    # project_service.py:211 -- list_page
    # Privacidade: esconde pessoal alheio.
    extra_filters.append(or_(Project.is_personal.is_(False),
                             Project.created_by == tenant.user_id))

Apagar aquele bloco expoe o projeto pessoal de TODO MUNDO no `GET /projects`
do workspace inteiro. E, ate este arquivo existir, isso passaria no portao
verde: `ls tests/integration | grep -i proj` devolvia so
`test_task_detach_project_db.py`, que e sobre desacoplar tarefa de projeto.

⚠️ A LICAO GERAL, e ela vale alem desta spec: `created_by` aparece em cinco
lugares e significa DUAS coisas diferentes. Antes de apagar qualquer um, leia
o comentario -- se ele fala em *pessoal*, nao e a E1.

SABOTAGEM (executar antes de commitar):
    Em `app/modules/tasks/application/project_service.py`, apagar o bloco
    INTEIRO do `extra_filters.append(...)` que carrega o comentario
    "Privacidade: esconde pessoal alheio".
    Deve cair `test_listagem_nao_traz_pessoal_alheio`. `pytest` sem este
    arquivo continuaria VERDE -- e essa e a medida do buraco que ele fecha.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.project_service import (
    ProjectFilters,
    ProjectService,
)
from app.shared.exceptions.base import EntityNotFoundError
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

PAGE = PageParams(size=100)


async def _mundo(db):
    """Raiz Marketing + subtime A. Duas pessoas, ambas OPERATOR de A.

    As duas no MESMO time de proposito: assim o unico motivo possivel para um
    projeto sumir da lista da outra e a privacidade do pessoal, e nao a lente
    de time. Se um dia a lente de time entrar no `project` (hoje ela nao
    existe em lugar nenhum -- `list_page` nao filtra por time), este teste
    continua afirmando exatamente a mesma coisa.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    ana = await f.make_user(db, workspace_id=ws, email="ana@t.dev")
    bia = await f.make_user(db, workspace_id=ws, email="bia@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=ana, team_id=a, role="OPERATOR")
    await f.add_member(db, workspace_id=ws, user_id=bia, team_id=a, role="OPERATOR")
    return ws, r, a, ana, bia


def _forest(r, a):
    return (node(r), node(a, r))


async def test_listagem_nao_traz_pessoal_alheio(db) -> None:
    """`GET /projects` como B NAO traz o projeto pessoal de A."""
    ws, r, a, ana, bia = await _mundo(db)
    pessoal_da_ana = await f.make_project(
        db, workspace_id=ws, created_by=ana, team_id=None,
        is_personal=True, title="Pessoal da Ana",
    )
    comum = await f.make_project(
        db, workspace_id=ws, created_by=ana, team_id=a,
        is_personal=False, title="Projeto do time",
    )

    with acting_as(
        workspace_id=ws, user_id=bia, memberships=(mship(a, "OPERATOR"),),
        team_tree=_forest(r, a),
    ):
        page = await ProjectService(db).list_page(PAGE, ProjectFilters())
        ids = {p.id for p in page.items}

    assert pessoal_da_ana not in ids, "pessoal alheio VAZOU na listagem"
    assert comum in ids, "o projeto comum sumiu -- o filtro pegou demais"


async def test_listagem_traz_o_pessoal_de_quem_pergunta(db) -> None:
    """O contrapeso: o filtro nao pode esconder o pessoal do PROPRIO dono.

    ⚠️ SEM ESTE TESTE, o anterior passaria com um filtro que some com todo
    projeto pessoal de todo mundo -- inclusive o seu. Sao os dois lados do
    mesmo `or_`, e cada um sozinho admite uma implementacao errada.
    """
    ws, r, a, ana, _bia = await _mundo(db)
    meu_pessoal = await f.make_project(
        db, workspace_id=ws, created_by=ana, team_id=None,
        is_personal=True, title="Pessoal da Ana",
    )

    with acting_as(
        workspace_id=ws, user_id=ana, memberships=(mship(a, "OPERATOR"),),
        team_tree=_forest(r, a),
    ):
        page = await ProjectService(db).list_page(PAGE, ProjectFilters())
        ids = {p.id for p in page.items}

    assert meu_pessoal in ids


async def test_detalhe_de_pessoal_alheio_da_404(db) -> None:
    """E o par por ID: 404, nao 403 -- nao vaza nem a existencia.

    Cobre `_assert_visible_to_current_user` (`project_service.py:462`), que e
    o outro lado da mesma privacidade. A listagem e o detalhe falham por
    caminhos diferentes; um teste so nao cobre os dois.
    """
    ws, r, a, ana, bia = await _mundo(db)
    pessoal_da_ana = await f.make_project(
        db, workspace_id=ws, created_by=ana, team_id=None,
        is_personal=True, title="Pessoal da Ana",
    )

    with acting_as(
        workspace_id=ws, user_id=bia, memberships=(mship(a, "OPERATOR"),),
        team_tree=_forest(r, a),
    ):
        with pytest.raises(EntityNotFoundError):
            await ProjectService(db).get(pessoal_da_ana)
