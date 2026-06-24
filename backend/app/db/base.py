"""Base declarativa do SQLAlchemy 2.0.

Todos os models ORM herdam de `Base`. Define:
    - a convencao de nomenclatura de constraints/indices,
      essencial para o Alembic gerar migrations com nomes
      estaveis e deterministicos (e para casar com os nomes
      ja existentes no schema_v5.sql);
    - o type-annotation map padrao (SQLAlchemy 2.0 estilo
      `Mapped[...]`).

IMPORTANTE: a convencao abaixo precisa produzir nomes
compativeis com os ja escritos no schema_v5.sql (ex.
`uq_task_id_workspace`, `chk_task_no_self_parent`,
`fk_task_project`). Como o schema ja existe no banco, o
Alembic NAO vai recriar essas constraints -- a convencao
serve para que migrations FUTURAS sigam o mesmo padrao.
"""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Convencao de nomes. %(...)s sao tokens do SQLAlchemy.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base declarativa unica de todos os models ORM.

    Os models de persistencia ficam em app/db/models/. Eles
    SAO as entidades (abordagem pragmatica de DDD escolhida na
    foundation): nao ha camada de mapeamento separada. Regras
    de dominio ricas vivem em metodos dos proprios models e
    nos services.
    """

    # eager_defaults: o Postgres devolve valores gerados no banco
    # (server_default / onupdate, ex. created_at/updated_at) via
    # RETURNING no mesmo INSERT/UPDATE. Sem isso, ler updated_at logo
    # apos um flush dispara releitura preguicosa -> MissingGreenlet no
    # contexto async (ex. ao serializar a resposta de um PATCH).
    __mapper_args__ = {"eager_defaults": True}

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
