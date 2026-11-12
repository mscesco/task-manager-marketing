"""Factories minimas para os testes de integracao.

Inserem via add()/flush() dentro da transacao do teste (sem commit) e
devolvem o id. `make_task` calcula path/depth como o dominio; os testes de
hierarquia usam `TaskService.create` para exercitar a logica.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    BaseColumn,
    BaseRow,
    BaseTable,
    BaseView,
    Project,
    Task,
    Team,
    User,
    UserTeam,
    Workspace,
)
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.domain.board_defaults import (
    COLUNAS_PADRAO,
    ColunaPadrao,
)


def _label(task_id: uuid.UUID) -> str:
    return f"t{task_id.hex}"


async def make_workspace(db: AsyncSession, *, name: str = "WS Teste") -> uuid.UUID:
    ws = Workspace(id=uuid.uuid4(), name=name, slug=f"ws-{uuid.uuid4().hex[:8]}")
    db.add(ws)
    await db.flush()
    return ws.id


async def make_user(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    email: str | None = None,
    is_active: bool = True,
    org_role: str | None = None,
) -> uuid.UUID:
    """`is_active=False` serve ao filtro de destinatario de aviso de prazo."""
    uid = uuid.uuid4()
    db.add(
        User(
            id=uid,
            workspace_id=workspace_id,
            name="User Teste",
            email=email or f"u-{uid.hex[:8]}@teste.dev",
            password_hash="x",
            is_active=is_active,
            org_role=org_role,
        )
    )
    await db.flush()
    return uid


async def make_team(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    parent_team_id: uuid.UUID | None = None,
    slug: str | None = None,
) -> uuid.UUID:
    tid = uuid.uuid4()
    db.add(
        Team(
            id=tid,
            workspace_id=workspace_id,
            parent_team_id=parent_team_id,
            name=slug or f"team-{tid.hex[:6]}",
            slug=slug or f"team-{tid.hex[:6]}",
        )
    )
    await db.flush()

    # Time raiz nasce com o quadro de oito colunas (`COLUNAS_PADRAO`, o do
    # provisionamento); sem quadro, `TaskService.create` falha. Subtime nao
    # ganha quadro. Quadro fora do padrao: `make_board`.
    if parent_team_id is None:
        await BoardService(db).create_default_board(
            workspace_id=workspace_id, team_id=tid,
            colunas=COLUNAS_PADRAO,
        )
    return tid


async def make_board(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    team_id: uuid.UUID,
    is_default: bool = False,
    name: str | None = None,
    com_legacy_status: bool = True,
    colunas: tuple[ColunaPadrao, ...] = COLUNAS_PADRAO,
) -> Board:
    """Um quadro extra para o time.

    `is_default=False` por padrao: o padrao ja nasce com o time raiz, e um
    segundo padrao falha no indice `board_um_padrao_por_time`. Nao usa o
    `BoardService` porque ele grava `is_default=True` e da flush antes de
    qualquer ajuste; `test_make_board_gera_o_mesmo_quadro_que_o_servico`
    garante que os dois montam o mesmo quadro.

    `colunas=COLUNAS_BASE` monta o quadro de quatro colunas: quatro status nao
    tem coluna, entao `coluna_para_status` cai na semantica em vez da ponte.
    `com_legacy_status=False` monta oito colunas sem ponte (como coluna criada
    por gente); varias dividem a mesma semantica, entao nao discrimina o
    fallback.
    """
    quadro = Board(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        team_id=team_id,
        name=name or f"Quadro {uuid.uuid4().hex[:6]}",
        is_default=is_default,
    )
    db.add(quadro)
    await db.flush()  # precisa do id para as colunas

    for posicao, coluna in enumerate(colunas):
        db.add(
            BoardColumn(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                board_id=quadro.id,
                name=coluna.nome,
                color=coluna.cor,
                position=posicao,
                semantic=coluna.semantica,
                notify_deadline=coluna.notify_deadline,
                is_default_target=coluna.is_default_target,
                legacy_status=coluna.legacy_status if com_legacy_status else None,
            )
        )
    await db.flush()
    return quadro


async def add_member(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    role: str,
) -> None:
    db.add(
        UserTeam(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            team_id=team_id,
            role=role,
        )
    )
    await db.flush()


async def make_project(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    team_id: uuid.UUID | None,
    title: str = "Projeto",
) -> uuid.UUID:
    pid = uuid.uuid4()
    db.add(
        Project(
            id=pid,
            workspace_id=workspace_id,
            title=title,
            description="",
            created_by=created_by,
            team_id=team_id,
        )
    )
    await db.flush()
    return pid


async def make_base(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    team_id: uuid.UUID,
    name: str = "Calendario",
    deleted: bool = False,
) -> dict[str, uuid.UUID | str]:
    """Uma base como o produto a cria (coluna de titulo e visao padrao), mais
    uma coluna de selecao com uma opcao, uma linha e uma segunda visao. Nao usa
    o `BaseService`. Devolve os ids pelo nome."""
    base_id = uuid.uuid4()
    titulo_id = uuid.uuid4()
    coluna_id = uuid.uuid4()
    opcao_id = str(uuid.uuid4())
    linha_id = uuid.uuid4()
    visao_padrao_id = uuid.uuid4()
    visao_id = uuid.uuid4()
    db.add(
        BaseTable(
            id=base_id,
            workspace_id=workspace_id,
            team_id=team_id,
            name=name,
            description="",
            created_by=created_by,
            deleted_at=datetime.now(UTC) if deleted else None,
            deleted_by=created_by if deleted else None,
        )
    )
    await db.flush()
    db.add_all(
        [
            BaseColumn(
                id=titulo_id, workspace_id=workspace_id, base_id=base_id,
                name="Título", type="title", options=[], position=1,
            ),
            BaseColumn(
                id=coluna_id, workspace_id=workspace_id, base_id=base_id,
                name="Plataforma", type="select", position=2,
                options=[
                    {"id": opcao_id, "label": "Instagram", "color": "purple",
                     "deleted_at": None}
                ],
            ),
            BaseRow(
                id=linha_id, workspace_id=workspace_id, base_id=base_id,
                created_by=created_by,
                values={str(titulo_id): "Collab", str(coluna_id): opcao_id},
            ),
            BaseView(
                id=visao_padrao_id, workspace_id=workspace_id, base_id=base_id,
                name="Tabela", layout="table", config={}, position=1,
                is_default=True,
            ),
            BaseView(
                id=visao_id, workspace_id=workspace_id, base_id=base_id,
                name="Por status", layout="board", config={}, position=2,
            ),
        ]
    )
    await db.flush()
    return {
        "base": base_id,
        "titulo": titulo_id,
        "coluna": coluna_id,
        "opcao": opcao_id,
        "linha": linha_id,
        "visao_padrao": visao_padrao_id,
        "visao": visao_id,
    }


async def _coluna_do_status_no_quadro(
    db: AsyncSession, *, workspace_id: uuid.UUID, board_id: uuid.UUID, status: TaskStatus
) -> uuid.UUID | None:
    """`column_id` daquele status no quadro, so pela ponte (`legacy_status`).

    Nao reproduz o fallback por semantica do `coluna_para_status`, de proposito.
    Num quadro de quatro colunas, use `BACKLOG`, `IN_PROGRESS`, `COMPLETED` ou
    `CANCELLED`."""
    linha = (
        await db.execute(
            text(
                """
                SELECT c.id
                FROM board_column c
                WHERE c.board_id = :board
                  AND c.workspace_id = :ws
                  AND c.legacy_status = CAST(:st AS task_status)
                """
            ),
            {"board": board_id, "ws": workspace_id, "st": status.value},
        )
    ).first()
    return None if linha is None else linha[0]


async def _quadro_geral_e_coluna(
    db: AsyncSession, *, workspace_id: uuid.UUID, status: TaskStatus
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Quadro padrao do time raiz e a coluna do status. Espelha
    `BoardRepository.default_board_and_column_for_status`."""
    linha = (
        await db.execute(
            text(
                """
                SELECT b.id, c.id
                FROM board b
                JOIN team t
                  ON t.id = b.team_id
                 AND t.workspace_id = b.workspace_id
                 AND t.parent_team_id IS NULL
                JOIN board_column c
                  ON c.board_id = b.id
                 AND c.legacy_status = CAST(:st AS task_status)
                WHERE b.workspace_id = :ws
                  AND b.is_default
                """
            ),
            {"ws": workspace_id, "st": status.value},
        )
    ).first()
    return None if linha is None else (linha[0], linha[1])


