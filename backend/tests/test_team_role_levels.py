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


def test_cada_papel_de_comando_tem_um_nivel_so() -> None:
    """MANAGER implica raiz e SUPERVISOR implica subtime."""
    so_na_raiz = roles_permitidos_no_nivel(RAIZ) - roles_permitidos_no_nivel(SUBTIME)
    so_em_subtime = roles_permitidos_no_nivel(SUBTIME) - roles_permitidos_no_nivel(
        RAIZ
    )
    assert so_na_raiz == {"MANAGER"}
    assert so_em_subtime == {"SUPERVISOR"}


def test_operator_e_o_unico_papel_dos_dois_niveis() -> None:
    """OPERATOR, o unico sem autoridade, e o unico nos dois niveis."""
    nos_dois = roles_permitidos_no_nivel(RAIZ) & roles_permitidos_no_nivel(SUBTIME)
    assert nos_dois == {"OPERATOR"}


def test_manager_recusado_em_subtime() -> None:
    assert not role_permitido_no_nivel("MANAGER", is_root=SUBTIME)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel("MANAGER", is_root=SUBTIME)


def test_operator_aceito_na_raiz() -> None:
    """OPERATOR so no time raiz e estado valido."""
    assert role_permitido_no_nivel("OPERATOR", is_root=RAIZ)
    assert_role_permitido_no_nivel("OPERATOR", is_root=RAIZ)  # nao levanta


def test_supervisor_recusado_na_raiz() -> None:
    """SUPERVISOR na raiz e recusado: governaria operadores da raiz pelo gate de
    "subtimes supervisionados".
    """
    assert not role_permitido_no_nivel("SUPERVISOR", is_root=RAIZ)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel("SUPERVISOR", is_root=RAIZ)


def test_manager_aceito_na_raiz() -> None:
    assert_role_permitido_no_nivel("MANAGER", is_root=RAIZ)  # nao levanta


@pytest.mark.parametrize("nivel", [RAIZ, SUBTIME])
def test_admin_recusado_em_TODO_nivel_de_time(nivel: bool) -> None:
    """ADMIN nao e papel de time: cai no ramo de papel desconhecido em todo nivel."""
    assert not role_permitido_no_nivel("ADMIN", is_root=nivel)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel("ADMIN", is_root=nivel)


def test_mensagem_do_supervisor_na_raiz_orienta_a_saida() -> None:
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel("SUPERVISOR", is_root=RAIZ)
    texto = str(exc.value).lower()
    assert "subtime" in texto      # onde o papel PERTENCE
    assert "operador" in texto     # e o que usar no lugar


@pytest.mark.parametrize("role", ["SUPERVISOR", "OPERATOR"])
def test_supervisor_e_operator_aceitos_em_subtime(role: str) -> None:
    assert_role_permitido_no_nivel(role, is_root=SUBTIME)  # nao levanta


def test_aceita_o_enum_alem_da_string() -> None:
    """Os call-sites passam UserTeamRole, nao string."""
    assert_role_permitido_no_nivel(UserTeamRole.MANAGER, is_root=RAIZ)
    assert_role_permitido_no_nivel(UserTeamRole.OPERATOR, is_root=SUBTIME)
    assert_role_permitido_no_nivel(UserTeamRole.SUPERVISOR, is_root=SUBTIME)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(UserTeamRole.MANAGER, is_root=SUBTIME)


def test_papel_desconhecido_falha_fechada_nos_dois_niveis() -> None:
    """Papel novo no enum sem classificacao e recusado, nao liberado."""
    for nivel in (RAIZ, SUBTIME):
        assert not role_permitido_no_nivel("AUDITOR", is_root=nivel)
        with pytest.raises(BusinessRuleError):
            assert_role_permitido_no_nivel("AUDITOR", is_root=nivel)


def test_todo_papel_do_enum_esta_classificado() -> None:
    """Os dois niveis cobrem o enum exatamente: com `>=` papel novo passaria calado."""
    cobertos = roles_permitidos_no_nivel(RAIZ) | roles_permitidos_no_nivel(SUBTIME)
    do_enum = {r.value for r in UserTeamRole}
    assert do_enum == cobertos, f"Papel sem nivel definido: {do_enum ^ cobertos}"


def test_mensagem_de_erro_orienta_o_usuario() -> None:
    """A mensagem diz onde o papel pertence, nao so que deu errado."""
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel("MANAGER", is_root=SUBTIME)
    texto = str(exc.value).lower()
    assert "principal" in texto      # onde o papel PERTENCE
    assert "subtime" in texto        # e o que usar no lugar
