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
from sqlalchemy import select

from app.db.models import Board, BoardColumn
from app.db.models.enums import TaskStatus, UserTeamRole
from app.modules.tasks.application.task_service import CreateTaskCommand, TaskService
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.workspaces.application.workspace_service import TeamService
from app.modules.users.application.member_service import MemberService
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import AuthorizationError, ValidationError
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


async def test_a_area_NOVA_nasce_COM_quadro_geral(db) -> None:
    """⭐⭐ A invariante ditada pela Camila em 10/09: *"time raiz que nao pode
    nascer sem quadro"*.

    ⚠️⚠️ E ELA JA ERA DECISAO desde 02/09 (Spec 046 §4.3): *"cada raiz tem o
    seu, criado junto com ela"*. A metade que GARANTE UM SO foi implementada --
    o indice parcial `board_um_padrao_por_time`. A metade que CRIA ficou de
    fora: `create_default_board` so era chamado do provisionamento do
    WORKSPACE, e o `POST /teams` nao passa por lá. Da segunda area em diante, o
    time raiz nascia sem quadro.

    ⚠️⚠️ E O MOTIVO DE NENHUM TESTE TER PEGADO ESTA AQUI DENTRO: a factory
    `make_team` cria o quadro padrao para todo time sem pai, e o comentario
    dela diz **"igual ao produto"**. Nao era igual. A bancada cumpria a
    invariante que a producao violava, entao o defeito era invisivel por
    construcao -- toda area destes testes nasceu com quadro porque a FACTORY o
    criou, nunca porque o servico o criasse.

    ⚠️ A ASSERCAO E PELO CAMINHO QUE IMPORTA, e nao por um `SELECT` em `board`:
    `default_board_and_column_for_status` e quem responde onde nasce toda
    tarefa de topo. Se ela acha o quadro da area nova, a area nova funciona.
    Provar que "existe uma linha em board" provaria menos.
    """
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        await db.flush()
        quadro, coluna = await BoardRepository(db).default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=nova.id
        )

    assert quadro is not None
    assert coluna is not None

    # E o quadro e DELE, nao o de outro time.
    with acting_as(**ctx):
        do_marketing, _ = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG, area_id=marketing)
    assert quadro != do_marketing


async def test_o_time_novo_nasce_com_as_QUATRO_colunas_comuns(db) -> None:
    """⭐⭐ Correcao dela em 10/09: *"o quadro nao e pra nascer igual o do
    marketing, e pra nascer como um quadro comum, com backlog, em andamento,
    concluido e cancelado"*.

    ⚠️ As oito do Marketing sao HISTORICAS -- a copia da migration `0008`, o
    que esta em producao. Um time novo nao herda o passado dele.

    Sabotagem: passar `COLUNAS_PADRAO` no `TeamService.create` faz este teste
    ficar vermelho, e so ele.
    """
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        await db.flush()
        colunas = (
            (
                await db.execute(
                    select(BoardColumn.name)
                    .join(Board, Board.id == BoardColumn.board_id)
                    .where(Board.team_id == nova.id, Board.is_default.is_(True))
                    .order_by(BoardColumn.position)
                )
            )
            .scalars()
            .all()
        )

    assert list(colunas) == [
        "Backlog",
        "Em Andamento",
        "Concluído",
        "Cancelado",
    ]


async def test_os_QUATRO_status_sem_coluna_propria_caem_na_semantica(db) -> None:
    """⭐⭐ O degrau que torna as quatro colunas seguras para receber tarefa.

    ⚠️⚠️ SEM ELE, O TIME NOVO NAO RECEBE TAREFA DE TOPO com `PLANNED`,
    `IN_REVIEW`, `EXTERNAL_APPROVAL` nem `BLOCKED`: a
    `default_board_and_column_for_status` casava SO pela ponte
    (`legacy_status`), e as quatro colunas comuns tem quatro pontes. A ADR 0042
    tinha deixado esta funcao de fora do degrau de proposito -- e estava certo
    enquanto todo quadro geral tinha as oito.

    ⚠️ E NAO APARECERIA PELA TELA: o `createTask` do front nem manda `status`, e
    o padrao do backend e `BACKLOG`, que tem ponte. Quem manda status explicito
    e n8n, Swagger ou script -- 422 para eles, dias depois, sem relacao
    aparente com a criacao do time.

    ⚠️ CADA UM CAI NO ALVO DA SUA SEMANTICA: `PLANNED` e OPEN -> Backlog;
    `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` sao IN_PROGRESS -> Em
    Andamento.
    """
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        await db.flush()
        repo = BoardRepository(db)
        destino = {}
        for st in (
            TaskStatus.PLANNED,
            TaskStatus.IN_REVIEW,
            TaskStatus.EXTERNAL_APPROVAL,
            TaskStatus.BLOCKED,
        ):
            _, coluna_id = await repo.default_board_and_column_for_status(
                st, area_id=nova.id
            )
            destino[st] = (
                await db.execute(
                    select(BoardColumn.name).where(BoardColumn.id == coluna_id)
                )
            ).scalar_one()

    assert destino[TaskStatus.PLANNED] == "Backlog"
    assert destino[TaskStatus.IN_REVIEW] == "Em Andamento"
    assert destino[TaskStatus.EXTERNAL_APPROVAL] == "Em Andamento"
    assert destino[TaskStatus.BLOCKED] == "Em Andamento"


