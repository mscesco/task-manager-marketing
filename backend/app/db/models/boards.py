"""Models ORM de QUADRO: board e board_column (Spec 035, ADR 0030).

Ate 05/08/2026 "coluna" nao existia como entidade -- a coluna ERA o
`task.status`, um ENUM nativo. Enquanto for assim nao ha quadro configuravel,
e trocar o ENUM por texto livre quebraria em silencio os quatro subsistemas
que dependem do SIGNIFICADO do status.

A saida e a coluna DECLARAR o que significa (`semantic`). O `task.status`
continua existindo e passa a ser derivado dela -- os onze pontos do backend
que perguntam "isto esta concluido?" seguem funcionando sem saber que colunas
existem.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import ColumnSemantic, TaskStatus


class Board(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Quadro. Pertence a um TIME.

    ⚠️ Nesta spec existe UM por workspace: o geral, do time raiz. O modelo ja
    comporta o quadro personalizado de subtime (ADR 0030, decisao B), que e
    spec seguinte -- por isso `team_id` e nao `workspace_id` sozinho.

    ⚠️ `SoftDeleteMixin` DESDE A `0012`, e ele vem ANTES de existir tela de
    apagar quadro, de proposito. A ADR 0034 decidiu que apagar quadro interno
    apaga as tarefas junto (soft delete, ADR 0005); a coluna precisa existir
    antes do `GET /boards` (FATIA 2 do `plan.md` da Spec 036 -- o roteiro
    antigo chamava essa entrega de "F3"; as duas numeracoes nao coincidem e o
    `plan.md` e a fonte da verdade), senao o endpoint nasce sem
    `deleted_at IS NULL` e passa a listar quadro apagado no dia em que apagar
    existir -- defeito plantado numa fatia e colhido em outra.

    ⚠️ `BoardColumn` NAO ganhou soft delete, e nao e esquecimento. Apagar
    COLUNA e outra operacao: pela 0030 ela exige escolher a coluna de destino
    das tarefas e some de verdade. Dar `deleted_at` a ela agora seria schema
    especulativo para uma decisao que ainda nao foi tomada.

    ⚠️ CONSEQUENCIA NAO OBVIA DO INDICE PARCIAL. `board_um_padrao_por_time` e
    unico em `team_id WHERE is_default`, e nao sabe de `deleted_at`. Um quadro
    PADRAO apagado continua bloqueando a criacao de um novo padrao para aquele
    time -- o time ficaria sem quadro e sem como recriar. Nao ha conserto aqui
    porque nao ha problema hoje: quadro interno e `is_default=False` e o indice
    nem se aplica a ele. **A F5 tem de PROIBIR apagar quadro padrao**, e essa
    trava e a que fecha o caso. Se um dia o padrao virar apagavel, o indice
    ganha `AND deleted_at IS NULL` na mesma migration.
    """

    __tablename__ = "board"
    __table_args__ = (
        # Sustenta a FK composta de `board_column` e de `task`.
        UniqueConstraint("id", "workspace_id", name="uq_board_id_workspace"),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="board_team",
        ),
        # ⚠️ UM quadro padrao por TIME, garantido por indice parcial -- mesma
        # tecnica do `team_unica_raiz_por_workspace`. Sem isto, "qual e o
        # quadro do time?" passa a ter duas respostas, e a resposta errada
        # nao aparece na tela: aparece na tarefa que foi parar no quadro
        # errado.
        Index(
            "board_um_padrao_por_time",
            "team_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        # ⚠️ NOME UNICO POR TIME (fatia 9, migration `0013`). Ate 18/08 nada
        # impedia tres quadros "Quadro CRM Teste" no mesmo subtime -- e havia
        # tres, vistos na conferencia visual de 17/08.
        #
        # ⚠️ E PRE-REQUISITO DE APAGAR QUADRO. Aquela fatia confirma a exclusao
        # pedindo para DIGITAR o nome; com nomes repetidos, digitar nao diz
        # qual dos tres, e a confirmacao vira teatro numa operacao que apaga as
        # tarefas de dentro.
        #
        # ⚠️ MAIUSCULA CONTA: "Backlog" e "backlog" sao nomes diferentes e os
        # dois podem existir (decisao de 18/08). Indexar `lower(name)` foi
        # recusado -- "sao diferentes visualmente".
        #
        # ⚠️ PARCIAL: quadro APAGADO nao ocupa o nome. Sem o `WHERE`, um quadro
        # que ninguem consegue ver bloquearia o nome para sempre, e a tela
        # diria "ja existe" apontando para o nada.
        #
        # ⚠️ NAO HA EQUIVALENTE EM `board_column`, E ISSO E MEDIDO, nao
        # esquecido. Ver o comentario em `_assert_nomes_do_lote`: o lote aplica
        # em quatro etapas com `flush` em cada uma, e um indice unico recusaria
        # o estado INTERMEDIARIO de trocar duas colunas de nome ou de
        # apagar-e-recriar com o mesmo nome -- com `IntegrityError`, que sai
        # como 500.
        Index(
            "board_nome_unico_por_time",
            "team_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )


class BoardColumn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Coluna de um quadro. O que a pessoa ve e configura.

    ⚠️ `semantic` e o campo que faz esta spec valer a pena. Sem ele, coluna
    configuravel derruba a cascata de conclusao, a varredura de arquivamento,
    a proporcao da checklist e o aviso de prazo -- os quatro em SILENCIO.
    """

    __tablename__ = "board_column"
    __table_args__ = (
        # Sustenta a FK composta de `task`: (column_id, board_id).
        UniqueConstraint(
            "id", "board_id", name="uq_board_column_id_board"
        ),
        ForeignKeyConstraint(
            ["board_id", "workspace_id"],
            ["board.id", "board.workspace_id"],
            ondelete="RESTRICT",
            name="board_column_board",
        ),
        CheckConstraint("position >= 0", name="board_column_position_non_negative"),
        # ⚠️ UMA coluna de destino por semantica, por quadro. E o que responde
        # "para onde vai a tarefa concluida?" quando existem duas colunas
        # `DONE`. A alternativa (a primeira pela ordem) foi rejeitada no ADR
        # 0030: amarraria o destino da cascata a ordem VISUAL, e arrastar uma
        # coluna passaria a mudar comportamento sem ninguem pedir.
        Index(
            "board_column_um_destino_por_semantica",
            "board_id",
            "semantic",
            unique=True,
            postgresql_where=text("is_default_target"),
        ),
        # ⚠️ UM status por quadro (Spec 035 fatia 3a, ADR 0033). Enquanto a
        # coluna e derivada do status, "qual e a coluna deste status?" tem de
        # ter UMA resposta -- com duas, o `BoardRepository` escolheria uma
        # delas em silencio e a tarefa iria para a coluna errada, sem erro e
        # sem tela.
        #
        # ⚠️ PARCIAL: coluna criada por gente tem `legacy_status` NULL, e
        # varias coexistem no mesmo quadro. Indice unico simples recusaria a
        # segunda coluna nova de qualquer quadro.
        Index(
            "board_column_um_status_por_quadro",
            "board_id",
            "legacy_status",
            unique=True,
            postgresql_where=text("legacy_status IS NOT NULL"),
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    board_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # ⚠️ TOKEN de tema, nao hex. A Spec 031 (C1a) tirou os hex justamente
    # porque nao invertiam no tema escuro. As colunas migradas levam
    # `var(--status-backlog-dot)`; coluna criada a mao pode levar hex.
    color: Mapped[str] = mapped_column(String(60), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    semantic: Mapped[ColumnSemantic] = mapped_column(
        Enum(ColumnSemantic, name="column_semantic", create_type=False),
        nullable=False,
    )
    # ⚠️ Substitui o `BLOCKED` cravado no `DeadlineNotifyService`. Aquele
    # status carregava comportamento escondido ("nao ha o que agir enquanto
    # travada"); virar flag por coluna resolve o caso geral -- um time cria
    # "Aguardando cliente" e desliga a cobranca sem precisar de codigo.
    notify_deadline: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
    is_default_target: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    # ⚠️ PONTE COM DATA DE DEMOLICAO (ADR 0033). Guarda de qual `task.status`
    # esta coluna veio, e existe por um motivo so: enquanto o front desenhar o
    # quadro a partir de `web/lib/status.ts`, `status` e a fonte da verdade e a
    # COLUNA e que e derivada dele. Este campo e o que torna essa derivacao
    # 1:1 e sem perda.
    #
    # O caminho inverso (status derivado da semantica, que e a D3 original) e
    # 8:4 -- quatro colunas compartilham `IN_PROGRESS` e duas compartilham
    # `OPEN`. Derivar naquela direcao hoje apagaria `PLANNED`, `IN_REVIEW`,
    # `EXTERNAL_APPROVAL` e `BLOCKED`, e como o `Board.tsx` monta as colunas
    # pela lista de status, as tarefas dessas colunas pulariam para "Em
    # Andamento" na tela de todo mundo.
    #
    # ⚠️ NULL em coluna criada por GENTE, e isso e o normal, nao um defeito:
    # coluna nova nao corresponde a status nenhum. Quando o front passar a ler
    # as colunas do banco, o ADR daquele passo DROPA esta coluna.
    #
    # ⚠️ NAO casar coluna por NOME. Foi a alternativa sem schema, e quebraria
    # em silencio no dia em que alguem renomeasse "Bloqueado" -- gravando a
    # coluna errada, sem erro e sem tela.
    legacy_status: Mapped[TaskStatus | None] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=True,
        # ⚠️ TEXTO IDENTICO ao COMMENT da migration `0010`, caractere a
        # caractere. O drift de comentario e comparado por TEXTO: declarar aqui
        # e nao gravar la (ou o contrario) deixa o `autogenerate` propondo a
        # diferenca para sempre, e o portao vermelho vira ruido que as pessoas
        # aprendem a ignorar. Precedente do conserto ERRADO esta na
        # `Solicitation`, que redeclara `updated_at` SEM comment porque a 0005
        # esqueceu de grava-lo -- mutilaram o model para casar com a migration.
        comment=(
            "ADR 0033: de qual task.status esta coluna veio. PONTE -- "
            "enquanto o front desenha o quadro por status, a coluna e "
            "derivada do status (1:1). NULL em coluna criada por gente. "
            "Some quando o front passar a ler colunas do banco."
        ),
    )

    @property
    def is_status_bridge(self) -> bool:
        """Esta coluna e ponte de ALGUM status -- sem dizer de qual.

        ⚠️ EXISTE PARA `BoardColumnResponse`, e o formato e o ponto. O front
        precisa saber ONDE o "x" vai falhar (`_assert_ponte_sobrevive` recusa
        apagar coluna com ponte do quadro PADRAO), e nao precisa saber QUAL
        status -- que e justamente o acoplamento que a ADR 0033 proibe. Um
        booleano da a primeira coisa sem dar a segunda.

        ⚠️ E UMA `@property`, E NAO UM VALIDADOR NO SCHEMA, de proposito:
        `from_attributes` a le como se fosse coluna do banco, entao os seis
        lugares que fazem `BoardColumnResponse.model_validate(coluna)`
        continuam identicos e sem consulta nova.

        ⚠️⚠️ **`True` AQUI NAO QUER DIZER "NAO PODE SER APAGADA".** As quatro
        colunas base de um quadro AVULSO tambem nascem com `legacy_status`
        (`board_defaults.py`), e elas podem ser apagadas. A trava e
        `board.is_default AND legacy_status is not None` -- as duas metades.
        """
        return self.legacy_status is not None
