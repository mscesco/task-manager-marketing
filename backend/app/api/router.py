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
from app.modules.auth.api.router import router as auth_router
from app.modules.tasks.api.collaboration_router import (
    router as collaboration_router,
)
from app.modules.tasks.api.comment_router import router as comment_router
from app.modules.tasks.api.me_router import router as me_router
from app.modules.tasks.api.projects_router import router as projects_router
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
api_v1_router.include_router(collaboration_router)
api_v1_router.include_router(comment_router)