async def test_a_PONTE_continua_ganhando_do_alvo_da_semantica(db) -> None:
    """⚠️ A ordem dos degraus, no quadro de OITO colunas.

    ⚠️ Inverter os degraus produz um estado VALIDO e errado: uma tarefa
    `EXTERNAL_APPROVAL` no quadro do Marketing pararia em "Em Andamento" --
    coluna do quadro certo, com a semantica certa, e no lugar errado. Nenhuma
    FK recusa e nenhum tipo reclama.
    """
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        _, coluna_id = await BoardRepository(
            db
        ).default_board_and_column_for_status(
            TaskStatus.EXTERNAL_APPROVAL, area_id=marketing
        )
        nome = (
            await db.execute(
                select(BoardColumn.name).where(BoardColumn.id == coluna_id)
            )
        ).scalar_one()

    assert nome == "Aprovação Externa"


async def test_SUBTIME_novo_nao_nasce_com_quadro_geral(db) -> None:
    """⚠️ A outra metade da invariante, e ela e uma NEGACAO.

    Subtime nao tem quadro geral -- ele tem quadro INTERNO, `is_default=False`,
    criado por gente e com nome escolhido (ADR 0032). Criar um padrao aqui
    daria a cada subtime um segundo "Quadro geral", e o indice parcial nem
    reclamaria: ele e por TIME, e o subtime e outro time.

    Sabotagem: tirar o `if parent_team_id is None` do `TeamService.create` faz
    este teste ficar vermelho, e nenhum outro.
    """
    ctx, ws, marketing, *_ = await _duas_areas(db)
    with acting_as(**ctx):
        sub = await TeamService(db).create(
            name="Conteudo", slug="conteudo", parent_team_id=marketing
        )
        await db.flush()
        padroes = (
            await db.execute(
                select(Board).where(
                    Board.team_id == sub.id, Board.is_default.is_(True)
                )
            )
        ).scalars().all()

    assert padroes == []


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

    # ⚠️ Spec 051, fatia D: ESVAZIAR COMO ADMIN DE ORGANIZACAO. O vinculo ADMIN
    # antigo no Marketing e comando SO naquela arvore, e esvaziar o Infra (do
    # TI) passou a conferir `subteam.delete` no time. O que este teste mede e o
    # destino do esvaziamento, e para isso o ator precisa alcancar as duas.
    with acting_as(**{**ctx, "org_role": "ADMIN"}):
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


# ------------------------------------------------------------------
# ⭐⭐ Gerente so mexe na PROPRIA arvore (decisao da Camila, 09/09)
# ------------------------------------------------------------------
async def test_gerente_NAO_administra_gente_de_outra_area(db) -> None:
    """⭐⭐ O achado do code review de 09/09, virando regra.

    Ate aqui `change_member_role` perguntava "voce tem `team.manage` EM ALGUM
    LUGAR?" -- e com uma area so isso coincidia com a verdade, porque nao
    havia outro lugar. Com duas areas a pergunta larga vira um buraco: a
    gerente do Marketing troca o cargo de alguem no TI.

    ⚠️ E O CADEADO DO PAINEL FOI ESTREITADO NO MESMO COMMIT. Se so um dos dois
    mudasse, tela e servidor passariam a discordar -- cadeado aberto que da
    403 ao salvar, ou cadeado fechado escondendo acao permitida. E o teste da
    concordancia (`test_o_cadeado_concorda_com_o_patch`) nao pegaria: ele roda
    com UMA area, onde as duas perguntas continuam iguais.

    ⚠️ E ESTE TESTE SO ENXERGA A DIFERENCA PORQUE PASSA `team_tree`. Sem a
    arvore, `acting_as` monta as permissoes como `frozenset`, e
    `has_permission_in` cai fail-open na pergunta ampla -- o teste ficaria
    verde com a regra errada. Esta escrito no `conftest`.
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _duas_areas(db)

    gerente = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=marketing, role="MANAGER"
    )
    alheio = await f.make_user(db, workspace_id=ws, email="ti@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=alheio, team_id=infra, role="OPERATOR"
    )
    await db.flush()

    como_gerente = dict(ctx)
    como_gerente["user_id"] = gerente
    como_gerente["memberships"] = (mship(marketing, "MANAGER"),)

    with acting_as(**como_gerente):
        svc = MemberService(db)

        # ⚠️ O cadeado FECHA para a area alheia...
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=alheio, team_id=infra, papel_atual=UserTeamRole.OPERATOR
        )
        # ...e o PATCH recusa, pelo mesmo motivo.
        with pytest.raises(AuthorizationError):
            await svc.change_member_role(
                user_id=alheio,
                team_id=infra,
                new_role=UserTeamRole.SUPERVISOR,
            )


async def test_gerente_CONTINUA_administrando_a_propria_arvore(db) -> None:
    """⚠️ A metade que impede o conserto de virar bloqueio geral.

    Sem este caso, "gerente nao administra ninguem" passaria pelo teste acima
    -- e o estreitamento teria tirado do MANAGER o trabalho que e dele.
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _duas_areas(db)

    gerente = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=marketing, role="MANAGER"
    )
    dele = await f.make_user(db, workspace_id=ws, email="seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dele, team_id=seo, role="OPERATOR"
    )
    await db.flush()

    como_gerente = dict(ctx)
    como_gerente["user_id"] = gerente
    como_gerente["memberships"] = (mship(marketing, "MANAGER"),)

    with acting_as(**como_gerente):
        svc = MemberService(db)
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=dele, team_id=seo, papel_atual=UserTeamRole.OPERATOR
        )
        # ⚠️ O SUBTIME conta como "propria arvore": `permissions_for_actor`
        # concede ao comando o time do vinculo MAIS os descendentes.
        vinculo = await svc.change_member_role(
            user_id=dele, team_id=seo, new_role=UserTeamRole.SUPERVISOR
        )
    assert vinculo.role is UserTeamRole.SUPERVISOR
