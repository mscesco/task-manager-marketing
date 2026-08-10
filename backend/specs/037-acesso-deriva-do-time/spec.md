# Spec 037 — Acesso deriva do time, e só do time

> **Status: decisões fechadas (ADR 0038, E1–E9). Escrita em 06/08/2026.
> As medições da F1 estão RODADAS (ver §As medições da F1); nenhum código
> escrito.** Esta spec implementa a ADR 0038: retira as três
> exceções à lente de time, remove o estado (responsável/observador) de quem
> perde alcance, e barra a mudança de vínculo que deixaria tarefa órfã.
>
> Destino: `backend/specs/037-acesso-deriva-do-time/spec.md`
>
> ⚠️ **Precede a continuação da Spec 036.** A 036 está na fatia 2 de 5 e
> pausada por decisão de 06/08: fazer a permissão certa antes de construir mais
> em cima dela. Ver §Fronteira de risco.

---

## Objetivo

Hoje três coisas furam a lente de time: o `created_by` (ADR 0013), o
`/me/assignments` (ADR 0018) e a marca `out_of_scope` (ADR 0017). O efeito
somado é que **sair de um subtime não tira acesso a nada** — só muda a cor de
um selo.

A ADR 0038 decidiu o contrário: a lente de time é a única fonte de
visibilidade, e perder a lente remove o estado, não só a visão. Esta spec é a
implementação disso.

**O que o usuário percebe no fim:** ao ser movida de subtime, a pessoa deixa de
ser responsável pelas tarefas daquele subtime e é avisada. Se ela for a única
responsável por alguma tarefa não-terminal, a movimentação **falha** e diz
exatamente quais são.

---

## O que o código faz hoje (medido no repo e em produção, 06/08)

| Fato | Onde |
|---|---|
| `created_by` concede leitura em **dois** pontos — e só dois | `task_guards.py:60`, `task_repository.py:126` |
| ⚠️ `task_repository.py:117` e `:130` e `project_service.py:215` são o filtro de **pessoal alheio**, não a ADR 0013. Apagá-los vaza projeto pessoal | ver §Correção de 06/08 |
| `project` não tem lente de time em lugar nenhum: `list_page` e `_assert_visible_to_current_user` só escondem pessoal alheio | `project_service.py:211`, `:462` |
| Três testes afirmam esse furo | `test_visibility_db.py:93`, `test_collaboration.py:100`, `test_comments_db.py:235` |
| `out_of_scope` aparece em **11** lugares nos testes, em 2 arquivos | `factories.py`, `test_me_assignments_db.py` |
| …em **10** lugares no backend, em 4 arquivos | `task_repository.py`, `api/schemas.py`, `me_router.py`, `me_service.py` |
| ⚠️ …e em **9** lugares no front, em **4** arquivos — não só em `/minhas-tarefas` | `minhas-tarefas/page.tsx` (6), `lib/api.ts`, `lib/notificacoes.ts`, `tarefa/[id]/page.tsx` |
| Os quatro gatilhos de vínculo moram no mesmo arquivo | `member_service.py:424, 485, 537, 623` |
| `TERMINAL_SEMANTICS = {DONE, CANCELLED}` já existe, puro e testado | `board_semantics.py:36` |
| `remove_assignee` já recusa remover o último responsável | `collaboration_service.py:219` |
| `team_id` explícito **não é validado** contra a lente — *"quem manda, manda"* | `task_service.py:277` |
| O front **já** implementa a ADR: sem seletor de time no modal; `/quadro/[teamId]` barra por `lens.visibleTeamIds` | `web/lib/api.ts:702`, `web/app/quadro/[teamId]/page.tsx` |
| A doc interativa da API já existe fora de produção | `main.py:63` (`/docs`, `/redoc`) |

### Os números de produção que dimensionam a spec

Tarefas vivas com **um responsável só**, por escopo e semântica:

| time | `OPEN` | `IN_PROGRESS` | `DONE` | `CANCELLED` |
|---|---|---|---|---|
| raiz | 120 | 47 | 165 | 1 |
| **subtime** | **26** | **7** | 17 | 1 |

