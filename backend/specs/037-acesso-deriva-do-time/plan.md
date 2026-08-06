# Spec 037 — plano de execução

> Seis fatias. As cinco primeiras são backend; a sexta encosta no front.
> Ordem de deploy no fim do arquivo.
>
> ⚠️ **A F1 é medição e não muda comportamento.** Ela existe porque três
> números desta spec não foram medidos, e dois deles podem mudar o desenho.

---

## Fatia 1 — as três medições, e a validação de `team_id`

**O que sobe:** a validação do critério 3 (`team_id` explícito dentro da
lente), em `TaskService.create`. E três consultas rodadas contra produção,
com o resultado gravado na spec.

**As três medições, antes de qualquer código:**

1. ⚠️ **A interseção com as 37 legadas.** Das tarefas vivas sem responsável,
   quantas são alcançadas **só** pelo criador? Essas somem e não sobra relação
   nenhuma apontando para elas. Se der maior que zero, a spec ganha uma fatia
   de resgate antes da F5.
2. Quantas tarefas têm `team_id` fora do alcance de quem as criou. A validação
   nova não retroage, mas a E1 as faz sumir.
3. Quantas pessoas seriam barradas por **rebaixamento** (`change_member_role`).
   As 33 medidas em 06/08 cobrem movimentação de time, não rebaixamento — e o
   rebaixamento tira oito subtimes de uma vez.

**Como testar:** teste HTTP em `POST /tasks` com `team_id` de subtime irmão,
como SUPERVISOR. Espera 422 com `details.field == "team_id"`.

⚠️ **Um teste de que a tela continua funcionando**: o mesmo POST com o
`team_id` da raiz e com o do próprio subtime tem de passar. A validação nova
não pode quebrar o caminho que `web/lib/api.ts:702` já usa (pin na raiz).

**Sabotagem:** apagar o bloco inteiro da validação (não afrouxar o `in`). Cai o
teste do subtime irmão com `DID NOT RAISE`.

---

## Fatia 2 — o predicado, sozinho

**O que sobe:** uma função de domínio + a consulta que a alimenta. **Leitura
pura, nada de escrita, nada ligado a nenhum gatilho ainda.**

> `bloqueios_por_perda_de_alcance(user_id, times_depois) -> list[TarefaBloqueio]`
>
> "Dado o conjunto de times que a pessoa teria DEPOIS da mudança, de quais
> tarefas **não-terminais** ela é a **única** responsável e deixaria de
> alcançar?"

⚠️ **É o predicado único das E4/E7.** Escrito uma vez, chamado em três lugares
na F3. Se aparecer uma segunda cópia dele em qualquer fatia, é defeito.

⚠️ **Terminal vem de `board_semantics.TERMINAL_SEMANTICS`**, nunca de uma
lista de status escrita à mão. É o primeiro leitor de verdade de
`column.semantic`, que estava sem leitor desde a Spec 035.

**Como testar (o arreio já sabe montar dois quadros — `make_board` +
`make_task(board_id=)`):**

1. única responsável, tarefa `OPEN` em subtime que ela perde → **bloqueia**;
2. mesma tarefa em coluna `DONE` → **não bloqueia**;
3. dois responsáveis → **não bloqueia** (ela não é a única);
4. tarefa na **raiz** → **não bloqueia** (ninguém perde a raiz);
5. tarefa em subtime que ela **mantém** → não bloqueia;
6. tarefa arquivada ou soft-deletada → não bloqueia.

**Sabotagem:** trocar `TERMINAL_SEMANTICS` pelo conjunto vazio — reverte a
regra inteira da E4, não a mutila. Cai o teste 2, que passa a bloquear uma
tarefa `DONE`.

---

## Fatia 3 — os três gatilhos que barram (E4 + E8)

**O que sobe:** `move_member_subteam`, `remove_member_from_team` e
`change_member_role` chamam o predicado e levantam 422 com a **lista
estruturada** (`id`, `título`, `subtime`, coluna) — não uma frase.

⚠️ **`deactivate_member` NÃO entra aqui**, e a ausência é decisão (E7). Ela é
a F5.

**Como testar:** um teste por gatilho, mais o do rebaixamento
(MANAGER → OPERATOR da raiz perde os oito subtimes de uma vez), mais um que
afirma que o corpo do 422 traz a lista com os campos, não só a contagem.

⚠️ **O teste da lista é o que impede a E8 de virar mensagem de texto na
primeira pressa.** Afirme os campos, não o tamanho.

**Sabotagem:** no `change_member_role`, remover a chamada ao predicado inteira.
Cai o teste do rebaixamento com `DID NOT RAISE`. ⚠️ Não basta trocar o `raise`
por outro — o bloco de chamada sai inteiro.

---

## Fatia 4 — a remoção e a notificação (E3 + E9)

