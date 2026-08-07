"""O que uma pessoa deixaria orfao ao encolher a lente (Spec 037, E4 + E8).

⚠️ ESTE ARQUIVO NAO TEM REGRA. Ele tem a FORMA da resposta.

A regra ("de quais tarefas nao-terminais ela e a unica responsavel e deixaria
de alcancar?") mora em `TaskRepository.bloqueios_por_perda_de_alcance`, porque
ela e uma pergunta ao banco: envolve contar responsaveis, cruzar com a
semantica da coluna e comparar com um conjunto de times. Trazer isso para a
memoria para decidir em Python seria varrer a tabela de tarefas inteira a cada
movimentacao de membro.

O que mora aqui e o TIPO da resposta, e ele existe por causa da **E8**: o 422
da E4 carrega a LISTA ESTRUTURADA -- `id`, titulo, subtime e coluna de cada
tarefa que barrou --, nao uma frase nem uma contagem.

⚠️ E8 NAO E ENFEITE DE MENSAGEM. Medido em 06/08: **duas pessoas carregam 30
das 33** tarefas que travariam hoje (beatriz.fontes 18, gisele.reis 12). Uma
frase serve para quem tem 1 e e uma parede para quem tem 18 -- e regra que vira
parede e contornada, nao seguida. A reatribuicao em lote fica fora da Spec 037
por decisao; a E8 existe para que ela consuma uma lista que ja nasce pronta, em
vez de recalcular tudo.

⚠️ POR QUE UM DATACLASS E NAO UM `dict`: para que a F3 nao possa "simplificar"
a resposta para `{"tarefas": 18}` sem que nada quebre. O teste da F3 afirma os
CAMPOS, e o tipo e o que torna a afirmacao barata.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TarefaBloqueio:
    """Uma tarefa que impede a mudanca de vinculo.

    Os quatro campos sao exatamente os quatro que a E8 promete no corpo do 422.
    `subtime` e o NOME do time, nao o id: quem le o erro e uma pessoa decidindo
    para quem reatribuir, e id nao ajuda ninguem a decidir. O `team_id` vem
    junto porque a reatribuicao em lote (fatia futura) vai precisar dele.
    """

    task_id: uuid.UUID
    titulo: str
    team_id: uuid.UUID | None
    subtime: str | None
    coluna: str


@dataclass(frozen=True, slots=True)
class RelacaoPerdida:
    """Uma relacao (responsavel e/ou observador) que a E3 vai apagar.

    ⚠️ O CONJUNTO E MAIOR QUE O DE `TarefaBloqueio`, e a diferenca e a fatia
    inteira. O bloqueio (E4) so olha tarefa NAO-TERMINAL de que ela e a UNICA
    responsavel -- e o que impede a orfa. A remocao (E3) olha TUDO que ela
    deixa de alcancar: tarefa terminal tambem, tarefa com colega tambem, e
    observador tambem.

    ⚠️ INVARIANTE QUE A ORDEM DAS FATIAS GARANTE: quando esta remocao roda, a
    E4 ja passou. Entao nenhuma tarefa NAO-TERMINAL aqui pode ficar sem
    responsavel -- ou ela tem colega, ou a operacao teria sido barrada antes.
    Terminal pode ficar sem, e isso e aceito: trabalho encerrado nao precisa de
    dono. `test_terminal_pode_ficar_sem_responsavel` fixa isso.
    """

    task_id: uuid.UUID
    titulo: str
    team_id: uuid.UUID | None
    subtime: str | None
    era_responsavel: bool
    era_observador: bool
