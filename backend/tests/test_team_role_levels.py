"""Invariante de papel por NIVEL de time -- logica pura (Spec 024 -> 045 D).

Trava a regra sem banco:

    - raiz    -> MANAGER, OPERATOR
    - subtime -> SUPERVISOR, OPERATOR
    - ADMIN   -> nivel NENHUM: e papel de ORGANIZACAO (`users.org_role`)
    - papel desconhecido -> recusado em QUALQUER nivel (falha fechada, R5)

⚠️⚠️ SETE TESTES DESTE ARQUIVO AFIRMAVAM A REGRA ANTERIOR e foram
REESCRITOS na fatia D, nao apagados -- vale saber o que eles diziam, porque
o que mudou foi a REGRA, e nao um detalhe de implementacao:

    test_raiz_aceita_os_quatro_papeis           -> a raiz aceitava os quatro
    test_apenas_admin_e_manager_..._da_raiz     -> exclusivos eram DOIS
    test_supervisor_e_operator_aceitos_na_raiz  -> supervisor cabia na raiz
    test_admin_e_manager_aceitos_na_raiz        -> admin era papel de time

⚠️ CADA UM DELES TEM SUCESSOR AQUI, afirmando o contrario. Se algum dia a
regra voltar atras, sao estes que denunciam -- e nao a ausencia deles.

O que NAO mudou, e o motivo importa: OPERATOR continua nos dois niveis.
Estar so no time geral, sem subtime, e estado de produto projetado (Spec
003, decisoes 7 e 17) -- e assim que se tira alguem de um subtime sem
remover a pessoa.

Estes testes sao a primeira linha de defesa: se alguem afrouxar a regra no
`team_scope`, quebra aqui, sem depender de Postgres nem da suite de
integracao.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.team_scope import (
    _ORG_LEVEL_ROLES,
    assert_role_permitido_no_nivel,
    role_permitido_no_nivel,
    roles_permitidos_no_nivel,
)
from app.shared.exceptions.base import BusinessRuleError

RAIZ = True
SUBTIME = False


def test_raiz_aceita_manager_e_operator() -> None:
    """⭐ Sucessor de `test_raiz_aceita_os_quatro_papeis` (fatia D).

    A raiz e a AREA: cabe quem manda nela (MANAGER) e quem executa nela
    (OPERATOR). Nao cabe mais nem ADMIN (foi para a organizacao) nem
    SUPERVISOR (e dono de um braco, e a raiz nao e braco de ninguem).
    """
    assert roles_permitidos_no_nivel(RAIZ) == {"MANAGER", "OPERATOR"}


def test_subtime_aceita_apenas_supervisor_e_operator() -> None:
    assert roles_permitidos_no_nivel(SUBTIME) == {"SUPERVISOR", "OPERATOR"}


def test_cada_papel_de_comando_tem_um_nivel_so() -> None:
    """⭐ Sucessor de `test_apenas_admin_e_manager_sao_exclusivos_da_raiz`.

    O QUE a invariante garante agora, nos DOIS sentidos:
        ver MANAGER    implica estar na raiz;
        ver SUPERVISOR implica estar num subtime.

    Antes so o primeiro valia. OPERATOR continua nos dois niveis de
    proposito -- e a diferenca entre os conjuntos que carrega a regra.
    """
    so_na_raiz = roles_permitidos_no_nivel(RAIZ) - roles_permitidos_no_nivel(SUBTIME)
    so_em_subtime = roles_permitidos_no_nivel(SUBTIME) - roles_permitidos_no_nivel(
        RAIZ
    )
    assert so_na_raiz == {"MANAGER"}
    assert so_em_subtime == {"SUPERVISOR"}


def test_operator_e_o_unico_papel_dos_dois_niveis() -> None:
    """E o unico sem autoridade nenhuma -- e nao e coincidencia.

    Sabotagem: por SUPERVISOR de volta na raiz e este teste cai junto com
    `test_cada_papel_de_comando_tem_um_nivel_so`.
    """
    nos_dois = roles_permitidos_no_nivel(RAIZ) & roles_permitidos_no_nivel(SUBTIME)
    assert nos_dois == {"OPERATOR"}


@pytest.mark.parametrize("role", ["ADMIN", "MANAGER"])
def test_admin_e_manager_recusados_em_subtime(role: str) -> None:
    assert not role_permitido_no_nivel(role, is_root=SUBTIME)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(role, is_root=SUBTIME)


def test_operator_aceito_na_raiz() -> None:
    """⭐ Sucessor parcial de `test_supervisor_e_operator_aceitos_na_raiz`.

    ⚠️ O SUPERVISOR SAIU DESTE TESTE E VIROU O DE BAIXO. O OPERATOR fica, e
    e ele que sustenta o fluxo original: estar so no time geral e estado
    valido (Spec 003, decisoes 7 e 17) -- e assim que se tira alguem de um
    subtime sem remover a pessoa.
    """
    assert role_permitido_no_nivel("OPERATOR", is_root=RAIZ)
    assert_role_permitido_no_nivel("OPERATOR", is_root=RAIZ)  # nao levanta


def test_supervisor_recusado_na_raiz() -> None:
    """⭐ Nasce na fatia D, invertendo o que este arquivo afirmava.

    ⚠️ E A METADE DA REGRA QUE TINHA CONSEQUENCIA DE PRODUTO: mover um
    supervisor de subtime para a raiz nao podia mais gravar SUPERVISOR la, e a
    porta 4 do MemberService (`move_member_subteam`) o REBAIXAVA para OPERATOR
    (decisao da Camila, 08/09). A porta e o rebaixamento sairam com a rota em
    17/09/2026. Esta funcao continua dizendo apenas que o papel nao cabe.

    ⚠️ E o motivo nao e estetico. `_subtimes_supervisionados` devolvia a
    PROPRIA RAIZ quando o vinculo SUPERVISOR estava la, deixando um
    supervisor da raiz governar operadores da raiz por um gate chamado
    "subtimes supervisionados".
    """
    assert not role_permitido_no_nivel("SUPERVISOR", is_root=RAIZ)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel("SUPERVISOR", is_root=RAIZ)


def test_manager_aceito_na_raiz() -> None:
    assert_role_permitido_no_nivel("MANAGER", is_root=RAIZ)  # nao levanta


@pytest.mark.parametrize("nivel", [RAIZ, SUBTIME])
def test_admin_recusado_em_TODO_nivel_de_time(nivel: bool) -> None:
    """⭐ Sucessor de `test_admin_e_manager_aceitos_na_raiz` (fatia D).

    ADMIN deixou de ser papel de time: ele mora em `users.org_role` desde a
    fatia B. Nao ha mais nivel de time que o aceite.

    Sabotagem: devolver ADMIN a `_ROOT_ROLES` faz este teste cair no caso
    RAIZ, e so nele -- o caso SUBTIME ja era recusado antes.
    """
    assert not role_permitido_no_nivel("ADMIN", is_root=nivel)
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel("ADMIN", is_root=nivel)


def test_mensagem_do_admin_diz_para_onde_ele_foi() -> None:
    """⚠️ ADMIN NAO PODE CAIR NO RAMO DE "papel desconhecido".

    Quem tenta cadastrar um admin leria "nao e possivel definir em que nivel
    ele pode existir" e concluiria que o sistema perdeu o papel -- e iria
    procura-lo no lugar errado. A mensagem tem de dizer que ele existe, em
    outro nivel.
    """
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel("ADMIN", is_root=RAIZ)
    texto = str(exc.value).lower()
    assert "organizacao" in texto
    assert "desconhecido" not in texto


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
    with pytest.raises(BusinessRuleError):
        assert_role_permitido_no_nivel(UserTeamRole.ADMIN, is_root=RAIZ)


def test_papel_desconhecido_falha_fechada_nos_dois_niveis() -> None:
    """R5: papel novo no enum sem classificacao aqui e RECUSADO, nao
    liberado. Se um dia entrar 'AUDITOR', ele nao passa calado."""
    for nivel in (RAIZ, SUBTIME):
        assert not role_permitido_no_nivel("AUDITOR", is_root=nivel)
        with pytest.raises(BusinessRuleError):
            assert_role_permitido_no_nivel("AUDITOR", is_root=nivel)


def test_todo_papel_do_enum_esta_classificado() -> None:
    """Guarda contra o enum crescer sem alguem atualizar a regra.

    ⚠️⚠️ ESTE TESTE AFIRMAVA `do_enum == cobertos`, e a fatia D o quebrou de
    verdade: ADMIN passou a nao caber em nivel de time nenhum. A correcao
    NAO foi afrouxar para `>=` -- isso mataria o guardiao, porque qualquer
    papel novo tambem passaria calado.

    A forma nova continua exata: o que sobra do enum, depois de descontar os
    dois niveis, tem de ser EXATAMENTE o conjunto declarado como de
    organizacao. Papel novo aparece nessa diferenca e reprova aqui.
    """
    cobertos = roles_permitidos_no_nivel(RAIZ) | roles_permitidos_no_nivel(SUBTIME)
    do_enum = {r.value for r in UserTeamRole}
    sem_nivel_de_time = do_enum - cobertos
    assert sem_nivel_de_time == set(_ORG_LEVEL_ROLES), (
        "Papel do enum sem nivel definido (ou vice-versa): "
        f"{sem_nivel_de_time ^ set(_ORG_LEVEL_ROLES)}"
    )
    # E nada foi inventado do lado dos niveis: tudo que eles aceitam existe
    # no enum de verdade.
    assert cobertos <= do_enum


def test_mensagem_de_erro_orienta_o_usuario() -> None:
    """A mensagem e lida por um coordenador cadastrando gente, nao por um
    dev: precisa dizer onde o papel PERTENCE, nao so que deu errado."""
    with pytest.raises(BusinessRuleError) as exc:
        assert_role_permitido_no_nivel("MANAGER", is_root=SUBTIME)
    texto = str(exc.value).lower()
    assert "principal" in texto      # onde o papel PERTENCE
    assert "subtime" in texto        # e o que usar no lugar
