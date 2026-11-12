"""A limpeza diaria de notificacoes e o indice do sino.

    lida com mais de 6 meses     -> some
    lida recente                 -> fica
    NAO lida, por mais velha     -> fica (a pessoa ainda nao viu)
    indice                       -> segue (recipient, updated_at, id)

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text, update

from app.db.models import Notification
from app.modules.notifications.application.purge_service import (
    READ_RETENTION,
    NotificationPurgeService,
)
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

AGORA = datetime.now(UTC)


async def _aviso(db, ctx, me, *, idade: timedelta, lida: bool):
    with acting_as(**ctx):
        row = NotificationRepository(db).create(
            recipient_id=me, actor_id=None, type="TASK_ASSIGNED"
        )
        await db.flush()
    quando = AGORA - idade
    await db.execute(
        update(Notification)
        .where(Notification.id == row.id)
        .values(updated_at=quando, created_at=quando, read_at=quando if lida else None)
    )
    return row.id


async def test_apaga_so_a_lida_com_mais_de_6_meses(db) -> None:
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=r, role="OPERATOR")
    ctx = dict(
        workspace_id=ws, user_id=me,
        memberships=(mship(r, "OPERATOR"),), team_tree=(node(r),),
    )
    velha = READ_RETENTION + timedelta(days=1)
    lida_velha = await _aviso(db, ctx, me, idade=velha, lida=True)
    lida_nova = await _aviso(db, ctx, me, idade=timedelta(days=170), lida=True)
    nao_lida_velha = await _aviso(db, ctx, me, idade=timedelta(days=400), lida=False)

    resultado = await NotificationPurgeService(db).run(now=AGORA)

    restam = set(
        (await db.execute(select(Notification.id).where(Notification.recipient_id == me)))
        .scalars()
        .all()
    )
    assert lida_velha not in restam
    assert restam == {lida_nova, nao_lida_velha}
    assert resultado == {"notifications": 1}
    # Idempotente.
    assert await NotificationPurgeService(db).run(now=AGORA) == {"notifications": 0}


async def test_indice_do_sino_segue_a_ordenacao(db) -> None:
    indices = dict(
        (
            await db.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE tablename = 'notification'"
                )
            )
        ).all()
    )
    assert "(recipient_id, updated_at DESC, id DESC)" in (
        indices["ix_notification_recipient_updated"]
    )
