"""o formulario de solicitacao vira dado (Spec 043, fatia A)

Revision ID: 0016_formulario_de_solicitacao
Revises: 0015_unaccent_para_busca
Create Date: 2026-08-24

Tres tabelas novas (`solicitation_form`, `solicitation_section`,
`solicitation_question`) e uma coluna em `solicitation` (`form_id`).

⚠️ ESTA MIGRATION SO CRIA ESTRUTURA. Ela NAO traduz o
`web/lib/solicitacaoForm.ts` em linhas -- isso e a `0017`, e a separacao e
deliberada: schema e reversivel de olhos fechados, dado nao. Rodar a estrutura
sem o dado deixa o produto exatamente como esta hoje (o formulario publico
continua lendo do TypeScript ate a fatia B).

⚠️ NOTA CORRIGIDA EM 26/08: eu tinha escrito aqui que "nenhuma das tabelas tem
NOT NULL sem server_default". A premissa esta certa e a conclusao estava
generalizada demais -- o perigo e acrescentar coluna obrigatoria a tabela que
JA TEM LINHAS, e estas nascem vazias. O `position` perdeu o `server_default`
justamente por isso: `board_column.position`, o vizinho mais proximo, e
`Integer, nullable=False` e mais nada, e declarar default no servidor sem
declarar no modelo e DRIFT.

⚠️ `form_id` EM `solicitation` NASCE NULLABLE E CONTINUA ASSIM. Ver o
comentario no modelo: solicitacao orfa e historico valido, e o `JOIN` da fila e
`LEFT` justamente por isso.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_formulario_de_solicitacao"
down_revision: str | None = "0015_unaccent_para_busca"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "solicitation_form",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "is_published",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            # ⚠️ O COMMENT VEM DO `TimestampMixin`, e faltar aqui e DRIFT. Ele
            # nao e documentacao decorativa: o mixin o declara justamente para
            # o autogenerate nao propor apagar o que esta no banco. Sem ele na
            # migration, o autogenerate propoe ACRESCENTAR -- que foi o que o
            # CI acusou.
            comment=(
                "Nao atualiza sozinho. Setado pelo backend via "
                "SQLAlchemy onupdate."
            ),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        # ⚠️ O NOME SAI DA CONVENCAO (`fk_%(table)s_%(coluna)s`) E O
        # `ondelete` E RESTRICT -- os dois vem do `WorkspaceScopedMixin`, que
        # declara a FK inline. Eu tinha escrito nome proprio e sem ondelete;
        # o autogenerate viu uma FK a menos e outra a mais.
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="RESTRICT",
            name=op.f("fk_solicitation_form_workspace_id"),
        ),
        # ⚠️⚠️ A UNIQUE QUE FALTOU NA PRIMEIRA VERSAO, e sem ela a migration
        # NAO RODA: o Postgres exige unicidade nas colunas referenciadas por
        # uma FK composta, e ser PK so em `id` nao basta. Erro literal:
        # "there is no unique constraint matching given keys for referenced
        # table". O schema ja tinha o padrao em `uq_team_id_workspace` e
        # `uq_board_id_workspace` -- eu copiei a FK do vizinho e deixei a
        # metade que a sustenta para tras.
        sa.UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_form_id_workspace"
        ),
        # ⚠️ RESTRICT: apagar um time nao pode levar junto o formulario que
        # ainda responde por solicitacoes historicas.
        sa.ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="solicitation_form_team",
        ),
    )
    # ⚠️ UNICO POR WORKSPACE, e nao por time: o slug e a URL publica
    # (`/solicitar/<slug>`), e dois times do mesmo workspace nao podem disputar
    # `/solicitar/arte`. Parcial em `deleted_at IS NULL` -- senao um formulario
    # na lixeira reservaria o nome para sempre.
    # ⚠️ O `WorkspaceScopedMixin` DECLARA `index=True` no `workspace_id`, entao
    # o modelo espera este indice em TODA tabela que usa o mixin. Ele nao
    # aparece no `__table_args__` de ninguem -- vem de graca com a coluna --, e
    # foi por isso que passou batido nas tres tabelas de uma vez.
    op.create_index(
        op.f("ix_solicitation_form_workspace_id"),
        "solicitation_form",
        ["workspace_id"],
    )
    op.create_index(
        "solicitation_form_slug_unico",
        "solicitation_form",
        ["workspace_id", "slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "solicitation_form_por_time",
        "solicitation_form",
        ["workspace_id", "team_id"],
    )

    op.create_table(
        "solicitation_section",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("form_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=False, server_default=""),
        sa.Column("sla_text", sa.String(200), nullable=True),
        sa.Column(
            "summary_question_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        # ⚠️ SEM `server_default`, e o vizinho manda: `board_column.position`
        # e `Integer, nullable=False` e mais nada. O default do modelo e do
        # lado PYTHON (`default=0`), e declarar um no servidor sem declarar no
        # modelo e drift -- foi o que o CI acusou.
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            # ⚠️ O COMMENT VEM DO `TimestampMixin`, e faltar aqui e DRIFT. Ele
            # nao e documentacao decorativa: o mixin o declara justamente para
            # o autogenerate nao propor apagar o que esta no banco. Sem ele na
            # migration, o autogenerate propoe ACRESCENTAR -- que foi o que o
            # CI acusou.
            comment=(
                "Nao atualiza sozinho. Setado pelo backend via "
                "SQLAlchemy onupdate."
            ),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        # ⚠️ O NOME SAI DA CONVENCAO (`fk_%(table)s_%(coluna)s`) E O
        # `ondelete` E RESTRICT -- os dois vem do `WorkspaceScopedMixin`, que
        # declara a FK inline. Eu tinha escrito nome proprio e sem ondelete;
        # o autogenerate viu uma FK a menos e outra a mais.
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="RESTRICT",
            name=op.f("fk_solicitation_section_workspace_id"),
        ),
        # A pergunta aponta para ca por `(section_id, workspace_id)`.
        sa.UniqueConstraint(
            "id", "workspace_id", name="uq_solicitation_section_id_workspace"
        ),
        # CASCADE aqui, e nao RESTRICT: secao sem formulario nao e historico,
        # e lixo. O historico das RESPOSTAS vive em `solicitation.answers`.
        sa.ForeignKeyConstraint(
            ["form_id", "workspace_id"],
            ["solicitation_form.id", "solicitation_form.workspace_id"],
            ondelete="CASCADE",
            name="solicitation_section_form",
        ),
    )
    # ⚠️ O `WorkspaceScopedMixin` DECLARA `index=True` no `workspace_id`, entao
    # o modelo espera este indice em TODA tabela que usa o mixin. Ele nao
    # aparece no `__table_args__` de ninguem -- vem de graca com a coluna --, e
    # foi por isso que passou batido nas tres tabelas de uma vez.
    op.create_index(
        op.f("ix_solicitation_section_workspace_id"),
        "solicitation_section",
        ["workspace_id"],
    )
    op.create_index(
        "solicitation_section_por_form",
        "solicitation_section",
        ["workspace_id", "form_id", "position"],
    )

    op.create_table(
        "solicitation_question",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column(
            "required", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "options",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("placeholder", sa.String(200), nullable=True),
        sa.Column("help", sa.String(300), nullable=True),
        sa.Column(
            "show_if_question_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("show_if_value", sa.String(200), nullable=True),
        # ⚠️ SEM `server_default`, e o vizinho manda: `board_column.position`
        # e `Integer, nullable=False` e mais nada. O default do modelo e do
        # lado PYTHON (`default=0`), e declarar um no servidor sem declarar no
        # modelo e drift -- foi o que o CI acusou.
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            # ⚠️ O COMMENT VEM DO `TimestampMixin`, e faltar aqui e DRIFT. Ele
            # nao e documentacao decorativa: o mixin o declara justamente para
            # o autogenerate nao propor apagar o que esta no banco. Sem ele na
            # migration, o autogenerate propoe ACRESCENTAR -- que foi o que o
            # CI acusou.
            comment=(
                "Nao atualiza sozinho. Setado pelo backend via "
                "SQLAlchemy onupdate."
            ),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        # ⚠️ O NOME SAI DA CONVENCAO (`fk_%(table)s_%(coluna)s`) E O
        # `ondelete` E RESTRICT -- os dois vem do `WorkspaceScopedMixin`, que
        # declara a FK inline. Eu tinha escrito nome proprio e sem ondelete;
        # o autogenerate viu uma FK a menos e outra a mais.
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="RESTRICT",
            name=op.f("fk_solicitation_question_workspace_id"),
        ),
        sa.ForeignKeyConstraint(
            ["section_id", "workspace_id"],
            ["solicitation_section.id", "solicitation_section.workspace_id"],
            ondelete="CASCADE",
            name="solicitation_question_section",
        ),
        sa.CheckConstraint(
            "position >= 0", name="solicitation_question_position_nao_negativa"
        ),
    )
    # ⚠️ O `WorkspaceScopedMixin` DECLARA `index=True` no `workspace_id`, entao
    # o modelo espera este indice em TODA tabela que usa o mixin. Ele nao
    # aparece no `__table_args__` de ninguem -- vem de graca com a coluna --, e
    # foi por isso que passou batido nas tres tabelas de uma vez.
    op.create_index(
        op.f("ix_solicitation_question_workspace_id"),
        "solicitation_question",
        ["workspace_id"],
    )
    op.create_index(
        "solicitation_question_por_secao",
        "solicitation_question",
        ["workspace_id", "section_id", "position"],
    )

    op.add_column(
        "solicitation",
        sa.Column("form_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # ⚠️ SEM FK PARA `solicitation_form`, E ISSO E DECISAO. Uma FK obrigaria a
    # escolher entre RESTRICT (formulario nunca some enquanto houver
    # solicitacao antiga -- e sempre havera) e SET NULL (apagar formulario
    # apaga o vinculo do historico, em silencio). A leitura ja e tolerante a
    # `form_id` orfao pelo `LEFT JOIN`, e e ela que define o comportamento.
    op.create_index(
        "solicitation_por_form", "solicitation", ["workspace_id", "form_id"]
    )


def downgrade() -> None:
    # ⚠️ Os `ix_..._workspace_id` somem junto com as tabelas (`drop_table` leva
    # os indices dela), entao nao ha `drop_index` para eles aqui -- so para o
    # que foi criado numa tabela que SOBREVIVE ao downgrade.
    op.drop_index("solicitation_por_form", table_name="solicitation")
    op.drop_column("solicitation", "form_id")
    op.drop_index(
        "solicitation_question_por_secao", table_name="solicitation_question"
    )
    op.drop_table("solicitation_question")
    op.drop_index("solicitation_section_por_form", table_name="solicitation_section")
    op.drop_table("solicitation_section")
    op.drop_index("solicitation_form_por_time", table_name="solicitation_form")
    op.drop_index("solicitation_form_slug_unico", table_name="solicitation_form")
    op.drop_table("solicitation_form")
