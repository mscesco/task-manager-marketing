"""Dois times raiz no mesmo workspace, no banco.

Os defeitos que estes testes guardam nao levantam excecao: gravam no quadro ou
na arvore do outro time raiz.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Board, BoardColumn
from app.db.models.enums import TaskStatus, UserTeamRole
from app.modules.tasks.application.task_service import CreateTaskCommand, TaskService
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.users.application.member_service import MemberService
from app.modules.workspaces.application.workspace_service import TeamService
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _dois_times_raiz(db):
    """Marketing (com SEO) e TI (com Infra), irmaos, cada um com quadro geral.

    O quadro geral vem da `make_team` (todo time sem pai); cria-lo de novo viola
    `board_um_padrao_por_time`. O nome sai do slug, por isso "marketing"/"ti".
    """
    ws = await f.make_workspace(db)
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=marketing, slug="seo")
    ti = await f.make_team(db, workspace_id=ws, slug="ti")
    infra = await f.make_team(db, workspace_id=ws, parent_team_id=ti, slug="infra")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    await db.flush()

    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        org_role="ADMIN",
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
            TaskStatus.BACKLOG, root_team_id=marketing
        )
        q_ti, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, root_team_id=ti
        )
    return ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin


async def test_criar_outro_time_raiz_pelo_servico(db) -> None:
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        roots = await TeamRepository(db).root_team_ids()

    assert nova.parent_team_id is None
    assert len(roots) == 3


async def test_o_time_raiz_NOVO_nasce_COM_quadro_geral(db) -> None:
    """Time raiz nao nasce sem quadro.

    A `make_team` cria o quadro sozinha, entao so o `TeamService.create` prova
    isto. Confere pelo caminho onde nasce a tarefa de topo.
    """
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        nova = await TeamService(db).create(name="Design", slug="design")
        await db.flush()
        quadro, coluna = await BoardRepository(db).default_board_and_column_for_status(
            TaskStatus.BACKLOG, root_team_id=nova.id
        )

    assert quadro is not None
    assert coluna is not None

    # E o quadro e dele, nao o de outro time.
    with acting_as(**ctx):
        do_marketing, _ = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG, root_team_id=marketing)
    assert quadro != do_marketing


async def test_o_time_novo_nasce_com_as_QUATRO_colunas_comuns(db) -> None:
    """As oito colunas do Marketing sao historicas; time novo nasce com quatro."""
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
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
    """Status sem ponte no quadro de quatro colunas cai no alvo da semantica.

    `PLANNED` e OPEN -> Backlog; `IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED`
    sao IN_PROGRESS -> Em Andamento. A tela nao pega isto (manda BACKLOG); quem
    manda status explicito e n8n/script.
    """
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
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
                st, root_team_id=nova.id
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
    """No quadro de oito colunas a ponte ganha; inverter da estado valido e errado."""
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        _, coluna_id = await BoardRepository(
            db
        ).default_board_and_column_for_status(
            TaskStatus.EXTERNAL_APPROVAL, root_team_id=marketing
        )
        nome = (
            await db.execute(
                select(BoardColumn.name).where(BoardColumn.id == coluna_id)
            )
        ).scalar_one()

    assert nome == "Aprovação Externa"


async def test_SUBTIME_novo_nao_nasce_com_quadro_geral(db) -> None:
    """Subtime so tem quadro interno; o indice parcial nao impediria um padrao nele."""
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
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


async def test_root_team_ids_vem_ordenado_por_nome(db) -> None:
    """Sem `ORDER BY` a ordem do Postgres muda sozinha; mesma ordem do front."""
    ctx, ws, marketing, seo, ti, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        roots = await TeamRepository(db).root_team_ids()
    # 'marketing' < 'ti' por nome.
    assert roots == [marketing, ti]


async def test_root_team_id_of_sobe_pela_PROPRIA_arvore(db) -> None:
    ctx, ws, marketing, seo, ti, infra, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        repo = TeamRepository(db)
        assert await repo.root_team_id_of(seo) == marketing
        assert await repo.root_team_id_of(infra) == ti
        # Um time raiz responde a si mesmo.
        assert await repo.root_team_id_of(ti) == ti


async def test_esvaziar_subtime_do_TI_nao_despeja_no_marketing(db) -> None:
    """O destino do esvaziamento e a raiz da propria arvore, nao uma qualquer."""
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _dois_times_raiz(db)
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

    # O ator precisa alcancar os dois times raiz: o ADMIN de organizacao do `ctx`.
    with acting_as(**ctx):
        previa = await TeamService(db).esvaziar_e_remover(team_id=infra)

    await db.refresh(tarefa)
    assert tarefa.team_id == ti
    assert tarefa.team_id != marketing
    assert previa.destino_team_id == ti
    assert previa.destino_nome == "ti"


async def test_a_previa_NOMEIA_o_time_raiz_de_destino(db) -> None:
    ctx, ws, marketing, seo, ti, infra, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        previa = await TeamService(db).previa_remocao(team_id=seo)

    assert previa.destino_team_id == marketing
    assert previa.destino_nome == "marketing"


async def test_a_previa_de_um_TIME_RAIZ_nao_tem_destino(db) -> None:
    """Time raiz nao e removivel, entao nao ha destino."""
    ctx, ws, marketing, *_ = await _dois_times_raiz(db)
    with acting_as(**ctx):
        previa = await TeamService(db).previa_remocao(team_id=marketing)

    assert previa.eh_raiz is True
    assert previa.destino_team_id is None
    assert previa.destino_nome is None


async def test_o_quadro_geral_e_o_DO_TIME_RAIZ(db) -> None:
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, _admin = await _dois_times_raiz(db)
    with acting_as(**ctx):
        repo = BoardRepository(db)
        b_mkt, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, root_team_id=marketing
        )
        b_ti, _ = await repo.default_board_and_column_for_status(
            TaskStatus.BACKLOG, root_team_id=ti
        )

    assert b_mkt == q_mkt
    assert b_ti == q_ti
    assert b_mkt != b_ti


async def test_tarefa_de_subtime_do_TI_nasce_no_quadro_do_TI(db) -> None:
    """Tarefa de subtime vive no quadro geral da raiz dela; nada acusaria o erro."""
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _dois_times_raiz(db)
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
    # O quadro e da raiz; o time continua sendo o subtime.
    assert tarefa.team_id == infra


async def test_sem_time_e_sem_quadro_com_DOIS_times_raiz_e_recusado(db) -> None:
    """Recusa em vez de escolher, e a mensagem diz que e ambiguidade."""
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _dois_times_raiz(db)
    with acting_as(**ctx):
        with pytest.raises(ValidationError) as exc:
            await TaskService(db).create(
                CreateTaskCommand(
                    title="Sem endereco",
                    status=TaskStatus.BACKLOG,
                    assignee_ids=[admin],
                )
            )

    assert "mais de um time raiz" in str(exc.value)


# Gerente so administra gente da propria arvore.
async def test_gerente_NAO_administra_gente_de_outro_time_raiz(db) -> None:
    """Cadeado do painel e PATCH recusam juntos.

    So enxerga a diferenca porque passa `team_tree`: sem ela, `has_permission_in`
    cai fail-open na pergunta ampla (ver `conftest`).
    """
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _dois_times_raiz(db)

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
    # Herdar o ADMIN de organizacao do `ctx` deixaria o teste verde pelo motivo errado.
    como_gerente["org_role"] = None

    with acting_as(**como_gerente):
        svc = MemberService(db)

        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=alheio, team_id=infra, papel_atual=UserTeamRole.OPERATOR
        )
        with pytest.raises(AuthorizationError):
            await svc.change_member_role(
                user_id=alheio,
                team_id=infra,
                new_role=UserTeamRole.SUPERVISOR,
            )


async def test_gerente_CONTINUA_administrando_a_propria_arvore(db) -> None:
    """A outra metade: a recusa acima nao pode virar bloqueio geral."""
    ctx, ws, marketing, seo, ti, infra, q_mkt, q_ti, admin = await _dois_times_raiz(db)

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
    como_gerente["org_role"] = None  # ver o teste acima

    with acting_as(**como_gerente):
        svc = MemberService(db)
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=dele, team_id=seo, papel_atual=UserTeamRole.OPERATOR
        )
        # O subtime conta como propria arvore.
        vinculo = await svc.change_member_role(
            user_id=dele, team_id=seo, new_role=UserTeamRole.SUPERVISOR
        )
    assert vinculo.role is UserTeamRole.SUPERVISOR
