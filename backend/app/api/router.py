"""Agregador de rotas: negocio sob /api/v1, health checks fora do prefixo."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.client_errors import router as client_errors_router
from app.api.health import router as health_router
from app.modules.auth.api.router import router as auth_router
from app.modules.bases.api.router import router as bases_router
from app.modules.notifications.api.preferences_router import (
    router as notification_preferences_router,
)
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
from app.modules.tasks.api.dashboard_router import router as dashboard_router
from app.modules.tasks.api.links_router import router as links_router
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
api_v1_router.include_router(dashboard_router)
api_v1_router.include_router(tasks_router)
api_v1_router.include_router(boards_router)
api_v1_router.include_router(collaboration_router)
api_v1_router.include_router(comment_router)
api_v1_router.include_router(links_router)
api_v1_router.include_router(bases_router)
api_v1_router.include_router(notifications_router)
api_v1_router.include_router(notification_preferences_router)
# Formularios antes de solicitacoes: o FastAPI casa na ordem de registro e
# `GET /solicitacoes/{id}` engoliria `/solicitacoes/formularios` (422).
# Routers separados no mesmo prefixo porque cada um tem dependencias
# proprias (permissao de gerenciar formulario; o publico, rate limit sem credencial).
api_v1_router.include_router(solicitation_forms_router)
api_v1_router.include_router(solicitations_router)
api_v1_router.include_router(solicitation_forms_public_router)
api_v1_router.include_router(system_router)
api_v1_router.include_router(client_errors_router)
