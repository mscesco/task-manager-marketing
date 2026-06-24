"""Seed dos subtimes da UniFECAF -- gatilho fino.

Toda a regra esta no TeamSeedService. Idempotente: pode rodar 2x.
TEMPORARIO: sai de cena quando os endpoints de admin de time existirem.

USO (dentro do container de dev):

    docker compose run --rm api-dev python -m scripts.seed_unifecaf_teams \\
        --workspace-slug unifecaf \\
        --admin-email admin@unifecaf.com.br

Por padrao cria os 9 subtimes do Marketing e poe o admin como MANAGER
no Marketing (principal). --principal-team-slug e --admin-role permitem
ajustar.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.models.enums import UserTeamRole
from app.db.session import db_manager
from app.modules.workspaces.application.team_seed_service import (
    TeamSeedService,
)
from app.shared.exceptions.base import AppError


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cria os subtimes do Marketing e vincula o admin."
    )
    parser.add_argument("--workspace-slug", required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--principal-team-slug", default="marketing")
    parser.add_argument(
        "--admin-role",
        default="MANAGER",
        choices=[r.value for r in UserTeamRole],
    )
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> None:
    db_manager.init()
    try:
        async with db_manager.session_scope() as session:
            result = await TeamSeedService(session).seed(
                workspace_slug=args.workspace_slug,
                admin_email=args.admin_email,
                principal_team_slug=args.principal_team_slug,
                admin_role=UserTeamRole(args.admin_role),
            )
        print("Seed de times concluido:")
        print(f"  workspace_id      : {result.workspace_id}")
        print(f"  principal_team_id : {result.principal_team_id}")
        print(f"  subtimes criados  : {list(result.created_subteam_slugs) or '(nenhum novo)'}")
        print(f"  admin             : {result.admin_user_id} ({result.admin_role})")
    finally:
        await db_manager.dispose()


def main() -> int:
    args = _parse_args()
    try:
        asyncio.run(_run(args))
    except AppError as exc:
        print(f"Falha no seed [{exc.code}]: {exc.message}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Erro inesperado: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
