"""Testes do submodulo Collaboration (Entrega 4) -- logica pura, sem DB.

Cobertura:
    - permissions: OPERATOR ganhou task.assign.
    - history builders: assigned / unassigned (event_type + metadata).
    - task_guards (puro): task_visible / task_editable cobrindo
        * pessoal proprio vs alheio
        * criador sempre ve (ADR 0013) mas NAO edita
        * lente de time (comum / avulsa)
        * admin (lente None)

Os fluxos com escrita real no Postgres (insert de assignment/watcher,
history, idempotencia, 404/409/422 ponta a ponta) validam no smoke /docs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.task_guards import task_editable, task_visible
from app.modules.tasks.domain.history import (
    TaskHistoryEventType,
    build_assigned_entry,
    build_unassigned_entry,
)


# --------------------------------------------------------
# Dublês mínimos (so os campos que as funcoes puras leem)
# --------------------------------------------------------
@dataclass
class _Task:
    id: uuid.UUID
    created_by: uuid.UUID
    team_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


@dataclass
class _Project:
    team_id: uuid.UUID | None
    created_by: uuid.UUID
    is_personal: bool = False


def _id() -> uuid.UUID:
    return uuid.uuid4()


# --------------------------------------------------------
# permissions
# --------------------------------------------------------
def test_operator_now_has_task_assign() -> None:
    perms = permissions_for_roles(frozenset({UserTeamRole.OPERATOR.value}))
    assert "task.assign" in perms
    # nao ganhou edicao/delete de tabela alem do que ja tinha
    assert "task.delete" not in perms


def test_admin_still_has_task_assign() -> None:
    perms = permissions_for_roles(frozenset({UserTeamRole.ADMIN.value}))
    assert "task.assign" in perms


# --------------------------------------------------------
# history builders
# --------------------------------------------------------
def test_build_assigned_entry() -> None:
    user, actor = _id(), _id()
    entry = build_assigned_entry(user_id=user, assigned_by=actor)
    assert entry.event_type is TaskHistoryEventType.ASSIGNED
    assert entry.metadata == {"user_id": str(user), "assigned_by": str(actor)}


def test_build_unassigned_entry() -> None:
    user = _id()
    entry = build_unassigned_entry(user_id=user)
    assert entry.event_type is TaskHistoryEventType.UNASSIGNED
    assert entry.metadata == {"user_id": str(user)}


# --------------------------------------------------------
# task_visible (ADR 0013 + Entrega 3)
# --------------------------------------------------------
def test_visible_personal_owner_yes_other_no() -> None:
    owner, other = _id(), _id()
    task = _Task(id=_id(), created_by=owner, project_id=_id())
    proj = _Project(team_id=None, created_by=owner, is_personal=True)
    # dono ve
    assert task_visible(task=task, project=proj, viewer_user_id=owner, visible=None)
    # outro NAO ve, nem admin (visible=None)
    assert not task_visible(
        task=task, project=proj, viewer_user_id=other, visible=None
    )


def test_visible_creator_NAO_ve_avulsa_fora_da_lente() -> None:
    """Spec 037, E1 -- este teste INVERTEU, e a inversao e a entrega.

    Ate a Spec 037 ele afirmava o contrario: `created_by` garantia visao mesmo
    com o time fora da lente (ADR 0013). A ADR 0038 retirou isso -- a lente de
    time e a unica fonte de visibilidade.

    ⚠️ ELE NAO FOI APAGADO, DE PROPOSITO. Apagar deixaria a regra sem
    afirmacao nenhuma: nada impediria alguem de reintroduzir o ramo
    `created_by` mais adiante e ver tudo verde. Inverter mantem o ponto sob
    vigilancia.
    """
    creator = _id()
    team_copy = _id()  # subtime irmao, fora da lente do criador
    task = _Task(id=_id(), created_by=creator, team_id=team_copy, project_id=None)
    # criar NAO concede leitura: sem o time na lente, nao ve.
    assert not task_visible(
        task=task, project=None, viewer_user_id=creator, visible=frozenset()
    )
    # e com o time na lente, ve -- como qualquer outra pessoa.
    assert task_visible(
        task=task, project=None, viewer_user_id=creator, visible=frozenset({team_copy})
    )


def test_visible_noncreator_avulsa_needs_lens() -> None:
    creator, viewer = _id(), _id()
    team_copy = _id()
    task = _Task(id=_id(), created_by=creator, team_id=team_copy, project_id=None)
    # quem nao criou e nao tem o time na lente: nao ve
    assert not task_visible(
        task=task, project=None, viewer_user_id=viewer, visible=frozenset()
    )
    # com o time na lente: ve
    assert task_visible(
        task=task, project=None, viewer_user_id=viewer, visible=frozenset({team_copy})
    )


def test_visible_common_project_by_project_team() -> None:
    creator, viewer = _id(), _id()
    proj_team = _id()
    task = _Task(id=_id(), created_by=creator, team_id=_id(), project_id=_id())
    proj = _Project(team_id=proj_team, created_by=creator, is_personal=False)
    # ve o projeto (team do projeto na lente) -> ve a task
    assert task_visible(
        task=task, project=proj, viewer_user_id=viewer, visible=frozenset({proj_team})
    )
    # projeto fora da lente e nao e criador -> nao ve
    assert not task_visible(
        task=task, project=proj, viewer_user_id=viewer, visible=frozenset()
    )


def test_visible_missing_project_is_invisible() -> None:
    task = _Task(id=_id(), created_by=_id(), project_id=_id())
    # project_id setado mas projeto ausente (inconsistencia) -> 404
    assert not task_visible(
        task=task, project=None, viewer_user_id=task.created_by, visible=None
    )


# --------------------------------------------------------
# task_editable (ADR 0013: created_by NAO edita)
# --------------------------------------------------------
def test_editable_creator_does_not_get_edit() -> None:
    creator = _id()
    team_copy = _id()
    task = _Task(id=_id(), created_by=creator, team_id=team_copy, project_id=None)
    # criador, mas time da task fora da lente de edicao -> NAO edita
    assert not task_editable(
        task=task, project=None, viewer_user_id=creator, editable=frozenset()
    )


def test_editable_by_team_in_lens() -> None:
    team = _id()
    task = _Task(id=_id(), created_by=_id(), team_id=team, project_id=None)
    assert task_editable(
        task=task, project=None, viewer_user_id=_id(), editable=frozenset({team})
    )


def test_editable_admin_edits_all() -> None:
    task = _Task(id=_id(), created_by=_id(), team_id=_id(), project_id=None)
    assert task_editable(
        task=task, project=None, viewer_user_id=_id(), editable=None
    )


def test_editable_personal_owner() -> None:
    owner = _id()
    task = _Task(id=_id(), created_by=owner, project_id=_id())
    proj = _Project(team_id=None, created_by=owner, is_personal=True)
    assert task_editable(
        task=task, project=proj, viewer_user_id=owner, editable=frozenset()
    )
