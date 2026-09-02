"""Mapa de papeis para permissoes -- autorizacao pragmatica.

DECISAO DA FOUNDATION: nao ha tabela de RBAC. As permissoes
sao derivadas dos papeis (enum user_team_role do schema v5)
por este mapa ESTATICO.

Por que assim:
    - o requisito atual e "nao quero RBAC complexo agora";
    - papeis ja existem no schema (user_team.role);
    - um mapa estatico cobre a necessidade de autorizacao
      sem introduzir tabelas, telas de admin e joins.

Evolucao futura (sem quebrar contrato):
    Se um dia for preciso RBAC dinamico, basta trocar a
    funcao `permissions_for_roles` por uma que consulte o
    banco. O TenantContext e os guards continuam iguais.

POR QUE ESTE MAPA IGNORA O TIME (Spec 024 -- leia antes de "consertar"):
    `permissions_for_roles` recebe a UNIAO dos papeis do usuario e nao
    olha em qual time cada papel foi concedido. Isso parece um furo --
    e era, ate a Spec 024.

    A correcao NAO foi criar permissao por time. Foi restringir ONDE
    cada papel pode existir: ADMIN e MANAGER so existem no time RAIZ
    (`team_scope.assert_role_permitido_no_nivel`, aplicado nas quatro
    portas do MemberService). Como quem carrega esses papeis e
    necessariamente membro da raiz, "uniao dos papeis" e "autoridade
    sobre a arvore" (`team_scope.visible_team_ids`) coincidem por
    construcao.

    Consequencia pratica: este mapa CONTINUA sendo o unico lugar a
    editar quando surgir permissao nova. Se voce esta aqui pensando em
    adicionar escopo de time a uma permissao, provavelmente a resposta
    e outra -- confira se a invariante de nivel ja resolve.

    Cuidado: SUPERVISOR e OPERATOR existem nos DOIS niveis (estar so no
    time geral e estado valido -- Spec 003, decisoes 7 e 17). A
    exclusividade vale so pra ADMIN e MANAGER.

CONVENCAO de nome de permissao: "<recurso>.<acao>", ex.
"task.create", "project.delete", "workspace.manage".
"""

from __future__ import annotations

from app.db.models.enums import OrgRole, UserTeamRole

# Permissoes concedidas por papel. Um usuario com varios
# papeis acumula a UNIAO das permissoes.
#
# Este mapa e o unico lugar a editar quando uma permissao
# nova surgir. Mantido deliberadamente simples e legivel.
_ROLE_PERMISSIONS: dict[UserTeamRole, frozenset[str]] = {
    UserTeamRole.ADMIN: frozenset(
        {
            "workspace.manage",
            "solicitation.review",
            # Spec 043 (fatia A). ⚠️ DISTINTA de `solicitation.review`, e a
            # diferenca e de assunto: `review` e TRIAR o que chegou;
            # `form.manage` e definir O QUE SE PERGUNTA. Quem responde a fila
            # nao e necessariamente quem desenha a porta de entrada.
            "solicitation_form.manage",
            "team.manage",
            "project.create",
            "project.update",
            "project.delete",
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
            # Spec 036 fatia 5b. Duas permissoes e nao uma: sem a `.root`, o
            # ADMIN nao cria quadro nenhum; sem a `.subteam`, o ADMIN nao
            # alcanca o quadro que o supervisor criou. Nao ha hierarquia neste
            # mapa -- sao listas literais, e quem exerce as duas precisa das
            # duas escritas.
            "board.manage.root",
            "board.manage.subteam",
        }
    ),
    UserTeamRole.MANAGER: frozenset(
        {
            "team.manage",
            "solicitation.review",
            # Spec 043 (fatia A), decisao da Camila: ADMIN e MANAGER.
            # ⚠️ O ESCOPO E O DO PAPEL, e nao global -- o servico confere se o
            # time do formulario esta em `editable_team_ids`. Um MANAGER de
            # Design nao edita a porta de entrada do Marketing.
            "solicitation_form.manage",
            "project.create",
            "project.update",
            "project.delete",  # Adicionado na Entrega 1 (decisao 25 da spec).
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
            # Spec 036 fatia 5b -- mesmas duas do ADMIN. MANAGER so existe no
            # time RAIZ (Spec 024), entao "quadro da raiz" e sempre o dele.
            "board.manage.root",
            "board.manage.subteam",
        }
    ),
    UserTeamRole.SUPERVISOR: frozenset(
        {
            "project.update",
            "task.create",
            "task.update",
            "task.assign",
            # Spec 028: alocar braco operacional no PROPRIO subtime.
            # Deliberadamente DISTINTA de "team.manage" (ADMIN/MANAGER):
            # esta so abre adicionar/remover OPERATOR, e so no subtime onde
            # o ator e SUPERVISOR. A trava de escopo NAO mora aqui -- mora
            # em MemberService._assert_escopo_supervisor, que e quem tem o
            # team_id do alvo. Este mapa diz "o que", nao "onde".
            "member.manage.subteam",
            # Spec 036 fatia 5b: quadro proprio do subtime, e SO dele.
            # ⚠️ NAO ganha `board.manage.root`. E a diferenca inteira entre os
            # dois papeis nesta spec: o supervisor monta o quadro do time dele,
            # e nao encosta no Quadro geral -- 176 tarefas vivas em 11/08.
            # ⚠️ A TRAVA DE ESCOPO NAO MORA AQUI. Mora em
            # `BoardService._assert_escopo_do_quadro`, que e quem tem o
            # `team_id` do alvo. Este mapa diz "o que", nao "onde" -- mesmo
            # desenho da `member.manage.subteam` logo acima.
            "board.manage.subteam",
        }
    ),
    UserTeamRole.OPERATOR: frozenset(
        {
            "task.create",
            "task.update",
            "task.assign",  # Entrega 4: operador distribui no quadro geral / seu subtime.
        }
    ),
}


