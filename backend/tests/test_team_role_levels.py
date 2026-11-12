"""Papel permitido por nivel de time, sem banco.

    - raiz    -> MANAGER, OPERATOR
    - subtime -> SUPERVISOR, OPERATOR
    - ADMIN   -> nao e papel de time (mora em `users.org_role`)
    - papel desconhecido -> recusado em qualquer nivel (falha fechada)

OPERATOR nos dois niveis permite tirar alguem de um subtime sem remover a pessoa.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.team_scope import (
    assert_role_permitido_no_nivel,
    role_permitido_no_nivel,
    roles_permitidos_no_nivel,
)
from app.shared.exceptions.base import BusinessRuleError

RAIZ = True
SUBTIME = False


def test_raiz_aceita_manager_e_operator() -> None:
    """Raiz aceita quem manda (MANAGER) e quem executa (OPERATOR); nem ADMIN nem
    SUPERVISOR.
    """
    assert roles_permitidos_no_nivel(RAIZ) == {"MANAGER", "OPERATOR"}


def test_subtime_aceita_apenas_supervisor_e_operator() -> None:
    assert roles_permitidos_no_nivel(SUBTIME) == {"SUPERVISOR", "OPERATOR"}


def test_todo_papel_do_enum_esta_classificado() -> None:
    """Os dois niveis cobrem o enum exatamente: com `>=` papel novo passaria calado."""
    cobertos = roles_permitidos_no_nivel(RAIZ) | roles_permitidos_no_nivel(SUBTIME)
    do_enum = {r.value for r in UserTeamRole}
    assert do_enum == cobertos, f"Papel sem nivel definido: {do_enum ^ cobertos}"


@pytest.mark.parametrize(
    ("role", "nivel"),
    [
        (UserTeamRole.MANAGER, RAIZ),
        (UserTeamRole.OPERATOR, RAIZ),
        (UserTeamRole.SUPERVISOR, SUBTIME),
        (UserTeamRole.OPERATOR, SUBTIME),
    ],
)
def test_assert_aceita_o_enum_no_nivel_certo(role: UserTeamRole, nivel: bool) -> None:
    """Os call-sites passam UserTeamRole, nao string."""
    assert_role_permitido_no_nivel(role, is_root=nivel)  # nao levanta


@pytest.mark.parametrize(
    ("role", "nivel", "onde_pertence", "o_que_usar"),
    [
        (UserTeamRole.MANAGER, SUBTIME, "principal", "subtime"),
        ("SUPERVISOR", RAIZ, "subtime", "operador"),
    ],
)
def test_papel_de_comando_no_nivel_errado_e_recusado_com_orientacao(
    role: object, nivel: bool, onde_pertence: str, o_que_usar: str
) -> None:
    """SUPERVISOR na raiz governaria operadores da raiz pelo gate de "subtimes
    supervisionados". A mensagem diz onde o papel pertence e o que usar."""
    assert not role_permitido_no_nivel(role, is_root=nivel)
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel(role, is_root=nivel)
    texto = str(exc.value).lower()
    assert onde_pertence in texto
    assert o_que_usar in texto


@pytest.mark.parametrize("role", ["ADMIN", "AUDITOR"])
@pytest.mark.parametrize("nivel", [RAIZ, SUBTIME])
def test_papel_fora_do_time_falha_fechada(role: str, nivel: bool) -> None:
    """ADMIN nao e papel de time, e papel desconhecido e recusado, nao liberado."""
    assert not role_permitido_no_nivel(role, is_root=nivel)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(role, is_root=nivel)
