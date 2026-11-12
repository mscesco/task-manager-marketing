"""Models de Solicitacao (formulario publico) e do formulario como dado.

Uma submissao com N categorias vira N linhas (`batch_id` gera o protocolo),
cada uma com triagem e tarefa independentes. A identificacao do solicitante e
replicada em cada linha: ele nao tem conta. `answers` e JSONB de
{label, value}, o retrato do que foi perguntado no dia. `status` e String +
CHECK; a maquina de estados vive no dominio.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin, WorkspaceScopedMixin


class Solicitation(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Uma demanda enviada pelo formulario publico. Triada isoladamente."""

    __tablename__ = "solicitation"
    __table_args__ = (
        # Copia de `SolicitationStatus`: estado novo mexe aqui, no dominio e
        # no indice parcial abaixo.
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED', "
            "'IN_PROGRESS', 'DONE')",
            name="solicitation_status_valid",
        ),
        # Rejeicao sempre tem motivo: e o unico registro do porque.
        CheckConstraint(
            "status <> 'REJECTED' OR review_note IS NOT NULL",
            name="solicitation_reject_requires_note",
        ),
        CheckConstraint(
            "batch_seq >= 1 AND batch_seq <= batch_total",
            name="solicitation_batch_seq_valid",
        ),
        # Tarefa so em demanda aceita (inclui em andamento e concluida).
        CheckConstraint(
            "task_created_at IS NULL OR status IN "
            "('APPROVED', 'IN_PROGRESS', 'DONE')",
            name="solicitation_task_requires_approved",
        ),
        ForeignKeyConstraint(
            ["reviewed_by_user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="SET NULL",
            name="solicitation_reviewed_by",
        ),
        ForeignKeyConstraint(
            ["task_marked_by_user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="SET NULL",
            name="solicitation_task_marked_by",
        ),
        # SET NULL: apagar a tarefa nao apaga o pedido, que volta a "aceito sem tarefa".
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="SET NULL",
            name="solicitation_task",
        ),
        # A fila: por status, mais novas primeiro.
        Index(
            "solicitation_ws_status_created",
            "workspace_id",
            "status",
            "created_at",
        ),
        # As irmas de um protocolo.
        Index("solicitation_batch", "workspace_id", "batch_id"),
        # Filtro "aceitas sem tarefa".
        Index(
            "solicitation_aprovadas_sem_tarefa",
            "workspace_id",
            "created_at",
            # O `IN` tem de ser o mesmo da consulta, ou o Postgres nao usa o indice.
            postgresql_where=text(
                "status IN ('APPROVED', 'IN_PROGRESS', 'DONE') "
                "AND task_created_at IS NULL"
            ),
        ),
        # COMMENT da tabela no banco; o dict de opcoes vai por ultimo.
        {
            "comment": (
                "Spec 025: demandas do formulario publico FazAe. Uma linha "
                "por categoria escolhida; triagem e tarefa independentes "
                "por linha."
            )
        },
    )

    requester_name: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_email: Mapped[str] = mapped_column(String(320), nullable=False)
    # NULL = o formulario nao perguntou; "" = perguntou e ficou em branco.
    # Nome e e-mail sao obrigatorios: a fila e por quem pediu e o aviso
    # automatico precisa do endereco.
    requester_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    requester_department: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    requester_polo: Mapped[str | None] = mapped_column(String(255), nullable=True)

    batch_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        comment=(
            "Submissao do formulario. Irmas do mesmo envio compartilham; "
            "gera o protocolo mostrado ao solicitante."
        ),
    )
    # Fixados no envio, para a fila mostrar "2 de 3" sem GROUP BY.
    batch_seq: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )
    batch_total: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )

    #: De qual formulario veio. Nullable: a solicitacao orfa e historico, por
    #: isso o join da fila e LEFT (`SolicitationRepository._base_select`).
    form_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    #: Slug da secao no dia do envio; nao segue renomeacao nem exclusao.
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    answers: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        comment=(
            "Lista JSONB de {label, value}: pergunta/resposta como exibido "
            "ao solicitante."
        ),
    )

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="PENDING", default="PENDING"
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    task_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment=(
            "Autodeclarado pelo aprovador. Alimenta o filtro \"aprovadas "
            "sem tarefa\" -- o valor esta no que fica SEM marca."
        ),
    )
    # Redeclarada sem o comment do TimestampMixin: no banco desta tabela ele nao existe.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    task_marked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    #: Legado: marcacao de tarefa em texto livre, mantida como unico rastro
    #: das solicitacoes antigas. O vinculo real e `task_id`.
    task_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)

    #: A tarefa que nasceu do pedido.
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )


