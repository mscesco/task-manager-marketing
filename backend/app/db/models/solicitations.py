"""Model ORM de Solicitacao -- formulario publico FazAe (Spec 025).

Solicitacoes chegam de FORA do sistema (formulario publico, sem login) e
entram na fila de triagem do marketing. Quem tria precisa de
`solicitation.review` -- que, pela invariante da Spec 024, significa
ADMIN ou MANAGER do time principal.

ANATOMIA DA TABELA (quatro blocos)
    identificacao -- quem pediu. Replicada em cada linha do lote de
        proposito: a solicitacao precisa ser autoexplicativa na fila,
        sem join, e o solicitante nao tem conta pra referenciar.
    lote          -- uma submissao com N categorias vira N LINHAS.
    conteudo      -- a demanda em si.
    triagem       -- aprovar/rejeitar, por linha.
    tarefa        -- aprovar NAO cria tarefa; isto rastreia o passo manual.

DECISOES (Spec 025)
    D10 `answers` e JSONB (lista de {label, value}): o formulario tem 11
        ramificacoes e vai mudar. Coluna a coluna geraria uma migration
        por ajuste de texto de pergunta. Tradeoff: validacao campo a
        campo fica no front; o backend valida identificacao, categoria e
        tamanho (endpoint publico => anti-abuso).
    D4  Multi-selecao: cada categoria escolhida vira uma linha propria,
        com SLA, triagem e tarefa INDEPENDENTES -- aprovar a arte e
        rejeitar a divulgacao do mesmo envio e o caso de uso central.
        `batch_id` mantem as irmas reconheciveis e gera o PROTOCOLO que
        o solicitante leva embora.
        `batch_seq`/`batch_total` sao desnormalizacao de dado IMUTAVEL
        (fixado no envio): evita um GROUP BY por linha so pra exibir
        "2 de 3" na fila.
    D8  Rejeicao SEMPRE carrega justificativa. E o unico registro do
        porque -- o solicitante nao tem conta nem recebe notificacao.
    D9  Aprovar nao cria tarefa (decisao de produto). O bloco `task_*`
        existe pra alimentar o filtro "aprovadas sem tarefa": sem ele,
        demanda aprovada apodrece em silencio ate alguem cobrar.
        E autodeclarado; o valor esta no negativo (o que fica sem marca).

    `status` e String + CHECK, nao ENUM do banco: evita churn de ALTER
    TYPE a cada estado novo; a maquina de estados vive no dominio.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
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
        # ---------------- integridade de estado ----------------
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="solicitation_status_valid",
        ),
        # D8 -- defesa em profundidade: o service tambem valida, mas uma
        # rejeicao sem motivo nao pode existir nem por caminho torto.
        CheckConstraint(
            "status <> 'REJECTED' OR review_note IS NOT NULL",
            name="solicitation_reject_requires_note",
        ),
        # D4 -- posicao coerente dentro do lote.
        CheckConstraint(
            "batch_seq >= 1 AND batch_seq <= batch_total",
            name="solicitation_batch_seq_valid",
        ),
        # D9 -- tarefa so existe para demanda APROVADA. Marcar tarefa de
        # pendente ou rejeitada e sempre erro de fluxo.
        CheckConstraint(
            "task_created_at IS NULL OR status = 'APPROVED'",
            name="solicitation_task_requires_approved",
        ),
        # ---------------- integridade referencial ----------------
        # FKs COMPOSTAS com workspace_id, como no resto do schema: impedem
        # apontar usuario de outro tenant.
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
        # ---------------- indices (um por leitura real) ----------------
        # 1. A fila: "deste workspace, por status, mais novas primeiro".
        Index(
            "solicitation_ws_status_created",
            "workspace_id",
            "status",
            "created_at",
        ),
        # 2. Abrir um envio: "todas as irmas deste protocolo".
        Index("solicitation_batch", "workspace_id", "batch_id"),
        # 3. PARCIAL -- o filtro "aprovadas sem tarefa" (D9). Parcial
        #    porque so essas linhas interessam: o indice fica minusculo e
        #    some quando alguem marca a tarefa.
        Index(
            "solicitation_aprovadas_sem_tarefa",
            "workspace_id",
            "created_at",
            postgresql_where=text(
                "status = 'APPROVED' AND task_created_at IS NULL"
            ),
        ),
        # COMMENT da TABELA no schema v5 (dict de opcoes vai por ULTIMO).
        {
            "comment": (
                "Spec 025: demandas do formulario publico FazAe. Uma linha "
                "por categoria escolhida; triagem e tarefa independentes "
                "por linha."
            )
        },
    )

    # ---------------- identificacao do solicitante ----------------
    # Sem conta no sistema: quem pede e coordenador de polo, professor, RH.
    requester_name: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_email: Mapped[str] = mapped_column(String(320), nullable=False)
    requester_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    requester_department: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_polo: Mapped[str] = mapped_column(String(255), nullable=False)

    # ---------------- lote (D4) ----------------
    batch_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        comment=(
            "Submissao do formulario. Irmas do mesmo envio compartilham; "
            "gera o protocolo mostrado ao solicitante."
        ),
    )
    # ⚠️ server_default no banco (DEFAULT 1). Sem declarar aqui, o
    # autogenerate propoe DROP DEFAULT -- e INSERT fora do ORM (psql, n8n)
    # passa a violar o NOT NULL.
    batch_seq: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )
    batch_total: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )

    # ---------------- conteudo ----------------
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

    # ---------------- triagem ----------------
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

    # ---------------- tarefa (D9) ----------------
    task_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment=(
            "Autodeclarado pelo aprovador. Alimenta o filtro \"aprovadas "
            "sem tarefa\" -- o valor esta no que fica SEM marca."
        ),
    )
    # ⚠️ Override do TimestampMixin: `solicitation` e a UNICA tabela com
    # updated_at SEM comment no banco (0005 foi escrita a mao e esqueceu).
    # Redeclarada sem comment pra o diff do autogenerate fechar em zero.
    # Se um dia rodar uma migration que acrescente o comment la, apague
    # estas linhas e deixe o mixin valer.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    task_marked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    #: link ou identificador da tarefa criada. Texto livre: a criacao e
    #: manual, entao nao ha id garantido pra validar contra a tabela task.
    task_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
