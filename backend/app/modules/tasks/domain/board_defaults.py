"""As colunas com que um quadro NASCE (Spec 035, ADR 0030/0033).

Esta lista e a fonte da verdade do SERVICO. A migration `0008` tem a propria
copia, congelada, e isso e deliberado: migration que importa codigo de
aplicacao muda de comportamento quando o codigo muda, e uma migration ja
aplicada tem de continuar significando o que significava no dia em que rodou.
As duas copias precisam CONCORDAR, e existe um teste que compara as duas
contra o banco (`test_quadro_novo_nasce_igual_ao_migrado`).

⚠️ OITO COLUNAS, E NAO AS TRES DA ADR 0030. A 0030 decidiu que quadro novo
nasce com "A fazer / Fazendo / Feito". Essa decisao tem a MESMA dependencia
que a D3 (ver ADR 0033): enquanto a coluna e derivada do `status`, um quadro
de tres colunas nao tem para onde mandar uma tarefa `PLANNED`, `IN_REVIEW`,
`EXTERNAL_APPROVAL`, `BLOCKED` ou `CANCELLED` -- cancelar uma tarefa num
workspace novo daria erro, ou a tarefa nasceria sem coluna. As tres valem
quando o front ler as colunas do banco e `status` deixar de ser 1:1 com elas.

⚠️ ROTULOS, CORES E ORDEM IDENTICOS a `web/lib/status.ts`. Enquanto o front
monta o quadro pela lista de status, divergir aqui nao aparece hoje: aparece
no dia em que o front passar a ler o banco, como regressao visual num diff que
nao contem a causa.
"""

from __future__ import annotations

from typing import Final, NamedTuple

from app.db.models.enums import ColumnSemantic, TaskStatus


class ColunaPadrao(NamedTuple):
    """Uma coluna do quadro recem-criado.

    `legacy_status` e o que liga a coluna ao status enquanto a derivacao roda
    nessa direcao (ADR 0033). `is_default_target` responde "para onde vai a
    tarefa desta semantica" quando ha mais de uma coluna com a mesma -- e por
    isso quatro sao marcadas, uma por semantica.
    """

    legacy_status: TaskStatus
    nome: str
    cor: str
    semantica: ColumnSemantic
    notify_deadline: bool
    is_default_target: bool


COLUNAS_PADRAO: Final[tuple[ColunaPadrao, ...]] = (
    ColunaPadrao(
        TaskStatus.BACKLOG,
        "Backlog",
        "var(--status-backlog-dot)",
        ColumnSemantic.OPEN,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.PLANNED,
        "Planejado",
        "var(--status-planned-dot)",
        ColumnSemantic.OPEN,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.IN_PROGRESS,
        "Em Andamento",
        "var(--status-progress-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.IN_REVIEW,
        "Aprovação Interna",
        "var(--status-review-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.EXTERNAL_APPROVAL,
        "Aprovação Externa",
        "var(--status-external-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.COMPLETED,
        "Concluído",
        "var(--status-done-dot)",
        ColumnSemantic.DONE,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.CANCELLED,
        "Cancelado",
        "var(--status-cancel-dot)",
        ColumnSemantic.CANCELLED,
        True,
        True,
    ),
    # ⚠️ `notify_deadline=False` reproduz o BLOCKED cravado no
    # DeadlineNotifyService: "nao ha o que agir enquanto travada". E a razao
    # pela qual a ADR 0030 rejeitou uma quinta semantica `BLOQUEADA` -- a flag
    # resolve o caso geral, e um time que criar "Aguardando cliente" desliga a
    # cobranca sem precisar de codigo.
    #
    # ⚠️ BLOCKED e o ULTIMO. `web/lib/status.ts` o desenha depois de Cancelado,
    # e `position` aqui e a ordem que a tela vai ler quando o front passar a
    # montar as colunas pelo banco. Agrupa-lo com os outros `IN_PROGRESS` seria
    # a ordem SEMANTICA, e nao a ordem de hoje -- foi o defeito que a `0008`
    # quase levou para producao.
    ColunaPadrao(
        TaskStatus.BLOCKED,
        "Bloqueado",
        "var(--status-blocked-dot)",
        ColumnSemantic.IN_PROGRESS,
        False,
        False,
    ),
)


#: As colunas com que nasce um quadro CRIADO POR PESSOA (Spec 036, fatia 5b).
#:
#: ⚠️ QUATRO, E NAO OITO. Este e o conjunto que a ADR 0030 tinha decidido e que
#: o cabecalho deste modulo registrou como adiado: uma coluna por SEMANTICA. O
#: que destravou foi a ADR 0042 -- status sem coluna no quadro cai na coluna
#: `is_default_target` da sua semantica --, sem a qual um quadro de quatro
#: colunas nao teria para onde mandar `PLANNED`, `IN_REVIEW`,
#: `EXTERNAL_APPROVAL` ou `BLOCKED`.
#:
#: ⚠️ NAO E UM SUBCONJUNTO ARBITRARIO DE `COLUNAS_PADRAO`: e a lista medida em
#: producao em 11/08. No Quadro geral do Marketing, `Aprovacao Interna`,
#: `Aprovacao Externa` e `Cancelado` somavam 5 cards em 176, contra 42 em
#: `Em Andamento` e 87 em `Concluido`.
#:
#: ⚠️ AS QUATRO NASCEM COM `legacy_status`, e as quatro sao `is_default_target`.
#: A ponte responde primeiro (ADR 0041) e o alvo responde no fallback (ADR
#: 0042) -- as duas ADRs precisam das duas coisas verdadeiras desde o
#: nascimento do quadro.
#:
#: ⚠️ `COLUNAS_PADRAO` NAO MUDA. Sao dois conjuntos vivos: as oito continuam
#: sendo o padrao do quadro DE WORKSPACE, congeladas junto com a copia da
#: migration `0008` e com `test_quadro_novo_nasce_igual_ao_migrado`. Quem
#: editar um tem de justificar por que nao editou o outro.
#:
#: ⚠️ ROTULOS IDENTICOS aos das oito -- "Concluido" e "Cancelado" no masculino,
#: como ja estao em producao. Divergir aqui e duas telas do mesmo produto
#: escrevendo a mesma coluna de dois jeitos.
COLUNAS_BASE: Final[tuple[ColunaPadrao, ...]] = (
    ColunaPadrao(
        TaskStatus.BACKLOG,
        "Backlog",
        "var(--status-backlog-dot)",
        ColumnSemantic.OPEN,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.IN_PROGRESS,
        "Em Andamento",
        "var(--status-progress-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.COMPLETED,
        "Concluído",
        "var(--status-done-dot)",
        ColumnSemantic.DONE,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.CANCELLED,
        "Cancelado",
        "var(--status-cancel-dot)",
        ColumnSemantic.CANCELLED,
        True,
        True,
    ),
)

#: Nome do quadro geral criado junto com o workspace.
NOME_QUADRO_GERAL: Final = "Quadro Geral"