async def make_task(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    team_id: uuid.UUID | None,
    project_id: uuid.UUID | None = None,
    parent: Task | None = None,
    title: str = "Task",
    status: TaskStatus = TaskStatus.BACKLOG,
    board_id: uuid.UUID | None = None,
) -> Task:
    """Uma tarefa pronta, sem passar pelo TaskService.

    Quadro: `board_id=` explicito; senao o do `parent=` (subtarefa herda o
    quadro do pai); senao o quadro padrao do time raiz. `board_id=` diferente do
    quadro do pai e recusado: a FK composta aceitaria a arvore partida.

    Mudar `task.status` depois deixa a coluna do status antigo; passe `status=`.
    """
    tid = uuid.uuid4()
    if parent is None:
        path = _label(tid)
        depth = 0
        parent_task_id = None
    else:
        path = f"{parent.path}.{_label(tid)}"
        depth = parent.depth + 1
        parent_task_id = parent.id

    if parent is not None and board_id is not None and parent.board_id != board_id:
        # `if/raise` e nao `assert`: tem de valer mesmo com pytest -O.
        raise AssertionError(
            "make_task recebeu `board_id` diferente do quadro do pai "
            f"(pai={parent.board_id}, pedido={board_id}). Isso monta a mao a "
            "arvore partida entre dois quadros que a F2 fechou -- a FK "
            "composta ACEITA esse par e o defeito nao aparece em lugar "
            "nenhum. Passe so `parent=`, ou monte a linha a mao e explique."
        )

    # Quadro e coluna resolvidos antes de montar a Task: `board_id`/`column_id`
    # tem FK composta, e uma consulta entre as duas atribuicoes dispararia
    # autoflush do par inconsistente.
    alvo = board_id if board_id is not None else (
        parent.board_id if parent is not None else None
    )

    if alvo is None:
        quadro = await _quadro_geral_e_coluna(
            db, workspace_id=workspace_id, status=status
        )
        assert quadro is not None, (
            f"workspace {workspace_id} nao tem quadro geral com coluna para "
            f"{status.value}. O time RAIZ foi criado por `make_team`? "
            "E ele quem cria o quadro."
        )
        board_alvo, coluna_alvo = quadro
    else:
        coluna_alvo = await _coluna_do_status_no_quadro(
            db, workspace_id=workspace_id, board_id=alvo, status=status
        )
        assert coluna_alvo is not None, (
            f"o quadro {alvo} nao tem coluna com legacy_status={status.value}. "
            "Ou o quadro e de outro workspace, ou ele foi criado com "
            "`com_legacy_status=False` -- quadro de colunas criadas por gente "
            "NAO responde por status (D4). Passe um `status` que exista la, ou "
            "escolha a coluna a mao."
        )
        board_alvo = alvo

    task = Task(
        id=tid,
        workspace_id=workspace_id,
        project_id=project_id,
        parent_task_id=parent_task_id,
        team_id=team_id,
        created_by=created_by,
        title=title,
        description="",
        path=path,
        depth=depth,
        status=status,
        board_id=board_alvo,
        column_id=coluna_alvo,
    )
    db.add(task)
    await db.flush()
    return task


async def make_assignment(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    assigned_by: uuid.UUID,
) -> None:
    """Insere assignment direto, sem as travas do service: e assim que nasce
    designacao fora da lente."""
    from app.db.models import TaskAssignment

    db.add(
        TaskAssignment(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=task_id,
            user_id=user_id,
            assigned_by=assigned_by,
        )
    )
    await db.flush()


async def make_watcher(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    from app.db.models import TaskWatcher

    db.add(
        TaskWatcher(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=task_id,
            user_id=user_id,
        )
    )
    await db.flush()
