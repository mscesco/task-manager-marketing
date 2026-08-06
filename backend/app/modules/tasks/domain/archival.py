"""Elegibilidade de auto-arquivamento -- predicado PURO (sem DB).

Espelha a regra usada na query do repositorio (TaskRepository.
list_stale_terminal). Mantido puro para teste isolado e para documentar a
regra num lugar so. Se a regra mudar, muda aqui E na query (mesma dupla
pure-domain + SQL ja usada em team_scope).

REGRA (Spec 013 DECISAO A/B, reescrita pela Spec 035 D6):
    Terminal e parada ha tempo demais:
      - `terminal_since < now - dias`, seja COMPLETED ou CANCELLED.
    Qualquer outro status: nunca elegivel.

⚠️ ANTES DESTA FATIA a regra era `completed_at` para COMPLETED e `updated_at`
para CANCELLED. A troca so e segura porque a fatia 2a veio ANTES e o campo
passou a ser escrito nas tres portas (create, transicao de status e o UPDATE em
massa da cascata). Na ordem inversa a varredura leria um campo que ninguem
preenche: as tarefas concluidas depois do deploy ficariam invisiveis para o
job, que continuaria rodando, sem erro, imprimindo um numero menor do que o
certo.

⚠️ O `status` CONTINUA sendo checado, e nao e redundancia. Se algum dia alguem
gravar `terminal_since` numa tarefa viva, a checagem faz a regra falhar FECHADO
(nao arquiva) em vez de arquivar trabalho em andamento -- que e o unico defeito
desta spec que o usuario ve na manha seguinte. A `0009` levanta erro se esse
estado existir; aqui e a segunda tranca da mesma porta.

DIFERENCA CONHECIDA E ACEITA (D6): editar uma tarefa CANCELADA nao adia mais o
arquivamento dela. Antes adiava, porque a regra lia `updated_at` e qualquer
edicao o movia. E correcao, nao regressao -- mas e a unica diferenca observavel
entre a regra velha e a nova depois do dia da migracao.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final

from app.db.models.enums import TaskStatus

#: Os status que contam como "coluna terminal" (Spec 035, D6). Ficam aqui, no
#: mesmo modulo da regra de arquivamento, porque sao a MESMA regra vista de
#: dois angulos: `is_stale_terminal` responde "esta parada ha tempo demais?" e
#: `is_terminal` responde "o relogio esta correndo?". Separar os dois numa
#: constante no service e num literal na query foi como a regra de "quem NAO
#: pode" ja se partiu em duas versoes divergentes neste repo.
TERMINAL_STATUSES: Final[frozenset[TaskStatus]] = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
)


def is_terminal(status: TaskStatus) -> bool:
    """True se o status para o relogio do arquivamento (`terminal_since`)."""
    return status in TERMINAL_STATUSES


def is_stale_terminal(
    *,
    status: TaskStatus,
    terminal_since: datetime | None,
    now: datetime,
    days: int,
) -> bool:
    """True se a task terminal esta parada ha mais dias que o limite.

    `now` injetado (testavel com relogio fake). `terminal_since` None ->
    NAO elegivel (falha fechado: nao arquiva o que nao da pra datar). Isso
    cobre tanto a tarefa nunca datada quanto a que saiu de terminal e teve o
    relogio limpo.
    """
    if status not in TERMINAL_STATUSES:
        return False
    cutoff = now - timedelta(days=days)
    return terminal_since is not None and terminal_since < cutoff
