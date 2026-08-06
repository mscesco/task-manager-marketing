"""Factories minimas para os testes de integracao.

Criam apenas o necessario dentro da transacao revertida do teste. Sem
dependencia do seed de producao. Inserem via add()/flush() (sem commit --
o teste controla a transacao) e devolvem o id.

make_task computa path/depth do mesmo jeito do dominio (label = 't'+hex),
para os testes que so precisam de "uma task existente". Os testes de
hierarquia usam TaskService.create de proposito, pra exercitar a logica.

⚠️ DESDE 06/08 (fatia "arreio de quadro") ESTE ARQUIVO SABE QUE EXISTE MAIS DE
UM QUADRO. Ate aqui `make_task` cravava o quadro do time RAIZ -- exatamente o
SQL que a F2 acabou de tirar do `BoardRepository`. Enquanto so existia um
quadro isso dava a resposta certa; no dia do segundo, a factory montaria a
tarefa no quadro geral com a coluna do quadro geral. Par internamente
consistente, **a FK composta ACEITA**, e o resultado e uma arvore partida
entre dois quadros sem erro e sem tela (a assimetria esta no cabecalho do
`board_repository`). O produto foi corrigido pela F2; o ARREIO nao tinha sido,
e e o arreio que escreve os testes da F3 e da F5.
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
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
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO


def _label(task_id: uuid.UUID) -> str:
    return f"t{task_id.hex}"


async def make_workspace(db: AsyncSession, *, name: str = "WS Teste") -> uuid.UUID:
    ws = Workspace(id=uuid.uuid4(), name=name, slug=f"ws-{uuid.uuid4().hex[:8]}")
    db.add(ws)
    await db.flush()
    return ws.id


async def make_user(
    db: AsyncSession, *, workspace_id: uuid.UUID, email: str | None = None
) -> uuid.UUID:
    uid = uuid.uuid4()
    db.add(
        User(
            id=uid,
            workspace_id=workspace_id,
            name="User Teste",
            email=email or f"u-{uid.hex[:8]}@teste.dev",
            password_hash="x",
            is_active=True,
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

    # ⚠️ TIME RAIZ NASCE COM QUADRO, igual ao produto (Spec 035 fatia 3a).
    # Desde a fatia 3b, `TaskService.create` resolve a coluna a partir do
    # status e FALHA se o workspace nao tiver quadro -- sem isto aqui, os 53
    # arquivos de teste que montam mundo pela factory parariam de conseguir
    # criar tarefa.
    #
    # ⚠️ SO na raiz. Subtime nao ganha quadro por existir (ADR 0032), e criar
    # um aqui violaria o `board_um_padrao_por_time` no primeiro subtime -- alem
    # de fazer a factory mentir sobre o produto.
    #
    # ⚠️ Quem precisa de um quadro NAO-padrao ou de colunas fora do padrao usa
    # `make_board` (abaixo). O que a factory entrega por padrao e o mundo
    # comum, nao todos os mundos.
    if parent_team_id is None:
        await BoardService(db).create_default_board(
            workspace_id=workspace_id, team_id=tid
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
) -> Board:
    """Um SEGUNDO quadro, para o teste que precisa de mais de um.

    Existe porque ate 06/08 montar o segundo quadro era trabalho manual dentro
    do teste (`test_board_scoping_db._mundo`), e por isso quase nenhum teste
    montava -- que e a razao de o SQL cravado no quadro da raiz ter passado
    despercebido desde a 035.

    ⚠️ `is_default=False` POR PADRAO, ao contrario do `BoardService`. O quadro
    interno da D1 e nao-padrao; o padrao ja nasce com o time raiz. Pedir
    `is_default=True` para um time que ja tem quadro padrao FALHA no flush, no
    indice parcial `board_um_padrao_por_time` -- e falhar ali e o certo.

    ⚠️ POR QUE NAO CHAMAR `BoardService.create_default_board` E AJUSTAR DEPOIS.
    O servico grava `is_default=True` e da flush ANTES de qualquer ajuste. Para
    o time raiz, esse estado intermediario ja viola o indice parcial -- o erro
    viria do estado transitorio, nao do que o teste pediu. As colunas vem do
    MESMO `COLUNAS_PADRAO` do servico; o que esta duplicado aqui e so o
    mapeamento NamedTuple -> BoardColumn, e existe
    `test_make_board_gera_o_mesmo_quadro_que_o_servico` comparando os dois
    campo a campo, pelo mesmo remedio que a 035 usou para a lista da migration
    versus a do servico.

    ⚠️ `com_legacy_status=False` monta o quadro do dia da D4: oito colunas com
    `legacy_status` NULL, que e como nasce coluna criada por GENTE. Um quadro
    assim NAO responde por status -- `column_for_status_in_board` levanta, e
    `make_task(board_id=...)` nele tambem. Isso e o comportamento correto ate a
    derivacao pela semantica existir, e o fixture serve justamente para provar
    que ele falha alto em vez de escolher uma coluna qualquer.
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

    for posicao, coluna in enumerate(COLUNAS_PADRAO):
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
    is_personal: bool = False,
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
            is_personal=is_personal,
        )
    )
    await db.flush()
    return pid


