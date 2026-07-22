"""Invariante de papel por NIVEL de time -- logica pura (Spec 024).

Trava a regra sem banco. Ela e UMA SO e ASSIMETRICA:

    ADMIN e MANAGER so existem no time RAIZ.

    - raiz    -> os QUATRO papeis
    - subtime -> so SUPERVISOR e OPERATOR
    - papel desconhecido -> recusado em QUALQUER nivel (falha fechada, R5)

A assimetria e deliberada: estar so no time geral, sem subtime, e estado
de produto projetado (Spec 003, decisoes 7 e 17).

Estes testes sao a primeira linha de defesa: se alguem afrouxar a regra
no `team_scope`, quebra aqui, sem depender de Postgres nem da suite de
integracao.
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


def test_raiz_aceita_os_quatro_papeis() -> None:
    """A raiz e o time geral: cabe comando E execucao."""
    assert roles_permitidos_no_nivel(RAIZ) == {
        "ADMIN",
        "MANAGER",
        "SUPERVISOR",
        "OPERATOR",
    }


def test_subtime_aceita_apenas_supervisor_e_operator() -> None:
    assert roles_permitidos_no_nivel(SUBTIME) == {"SUPERVISOR", "OPERATOR"}


def test_apenas_admin_e_manager_sao_exclusivos_da_raiz() -> None:
    """O QUE a invariante garante: ver ADMIN/MANAGER implica estar na raiz.

    SUPERVISOR e OPERATOR existem nos dois niveis de proposito -- e a
    diferenca entre os conjuntos que carrega a regra.
    """
    exclusivos = roles_permitidos_no_nivel(RAIZ) - roles_permitidos_no_nivel(SUBTIME)
    assert exclusivos == {"ADMIN", "MANAGER"}


@pytest.mark.parametrize("role", ["ADMIN", "MANAGER"])
def test_admin_e_manager_recusados_em_subtime(role: str) -> None:
    assert not role_permitido_no_nivel(role, is_root=SUBTIME)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(role, is_root=SUBTIME)


@pytest.mark.parametrize("role", ["SUPERVISOR", "OPERATOR"])
def test_supervisor_e_operator_aceitos_na_raiz(role: str) -> None:
    """Estar so no time geral e estado valido (Spec 003, decisoes 7 e 17):
    e assim que se tira alguem de um subtime sem remover a pessoa."""
    assert role_permitido_no_nivel(role, is_root=RAIZ)
    assert_role_permitido_no_nivel(role, is_root=RAIZ)  # nao levanta


@pytest.mark.parametrize("role", ["ADMIN", "MANAGER"])
def test_admin_e_manager_aceitos_na_raiz(role: str) -> None:
    assert_role_permitido_no_nivel(role, is_root=RAIZ)  # nao levanta


@pytest.mark.parametrize("role", ["SUPERVISOR", "OPERATOR"])
def test_supervisor_e_operator_aceitos_em_subtime(role: str) -> None:
    assert_role_permitido_no_nivel(role, is_root=SUBTIME)  # nao levanta


def test_aceita_o_enum_alem_da_string() -> None:
    """Os call-sites passam UserTeamRole, nao string."""
    assert_role_permitido_no_nivel(UserTeamRole.ADMIN, is_root=RAIZ)
    assert_role_permitido_no_nivel(UserTeamRole.OPERATOR, is_root=SUBTIME)
    assert_role_permitido_no_nivel(UserTeamRole.SUPERVISOR, is_root=RAIZ)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(UserTeamRole.MANAGER, is_root=SUBTIME)


def test_papel_desconhecido_falha_fechada_nos_dois_niveis() -> None:
    """R5: papel novo no enum sem classificacao aqui e RECUSADO, nao
    liberado. Se um dia entrar 'AUDITOR', ele nao passa calado."""
    for nivel in (RAIZ, SUBTIME):
        assert not role_permitido_no_nivel("AUDITOR", is_root=nivel)
        with pytest.raises(BusinessRuleError):
            assert_role_permitido_no_nivel("AUDITOR", is_root=nivel)


def test_todo_papel_do_enum_esta_classificado() -> None:
    """Guarda contra o enum crescer sem alguem atualizar a regra: todo
    papel real precisa caber em EXATAMENTE um dos dois niveis."""
    cobertos = roles_permitidos_no_nivel(RAIZ) | roles_permitidos_no_nivel(SUBTIME)
    do_enum = {r.value for r in UserTeamRole}
    assert do_enum == cobertos, (
        "Papel do enum sem nivel definido (ou vice-versa): "
        f"{do_enum ^ cobertos}"
    )


def test_mensagem_de_erro_orienta_o_usuario() -> None:
    """A mensagem e lida por um coordenador cadastrando gente, nao por um
    dev: precisa dizer onde o papel PERTENCE, nao so que deu errado."""
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel("MANAGER", is_root=SUBTIME)
    texto = str(exc.value).lower()
    assert "principal" in texto      # onde o papel PERTENCE
    assert "subtime" in texto        # e o que usar no lugar
