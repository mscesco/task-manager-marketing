"""Provisiona um workspace pela linha de comando (a regra esta no
WorkspaceProvisioningService).

Uso:

    docker compose run --rm api-dev python -m scripts.provision_workspace \\
        --workspace-name "UniFECAF" \\
        --workspace-slug "unifecaf" \\
        --team-name "Marketing" \\
        --team-slug "marketing" \\
        --admin-name "Nome do Admin" \\
        --admin-email "admin@unifecaf.com.br" \\
        --admin-password "senhaForte123"

Sem --admin-password, a senha e pedida sem eco.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.db.session import db_manager
from app.modules.workspaces.application.provisioning_service import (
    ProvisionWorkspaceCommand,
    WorkspaceProvisioningService,
)
from app.shared.exceptions.base import AppError


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provisiona um workspace completo (workspace + "
        "equipe inicial + usuario admin)."
    )
    parser.add_argument("--workspace-name", required=True)
    parser.add_argument("--workspace-slug", required=True)
    parser.add_argument("--team-name", required=True)
    parser.add_argument("--team-slug", required=True)
    parser.add_argument("--admin-name", required=True)
    parser.add_argument("--admin-email", required=True)
    # Ausente, e pedida interativamente (fora do historico do shell).
    parser.add_argument("--admin-password", default=None)
    return parser.parse_args()


async def _run(args: argparse.Namespace, password: str) -> None:
    """Executa o provisionamento dentro de uma transacao."""
    db_manager.init()
    try:
        async with db_manager.session_scope() as session:
            service = WorkspaceProvisioningService(session)
            command = ProvisionWorkspaceCommand(
                workspace_name=args.workspace_name,
                workspace_slug=args.workspace_slug,
                initial_team_name=args.team_name,
                initial_team_slug=args.team_slug,
                admin_name=args.admin_name,
                admin_email=args.admin_email,
                admin_password=password,
            )
            result = await service.provision(command)

        print("Workspace provisionado com sucesso:")
        print(f"  workspace_id : {result.workspace_id}")
        print(f"  team_id      : {result.team_id}")
        print(f"  admin_user_id: {result.admin_user_id}")
    finally:
        await db_manager.dispose()


def main() -> int:
    args = _parse_args()

    password = args.admin_password
    if not password:
        password = getpass.getpass("Senha do admin: ")
        confirm = getpass.getpass("Confirme a senha: ")
        if password != confirm:
            print("As senhas nao conferem.", file=sys.stderr)
            return 1

    try:
        asyncio.run(_run(args, password))
    except AppError as exc:
        print(f"Falha no provisionamento [{exc.code}]: {exc.message}",
              file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Erro inesperado: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
