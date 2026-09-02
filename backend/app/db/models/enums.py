"""Enums de dominio, espelhando os tipos ENUM do schema v5.

Os valores (strings) DEVEM ser identicos aos definidos no
PostgreSQL (CREATE TYPE ... AS ENUM). O SQLAlchemy mapeia
estes enums Python para os tipos nativos do banco.

Schema v5::

    user_team_role : ADMIN, MANAGER, SUPERVISOR, OPERATOR
    org_role       : ADMIN, GESTOR   (Spec 045 -- migration 0022)
    project_status : PLANNING, ACTIVE, BLOCKED, COMPLETED, CANCELLED
    task_status    : BACKLOG, PLANNED, IN_PROGRESS, IN_REVIEW,
                     BLOCKED, COMPLETED, CANCELLED
    priority_level : LOW, MEDIUM, HIGH, URGENT
"""

from __future__ import annotations

from enum import StrEnum


class UserTeamRole(StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    SUPERVISOR = "SUPERVISOR"
    OPERATOR = "OPERATOR"


class OrgRole(StrEnum):
    """Papel na ORGANIZACAO -- sem time (Spec 045, fatia B).

    ⚠️ A SEGUNDA PERTENCA. Ate esta spec, o unico lugar onde um papel podia
    existir era `user_team`, ou seja: TODO papel exigia um time. Um gestor da
    organizacao -- quem administra todas as areas sem pertencer a nenhuma --
    nao tinha onde morar. Com uma raiz so dava para fingir que a raiz ERA a
    organizacao; com N raizes (Spec 046) a ficcao nao fecha: admin de qual?

    `users.workspace_id` ja existe, entao a pessoa ja pertencia a organizacao
    sem depender de time. O que faltava era o PAPEL nesse nivel.

    ADMIN  -- define a organizacao: renomeia, apaga area, promove gestor.
    GESTOR -- opera a organizacao: cria area, cadastra e desativa pessoas,
              distribui papeis de time. Nao desfaz a organizacao.

    ⚠️ NAO TEM ORDEM, como todo StrEnum daqui -- a ordem em que os dois estao
    escritos e coincidencia de leitura. Se algum dia for preciso comparar posto
    entre eles, escreva um mapa explicito; comparar as strings mente sem erro
    nenhum (AGENTS.md §9).
    """

    ADMIN = "ADMIN"
    GESTOR = "GESTOR"


class ProjectStatus(StrEnum):
    PLANNING = "PLANNING"
    ACTIVE = "ACTIVE"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TaskStatus(StrEnum):
    BACKLOG = "BACKLOG"
    PLANNED = "PLANNED"
    IN_PROGRESS = "IN_PROGRESS"
    IN_REVIEW = "IN_REVIEW"
    # Spec 026: aprovacao de FORA do time (cliente/fornecedor/outra area),
    # distinta da revisao interna (IN_REVIEW). Estado EXCLUSIVo -- um card
    # so tem um status. Adicionado ao enum nativo via migration 0006
    # (ALTER TYPE ADD VALUE, sem downgrade -- Postgres nao remove valor).
    EXTERNAL_APPROVAL = "EXTERNAL_APPROVAL"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class ColumnSemantic(StrEnum):
    """O que uma COLUNA de quadro significa (Spec 035, ADR 0030).

    ⚠️ Existe porque quatro subsistemas dependem do SIGNIFICADO do status, e
    nao do rotulo: a cascata de conclusao, a varredura de arquivamento, a
    proporcao da checklist e o aviso de prazo. Com coluna configuravel, o
    rotulo deixa de ser confiavel -- a semantica e o que sobra pra eles
    perguntarem.

    ⚠️ DONE e CANCELLED sao os dois TERMINAIS, e nao sao intercambiaveis: a
    proporcao da checklist conta concluidas e ignora canceladas.
    """

    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class PriorityLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"
