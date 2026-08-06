"""Leitura de quadro e coluna (Spec 035 fatia 3b, ADR 0032/0033).

Um metodo so, e ele responde a pergunta que a fatia 3b faz em toda escrita de
tarefa: **em que quadro e em que coluna esta tarefa deve estar, dado o
status?**

⚠️ A DIRECAO E `status -> coluna`, e nao o contrario (ADR 0033). Enquanto o
front desenha o quadro pela lista de `web/lib/status.ts`, `status` e a fonte da
verdade. `board_column.legacy_status` e a ponte que torna essa derivacao 1:1 --
sem ela, so sobraria casar por nome (quebra no primeiro rename) ou pela
semantica (8:4, apaga quatro status).
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.enums import TaskStatus
from app.shared.exceptions.base import ValidationError


class BoardRepository:
    """Consultas de quadro. Sem escrita -- quem cria quadro e o BoardService."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def board_and_column_for_status(
        self, status: TaskStatus
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Devolve `(board_id, column_id)` do quadro geral para aquele status.

        UMA query, e nao duas. O `create` de tarefa e chamado em sequencia pela
        duplicacao (uma vez por no da arvore), e a Spec 021 ja mediu o custo de
        "duas queries por membro" como a parede de desempenho deste produto.

        ⚠️ O quadro e o do time RAIZ (`parent_team_id IS NULL`), e nao o do time
        da tarefa. E a decisao da ADR 0032, tomada com dado: 86% das tarefas
        vivas estao na raiz, e a decisao B da 0030 (uma tarefa vive num quadro
        so) obrigaria a escolher em qual quadro apareceriam as da raiz, que todo
        mundo alcanca. O JOIN em `team` e o que torna isso explicito: filtrar
        so por `is_default` daria a resposta certa hoje e a errada no dia em que
        um subtime tiver quadro proprio -- e a resposta errada nao aparece na
        tela, aparece na tarefa que foi parar no quadro de outro time.

        Levanta `ValidationError` se nao houver quadro ou se o status nao tiver
        coluna. Nao ha fallback DE PROPOSITO: cair para "a primeira coluna que
        achar" gravaria a tarefa na coluna errada em silencio, que e o defeito
        que esta spec inteira existe para evitar. Falhar aqui e alto, visivel e
        consertavel; falhar fechado nao seria nenhum dos tres.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT b.id, c.id
                    FROM board b
                    JOIN team t
                      ON t.id = b.team_id
                     AND t.workspace_id = b.workspace_id
                     AND t.parent_team_id IS NULL
                    JOIN board_column c
                      ON c.board_id = b.id
                     AND c.legacy_status = CAST(:status AS task_status)
                    WHERE b.workspace_id = :ws
                      AND b.is_default
                    """
                ),
                {"ws": tenant.workspace_id, "status": status.value},
            )
        ).first()

        if linha is None:
            raise ValidationError(
                "Este workspace nao tem quadro para o status "
                f"{status.value}. Workspace criado antes da Spec 035 fatia 3a "
                "nasceu sem quadro -- rodar a migration 0011.",
                details={"field": "status", "status": status.value},
            )
        return linha[0], linha[1]
