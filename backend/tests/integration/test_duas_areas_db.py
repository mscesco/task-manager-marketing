"""Spec 046 -- DUAS AREAS de verdade, no banco (fatias 2, 3 e 4).

⚠️⚠️ ESTE ARQUIVO SO PODE EXISTIR DEPOIS DA FATIA 2, e essa e a coisa mais
importante a saber sobre ele.

Enquanto o indice `team_unica_raiz_por_workspace` estava de pe, montar duas
areas era impossivel -- nem pelo servico, nem por `INSERT` direto. Por isso a
fatia 1 teve de provar a regra do front com a arvore em MEMORIA
(`web/lib/areas.ts`), e por isso a Spec 045 §3 avisou que uma spec inteira
podia ficar verde sem provar nada.

A migration `0023` derrubou o indice. Daqui em diante, "escolheu a area errada"
deixa de ser hipotese e vira um teste que fica vermelho.

⚠️ E O QUE ESTES TESTES GUARDAM NAO E ERRO DE EXECUCAO -- e RESPOSTA ERRADA.
Nenhum dos defeitos abaixo levanta excecao: eles gravam a tarefa no quadro de
outro departamento, ou despejam o conteudo do Marketing no TI. Sem estes
testes, todos os portoes ficam verdes.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import CreateTaskCommand, TaskService
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.workspaces.application.workspace_service import TeamService
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _duas_areas(db):
    """Marketing (com SEO) e TI (com Infra), irmaos, cada um com quadro geral.

    ⚠️ O QUADRO GERAL DE CADA AREA VEM DA PROPRIA FACTORY -- `make_team` cria
    um `create_default_board` para todo time SEM PAI, e so para esses (ADR
    0032). Cria-lo aqui de novo violaria o indice parcial
    `board_um_padrao_por_time` no primeiro flush.

    ⭐ E isso e a §4.3 acontecendo sem nada novo no modelo: "o quadro geral
    deixa de ser um objeto unico do workspace e passa a ser propriedade da
    area". Duas areas -> dois quadros gerais, por construcao.

    ⚠️ Os NOMES saem do slug (a factory nao aceita `name`), entao as asserces
    de ordenacao e de nome de destino usam "marketing"/"ti" minusculos.
    """
    ws = await f.make_workspace(db)
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=marketing, slug="seo")
    ti = await f.make_team(db, workspace_id=ws, slug="ti")
    infra = await f.make_team(db, workspace_id=ws, parent_team_id=ti, slug="infra")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=marketing, role="ADMIN"
    )
    await db.flush()

    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(marketing, "ADMIN"),),
        team_tree=(
            node(marketing),
            node(seo, marketing),
            node(ti),
            node(infra, ti),
        ),
    )
    with acting_as(**ctx):
        repo = BoardRepository(db)
        q_mkt, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=marketing
        )
        q_ti, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=ti
        )
    return ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin


# ------------------------------------------------------------------
# Fatia 2 -- as duas areas existem mesmo
# ------------------------------------------------------------------
async def test_criar_a_segunda_area_pelo_servico(db) -> None:
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        areas = await TeamRepository(db).areas_ids()

    assert nova.parent_team_id is None
    assert len(areas) == 3


async def test_areas_ids_vem_ORDENADA_por_nome(db) -> None:
    """⚠️ A ordem do Postgres sem `ORDER BY` nao e contrato.

    Quem pegar "a primeira" precisa de um criterio que nao mude sozinho. E o
    mesmo motivo, e a mesma ordenacao, de `rootTeams` no front.
    """
    ctx, ws, marketing, seo, ti, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        areas = await TeamRepository(db).areas_ids()
    # 'marketing' < 'ti' por nome.
    assert areas == [marketing, ti]


# ------------------------------------------------------------------
# Fatia 3 -- o conteudo NUNCA atravessa areas
# ------------------------------------------------------------------
async def test_area_de_sobe_pela_PROPRIA_arvore(db) -> None:
    """⭐⭐ O teste que a raiz unica tornava impossivel.

    `area_de` substituiu `root_id()`, que nao recebia nada e devolvia "a raiz
    do workspace". Com uma area so, as duas davam a mesma resposta SEMPRE --
    por isso o defeito nao tinha como aparecer antes desta fatia.

    Sabotagem rodada: `area_de` de volta para "a primeira area do workspace"
    (o `root_id()` antigo) -> suite inteira, **3 failed**, todos deste
    arquivo: este, o do esvaziamento e o do quadro da tarefa.

    ⚠️ EU TINHA ESCRITO AQUI "e so nele", E ERA FALSO -- a medicao deu tres.
    O numero maior e a boa noticia: `area_de` sustenta tres comportamentos
    diferentes (resolver a arvore, escolher o destino do esvaziamento,
    escolher o quadro geral), e cada um tem guardiao proprio. Quem mexer nela
    vai ver os tres, e nao um.
    """
    ctx, ws, marketing, seo, ti, infra, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        repo = TeamRepository(db)
        assert await repo.area_de(seo) == marketing
        assert await repo.area_de(infra) == ti
        # Uma area responde a si mesma.
        assert await repo.area_de(ti) == ti


async def test_esvaziar_subtime_do_TI_nao_despeja_no_marketing(db) -> None:
    """⭐⭐ O defeito de produto que a fatia 3 mata, e ele e SILENCIOSO.

    Antes desta fatia o destino era `root_id()` -- "a raiz do workspace" --,
    que com duas areas devolveria uma delas. Esvaziar o Infra podia arquivar
    as tarefas do TI dentro do Marketing, sem erro nenhum: `team_id` valido,
    FK satisfeita, resposta 200.
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _duas_areas(db)
    with acting_as(**ctx):
        tarefa = await TaskService(db).create(
            CreateTaskCommand(
                title="Trocar o switch",
                team_id=infra,
                status=TaskStatus.BACKLOG,
                assignee_ids=[admin],
            )
        )
        await db.flush()

        previa = await TeamService(db).esvaziar_e_remover(team_id=infra)

    await db.refresh(tarefa)
    # A tarefa foi para a area DELA, e nao para a outra.
    assert tarefa.team_id == ti
    assert tarefa.team_id != marketing
    assert previa.destino_team_id == ti
    assert previa.destino_nome == "ti"


