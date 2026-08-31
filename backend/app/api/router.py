"""Agregador central de rotas da API.

Cada modulo expoe seu proprio APIRouter; este arquivo os
reune sob o router principal. Quando um novo bounded
context ganhar rotas, basta incluir o router dele aqui.

Convencao de versionamento: todas as rotas de negocio
ficam sob /api/v1. Health checks ficam fora do prefixo
versionado (sao infra, nao API de negocio).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.health import router as health_router
from app.api.client_errors import router as client_errors_router
from app.modules.auth.api.router import router as auth_router
from app.modules.notifications.api.router import router as notifications_router
from app.modules.solicitations.api.form_public_router import (
    router as solicitation_forms_public_router,
)
from app.modules.solicitations.api.form_router import (
    router as solicitation_forms_router,
)
from app.modules.solicitations.api.router import router as solicitations_router
from app.modules.tasks.api.boards_router import router as boards_router
from app.modules.tasks.api.collaboration_router import (
    router as collaboration_router,
)
from app.modules.tasks.api.comment_router import router as comment_router
from app.modules.tasks.api.me_router import router as me_router
from app.modules.tasks.api.projects_router import router as projects_router
from app.modules.tasks.api.system_router import router as system_router
from app.modules.tasks.api.tasks_router import router as tasks_router
from app.modules.users.api.router import router as members_router
from app.modules.workspaces.api.router import router as workspaces_router

# Router de infraestrutura (sem versao).
infra_router = APIRouter()
infra_router.include_router(health_router)

# Router de negocio, versionado.
api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(workspaces_router)
api_v1_router.include_router(members_router)
api_v1_router.include_router(projects_router)
api_v1_router.include_router(me_router)
api_v1_router.include_router(tasks_router)
api_v1_router.include_router(boards_router)
api_v1_router.include_router(collaboration_router)
api_v1_router.include_router(comment_router)
api_v1_router.include_router(notifications_router)
# ⚠️⚠️ O ROUTER DE FORMULARIOS VEM ANTES, E A ORDEM E O CONSERTO DE UM 422 EM
# PRODUCAO (26/08). O router de solicitacoes tem `GET /solicitacoes/{id}`, e o
# FastAPI casa rota NA ORDEM DE REGISTRO: com ele primeiro,
# `GET /solicitacoes/formularios` batia no `{solicitation_id}`, tentava ler
# "formularios" como UUID e devolvia 422. A tela de formularios abria vazia com
# "Dados da requisicao invalidos".
#
# ⚠️ NAO INVERTA. Rota literal tem de ser declarada ANTES da parametrizada que
# a engole -- e `tests/integration/test_rotas_de_formulario_http_db.py` existe
# so para isto: ele bate na URL e exige que ela NAO seja 422.
#
# ⚠️ E O ROUTER PUBLICO NAO SOFRE DISSO: `/solicitacoes/publico/formularios`
# tem dois segmentos depois do prefixo, entao nunca casa com `{id}`, que e de
# um segmento so. Foi por isso que ele funcionou desde o primeiro dia e o
# autenticado nao.
# ⚠️ MESMO PREFIXO (`/solicitacoes`), ROUTER SEPARADO. O de cima tem a rota
# PUBLICA sem credencial; este exige `solicitation_form.manage` no router
# inteiro. Misturar os dois faria a dependencia de permissao valer para a rota
# publica -- ou, pior, alguem a tiraria dali para "consertar" e abriria o CRUD
# do formulario para o mundo.
api_v1_router.include_router(solicitation_forms_router)
api_v1_router.include_router(solicitations_router)
# ⚠️ TERCEIRO ROUTER NO MESMO PREFIXO, e o unico SEM CREDENCIAL alem do
# `POST /publico`. Ele fica separado justamente por isso: a dependencia de
# permissao do router acima nao pode alcanca-lo, e a de rate limit deste nao
# pode faltar.
api_v1_router.include_router(solicitation_forms_public_router)
api_v1_router.include_router(system_router)
api_v1_router.include_router(client_errors_router)
