"""Router de QUADROS. Spec 036 fatia 2 -- a primeira superficie de API de
quadro do produto.

Rotas:
    GET /boards  -- lista os quadros que quem pergunta ALCANCA

⚠️ LEITURA SO. Criar, renomear e apagar quadro sao a fatia 5, e vao precisar
da permissao `board.manage.subteam` com a trava de escopo no SERVICO (o mapa
diz *o que*, o servico tem o `team_id` do alvo -- precedente literal de
`member.manage.subteam`, Spec 028). Nada disso existe aqui.

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

from fastapi import APIRouter

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import BoardColumnResponse, BoardResponse
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
