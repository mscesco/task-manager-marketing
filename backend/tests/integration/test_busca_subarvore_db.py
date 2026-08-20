"""Busca por titulo casando descendente, contra Postgres real (Spec 042, A2).

A busca do quadro vai para o servidor porque e a unica das cinco consumidoras
da subarvore que nao vira campo agregado -- nao ha campo que represente um
termo que ainda nao foi digitado.

⚠️ ELA NAO E REDUZIDA, E MELHORA. Hoje `raizesQueCasamBusca` so enxerga o lote
carregado, e o proprio comentario dele avisa: subtarefa fora do teto ou
arquivada com o toggle desligado nao e encontrada. Aqui o banco inteiro
responde.

⚠️ O CASO QUE MANDA E O ACENTO. `normalizarBusca` (front) faz NFD + remove
diacritico + minuscula, entao "midia" acha "Midia Paga". Se o servidor casasse
so com `ILIKE`, a busca nova devolveria MENOS que a que ela substitui -- e a
regressao apareceria na tela mais usada, sem erro nenhum. Por isso a migration
`0015` traz `unaccent`, e por isso o teste do acento existe.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import PageParams
from tests.integration.conftest import acting_as, mship, node
from tests.integration import factories as f

pytestmark = pytest.mark.integration


async def _cenario(db):
    """Uma raiz sem o termo no titulo, com uma filha que TEM o termo.

    E o caso que a busca existe para resolver: a raiz e a campanha, e o que a
    pessoa lembra e o nome da peca.
    """
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    comum = {"workspace_id": ws, "created_by": user, "team_id": team}

    raiz = await f.make_task(db, **comum, title="Campanha de fim de ano")
    filha = await f.make_task(
        db, **comum, parent=raiz, title="Peça para Mídia Paga"
    )
    outra = await f.make_task(db, **comum, title="Reuniao de alinhamento")
    arquivada = await f.make_task(
        db, **comum, parent=outra, title="Post de Mídia antigo"
    )
    arquivada.is_archived = True
    # Descricao com o termo, titulo SEM: nao pode casar.
    so_descricao = await f.make_task(db, **comum, title="Tarefa qualquer")
    so_descricao.description = "isto fala de Midia Paga na descricao"
    await db.flush()
    return ws, team, user, raiz, filha, outra, so_descricao


async def _busca(db, *, ws, team, user, termo, include_archived=False):
    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        pagina = await TaskRepository(db).list_page_with_filters(
            PageParams(page=1, size=100),
            root_only=True,
            include_archived=include_archived,
            q=termo,
        )
    return {t.id for t in pagina.items}


async def test_acha_pela_subtarefa_e_devolve_a_MAE(db):
    """⚠️ O ponto inteiro da fatia.

    A raiz nao tem "Midia" no titulo; a filha tem. O card do quadro e sempre a
    raiz (ADR 0004), entao a unica forma de "achar" a subtarefa e trazer a mae.
    """
    ws, team, user, raiz, _filha, outra, _sd = await _cenario(db)
    achados = await _busca(db, ws=ws, team=team, user=user, termo="Mídia")
    assert raiz.id in achados
    assert outra.id not in achados


async def test_ignora_acento_nos_DOIS_sentidos(db):
    """⚠️ O caso que obriga o `unaccent` da migration 0015.

    Digitar sem acento tem de achar o titulo COM acento -- que e o que
    `normalizarBusca` faz no front hoje. Sem isto a busca do servidor devolve
    menos que a do cliente que ela substitui.
    """
    ws, team, user, raiz, _f, _o, _sd = await _cenario(db)
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="midia"
    )
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="Mídia"
    )


async def test_ignora_caixa(db):
    ws, team, user, raiz, _f, _o, _sd = await _cenario(db)
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="MIDIA PAGA"
    )


async def test_descricao_NAO_casa(db):
    """⚠️ Decisao de 05/08 mantida: so titulo.

    Casando por descricao o card aparece com o termo buscado em lugar nenhum da
    tela, e a leitura honesta de quem olha e "o filtro bugou".
    """
    ws, team, user, _raiz, _f, _o, so_descricao = await _cenario(db)
    achados = await _busca(db, ws=ws, team=team, user=user, termo="descricao")
    assert so_descricao.id not in achados


async def test_subtarefa_arquivada_segue_o_include_archived(db):
    """A busca enxerga o mesmo conjunto que o quadro carregou -- igual a hoje."""
    ws, team, user, _raiz, _f, outra, _sd = await _cenario(db)
    sem = await _busca(
        db, ws=ws, team=team, user=user, termo="antigo", include_archived=False
    )
    com = await _busca(
        db, ws=ws, team=team, user=user, termo="antigo", include_archived=True
    )
    assert outra.id not in sem
    assert outra.id in com


async def test_termo_vazio_nao_filtra_nada(db):
    """String vazia ou so espaco tem de ser 'sem busca', e nao 'casa tudo com
    LIKE %%' -- o resultado seria o mesmo por acidente, mas o custo nao."""
    ws, team, user, raiz, _f, outra, so_descricao = await _cenario(db)
    for termo in ("", "   ", None):
        achados = await _busca(db, ws=ws, team=team, user=user, termo=termo)
        assert {raiz.id, outra.id, so_descricao.id} <= achados


async def test_nao_acha_em_outro_workspace(db):
    """A busca passa pelo `_base_select`, mas o EXISTS da subarvore e escrito a
    mao -- este teste e o que garante que ele nao esqueceu o tenant."""
    ws_a, team_a, user_a, raiz_a, _f, _o, _sd = await _cenario(db)
    _ws_b, _tb, _ub, raiz_b, _fb, _ob, _sdb = await _cenario(db)
    achados = await _busca(db, ws=ws_a, team=team_a, user=user_a, termo="Mídia")
    assert raiz_a.id in achados
    assert raiz_b.id not in achados
