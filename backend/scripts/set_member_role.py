"""Utilitario de DESENVOLVIMENTO: define o papel EXCLUSIVO de um membro.

Apaga todos os vinculos de time do usuario no workspace e cria UM novo
(time por slug + papel). Serve para alternar estados de teste da
Entrega 3, ex.:

    # caminho feliz: ve/edita tudo via hierarquia
    docker compose run --rm api-dev python -m scripts.set_member_role \\
        --workspace-slug unifecaf --user-email admin@unifecaf.com.br \\
        --team-slug marketing --role MANAGER

    # testar a trava: ve so o subtime + geral, nao edita irmaos
    docker compose run --rm api-dev python -m scripts.set_member_role \\
        --workspace-slug unifecaf --user-email admin@unifecaf.com.br \\
        --team-slug crm-e-automacao --role OPERATOR

NAO use em producao -- e ferramenta de teste. Substitui, nao acumula:
deixa o usuario com exatamente um papel em um time.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import delete, select

from app.db.models import Team, User, UserTeam, Workspace
from app.db.models.enums import UserTeamRole
from app.db.session import db_manager


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Define o papel exclusivo de um membro (dev/teste)."
    )
    parser.add_argument("--workspace-slug", required=True)
    parser.add_argument("--user-email", required=True)
    parser.add_argument("--team-slug", required=True)
    parser.add_argument(
        "--role", required=True, choices=[r.value for r in UserTeamRole]
    )
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> None:
    db_manager.init()
    try:
        async with db_manager.session_scope() as session:
            ws = (
                await session.execute(
                    select(Workspace).where(Workspace.slug == args.workspace_slug)
                )
            ).scalar_one_or_none()
            if ws is None:
                raise SystemExit(f"Workspace '{args.workspace_slug}' nao existe.")

            user = (
                await session.execute(
                    select(User).where(
                        User.workspace_id == ws.id,
                        User.email == args.user_email.strip().lower(),
                    )
                )
            ).scalar_one_or_none()
            if user is None:
                raise SystemExit(f"Usuario '{args.user_email}' nao existe.")

            team = (
                await session.execute(
                    select(Team).where(
                        Team.workspace_id == ws.id, Team.slug == args.team_slug
                    )
                )
            ).scalar_one_or_none()
            if team is None:
                raise SystemExit(f"Time '{args.team_slug}' nao existe.")

            # Substitui: apaga todos os vinculos do usuario e cria um.
            await session.execute(
                delete(UserTeam).where(
                    UserTeam.workspace_id == ws.id,
                    UserTeam.user_id == user.id,
                )
            )
            session.add(
                UserTeam(
                    workspace_id=ws.id,
                    user_id=user.id,
                    team_id=team.id,
                    role=UserTeamRole(args.role),
                )
            )
        print(
            f"OK: {args.user_email} agora e {args.role} em "
            f"'{args.team_slug}' (vinculos anteriores removidos)."
        )
    finally:
        await db_manager.dispose()


def main() -> int:
    asyncio.run(_run(_parse_args()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