# O formulario como dado. `solicitation.answers` guarda o texto da pergunta,
# entao editar o formulario nao altera pedidos antigos.


class SolicitationForm(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Um formulario publico, de um time.

    `team_id` decide quem tria (a solicitacao chega por `form_id`). `slug` e a
    URL publica (`/solicitar/<slug>`), unico por workspace entre os nao
    apagados. Rascunho (`is_published` falso) nao aparece nem responde.
    """

    __tablename__ = "solicitation_form"
    __table_args__ = (
        # Sem esta unique a FK composta da secao nao pode existir.
        UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_form_id_workspace"
        ),
        # RESTRICT: apagar o time nao leva o formulario das solicitacoes antigas.
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="solicitation_form_team",
        ),
        Index(
            "solicitation_form_slug_unico",
            "workspace_id",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("solicitation_form_por_time", "workspace_id", "team_id"),
    )

    team_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="", default=""
    )
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )

    # Cabecalho: cada coluna guarda o rotulo do campo; NULL = nao pergunta.
    # Nome e e-mail nao sao configuraveis.
    phone_label: Mapped[str | None] = mapped_column(
        String(60), nullable=True, server_default="Telefone", default="Telefone"
    )
    department_label: Mapped[str | None] = mapped_column(
        String(60),
        nullable=True,
        server_default="Área / Departamento",
        default="Área / Departamento",
    )
    polo_label: Mapped[str | None] = mapped_column(
        String(60), nullable=True, server_default="Polo", default="Polo"
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SolicitationSection(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Uma secao do formulario (a antiga "categoria").

    `summary_question_id`: qual resposta vira o titulo do card na fila.
    """

    __tablename__ = "solicitation_section"
    __table_args__ = (
        # Alvo da FK composta da pergunta.
        UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_section_id_workspace"
        ),
        ForeignKeyConstraint(
            ["form_id", "workspace_id"],
            ["solicitation_form.id", "solicitation_form.workspace_id"],
            ondelete="CASCADE",
            name="solicitation_section_form",
        ),
        # Slug unico no formulario entre os nao apagados: a fila resolve o
        # rotulo do pedido por (form_id, slug).
        Index(
            "solicitation_section_slug_unico",
            "form_id",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("solicitation_section_por_form", "workspace_id", "form_id", "position"),
    )

    form_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    #: Vai para `solicitation.category`.
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    emoji: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="", default=""
    )
    #: SLA mostrado ao solicitante, em texto livre ("5 dias uteis apos aprovacao").
    sla_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary_question_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: A secao pode ser preenchida mais de uma vez no envio; cada repeticao
    #: vira uma solicitacao no lote.
    repeatable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    #: O que o botao diz: "+ Adicionar outro <repeat_label>". Vazio = o titulo.
    repeat_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SolicitationQuestion(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Uma pergunta de uma secao. `show_if_question_id` + `show_if_value`: a
    pergunta so aparece se aquela resposta tiver aquele valor."""

    __tablename__ = "solicitation_question"
    __table_args__ = (
        ForeignKeyConstraint(
            ["section_id", "workspace_id"],
            ["solicitation_section.id", "solicitation_section.workspace_id"],
            ondelete="CASCADE",
            name="solicitation_question_section",
        ),
        CheckConstraint(
            "position >= 0", name="solicitation_question_position_nao_negativa"
        ),
        Index(
            "solicitation_question_por_secao",
            "workspace_id",
            "section_id",
            "position",
        ),
    )

    section_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    #: Lista em `domain/form.py::QuestionKind`, nao ENUM: tipo novo sem migration.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    #: Alternativas de `escolha`/`multi`.
    options: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
    placeholder: Mapped[str | None] = mapped_column(String(200), nullable=True)
    help: Mapped[str | None] = mapped_column(String(300), nullable=True)
    show_if_question_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    show_if_value: Mapped[str | None] = mapped_column(String(200), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