**O que sobe:** a movimentação **permitida** remove a pessoa de
`task_assignment` e da lista de observadores das tarefas que ela perdeu, e
dispara **uma** notificação com a contagem e o nome do subtime.

⚠️ **É a primeira escrita em dado de tarefa disparada por mudança de vínculo.**
Errar aqui não dá 500 — dá tarefa sem dono, silenciosa.

**Como testar:**

1. mover alguém com 2 responsáveis numa tarefa → ela sai, a tarefa continua
   com 1, e **confere no banco** (não na resposta);
2. a contagem da notificação bate com o número de tarefas afetadas;
3. **uma** notificação, não N;
4. tarefa da raiz e tarefa do subtime que ela mantém: nada muda.

⚠️ **O critério 6 da spec exige conferir o BANCO.** Precedente literal: a
sabotagem da cascata de 05/08, em que `cascade_count` dizia `2` enquanto o
produto arquivava ao contrário. **Contagem certa com estado errado.**

**Sabotagem:** reverter a remoção (o bloco que deleta as linhas), mantendo a
notificação. Cai o teste 1 na conferência do banco — e **não** cai a contagem,
que é exatamente o que essa sabotagem prova.

---

## Fatia 5 — tirar o `created_by` da lente (E1 + E2), e o desligamento (E7)

**O que sobe:** o ramo `created_by` sai dos quatro pontos. Os **três** testes
que afirmam o furo invertem. `deactivate_member` passa sempre, marcando as
tarefas órfãs de forma visível.

⚠️ **É a fatia que muda o que as pessoas veem em produção**, e depende do
número 1 da F1. Se houver tarefa legada alcançada só pelo criador, a fatia de
resgate vem antes desta.

**Os quatro pontos:** `task_guards.py:60`, `task_repository.py:117` e `:126`
e `:130`, `project_service.py:215`.

⚠️ **O `task_repository` tem DOIS ramos** — um de task, um de projeto. Tirar um
e deixar o outro deixa metade do furo vivo e a suíte verde.

**Como testar:** os três testes invertidos (o criador **não** vê), mais um que
afirma que `created_by` **continua na resposta** (critério 2 — a E1 não pode
ser implementada apagando o campo), mais um de desligamento que passa deixando
órfã.

**Sabotagem:** devolver o ramo `created_by` em **um** dos quatro pontos (o do
projeto). Deve cair o teste do `project_service`, e **só ele** — se cair mais,
os pontos não estão independentes e vale saber disso.

---

## Fatia 6 — apagar o `out_of_scope` (E5)

**O que sobe:** o campo, a marca visual e o ramo da 0018 que omite a camada de
lente saem. `/me/assignments` volta a aplicar a lente como todo o resto.

⚠️ **É uma DELEÇÃO.** Se esta fatia acrescentar código, foi mal entendida.

**Onze ocorrências nos testes**, em `factories.py` e `test_me_assignments_db.py`.
No front, a marca visual em `/minhas-tarefas`.

**Como testar:** `grep -rn "out_of_scope" app/ web/ tests/` devolve **zero**.
Mais o portão do front inteiro (`tsc`, `npm test`, `next build`) — é a única
fatia da spec que o toca.

**Sabotagem:** não se aplica de forma útil a uma deleção. O portão aqui é o
`grep` a zero mais a suíte verde. ⚠️ **Diga isso na entrega em vez de inventar
uma sabotagem fraca** — sabotagem que não pode falhar não afirma nada.

---

## Ordem de deploy

1. **F1 sozinha.** Medição + uma validação que aperta um caminho que a tela já
   não usa. Risco baixo, e os números decidem o resto da spec.
2. **F2 sozinha.** Leitura pura, não ligada a nada. Não muda comportamento.
3. **F3.** Primeira mudança que uma pessoa percebe (a movimentação passa a
   falhar). Sobe sozinha.
4. **F4.** Primeira escrita. ⚠️ **Nunca junto da F3** — se a movimentação
   barrar errado e remover errado no mesmo deploy, não dá para saber qual dos
   dois é o defeito.
5. **F5.** Muda o que se vê em produção. Depende do número 1 da F1.
6. **F6.** Deleção, e a única com front.

⚠️ **A `0012` e o `GET /boards` da Spec 036 continuam fora de produção.** Nada
desta spec depende deles, mas o descongelamento tem que levar os dois, e
**migration antes do código** (ver `DEPLOY.md` §80).

## O que eu NÃO recomendo

- **Emendar F3 e F4.** Ver acima.
- **Começar pela F5** porque "é a que dá o resultado". Ela é a que mexe no que
  as pessoas veem, e sem a F4 a pessoa perde a visão e continua responsável
  nominal — o pior dos dois mundos.
- **Escrever a reatribuição em lote dentro desta spec.** Está fora de escopo
  por decisão. A E8 existe para que ela saia barata depois.
