"""valor de status 'aprovacao externa' no enum task_status

Revision ID: 0006_external_approval_status
Revises: 0005_solicitations
Create Date: 2026-07-22

Spec 026. Adiciona EXTERNAL_APPROVAL ao enum nativo `task_status`, para
distinguir no quadro a tarefa que espera aprovacao de FORA do time
(cliente/fornecedor/outra area) da que espera revisao interna (IN_REVIEW).

POR QUE VALOR NO ENUM, E NAO COLUNA BOOLEANA (Spec 026, D1):
    O estado e EXCLUSIVO -- um card so pode estar em um status. Um booleano
    ao lado do status tornaria representavel o estado ILEGAL
    (COMPLETED + aprovacao externa) e obrigaria todo codigo que decide por
    status a consultar dois campos. Estado da maquina => valor da maquina.

ORDEM DE DEPLOY -- EXCECAO A REGRA DO DEPLOY.md:
    Esta migration vai ANTES do codigo (o contrario do padrao). Motivo:
      - valor novo no tipo + codigo velho no ar  => INOFENSIVO (nada escreve
        o valor ate o front novo existir);
      - codigo novo + tipo velho                 => arrasto p/ a coluna nova
        estoura no Postgres => HTTP 500 na cara do usuario.
    Logo: aplicar `alembic upgrade head` ANTES de subir o front (Fatia 3).

AUTOCOMMIT OBRIGATORIO:
    `env.py` roda a migration dentro de `context.begin_transaction()`, e
    `ALTER TYPE ... ADD VALUE` NAO pode rodar dentro de uma transacao no
    Postgres. Por isso o `autocommit_block()`.

SEM DOWNGRADE (irreversivel, intencional):
    O Postgres nao remove valor de um enum. Desfazer exigiria recriar o tipo
    do zero e reescrever toda coluna que o referencia -- risco alto, fora de
    escopo. `downgrade()` e um no-op documentado. Se algum dia for mesmo
    necessario, e uma migration propria, pensada e testada, nao um rollback.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_external_approval_status"
down_revision: str | None = "0005_solicitations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF NOT EXISTS: torna a migration reexecutavel sem estourar se o valor
    # ja tiver sido adicionado (idempotencia -- exigencia da validacao).
    # AFTER 'IN_REVIEW': so posiciona no catalogo do Postgres; a ordem que
    # o usuario ve e a de web/lib/status.ts (fonte unica de colunas).
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE task_status "
            "ADD VALUE IF NOT EXISTS 'EXTERNAL_APPROVAL' AFTER 'IN_REVIEW';"
        )


def downgrade() -> None:
    # Sem downgrade -- Postgres nao remove valor de enum. Ver docstring.
    pass