async def test_a_previa_NOMEIA_a_area_de_destino(db) -> None:
    """§4.2: a previa dizia quantos saem e nao dizia para onde.

    ⚠️ Com uma area so isso era toleravel -- o destino era obvio ate para quem
    nunca tinha pensado nele. Com N areas, "3 tarefas serao movidas" esconde
    justamente a informacao que faria alguem cancelar a operacao.
    """
    ctx, ws, marketing, seo, ti, infra, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        previa = await TeamService(db).previa_remocao(team_id=seo)

    assert previa.destino_team_id == marketing
    assert previa.destino_nome == "marketing"


async def test_a_previa_de_uma_AREA_nao_tem_destino(db) -> None:
    """Area nao e removivel -- entao nao ha destino a prometer."""
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        previa = await TeamService(db).previa_remocao(team_id=marketing)

    assert previa.eh_raiz is True
    assert previa.destino_team_id is None
    assert previa.destino_nome is None


# ------------------------------------------------------------------
# Fatia 4 -- a tarefa nasce no quadro geral DA AREA DELA
# ------------------------------------------------------------------
async def test_o_quadro_geral_e_o_DA_AREA(db) -> None:
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, _admin = await _duas_areas(db)
    with acting_as(**ctx):
        repo = BoardRepository(db)
        b_mkt, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=marketing
        )
        b_ti, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=ti
        )

    assert b_mkt == q_mkt
    assert b_ti == q_ti
    assert b_mkt != b_ti


async def test_tarefa_de_subtime_do_TI_nasce_no_quadro_do_TI(db) -> None:
    """⭐⭐ O defeito que a §3 da spec chamou de "raiz sorteada", no backend.

    A tarefa tem `team_id` do subtime (Infra) e vive no quadro geral da AREA
    dele -- que e o TI, e nao "a raiz do workspace". Antes da fatia 4, a
    consulta filtrava `parent_team_id IS NULL` e devolvia N candidatos: a
    tarefa do TI podia nascer desenhada no quadro do Marketing.

    ⚠️ E NADA acusaria: `board_id` valido, coluna valida, status coerente. A
    invariante 2 do `invariantes.sql` (coluna de outro quadro) continuaria
    zero, porque a coluna SERIA daquele quadro.
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _duas_areas(db)
    with acting_as(**ctx):
        tarefa = await TaskService(db).create(
            CreateTaskCommand(
                title="Rack novo",
                team_id=infra,
                status=TaskStatus.BACKLOG,
                assignee_ids=[admin],
            )
        )

    assert tarefa.board_id == q_ti
    assert tarefa.board_id != q_mkt
    # E o time dela continua sendo o SUBTIME -- o quadro e da area, o time nao.
    assert tarefa.team_id == infra


async def test_sem_time_e_sem_quadro_com_DUAS_areas_e_recusado(db) -> None:
    """⭐ Com N areas, "a raiz" deixou de ter resposta -- entao pergunta.

    ⚠️ ESCOLHER SERIA PIOR QUE RECUSAR, e e a mesma decisao que o front tomou
    em `soleRootTeam`: gravar no lugar errado produz dado que sobrevive ao
    conserto do codigo.

    ⚠️ A MENSAGEM DIZ QUE O PROBLEMA E AMBIGUIDADE. Sem isso, quem integra
    (n8n, Swagger) tenta de novo com o mesmo corpo achando que errou o
    formato.
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _duas_areas(db)
    with acting_as(**ctx):
        with pytest.raises(ValidationError) as exc:
            await TaskService(db).create(
                CreateTaskCommand(
                    title="Sem endereco",
                    status=TaskStatus.BACKLOG,
                    assignee_ids=[admin],
                )
            )

    assert "mais de uma area" in str(exc.value)
