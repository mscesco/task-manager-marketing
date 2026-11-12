"""O papel de organizacao, sem time: lido no login e usado pelo job de arquivamento.

Uma pessoa com autoridade total pode ter zero linhas em `user_team`.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import OrgRole
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration


async def _com_org_role(db, *, workspace_id, user_id, papel):
    """Grava o papel de organizacao direto na linha do usuario."""
    from app.db.models import User

    user = await db.get(User, user_id)
    user.org_role = papel
    await db.flush()
    return user


# ------------------------------------------------------------- ponta a ponta


async def test_membership_carrega_o_papel_de_organizacao(db) -> None:
    """A leitura nao custa query nova -- a linha do User ja vinha."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _com_org_role(db, workspace_id=ws, user_id=dona, papel=OrgRole.ADMIN)

    membership = await MembershipRepository(db).get_membership(
        user_id=dona, workspace_id=ws
    )

    assert membership is not None
    assert membership.org_role == "ADMIN"
    # Sem time nenhum.
    assert membership.team_roles == ()
    assert membership.roles == frozenset()
    assert raiz is not None  # a raiz existe; ela so nao esta nela


async def test_o_job_de_arquivamento_acha_o_admin_pela_fonte_nova(db) -> None:
    """O admin sem vinculo de time e achado pelo `org_role`.

    Se o job procurasse so em `user_team`, pularia o workspace inteiro sem
    erro nem log.
    """
    ws = await f.make_workspace(db)
    await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _com_org_role(db, workspace_id=ws, user_id=dona, papel=OrgRole.ADMIN)

    achado = await StaleArchivalService(db)._resolve_admin(ws)

    assert achado == dona
