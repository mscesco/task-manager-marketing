# Spec 062 — Mover tarefa e subtarefa para qualquer lugar

**Status:** aprovada por ela em 05/11/2026, com as seis decisões abaixo.

Pedido dela (05/11): mover tarefas e subtarefas, em qualquer nível e de
qualquer time. No seletor, a pessoa escolhe o **quadro** (entre os que ela vê),
se a tarefa vai como **tarefa principal**, e, se não for, **debaixo de qual
tarefa** ela vai, em qualquer profundidade (sub da sub da sub).

## Como é hoje

- `POST /tasks/{id}/move` troca o **pai** e o **projeto**, levando a
  subárvore junto. Ele **não troca de quadro**: o pai novo tem de estar no
  mesmo quadro (recusa com 422, decisão de 18/08 — "mover entre quadros é
  operação própria").
- Trocar o **time** é um `PATCH`, e é recusado quando a tarefa tem
  subtarefa, inclusive arquivada (auditoria de 21/10, item 8).
- Na tela, o `TaskDetail` oferece só **trocar de projeto**. Trocar de pai ou de
  quadro não tem nenhum controle.
- Subtarefa não tem card próprio no quadro: ela aparece dentro da principal. O
  "quadro" de uma subtarefa é o da principal dela.

Esta spec é a "operação própria" que a decisão de 18/08 deixou para depois.

## Decisões (05/11)

1. **A subárvore vai junto, sempre.** Pai e filha moram no mesmo quadro
   (invariante de 18/08), então mover uma tarefa leva todas as subtarefas dela,
   em todos os níveis.
2. **Tudo vira o time do destino.** A tarefa movida e **todas** as subtarefas
   passam para o time do destino:
   - **quadro avulso:** o time do quadro;
   - **Quadro geral de uma área:** a área (time raiz);
   - **lente de subtime:** o subtime;
   - **debaixo de uma tarefa:** o time dessa tarefa.

   (Recusada: manter o time de cada subtarefa quando ele ainda cabe. Seria
   menos previsível.)
3. **Quem perde acesso sai, com aviso.** Antes de confirmar, a tela lista os
   responsáveis e seguidores que não enxergam o destino. Ao confirmar, eles
   saem das tarefas e recebem o aviso que já existe para perda de acesso
   (`alcance_perdido`). (Recusada: bloquear até reatribuir.)
4. **Projeto automático.**
   - **Como subtarefa:** herda o projeto da tarefa principal escolhida.
   - **Como tarefa principal:** mantém o projeto se ele cabe no time do
     destino; senão a tarefa fica sem projeto, e a tela avisa antes.
5. **O seletor de tarefa é uma busca que mostra o caminho.** É um campo de
   busca pelas tarefas do quadro escolhido. Cada resultado mostra o caminho
   inteiro (`Campanha de Natal › Redes sociais › Instagram`), e funciona igual
   em qualquer profundidade. (Recusada: árvore que abre nível por nível, que
   cansa em quadro grande.)
6. **Quem move assume a tarefa que ficaria sem responsável.** Toda tarefa
   precisa de pelo menos um responsável. Se todos os responsáveis de uma
   tarefa movida perderem o acesso, quem moveu vira o responsável dela. Ela
   sempre alcança o destino, porque só pode mover para onde cria tarefa. A
   prévia avisa: "Você vira responsável por N tarefas". Entra no histórico
   como uma designação comum, e não gera aviso para ela mesma. (Recusada:
   bloquear até reatribuir.)

## O que entrega

**Onde aparece:** **"Mover…"** no rodapé do detalhe da tarefa, ao lado de
"Duplicar", para quem pode editar a tarefa. Vale para principal e subtarefa
(as duas abrem no mesmo detalhe). O card do quadro não tem menu hoje; criar um
ficou fora desta spec.

**O modal**
1. **Quadro:** os quadros que a pessoa alcança, agrupados por área: o
   Quadro geral, a lente de cada subtime e os quadros avulsos. Abre no quadro
   atual. Se ela não puder criar no destino, a prévia diz e o botão desliga.
2. **Vai como:** "Tarefa principal" ou "Subtarefa de…".
3. **Subtarefa de…:** a busca descrita na decisão 5. Ficam de fora a própria
   tarefa e as subtarefas dela (não dá para pôr uma tarefa dentro dela mesma)
   e as tarefas arquivadas.
4. **Prévia, antes do botão:** "Leva junto N subtarefas"; "Fica sem o projeto
   X", quando for o caso; a lista de pessoas que vão sair, com o motivo; e
   "Você vira responsável por N tarefas", quando for o caso (decisão 6).
5. **Mover.** Depois, o aviso "Tarefa movida." e o quadro recarrega.

**O que acontece com a tarefa e as subtarefas**
- **Quadro e time:** os do destino (decisão 2).
- **Coluna:** cada tarefa vai para a coluna do destino que tem o **mesmo
  significado** da atual (a lógica que a conclusão em cascata já usa:
  `semantic` + coluna padrão). O status não muda.
- **Projeto:** decisão 4.
- **Histórico:** uma linha só, na tarefa movida, com quantas subtarefas
  foram junto (a forma do arquivar e do excluir). Quem saiu ganha a linha de
  "tirou dos responsáveis" ou "deixou de seguir" em cada tarefa; quem assume,
  a de "designou".

**Recusas (422, com a mensagem dizendo o que fazer)**
- Mover para dentro de si mesma ou de uma das próprias subtarefas.
- Mover para debaixo de uma tarefa arquivada, ou mover uma tarefa arquivada
  (desarquive antes).
- Destino onde a pessoa não pode criar tarefa, ou origem que ela não pode
  editar (403).
- Nada mudou: 200, sem fazer nada.

## Servidor

- `POST /api/v1/tasks/{id}/relocate` com
  `{ board_id, team_id, parent_task_id | null, dry_run }`. Com
  `dry_run: true`, devolve a prévia (subtarefas, projeto, pessoas que saem) e
  não grava nada. Sem ele, grava, numa transação só.
- `GET /api/v1/boards/{id}/tasks/search?q=&exclude_task_id=` devolve as
  tarefas de qualquer nível daquele quadro, cada uma com o caminho, sem a
  tarefa que está sendo movida nem as subtarefas dela. Limite de 20
  resultados. Corta pela lente de quem busca.
- O `/move` atual fica como está (n8n e telas antigas). O `relocate` reaproveita
  o `reparent_subtree` (path, depth, projeto) e as travas de quadro, time e
  projeto que já existem.
- **Sem migration.**

## Fatias (um commit cada, um PR só saindo de `main`)

- **A — servidor:** `relocate` com `dry_run` e a busca, com testes de cada
  decisão e de cada recusa.
- **B — tela:** o modal "Mover…" no `TaskDetail`, com a prévia.
  Conferido no navegador, nos dois temas.

## Fora

- Mover várias tarefas de uma vez.
- Arrastar um card para dentro de outro card para virar subtarefa.
- Copiar para outro quadro (o duplicar continua no mesmo lugar).
- Escolher o projeto no modal (decisão 4 é automática).