# ---------------------------------------------------------------------
# Spec 045, fatia B -- permissoes do papel de ORGANIZACAO.
#
# ⚠️ MAPA SEPARADO, E NAO MAIS ENTRADAS NO DE CIMA. Os dois niveis respondem
# perguntas diferentes: o de cima recebe papeis de TIME e o escopo deles e a
# arvore; este recebe o papel de ORGANIZACAO, que nao tem time nenhum. Junta-los
# faria `permissions_for_roles` receber uma string que nao existe em
# `UserTeamRole` e ser ignorada em silencio (ela ignora papel desconhecido de
# proposito) -- o GESTOR nasceria sem permissao alguma e nada acusaria.
#
# ⚠️ O ADMIN DE ORGANIZACAO RECEBE EXATAMENTE O QUE O ADMIN DE TIME JA TINHA.
# Nao e preguica: durante a transicao as duas fontes convivem, e um conjunto
# menor aqui faria a Camila PERDER poderes no instante em que o vinculo dela
# saisse de `user_team`. Afinar a diferenca entre "definir" e "operar" a
# organizacao e trabalho das telas (Spec 047), com o cadastro ja limpo.
# ---------------------------------------------------------------------
_ORG_ROLE_PERMISSIONS: dict[OrgRole, frozenset[str]] = {
    OrgRole.ADMIN: _ROLE_PERMISSIONS[UserTeamRole.ADMIN],
    # GESTOR opera a organizacao, mas nao a desfaz: tudo do ADMIN MENOS
    # `workspace.manage`, que e o que renomeia o workspace e apaga area.
    # ⚠️ Ninguem e GESTOR hoje -- o papel nasce para a tela da Spec 047 poder
    # atribui-lo.
    OrgRole.GESTOR: _ROLE_PERMISSIONS[UserTeamRole.ADMIN] - {"workspace.manage"},
}


def permissions_for_org_role(org_role: str | None) -> frozenset[str]:
    """Permissoes do papel de ORGANIZACAO. `None` = nenhum papel, nenhuma.

    Papel desconhecido devolve vazio -- mesmo desenho defensivo de
    `permissions_for_roles`: o banco pode evoluir o enum antes deste mapa, e
    conceder por engano e pior que conceder de menos.
    """
    if org_role is None:
        return frozenset()
    try:
        papel = OrgRole(org_role)
    except ValueError:
        return frozenset()
    return _ORG_ROLE_PERMISSIONS.get(papel, frozenset())


def permissions_for_roles(roles: frozenset[str]) -> frozenset[str]:
    """Deriva o conjunto de permissoes a partir de um conjunto de papeis.

    Papeis desconhecidos sao ignorados (defensivo -- o banco
    pode evoluir o enum antes deste mapa). O resultado e a
    uniao das permissoes de todos os papeis validos.
    """
    result: set[str] = set()
    for role_str in roles:
        try:
            role = UserTeamRole(role_str)
        except ValueError:
            continue  # papel nao mapeado: ignora
        result |= _ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(result)
