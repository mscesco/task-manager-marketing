"""contador de versao de token por usuario (revogacao de sessao)

Revision ID: 0007_token_version
Revises: 0006_external_approval_status
Create Date: 2026-07-30

Spec 030, Fatia 1. Acrescenta `users.token_version`: um contador que, ao ser
incrementado, invalida TODOS os tokens (access e refresh) ja emitidos para
aquele usuario.

POR QUE CONTADOR, E NAO DENYLIST DE `jti` (Spec 030, D1/D4):
    O claim `jti` ja existe em todo token e continua sem uso. Uma denylist
    daria revogacao por DISPOSITIVO, ao custo de uma tabela nova, uma leitura
    por requisicao e uma rotina de limpeza. No contexto real (computador
    compartilhado), revogar por dispositivo e PIOR: sair no notebook nao
    encerraria a sessao esquecida na maquina compartilhada. O contador pega
    carona numa linha de `users` que ja e lida em toda requisicao autenticada.

POR QUE `users`, NO PLURAL:
    E a unica tabela do schema assim, porque `user` e palavra reservada do
    PostgreSQL (ver docstring do model User). Escrever "user" aqui estoura.

DEFAULT 0 E O QUE PROTEGE O DIA DO DEPLOY:
    As contas existentes nascem em 0, e o codigo le o claim ausente como 0
    (`payload.get("tv", 0)`). Assim, todo token ja em circulacao continua
    valendo quando esta migration sobe. Sem isso, o deploy desloga o
    workspace inteiro de uma vez. Medido em 30/07: 24 contas ativas, todas
    com sessao viva.

SEM INDICE:
    A coluna e lida junto com a linha do usuario (por PK), nunca em WHERE.

REESCRITA DE TABELA:
    Nenhuma. Postgres 11+ grava DEFAULT de coluna NOT NULL no catalogo, sem
    reescrever as linhas existentes.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_token_version"
down_revision: str | None = "0006_external_approval_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    # Reversivel de verdade: derrubar a coluna nao desloga ninguem. Os tokens
    # em circulacao carregam o claim `tv`, que simplesmente deixa de ser
    # conferido quando o codigo antigo volta.
    op.drop_column("users", "token_version")
