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
    #: De qual FORMULARIO veio (Spec 043, fatia A).
    #:
    #: ⚠️ NASCE NULLABLE E CONTINUA NULLABLE. As solicitacoes anteriores a esta
    #: fatia ganham o valor na migracao de dados, pelo slug da categoria -- mas
    #: uma que fique sem (formulario apagado depois, banco de outro ambiente)
    #: NAO pode virar linha invalida. Ela e historico, e o `answers` dela ja se
    #: explica sozinho.
    #:
    #: ⚠️⚠️ E POR ISSO O JOIN DA FILA E `LEFT`. Um `JOIN` interno apagaria a
    #: solicitacao orfa da fila EM SILENCIO -- ninguem receberia erro, ela
    #: simplesmente deixaria de existir para quem tria. Ver
    #: `SolicitationRepository._base_select`.
    form_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    #: ⚠️ CONTINUA SENDO O SLUG DA SECAO, e continua texto. Ele e o vinculo
    #: historico: solicitacao respondida ha meses guarda a categoria que
    #: existia entao, mesmo que a secao tenha sido renomeada ou apagada.
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


# =====================================================================
# O FORMULARIO COMO DADO (Spec 043, fatia A)
#
# ⚠️ TRES TABELAS PARA UMA COISA QUE JA EXISTIA EM CODIGO. O formulario ja era
# declarativo (`web/lib/solicitacaoForm.ts`, 926 linhas): categorias, campos,
# seis tipos, pergunta condicional, SLA. O que ele nao era e EDITAVEL por
# quem nao mexe em codigo -- e, pior, a lista de categorias estava DUPLICADA
# no dominio do backend, entao categoria nova exigia deploy dos dois lados.
#
# ⚠️ E O `solicitation.answers` NAO MUDA. Ele guarda `{label, value}` -- o
# TEXTO da pergunta -- e e isso que torna o formulario editavel seguro: cada
# solicitacao carrega o retrato do que foi perguntado no dia. Ver
# `app/modules/solicitations/domain/form.py`.
# =====================================================================


class SolicitationForm(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Um formulario publico, de um time.

    ⚠️ `team_id` E O QUE DECIDE QUEM TRIA. A `solicitation` nao tem time --
    ela chega por aqui (`solicitation.form_id -> form.team_id`). Decisao da
    Camila (22/08): "a fila e de acordo com o formulario e o time".

    ⚠️ `slug` E A URL PUBLICA (`/solicitar/<slug>`), e por isso ele e unico
    POR WORKSPACE e nao por time: dois times do mesmo workspace nao podem
    disputar `/solicitar/arte`. O indice parcial ignora os apagados -- senao
    um formulario na lixeira reservaria o nome para sempre.

    ⚠️ `is_published` E A TRAVA DO PUBLICO. Rascunho nao aparece na lista nem
    responde pela URL. Sem isso, montar um formulario seria montar EM PUBLICO.
    """

    __tablename__ = "solicitation_form"
    __table_args__ = (
        # ⚠️⚠️ SEM ESTA UNIQUE, A FK COMPOSTA DA SECAO NAO EXISTE. O Postgres
        # exige que as colunas referenciadas tenham unicidade -- e `(id,
        # workspace_id)` nao a tem so por `id` ser PK. O erro sai na
        # MIGRATION, com "there is no unique constraint matching given keys",
        # e foi assim que a 0016 quebrou na primeira tentativa.
        #
        # ⚠️ O NOME SEGUE `uq_team_id_workspace` e `uq_board_id_workspace`, que
        # ja existem no schema -- e nao a convencao automatica, que daria
        # `uq_solicitation_form_id` e esconderia a segunda coluna do nome.
        UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_form_id_workspace"
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="solicitation_form_team",
        ),
        # ⚠️ RESTRICT, e nao CASCADE: apagar um time nao pode levar junto o
        # formulario que ainda responde por solicitacoes historicas.
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
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SolicitationSection(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Uma secao do formulario -- o que hoje se chama "categoria".

    ⚠️ O NOME MUDOU DE PROPOSITO. "Categoria" descrevia um menu de assuntos
    num formulario so; com varios formularios por time, o que existe e uma
    SECAO dentro de um deles. O slug antigo continua vivo em
    `solicitation.category`, que e historico e nao muda.

    ⚠️ `summary_question_id` E O `resumoDe` DO FRONT: qual resposta vira o
    titulo do card na fila de triagem. Sem ele a fila mostra o assunto e mais
    nada, e quem tria precisa abrir cada uma para saber do que se trata.
    """

    __tablename__ = "solicitation_section"
    __table_args__ = (
        # Mesma razao da tabela acima: e a pergunta que aponta para ca por
        # `(section_id, workspace_id)`.
        UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_section_id_workspace"
        ),
        ForeignKeyConstraint(
            ["form_id", "workspace_id"],
            ["solicitation_form.id", "solicitation_form.workspace_id"],
            ondelete="CASCADE",
            name="solicitation_section_form",
        ),
        Index("solicitation_section_por_form", "workspace_id", "form_id", "position"),
    )

    form_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    #: Slug estavel da secao. ⚠️ E ele que vai para `solicitation.category`, e
    #: e por ele que a migracao de dados liga as solicitacoes antigas.
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    emoji: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="", default=""
    )
    #: SLA mostrado ao solicitante. ⚠️ TEXTO LIVRE, e nao um numero de dias: o
    #: formulario de hoje diz coisas como "5 dias uteis apos aprovacao" e
    #: "prazo em definicao". Numero obrigaria a inventar semantica que ninguem
    #: pediu, e a traduzir de volta para uma frase na tela.
    sla_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary_question_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SolicitationQuestion(
    UUIDPrimaryKeyMixin, WorkspaceScopedMixin, TimestampMixin, Base
):
    """Uma pergunta de uma secao.

    ⚠️ `show_if_question_id` + `show_if_value` E O `mostrarSe` DO FRONT, e ele
    ja existe la ("Se sim / Se nao"). Guardar como par (pergunta, valor) e o
    minimo que cobre o que o formulario de hoje faz -- condicao composta (E/OU)
    nao esta em lugar nenhum do desenho atual, e inventa-la agora seria
    construir editor para regra que ninguem escreveu.
    """

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
    #: ⚠️ `String(20)` COM LISTA NO DOMINIO, e nao ENUM nativo -- ver
    #: `domain/form.py::QuestionKind`. Tipo novo nao pode exigir migration.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    #: Alternativas de `escolha`/`multi`. Lista JSONB de textos.
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