**Só as 33 em negrito podem barrar uma movimentação.** As 333 da raiz não
contam: ninguém perde a raiz de vista (a lente de SUPERVISOR/OPERATOR é
`{próprio time} + {raiz}`).

Concentração: **beatriz.fontes** (Mídias Sociais) 18 · **gisele.reis** (SEO) 12
· gabriela.silva 1 · gabriel.cascadan 1 · pedro.mendonca 1.

⚠️ **Duas pessoas carregam 30 das 33**, e é isso que justifica a E8 (o erro
carrega a lista estruturada, não uma frase).

⚠️ **E o número foi medido no mundo errado, de propósito.** Hoje quase tudo
vive na raiz porque o quadro de subtime não existe. A Spec 036 existe para
mover trabalho para dentro dos subtimes — **33 é o piso, não o teto.**

---

## As medições da F1 — rodadas em produção, 06/08/2026

Cinco consultas contra `task_manager` pelo Adminer, antes de qualquer linha de
código. O SQL da lente é a tradução de `team_scope.visible_team_ids`
(ADMIN → tudo; MANAGER de T → T + descendentes; SUPERVISOR/OPERATOR de X →
X + raiz), validado antes contra um Postgres 16 com banco sintético desta
mesma topologia.

| # | pergunta | resultado |
|---|---|---|
| 0 | um workspace, uma raiz? (porteira do SQL da lente) | `1 \| 1` ✅ |
| 1 | tarefas vivas sem responsável | **36** (o ADR dizia 37) |
| 1 | …destas, quantas só o criador alcança | **0** |
| 2 | tarefas cujo time está fora do alcance de quem criou | **0** |
| 3 | pessoas que o rebaixamento barraria hoje | **nenhuma** |
| 4 | projetos comuns fora da raiz | **nenhum** (20 projetos, 480 tarefas, todos na raiz) |

### O que cada zero decide

⚠️ **Não existe fatia de resgate.** A medição 1 era a única que podia fazer
esta spec perder trabalho. Deu zero: nenhuma tarefa depende do ramo
`created_by` para ser alcançada por alguém. **A spec fica em seis fatias.**

⚠️ **A F5 deixa de ser a fatia perigosa.** O plano a descrevia como "a que muda
o que as pessoas veem em produção". As medições 1 e 2 dizem que ela não muda
nada para ninguém: zero tarefas somem de zero telas. O cuidado especial migra
para a **F4**, que é a que escreve.

⚠️ **A validação da F1 previne, não conserta.** A medição 2 deu zero — não há
passivo. Ela existe para consistência de cliente (n8n, Swagger, chamada
direta), exatamente como o ADR já dizia.

**O rebaixamento não barra ninguém hoje** (medição 3), mas cobre só
ADMIN/MANAGER, e os gestores estão na raiz. O gatilho com cliente real continua
sendo movimentação de subtime: **33 tarefas, 30 delas em duas pessoas.**

### ⚠️ Por que zero não significa desperdício

Alguém vai abrir este arquivo daqui a duas sessões, ver `0, 0, 0` e perguntar
por que se gastaram três sessões nisto antes da 036. A resposta:

**os zeros são consequência de o quadro interno não existir.** É a fatia 5 da
Spec 036 que faz tarefa nascer dentro de subtime; é ela que cria o passivo que
estas consultas mediriam como diferente de zero. Fazer a 037 **antes** é
prevenção por desenho, e o custo (~9 sessões contra ~6) foi apresentado com
número e aceito em 06/08.

**Se a ordem tivesse sido a inversa, estas mesmas consultas voltariam com
número, e cada linha seria trabalho de correção em dado de produção.**

---

## ⚠️ Correção de 06/08 — os pontos do `created_by`

O ADR 0038 e a primeira versão deste `plan.md` diziam **quatro pontos**,
incluindo `project_service.py:215` e `task_repository.py:117`. Aberto o
arquivo, isso está errado, e a versão errada **vaza dado**:

```python
# project_service.py:211  -- list_page
# Privacidade: esconde pessoal alheio.
extra_filters.append(or_(Project.is_personal.is_(False),
                         Project.created_by == tenant.user_id))
```