async def _coluna_do_status_no_quadro(
    db: AsyncSession, *, workspace_id: uuid.UUID, board_id: uuid.UUID, status: TaskStatus
) -> uuid.UUID | None:
    """`column_id` daquele status DENTRO daquele quadro. Espelha o
    `BoardRepository.column_for_status_in_board` -- de proposito, para o arreio
    e o produto responderem a mesma pergunta do mesmo jeito."""
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
    """Quadro do time RAIZ e a coluna do status. Espelha o
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

    ⚠️ QUADRO E COLUNA, senao a `0011` recusa a linha: os dois viraram NOT
    NULL. A factory monta a linha DIRETO, sem passar pelo TaskService -- e o
    service e quem resolve a coluna no produto.

    ⚠️ COMO O QUADRO E ESCOLHIDO, em ordem de precedencia -- e a mesma regra do
    produto depois da F2:

      1. `board_id=` explicito -> aquele quadro.
      2. `parent=` -> o quadro DO PAI. Subtarefa herda o quadro do pai, sempre
         (F2). Ate 06/08 a factory ignorava isso e mandava a filha para o
         quadro da raiz: par `(board geral, coluna geral)` internamente
         consistente, FK ACEITA, arvore partida em silencio.
      3. nada -> o quadro geral, do time RAIZ (`parent_team_id IS NULL` +
         `is_default`), que e o comportamento de sempre e o que os 108 usos
         existentes esperam.

    ⚠️ `board_id=` JUNTO COM `parent=` de outro quadro e RECUSADO. Nao existe
    caso legitimo: seria montar a mao exatamente o defeito silencioso que a F2
    fechou. Se algum teste um dia precisar desse estado partido para provar que
    o produto o rejeita, ele monta a mao e escreve por que.

    ⚠️ LIMITE CONHECIDO, herdado: quem mexe em `task.status` DEPOIS de chamar a
    factory (varios testes fazem, com `t.status = ...`) fica com a coluna do
    status ANTIGO. O banco aceita -- a FK composta so garante que a coluna e do
    mesmo quadro, nao que e a do status certo. Para esses testes tanto faz;
    quem testa a coluna usa o service, que e o caminho real. Se um dia isso
    incomodar, passe `status=` aqui em vez de atribuir depois.
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
        # ⚠️ `if/raise` e nao `assert`: e uma trava de coerencia do arreio, e
        # tem de valer inclusive se alguem rodar pytest com -O um dia.
        raise AssertionError(
            "make_task recebeu `board_id` diferente do quadro do pai "
            f"(pai={parent.board_id}, pedido={board_id}). Isso monta a mao a "
            "arvore partida entre dois quadros que a F2 fechou -- a FK "
            "composta ACEITA esse par e o defeito nao aparece em lugar "
            "nenhum. Passe so `parent=`, ou monte a linha a mao e explique."
        )

    # ⚠️ OS DOIS VALORES SAO RESOLVIDOS ANTES DE QUALQUER ATRIBUICAO, e isso
    # nao e estilo. `board_id` e `column_id` tem FK composta: uma consulta
    # feita ENTRE a atribuicao de um e a do outro dispara autoflush, grava o
    # par inconsistente e recebe ForeignKeyViolationError. Aqui os dois entram
    # no construtor, numa gravacao so.
    alvo = board_id if board_id is not None else (
        parent.board_id if parent is not None else None
    )

    if alvo is None:
        quadro = await _quadro_geral_e_coluna(
            db, workspace_id=workspace_id, status=status
        )
        assert quadro is not None, (
            f"workspace {workspace_id} nao tem quadro geral com coluna para "
            f"{status.value}. O time RAIZ foi criado por `make_team`? Desde a "
            "fatia 3a e ele quem cria o quadro."
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
    """Insere assignment DIRETO (sem as travas do service) -- e assim que
    cenarios out_of_scope nascem (admin designou, ou pessoa movida depois)."""
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
