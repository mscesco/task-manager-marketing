"""Models ORM operacionais: project e task.

task e o agregado central do sistema. Pontos de atencao:
    - hierarquia via parent_task_id + LTREE (path) + depth;
    - subtask NAO tem tabela propria -- tudo e task;
    - ciclos indiretos (A->B->C->A) sao validados na
      service layer usando LTREE (o banco so impede
      self-reference direta);
    - soft delete + archive coexistem.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.db.base import Base
from app.db.mixins import (
    ArchivableMixin,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)
from app.db.models.enums import PriorityLevel, ProjectStatus, TaskStatus


class Ltree(UserDefinedType):
    """Tipo LTREE do PostgreSQL (extensao ltree).

    Mapeado como string no lado Python. Operacoes de
    hierarquia (ancestral, descendente, @>, <@) sao feitas
    com SQL textual na service/repository de task -- nao
    precisamos de um ORM-type sofisticado para a foundation.
    """

    cache_ok = True

    def get_col_spec(self, **kw: object) -> str:
        return "LTREE"


class Project(
    UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, ArchivableMixin, Base
):
    """Projeto. Container de tasks.

    is_personal:
        True identifica o projeto pessoal de um user (1 por user,
        garantido pelo indice parcial `project_personal_per_user`).
        Pessoais nao podem ser deletados, arquivados nem editados
        via PATCH (regras no ProjectService). Pessoal alheio eh
        invisivel em list/get. Ver ADR 0001.
    """

    __tablename__ = "project"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_project_id_workspace"),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="project_created_by",
        ),
        # Entrega 3: time dono do projeto (FK composta). Nulo no pessoal.
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="project_team",
        ),
        # Entrega 3 (ADR 0007): projeto comum exige time. Pessoal e
        # soft-deleted ficam isentos.
        CheckConstraint(
            "is_personal OR team_id IS NOT NULL OR deleted_at IS NOT NULL",
            name="project_team_required_when_common",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, name="project_status", create_type=False),
        nullable=False,
        server_default=ProjectStatus.PLANNING.value,
        default=ProjectStatus.PLANNING,
    )
    priority: Mapped[PriorityLevel] = mapped_column(
        Enum(PriorityLevel, name="priority_level", create_type=False),
        nullable=False,
        server_default=PriorityLevel.MEDIUM.value,
        default=PriorityLevel.MEDIUM,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    # Entrega 3: time dono do projeto. Nulo no pessoal (ver CHECK).
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    # Adicionado na migration 0002. server_default garante valor
    # para linhas pre-existentes e para INSERTs que omitam o campo.
    is_personal: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default="false",
        default=False,
    )


class Task(
    UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, ArchivableMixin, Base
):
    """Task -- agregado central. Subtasks sao tasks com parent_task_id."""

    __tablename__ = "task"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_task_id_workspace"),
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["project.id", "project.workspace_id"],
            ondelete="RESTRICT",
            name="task_project",
        ),
        ForeignKeyConstraint(
            ["parent_task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="task_parent",
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="task_team",
        ),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="task_created_by",
        ),
        CheckConstraint(
            "parent_task_id IS NULL OR parent_task_id <> id",
            name="task_no_self_parent",
        ),
        # Spec 035: tenancy do quadro, no mesmo formato dos outros.
        ForeignKeyConstraint(
            ["board_id", "workspace_id"],
            ["board.id", "board.workspace_id"],
            ondelete="RESTRICT",
            name="task_board",
        ),
        # ⚠️ A FK COMPOSTA E O PONTO, nao detalhe: ela torna impossivel NO
        # BANCO que uma tarefa aponte pra coluna de OUTRO quadro. Sem ela esse
        # estado e questao de tempo, nao aparece na tela, e entra na mesma
        # familia de `path`/`depth` -- corrupcao sem sintoma e sem conserto
        # por deploy.
        ForeignKeyConstraint(
            ["column_id", "board_id"],
            ["board_column.id", "board_column.board_id"],
            ondelete="RESTRICT",
            name="task_board_column",
        ),
        CheckConstraint("depth >= 0", name="task_depth_non_negative"),
        CheckConstraint("position >= 0", name="task_position_non_negative"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Entrega 3: nullable -> tarefa avulsa (sem projeto). ADR 0006.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    # Spec 035, fatia 3b: OBRIGATORIOS desde a `0011`. Toda tarefa vive num
    # quadro e numa coluna.
    #
    # ⚠️ NASCERAM NULLABLE na `0008` DE PROPOSITO, e a trava so veio duas
    # migrations depois. Criar ja obrigatorio quebra em qualquer banco com
    # dados -- e, pior, trava a tabela contra o PROPRIO codigo enquanto ele
    # ainda nao preenche o campo. A primeira versao da `0008` fez isso e
    # derrubou 196 testes de uma vez. Expande/contrai: coluna e backfill numa
    # migration, trava depois que o codigo escreve.
    #
    # ⚠️ Esta declaracao tem de acompanhar a `0011`. Deixar `| None` aqui com
    # NOT NULL no banco poe o portao de drift vermelho para sempre -- o
    # autogenerate propoe `alter_column(..., nullable=True)` toda vez, e
    # portao que mente vira ruido que as pessoas aprendem a ignorar.
    board_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    column_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    # ⚠️ RELOGIO DO ARQUIVAMENTO (Spec 035, D6). Gravado quando a tarefa ENTRA
    # numa coluna terminal, limpo quando sai. Nao e refatoracao: quando a
    # semantica de uma coluna puder ser editada, marcar "Aprovacao" como
    # terminal numa terca a tarde faria o job arquivar de madrugada tudo que
    # esta parado ali ha mais de 20 dias -- de uma vez, sem aviso. E o formato
    # do incidente das 177 emissoes. Com esta coluna, mudar a semantica grava
    # `now()` e o relogio recomeca.
    terminal_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        # ⚠️ O COMMENT esta no BANCO (migration 0008) e por isso precisa ser
        # DECLARADO aqui, palavra por palavra -- senao o autogenerate propoe
        # apagar a documentacao a cada rodada e o portao de drift nunca fecha.
        comment=(
            "Spec 035: quando a tarefa ENTROU em coluna terminal. Relogio "
            "do arquivamento automatico -- editar a semantica de uma coluna "
            "passa a reiniciar a contagem em vez de arquivar tudo na "
            "madrugada seguinte."
        ),
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=False,
        server_default=TaskStatus.BACKLOG.value,
        default=TaskStatus.BACKLOG,
    )
    priority: Mapped[PriorityLevel] = mapped_column(
        Enum(PriorityLevel, name="priority_level", create_type=False),
        nullable=False,
        server_default=PriorityLevel.MEDIUM.value,
        default=PriorityLevel.MEDIUM,
    )
    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0",
        default=0,
        comment="Ordenacao temporaria. Futuro: fractional indexing.",
    )
    depth: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    # path LTREE: NOT NULL no schema. Setado pela service de task
    # ao criar/mover a task.
    path: Mapped[str] = mapped_column(
        Ltree(),
        nullable=False,
        comment="Hierarquia LTREE. Exemplo: root.child.subchild",
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Spec 038, fatia B: a HORA do prazo. `None` = "vence no dia", que e o
    # comportamento de sempre e o de 100% das 1085 tarefas de 18/08.
    #
    # ⚠️ COLUNA SEPARADA, E NAO `due_date` VIRANDO `timestamptz`. Horario e
    # OPCIONAL (decisao da Camila, 18/08), e um timestamp unico nao distingue
    # "vence dia 19" de "vence dia 19 a meia-noite" -- sao dois estados de
    # produto e um valor so. Aqui "sem hora" E o `NULL`, e nao um valor
    # especial.
    #
    # ⚠️ E FOI ISSO QUE EVITOU MEXER EM 1085 LINHAS. Trocar o tipo de `due_date`
    # exigiria backfill (e `00:00` poria toda tarefa com prazo hoje em atraso de
    # manha), mais a troca de tipo dos DOIS campos de dedup abaixo -- e se eles
    # divergissem de `due_date`, o job passaria a notificar todo dia, todas as
    # tarefas com prazo, para as 26 pessoas. Coluna nova e nula nao faz nada
    # disso: o codigo velho nunca pergunta por ela.
    #
    # ⚠️ `Time` SEM FUSO, E ISSO E DELIBERADO. E relogio de parede -- "18:00" e
    # o que a pessoa digita. O fuso entra UMA vez, na hora de comparar, e e
    # `America/Sao_Paulo` (decisao da Camila, 18/08) -- o MESMO que o
    # `DeadlineNotifyService` ja usa desde a Spec 023 (D7). A tela e o job
    # passam a concordar por construcao.
    due_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Spec 023: dedup do aviso de prazo. Cada coluna guarda o due_date pra qual
    # aquele aviso JA saiu. O job so notifica se difere do due_date atual --
    # se o prazo mudar, reabilita sozinho (self-healing). So o job escreve aqui.
    due_soon_notified_for: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        comment=(
            "Spec 023: due_date pra qual o aviso de \"2 dias\" ja saiu "
            "(dedup). Difere do due_date atual => reabilita."
        ),
    )
    overdue_notified_for: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        comment=(
            "Spec 023: due_date pra qual o aviso de atraso ja saiu "
            "(dedup). Difere do due_date atual => reabilita."
        ),
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
