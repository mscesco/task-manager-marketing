"""Router de QUADROS. Spec 036 fatia 2 -- a primeira superficie de API de
quadro do produto.

Rotas:
    GET   /boards        -- lista os quadros que quem pergunta ALCANCA
    POST  /boards        -- cria quadro avulso (Spec 036, fatia 5b)
    PATCH /boards/{id}   -- renomeia quadro (Spec 036, fatia 5b)

⚠️ APAGAR QUADRO NAO EXISTE AQUI, e a ausencia e decisao de 11/08: a lixeira e
fatia propria, com confirmacao digitada, contagem de SUBARVORE no aviso (excluir
uma mae leva as filhas) e o `UPDATE` de restauracao escrito em
`backend/scripts/` no mesmo commit. Nao ha tela de restaurar.

⚠️ AS DUAS ROTAS DE ESCRITA NAO TEM `require_permission`, E ISSO E DELIBERADO
-- LEIA ANTES DE "CONSERTAR". `require_permission` recebe UMA permissao, e a
autorizacao aqui depende do ALVO: quadro de time raiz exige
`board.manage.root`; de subtime, `board.manage.subteam` MAIS ser supervisor
daquele subtime. Quem sabe o `team_id` do alvo e o servico, nao a porta.

    Por que nao pendurar `board.manage.subteam` na porta como filtro grosso:
    o nome mentiria. A rota que cria quadro NA RAIZ estaria anunciando
    `subteam`, e a proxima pessoa a ler "conserta" trocando a regra do servico
    para casar com a porta -- e aí o supervisor cria quadro na raiz.

    ⚠️ CONSEQUENCIA: um OPERATOR chega a fazer UM SELECT (o do time) antes do
    403. Custo aceito e medido em uma consulta.

⚠️ MAS `TenantContextDep` CONTINUA OBRIGATORIO NAS DUAS ROTAS, E ELE PARECE NAO
USADO -- E O `_`. Nao apague. `set_tenant` e chamado num lugar so do produto
(`auth/api/dependencies.py`, dentro de `get_tenant_context`), e nao ha
middleware que popule o contexto. Rota que nao declara a dependencia roda SEM
tenant, e o primeiro `require_tenant()` la dentro estoura com
`missing_tenant_context`.

    ⚠️ ESTE DEFEITO EXISTIU, em 11/08, e nao foi hipotese: a primeira versao
    destas duas rotas tirou `require_permission` e nao pos nada no lugar. Os
    11 testes de `test_boards_escrita_http_db.py` falharam TODOS com
    `missing_tenant_context` -- e teriam falhado igual em producao, em 100%
    das requisicoes, com a matriz de autorizacao inteira verde no servico.

    ⚠️ A LICAO: `require_permission` faz DUAS coisas -- gate de permissao e
    `Depends(get_tenant_context)`. Tirar o gate NAO e tirar a dependencia.

⚠️ ENTAO O GATE DE ESCRITA E `BoardService._assert_pode_gerir`, e a matriz de
4 papeis x 3 alvos vive em `test_board_service_escrita_db.py`. Um teste HTTP
que so confirme 201/200 NAO prova autorizacao nenhuma; o que este arquivo
precisa cobrir e que a rota CHAMA o servico e que o erro dele vira o status
certo.

⚠️ SEM `require_permission`, E ISSO E DELIBERADO. O padrao da casa para
LEITURA e exatamente este: `GET /tasks` tambem pede so `TenantContextDep`, e
quem restringe e a lente dentro do repositorio. Acrescentar uma permissao
`board.read` aqui criaria um segundo eixo de autorizacao para a mesma pergunta
-- que e o que a ADR 0035 (D3) recusou explicitamente ao decidir que a
visibilidade do quadro sai de graca do `team_id` dele.

⚠️ ENTAO A TRAVA INTEIRA MORA NA CONSULTA, e nao na porta. Isso e o oposto do
caso da Spec 028, onde a trava era o gate da rota. Consequencia pratica para
quem for mexer: um teste que chame `BoardRepository.list_visible` direto prova
esta fatia; o teste HTTP (`test_boards_list_http_db.py`) existe para pegar o
dia em que alguem acrescentar um caminho alternativo de leitura no router.

⚠️ SEM PAGINACAO, e o numero esta medido: producao tem UM quadro em 06/08/2026
(`backend/scripts/invariantes.sql`, consulta 5), e a ADR 0034 preve poucas
dezenas no pior caso -- um por subtime. Paginar uma lista que o front precisa
inteira para desenhar o seletor de quadro seria complexidade a favor de um
volume que nao existe. Se a consulta 5 passar das dezenas, o lugar de rever e
este comentario.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import SessionDep, UoWDep
from app.db.models.boards import Board, BoardColumn
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    BoardColumnCreateRequest,
    BoardColumnDeleteResponse,
    BoardColumnDetailResponse,
    BoardColumnRenameRequest,
    BoardColumnResponse,
    BoardCreateRequest,
    BoardRenameRequest,
    BoardResponse,
)
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.infrastructure.board_repository import BoardRepository

router = APIRouter(prefix="/boards", tags=["boards"])


@router.get("", response_model=list[BoardResponse])
async def list_boards(
    _: TenantContextDep, session: SessionDep
) -> list[BoardResponse]:
    """Quadros que o usuario alcanca, pela lente (`visible_team_ids`).

    ADMIN ve todos os do PROPRIO workspace. MANAGER da raiz ve a raiz e os
    descendentes -- portanto os quadros internos. SUPERVISOR/OPERATOR de X ve
    X e a raiz, portanto o quadro geral e os do proprio subtime, e nao os de
    outro subtime (ADR 0035, D3).

    ⚠️ Quadro APAGADO nao aparece, e o filtro esta na consulta, nao aqui.
    Filtrar em Python depois de trazer tudo funcionaria e seria a versao que
    vaza no dia em que alguem acrescentar paginacao: a pagina viria cheia de
    quadro apagado e curta na tela.
    """
    quadros = await BoardRepository(session).list_visible()
    return [
        BoardResponse(
            id=quadro.id,
            name=quadro.name,
            team_id=quadro.team_id,
            is_default=quadro.is_default,
            colunas=[
                BoardColumnResponse.model_validate(coluna) for coluna in colunas
            ],
        )
        for quadro, colunas in quadros
    ]


async def _resposta(session, quadro: Board) -> BoardResponse:
    """Monta o `BoardResponse` lendo as colunas DO BANCO.

    ⚠️ LE, e nao ecoa `COLUNAS_BASE`. Se um dia a criacao filtrar, reordenar ou
    deduplicar coluna, a resposta acompanha sozinha -- mesmo raciocinio do
    `assignee_ids` no `POST /tasks`, que a Spec 021 aprendeu na marra.

    ⚠️ ORDER BY `position`. Sem ele a ordem e a do banco, que nao e ordem
    nenhuma e muda com UPDATE -- o seletor de coluna do front sairia
    embaralhado em relacao ao quadro, sem erro.
    """
    colunas = (
        (
            await session.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == quadro.id)
                .order_by(BoardColumn.position)
            )
        )
        .scalars()
        .all()
    )
    return BoardResponse(
        id=quadro.id,
        name=quadro.name,
        team_id=quadro.team_id,
        is_default=quadro.is_default,
        colunas=[BoardColumnResponse.model_validate(c) for c in colunas],
    )


@router.post(
    "",
    response_model=BoardResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_board(
    payload: BoardCreateRequest, _: TenantContextDep, uow: UoWDep
) -> BoardResponse:
    """Cria um quadro avulso para `team_id`, com as quatro colunas base.

    Autorizacao inteira no servico (ver o cabecalho do modulo):
    `board.manage.root` para time raiz; `board.manage.subteam` **mais** ser
    supervisor daquele subtime, para subtime. ADMIN e MANAGER passam nos dois
    pela saida de gestao ampla.

    A resposta e montada antes do commit, na mesma transacao que criou --
    convencao copiada do `POST /tasks`.

    ⚠️ E CONVENCAO, NAO TRAVA, E ISSO FOI MEDIDO EM 11/08. A versao anterior
    deste docstring afirmava que inverter a ordem faria os objetos expirarem e
    dispararia SELECT fora do greenlet. FALSO NESTE PROJETO: o sessionmaker usa
    `expire_on_commit=False` (`app/db/session.py:62`, com o comentario
    "objetos seguem usaveis pos-commit"), e o fixture `db` dos testes tambem.
    Mover o `commit()` para antes do `_resposta` deixa os 714 VERDES.

    ⚠️ ENTAO NAO CONSTRUA REGRA EM CIMA DISTO. Se um dia alguem ligar
    `expire_on_commit`, esta ordem passa a importar em toda a API de uma vez, e
    nenhum teste avisa -- nem aqui nem no `POST /tasks`.
    """
    quadro = await BoardService(uow.session).criar_quadro(
        team_id=payload.team_id, nome=payload.name
    )
    resposta = await _resposta(uow.session, quadro)
    await uow.commit()
    return resposta


@router.patch("/{board_id}", response_model=BoardResponse)
async def rename_board(
    board_id: uuid.UUID,
    payload: BoardRenameRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> BoardResponse:
    """Renomeia um quadro. NAO mexe em colunas, `team_id` nem `is_default`.

    ⚠️ O QUADRO GERAL PODE SER RENOMEADO, por `board.manage.root`. Renomear nao
    toca em coluna nenhuma -- as 176 tarefas vivas de 11/08 nao sentem. Editar
    e apagar COLUNA do geral e que continuam fora, na fatia seguinte.

    ⚠️ 404 vem antes de 403 aqui, e nao e descuido: o servico busca o quadro do
    workspace (`_quadro_do_workspace`) antes de perguntar permissao, porque a
    permissao depende do `team_id` DELE. Um `board_id` de outro workspace
    devolve 404, e nao 403 -- que e a resposta certa: 403 confirmaria que o
    quadro existe.
    """
    quadro = await BoardService(uow.session).renomear_quadro(
        board_id=board_id, nome=payload.name
    )
    resposta = await _resposta(uow.session, quadro)
    await uow.commit()
    return resposta


# =====================================================================
# COLUNAS (Spec 036, fatia 5b-4a)
#
# ⚠️ AS ROTAS SAO ANINHADAS (`/boards/{board_id}/columns/...`) E ISSO E TRAVA,
# NAO ESTETICA. A autorizacao de coluna depende do TIME DO QUADRO; uma rota
# `/columns/{id}` teria de descobrir o quadro a partir da coluna, e quem
# esquecesse de conferir que a coluna pertence AQUELE quadro abriria edicao de
# coluna alheia com a permissao do quadro proprio. Com o `board_id` na URL, o
# servico confere os dois (`_coluna_do_quadro`).
#
# ⚠️ AS DUAS SEGUEM SEM `require_permission` E COM `TenantContextDep`, pelo
# mesmo motivo das rotas de quadro -- leia o cabecalho deste modulo antes de
# "consertar". `_: TenantContextDep` parece nao usado e NAO E.
# =====================================================================


@router.post(
    "/{board_id}/columns",
    response_model=BoardColumnResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_column(
    board_id: uuid.UUID,
    payload: BoardColumnCreateRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> BoardColumnResponse:
    """Acrescenta uma coluna ao fim de um quadro avulso.

    ⚠️ RECUSA 422 NO QUADRO PADRAO. As colunas do quadro geral nao se mexem
    enquanto a 5c nao existir: sao 176 tarefas vivas e nao ha tela que desfaca.
    Renomear o QUADRO geral continua permitido -- aquilo nao toca em coluna.

    ⚠️ 404 antes de 403, igual ao `PATCH /boards`: a permissao depende do
    `team_id` do quadro, entao ele e buscado primeiro. Um 403 confirmaria que o
    quadro existe.

    ⚠️ A coluna nasce com `legacy_status` NULL e `is_default_target` False, e
    nenhum dos dois e parametro. Ver `BoardService.criar_coluna`.
    """
    coluna = await BoardService(uow.session).criar_coluna(
        board_id=board_id, nome=payload.name, semantica=payload.semantic
    )
    resposta = BoardColumnResponse.model_validate(coluna)
    await uow.commit()
    return resposta


@router.patch(
    "/{board_id}/columns/{column_id}",
    response_model=BoardColumnResponse,
)
async def rename_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    payload: BoardColumnRenameRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> BoardColumnResponse:
    """Renomeia uma coluna. NAO mexe em semantica, cor, posicao nem alvo.

    ⚠️ COLUNA DE OUTRO QUADRO DEVOLVE 404, e nao 403. O servico busca a coluna
    com o `board_id` no WHERE; ela simplesmente nao existe naquele quadro. Um
    403 diria que ela existe em algum lugar.
    """
    coluna = await BoardService(uow.session).renomear_coluna(
        board_id=board_id, column_id=column_id, nome=payload.name
    )
    resposta = BoardColumnResponse.model_validate(coluna)
    await uow.commit()
    return resposta


@router.get(
    "/{board_id}/columns/{column_id}",
    response_model=BoardColumnDetailResponse,
)
async def get_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
) -> BoardColumnDetailResponse:
    """A coluna, com quantas tarefas vivas ela tem.

    ⚠️ EXISTE PARA O AVISO DE APAGAR. A tela precisa do numero ANTES da
    confirmacao; o `GET /boards` nao o carrega de proposito, para nao pagar um
    `COUNT` por coluna em toda abertura de tela.

    ⚠️ SEM TRAVA DE ESCRITA, e e o certo: quem alcanca o quadro pela lente
    alcanca as colunas dele -- o `GET /boards` ja devolve todas. Exigir
    `board.manage.*` aqui seria proteger um numero que a mesma pessoa obtem
    contando os cards na tela.
    """
    contagem = await BoardService(session).contar_tarefas_da_coluna(
        board_id=board_id, column_id=column_id
    )
    coluna = (
        await session.execute(
            select(BoardColumn).where(
                BoardColumn.id == column_id, BoardColumn.board_id == board_id
            )
        )
    ).scalar_one()
    return BoardColumnDetailResponse(
        **BoardColumnResponse.model_validate(coluna).model_dump(),
        task_count=contagem,
    )


@router.delete(
    "/{board_id}/columns/{column_id}",
    response_model=BoardColumnDeleteResponse,
)
async def delete_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    _: TenantContextDep,
    uow: UoWDep,
    destino_id: uuid.UUID | None = None,
) -> BoardColumnDeleteResponse:
    """Apaga uma coluna, mandando as tarefas dela para `destino_id`.

    ⚠️ `destino_id` VAI NA QUERY STRING, e nao no corpo. `DELETE` com corpo e
    aceito pelo FastAPI e ignorado por parte da infraestrutura de rede -- e
    quando o corpo se perde, este endpoint deixa de mover tarefa e passa a
    recusar por falta de destino, que e um 422 sem causa aparente.

    ⚠️ DUAS RECUSAS DIFERENTES, as duas 422 (ADR 0042):
      - sem `destino_id` numa coluna com tarefas -- "para onde vao estas?";
      - ultima `OPEN` ou ultima `DONE` -- "o quadro continua funcionando?".
    A segunda vale MESMO com destino escolhido: nada impede apagar a ultima
    `DONE` mandando tudo para `Backlog`, e a quebra so apareceria na semana
    seguinte, numa cascata de conclusao.

    ⚠️ DESTINO TERMINAL NAO E MOVER -- e concluir ou cancelar o lote, com
    cascata de subtarefas, `terminal_since` ligando e avisos de prazo morrendo.
    O aviso da tela tem de dizer isso com outro texto (fatia 5b-6); o backend
    faz a coisa certa nos dois casos porque delega ao `TaskService`.
    """
    movidas = await BoardService(uow.session).apagar_coluna(
        board_id=board_id, column_id=column_id, destino_id=destino_id
    )
    await uow.commit()
    return BoardColumnDeleteResponse(movidas=movidas)
