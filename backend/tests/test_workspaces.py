"""Testes do modulo workspaces e da gestao de membros.

Estes testes cobrem a LOGICA DE NEGOCIO que nao depende do
banco: validacoes do provisionamento e regras dos commands.

Os testes que exercitam escrita real no PostgreSQL (criar
workspace, cadastrar membro de ponta a ponta) ficam para
uma suite de integracao separada, executada contra o
banco task_manager_dev -- ver README.
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.users.application.member_service import CreateMemberCommand
from app.modules.workspaces.application.provisioning_service import (
    ProvisionWorkspaceCommand,
    WorkspaceProvisioningService,
)
from app.shared.exceptions.base import ConflictError, ValidationError


def _provisioning_service() -> WorkspaceProvisioningService:
    """Instancia o service sem sessao -- so para testar _validate."""
    return WorkspaceProvisioningService.__new__(WorkspaceProvisioningService)


def _valid_command(**overrides: object) -> ProvisionWorkspaceCommand:
    """Comando de provisionamento valido, com overrides pontuais."""
    defaults: dict[str, object] = {
        "workspace_name": "UniFECAF",
        "workspace_slug": "unifecaf",
        "initial_team_name": "Marketing",
        "initial_team_slug": "marketing",
        "admin_name": "Admin",
        "admin_email": "admin@unifecaf.com.br",
        "admin_password": "senhaForte123",
    }
    defaults.update(overrides)
    return ProvisionWorkspaceCommand(**defaults)  # type: ignore[arg-type]


# --------------------------------------------------------
# Provisionamento -- validacoes
# --------------------------------------------------------
def test_provisioning_accepts_valid_command() -> None:
    """Um comando bem formado passa na validacao sem erro."""
    _provisioning_service()._validate(_valid_command())


def test_provisioning_rejects_invalid_workspace_slug() -> None:
    """Slug com maiuscula/espaco e rejeitado."""
    with pytest.raises(ValidationError) as exc:
        _provisioning_service()._validate(
            _valid_command(workspace_slug="UniFECAF Slug")
        )
    assert exc.value.details["field"] == "workspace_slug"


def test_provisioning_rejects_invalid_team_slug() -> None:
    """Slug de equipe mal formado e rejeitado."""
    with pytest.raises(ValidationError) as exc:
        _provisioning_service()._validate(
            _valid_command(initial_team_slug="Marketing!")
        )
    assert exc.value.details["field"] == "initial_team_slug"


def test_provisioning_rejects_short_password() -> None:
    """Senha do admin com menos de 8 caracteres e rejeitada."""
    with pytest.raises(ValidationError) as exc:
        _provisioning_service()._validate(_valid_command(admin_password="123"))
    assert exc.value.details["field"] == "admin_password"


def test_provisioning_rejects_bad_email() -> None:
    """E-mail do admin sem @ e rejeitado."""
    with pytest.raises(ValidationError) as exc:
        _provisioning_service()._validate(
            _valid_command(admin_email="invalido")
        )
    assert exc.value.details["field"] == "admin_email"


# --------------------------------------------------------
# CreateMemberCommand -- estrutura (Entrega 7: sem senha)
# --------------------------------------------------------
def test_create_member_command_requires_team_and_role() -> None:
    """Spec 014: team_id e role sao obrigatorios -- sem default.

    Construir o command sem eles e um erro de tipo (TypeError): o estado
    orfao (membro sem vinculo) deixa de ser construivel.
    """
    with pytest.raises(TypeError):
        CreateMemberCommand(name="Fulano", email="f@unifecaf.com.br")  # type: ignore[call-arg]


def test_create_member_command_with_team() -> None:
    """team_id e role informados juntos (principal ou subtime)."""
    from app.db.models.enums import UserTeamRole

    team_id = uuid.uuid4()
    cmd = CreateMemberCommand(
        name="Fulano",
        email="f@unifecaf.com.br",
        team_id=team_id,
        role=UserTeamRole.OPERATOR,
    )
    assert cmd.team_id == team_id
    assert cmd.role is UserTeamRole.OPERATOR


# --------------------------------------------------------
# TeamService -- hierarquia e deteccao de ciclo
# --------------------------------------------------------
class _FakeTeamRepo:
    """Repository fake -- expoe so o que o move() chama.

    Carrega um pequeno banco em memoria via dict {id: parent_id}.
    """

    def __init__(self, tree: dict) -> None:
        self._tree = tree  # {team_id: parent_id_or_None}
        self.session_flush_called = False

    async def get_by_id(self, team_id):
        if team_id not in self._tree:
            return None

        # Devolve um stub de Team com os atributos minimos
        # que o service le.
        class _T:
            def __init__(self, id_, parent_id):
                self.id = id_
                self.parent_team_id = parent_id

        return _T(team_id, self._tree[team_id])

    async def root_exists(self):
        """Spec 024/D2: ja existe raiz nesta arvore?

        No repo real e um COUNT com filtro de tenant; aqui e derivado do
        dict {team_id: parent_id}.
        """
        return any(parent is None for parent in self._tree.values())

    async def collect_ancestor_ids(self, team_id, *, max_depth=50):
        ancestors = []
        current = self._tree.get(team_id)
        seen = set()
        while current is not None and current not in seen:
            seen.add(current)
            ancestors.append(current)
            current = self._tree.get(current)
        return ancestors


class _FakeSession:
    async def flush(self):
        pass


def _build_team_service_with_tree(tree: dict):
    """Monta um TeamService com repositorio/sessao falsos."""
    from app.modules.workspaces.application.workspace_service import (
        TeamService,
    )

    svc = TeamService.__new__(TeamService)
    svc._repo = _FakeTeamRepo(tree)
    svc._session = _FakeSession()
    return svc


async def test_team_move_to_root_conflita_quando_ja_existe_raiz() -> None:
    """Spec 024/D4: promover subtime a raiz com raiz existente e RECUSADO.

    Este teste AFIRMAVA o contrario ate a Spec 024 ("mover para a raiz e
    valido"). A regra mudou de proposito: um workspace tem UMA raiz, e ela
    e o time principal. O importante e que a recusa venha como erro de
    DOMINIO (ConflictError -> 409), e nao como IntegrityError do indice
    unico (-> 500).
    """
    marketing = uuid.uuid4()
    crm = uuid.uuid4()
    svc = _build_team_service_with_tree({marketing: None, crm: marketing})

    with pytest.raises(ConflictError):
        await svc.move(team_id=crm, new_parent_id=None)


async def test_team_move_to_root_works_quando_nao_ha_raiz() -> None:
    """Sem raiz na arvore, promover a raiz continua valido.

    Cenario de borda (o indice parcial permite ZERO raizes): a trava e
    "no maximo uma", nao "sempre exatamente uma".
    """
    orfao = uuid.uuid4()
    filho = uuid.uuid4()
    # nenhum time com parent None -> arvore sem raiz
    svc = _build_team_service_with_tree({orfao: filho, filho: orfao})

    result = await svc.move(team_id=filho, new_parent_id=None)
    assert result.parent_team_id is None


async def test_team_move_under_another_parent_works() -> None:
    """Mover entre paes diferentes (sem ciclo) e valido."""
    marketing = uuid.uuid4()
    comercial = uuid.uuid4()
    crm = uuid.uuid4()
    svc = _build_team_service_with_tree(
        {marketing: None, comercial: None, crm: marketing}
    )

    result = await svc.move(team_id=crm, new_parent_id=comercial)
    assert result.parent_team_id == comercial


async def test_team_move_rejects_self_as_parent() -> None:
    """Equipe nao pode ser pai de si mesma."""
    from app.shared.exceptions.base import BusinessRuleError

    crm = uuid.uuid4()
    svc = _build_team_service_with_tree({crm: None})

    with pytest.raises(BusinessRuleError):
        await svc.move(team_id=crm, new_parent_id=crm)


async def test_team_move_rejects_indirect_cycle() -> None:
    """Detecta ciclo A->B->C->A: mover A para sob C deve falhar."""
    from app.shared.exceptions.base import BusinessRuleError

    a = uuid.uuid4()
    b = uuid.uuid4()
    c = uuid.uuid4()
    # arvore atual: A (raiz), B filho de A, C filho de B
    # mover A para sob C criaria ciclo C->A->B->C
    svc = _build_team_service_with_tree({a: None, b: a, c: b})

    with pytest.raises(BusinessRuleError) as exc:
        await svc.move(team_id=a, new_parent_id=c)
    assert "ciclo" in exc.value.message.lower()


async def test_team_move_rejects_missing_team() -> None:
    """Tentar mover equipe inexistente -> EntityNotFoundError."""
    from app.shared.exceptions.base import EntityNotFoundError

    svc = _build_team_service_with_tree({})
    with pytest.raises(EntityNotFoundError):
        await svc.move(team_id=uuid.uuid4(), new_parent_id=None)