Este bloco é a única coisa que impede o projeto pessoal de todo mundo de
aparecer no `GET /projects` do workspace inteiro. Mesma coisa no
`task_repository.py:117` (bloco `(A)`, que o próprio código marca como *"vale
até pra admin"*) e no `:130` (*"pessoal próprio: sempre visível"*).

⚠️ **E não há teste de integração de listagem de projeto** — `ls
tests/integration | grep -i proj` devolve só `test_task_detach_project_db.py`.
Apagar aquele bloco passaria no portão verde e vazaria em produção.

**Os pontos reais da E1 são dois:** `task_guards.py:60` e
`task_repository.py:126`.

### O buraco que apareceu no lugar do terceiro ponto

`project_service` não tem lente de time **em lugar nenhum**:
`_assert_visible_to_current_user` (`:462`) só bloqueia pessoal alheio, e
`list_page` não filtra por time. Hoje qualquer pessoa enxerga qualquer projeto
comum de qualquer subtime, por lista e por detalhe.

**Hoje isso não expõe nada** (medição 4: os 20 projetos estão na raiz, que está
na lente de todos). Mas `project_service.py:140` **não** trava projeto na raiz
— aceita qualquer time da árvore. Basta um projeto nascer em subtime, por API
ou pelo n8n, para o buraco virar real e silencioso.

**Tratamento:** dívida registrada, com alarme. A consulta 6 do
`scripts/invariantes.sql` conta projeto comum fora da raiz e deve voltar `0`.
Fechar o buraco continua **fora do escopo** desta spec (ver §Fora de escopo).

---

## Decisões

Todas em `docs/adr/0038-acesso-deriva-do-time.md`, E1–E9. Resumo do que vira
código:

| | |
|---|---|
| **E1** | o ramo `created_by` sai da lente (**2 pontos** — ver §Correção de 06/08) |
| **E2** | `task.created_by` continua existindo e sendo exibido — é histórico |
| **E3** | perder alcance **remove** responsável e observador |
| **E4** | `move`/`remove`/`change_role` **barram** se deixariam órfã tarefa **não-terminal** |
| **E5** | `out_of_scope` é apagado (backend + front) |
| **E6** | não há exceção por relação |
| **E7** | quatro gatilhos; `deactivate_member` **não barra** |
| **E8** | o `422` devolve a lista estruturada de tarefas que barraram |
| **E9** | uma notificação por movimentação, nunca uma por tarefa |

---

## Critérios de aceitação

1. **Criador não enxerga mais.** Quem criou uma tarefa cujo time saiu da sua
   lente não a lista, não a abre e não comenta nela. Os três testes citados
   acima **invertem** (não somem).
2. **`created_by` continua na resposta.** A tarefa mostra "criada por fulano"
   mesmo depois de fulano perder a lente. A E1 não pode ser implementada
   apagando o campo.
3. **`team_id` explícito é validado.** `POST /tasks` com `team_id` fora da
   lente de quem cria devolve 422. Vale para todo cliente, não só para a tela.
4. **A movimentação barra, com lista.** Mover/remover/rebaixar alguém que é
   única responsável por tarefa **não-terminal** que perderia devolve 422 com
   `id`, `título`, `subtime` e coluna de cada uma.
5. **Coluna terminal não barra.** As mesmas tarefas em coluna `DONE` ou
   `CANCELLED` não impedem nada.
6. **A movimentação permitida remove o estado.** Depois de mover, a pessoa não
   é mais responsável nem observadora das tarefas que perdeu, **no banco**.
   ⚠️ Conferir o banco, não a resposta da API — o precedente é a sabotagem da
   cascata de 05/08, onde a contagem dizia `2` e o produto arquivava ao
   contrário.
7. **Uma notificação por movimentação**, com a contagem e o nome do subtime.
   Nunca uma por tarefa.
8. **Desligar não barra.** `deactivate_member` passa mesmo deixando órfã, e as
   tarefas ficam marcadas de forma que alguém as encontre.
9. **`out_of_scope` não existe mais.** Nem no schema, nem no front.
   ⚠️ **CORRIGIDO EM 10/08/2026.** O portão é
   `git grep -n "out_of_scope" -- backend/app backend/tests web/app web/lib`
   devolvendo **EXATAMENTE UMA linha**, e ela é:

       backend/tests/integration/test_me_assignments_db.py:293
       assert "out_of_scope" not in body["items"][0]

   O critério dizia "zero" e era **inatingível**: essa asserção é o que PROVA
   que o campo saiu do contrato. Apagá-la para o grep zerar seria apagar a
   única evidência. **Decisão tomada: mantém a asserção e emenda o critério.**
   Zero passa a ser MOTIVO PARA PARAR — significa que alguém removeu o teste.

   E não use `web/` inteiro, que contém `web/specs` e `web/docs`, onde o nome
   aparece em registro histórico e **deve continuar aparecendo**. Portão que
   não pode passar não afirma nada.
10. **A invariante volta zero.** A consulta da §Como medir da ADR 0038
    (`responsavel_sem_alcance`) devolve `0` depois do deploy e continua `0`.

---

## Fora de escopo

- **Reatribuição em lote.** Fatia posterior. A E8 existe para que ela consuma
  uma lista que já nasce pronta. Ver §Alternativas da ADR 0038.
- **Permissão por quadro.** Recusada pela 0030, pela 0035 e de novo pela 0038.
  O quadro interno **não é confidencial contra a gestão**.
- **Ligar `/docs` em produção.** É decisão de segurança separada, e hoje está
  desligado de propósito (`main.py:63`).
- **A regra "projeto só nasce em time raiz"**, levantada em 06/08. Não é o
  estado atual (`project_service.py:140` aceita qualquer time da árvore) e não
  é ADR de ninguém. **Spec própria.** ✅ **Medido em 06/08 (consulta 4): 20
  projetos comuns, 480 tarefas vivas, TODOS na raiz. Zero em subtime.**
- **A lente de time sobre `project`.** Não existe hoje (§Correção de 06/08) e
  não entra aqui: mexeria em listagem, detalhe e criação de projeto, e
  arrastaria uma spec de tarefa para dentro do módulo de projeto. Fica como
  dívida **com alarme** — consulta 6 do `invariantes.sql`. ⚠️ Se ela deixar de
  voltar `0`, isto vira spec com prioridade, não item de lista.
- **A topologia de múltiplas raízes.** `team_unica_raiz_por_workspace`
  (migration `0004`) permite **uma** raiz por workspace. "Marketing,
  Desenvolvimento, Carreiras" como raízes seriam workspaces distintos, sem
  nada compartilhado. Assunto próprio.

---

## Fronteira de risco

⚠️ **Esta spec escreve no banco por efeito colateral de outra ação.** A E3
remove linhas de `task_assignment` quando alguém é movido. É a primeira vez que
uma mudança de vínculo apaga dado de tarefa. Errar aqui não dá 500 — dá tarefa
sem dono, silenciosa, num quadro que ninguém abre.

✅ **Regra de leitura não conserta dado escrito — medido, e o passivo é zero.**
No dia do deploy da E1, **nenhuma** tarefa some da tela de ninguém (medições 1
e 2). O risco continua existindo como categoria; o dado que o realizaria não
existe hoje.

✅ **As 36 tarefas legadas sem responsável** (ADR 0031 — o ADR dizia 37) eram o
único ponto em que isto podia perder trabalho de verdade. **Zero delas é
alcançada só pelo criador.** Sem fatia de resgate.

⚠️ **O risco não sumiu, mudou de fatia.** Com a E1 inofensiva por medição, o
único ponto desta spec que pode estragar dado de produção é a **F4**, que
remove linhas de `task_assignment`. É lá que vai o cuidado que estava reservado
para a F5 — e é por isso que o critério 6 exige conferir o **banco**.

⚠️ **A 036 fica pausada na fatia 2, e as fatias 1 e 2 estão fora de produção.**
A `0012` e o `GET /boards` sobem juntos quando o congelamento acabar. Nada
nesta spec depende deles, e nada deles depende desta spec — mas o
descongelamento tem que levar os dois.
