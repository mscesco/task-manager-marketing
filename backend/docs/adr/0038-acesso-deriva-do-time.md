# 0038 — Acesso deriva do time, e só do time. A relação com a tarefa não fura a lente.

## Status

Accepted — **supersede a [0013](0013-criador-sempre-ve.md)** (criador sempre vê)
e **supersede a [0018](0018-query-relacoes-fura-lente.md)** na parte em que ela
omite a camada de lente. Refina a **[0017]** (o `out_of_scope` deixa de ter
caso de uso). Confirma sem alterar a **0035 §D3**: a visibilidade continua
saindo do `team_id`, e agora ela é a *única* fonte.

Fecha as decisões **E1–E9** de 06/08/2026.

## Contexto

O produto tinha três exceções à lente de time, criadas em momentos diferentes e
por motivos diferentes, e nenhuma delas se sabia parte de um conjunto:

1. **`created_by` sempre enxerga** (0013). Nasceu de um caso real: alguém cria
   tarefa avulsa para um subtime irmão e ela some da própria lente no instante
   seguinte. Implementada em **dois** pontos — `task_guards.task_visible:60` e
   um ramo do `or_` da lente em
   `task_repository.list_page_with_filters:126`. Ver §Correção de 06/08.
2. **`/me/assignments` omite a camada de lente** (0018), de propósito, para a
   tela poder mostrar tarefa fora de escopo.
3. **`out_of_scope`** (0017) é a marca visual da 2 — "você está ligado a isto e
   não enxerga pela lente atual".

A Spec 036 (quadro interno de subtime) obrigou a olhar as três juntas, porque
ela é a primeira entrega em que a lente passa a significar algo que uma pessoa
vê na tela: *este quadro é do meu subtime*. E aí a pergunta ficou impossível de
adiar: **o que acontece quando alguém sai do subtime?**

Pela regra de 06/08, a resposta era: continua vendo tudo que criou lá, e
continua vendo, marcado, tudo em que é responsável. Ou seja, **a saída do time
não tirava acesso a nada** — só mudava a cor do selo.

⚠️ **O achado que decidiu a discussão:** medido no repositório, o furo da 0013
não expõe ninguém *hoje* no quadro interno. Quem pode criar lá (supervisor do
subtime, ADMIN, MANAGER) já tem aquele time na lente. O furo só passa a valer
quando a lente **encolhe depois** — que é exatamente o caso de rotatividade,
e exatamente o caso que a spec do quadro interno torna comum.

## Decisão

**E1 — A lente de time é a única fonte de visibilidade de tarefa.** Nenhuma
relação (criador, responsável, observador) concede leitura por si. O ramo
`task.created_by == viewer` sai de `task_visible` e do `or_` da lente no
repositório. ⚠️ **São dois pontos, e o `project_service` NÃO é um deles** — ver
§Correção de 06/08.

⚠️ Isto **simplifica** a regra: cai um ramo inteiro do `or_`. Se a
implementação ficar mais complicada, foi implementada errado.

**E2 — `task.created_by` continua existindo e continua sendo mostrado.** É
histórico: "criada por fulano" aparece na tarefa mesmo depois de fulano sair do
time, do subtime ou da empresa. A coluna é `NOT NULL` e nada nela muda. O que
muda é que ela **não concede leitura**.

**E3 — Perder a lente remove o estado, não só a visão.** Ao perder o alcance de
uma tarefa por mudança de vínculo, a pessoa é removida como **responsável** e
como **observador** daquela tarefa.

⚠️ Esta é a decisão mais cara do ADR, e a razão dela é que a alternativa —
apenas esconder — deixa a pessoa como responsável nominal por trabalho que ela
não consegue abrir. O produto passaria a ter dono invisível, que é pior que não
ter dono: ninguém procura o que tem dono.

⚠️ **Esconder é leitura e é reversível de graça; remover é escrita e não é.**
Devolver o vínculo não devolve as designações. Isso está aceito, e é o motivo
de a E4 existir.

**E4 — A saída do time é BARRADA quando deixaria tarefa órfã, e a fronteira é
a SEMÂNTICA da coluna.** Se a pessoa é a única responsável por alguma tarefa
**não-terminal** que passaria a não alcançar, a movimentação falha alto, com a
lista, e pede reatribuição antes.

Terminal = `board_semantics.TERMINAL_SEMANTICS` (`DONE`, `CANCELLED`). Tarefa
em coluna terminal **não barra nada**: é trabalho que ninguém vai precisar
retomar, e travar a movimentação por causa dela seria burocracia sem dono.

⚠️ **É o primeiro leitor de verdade de `column.semantic`.** O campo existia
desde a Spec 035 e estava listado como "sem leitor" desde então.

⚠️ A alternativa (deixar a tarefa ficar sem responsável) recria de propósito o
estado que a **0031** existe para impedir. As duas ADRs se contradiziam neste
ponto; a E4 é a resolução, e ela preserva as duas.

**E5 — `out_of_scope` deixa de existir.** Com a E3, ele nunca pode valer
`true`: quem não alcança não é mais responsável. O campo, a marca visual e o
ramo da 0018 que omite a camada de lente saem. `/me/assignments` passa a ser o
que a tela sempre quis ser — a lista das minhas tarefas — e volta a aplicar a
lente como todo o resto do app.

⚠️ Isto é uma **deleção**. A spec que implementar esta ADR fica menor por causa
da E5, não maior.

**E6 — A hierarquia de acesso é absoluta.** Não há exceção por relação, por
antiguidade, por autoria ou por acompanhamento. Fora da lente é fora, e
"acompanhar" não é um tipo de acesso.

**E7 — Os gatilhos são QUATRO, e os quatro moram no `MemberService`.**

| método | o que encolhe | barra? |
|---|---|---|
| `move_member_subteam` (:537) | perde o subtime antigo | **sim** |
| `remove_member_from_team` (:485) | perde o time | **sim** |
| `change_member_role` (:424) | MANAGER → OPERATOR perde os OITO subtimes de uma vez | **sim** |
| `deactivate_member` (:623) | perde tudo | **NÃO** |

⚠️ **O `change_member_role` é o maior dos quatro e não estava na discussão.** A
lente do MANAGER é raiz + descendentes; a do OPERATOR da raiz é só a raiz. Um
rebaixamento tira acesso a oito subtimes num clique — mais do que qualquer
movimentação de time. Deixá-lo de fora manteria aberto um buraco maior que os
que este ADR fecha.

⚠️ **O `deactivate_member` NÃO barra, e essa é a única concessão do ADR.**
Barrar faz sentido quando a mudança é *opcional* — mover, rebaixar, tirar do
time: dá para dizer "reatribua antes". **Desligar alguém não é opcional.**
Ninguém segura o desligamento de quem saiu da empresa porque restam 18 tarefas,
e uma trava aqui seria contornada no primeiro dia reativando a conta. A
desativação passa sempre, e as tarefas ficam **órfãs de forma visível** — não
em silêncio. É o único ponto em que a invariante da 0031 cede, e cede por
motivo escrito.

⚠️ O custo real não é o número de pontos de ligação: é o **predicado**, que é
um só ("dado o conjunto de times que a pessoa teria depois da mudança, de quais
tarefas não-terminais ela é a única responsável e deixaria de alcançar?").
Escrito uma vez, chamado em quatro lugares do mesmo módulo. Fazer dois em vez
de quatro economiza quase nada.

**E8 — O erro da E4 carrega a LISTA ESTRUTURADA, não uma frase.** O `422`
devolve `id`, `título`, `subtime` e coluna de cada tarefa que barrou.

⚠️ Isto não é enfeite de mensagem: **duas pessoas carregam 30 das 33 tarefas
que travariam hoje** (ver §Como medir). Uma frase serve para quem tem 1 tarefa
e é uma parede para quem tem 18 — e regra que vira parede é contornada, não
seguida. A reatribuição em lote fica **fora** desta entrega, mas o dado que ela
precisa nasce aqui, porque o predicado já o calcula para decidir. Sem a E8, a
fatia futura recalcularia tudo e a spec nasceria com dívida.

**E9 — A pessoa é notificada, uma vez por movimentação.** *"Você deixou de ser
responsável por 18 tarefas do subtime Mídias Sociais."* Uma notificação por
evento, nunca uma por tarefa. O sistema de notificação já existe.

> **Nota de 17/09/2026 (Spec 053, fatia A):** a contagem nunca foi só de
> responsável — ela inclui as tarefas em que a pessoa só observava
> (`member_service._remover_relacoes_perdidas`). O texto do sino diz *"Ana
> mudou seu time: você deixou de ter acesso a 18 tarefas"*. E, até a 053, o
> front nem tinha texto para este aviso: ele aparecia como "Atualização em uma
> tarefa".

## Consequências

- **NÃO existe janela de regressão na tela, e isso foi medido.** A hipótese
  inicial — "alguém cria tarefa fora da própria lente e ela some" — não é
  alcançável pela interface: `createTask` (`web/lib/api.ts:702`) só manda
  `team_id` explícito quando o modal vem de `/quadro/[teamId]`, e essa página
  barra com `lens.visibleTeamIds.has(alvo.id)` antes de renderizar. Não há
  seletor de time no modal de criar tarefa. **O front já implementa esta ADR.**
- ⚠️ **A API, porém, não implementa.** `task_service.py:277` documenta a
  precedência do `team_id` como *"quem manda, manda"* — sem validação de
  alcance. Alcançável por n8n, Swagger e chamada direta.
  **A validação de `team_id` contra a lente entra por CONSISTÊNCIA DE CLIENTE,
  não por ordem obrigatória.** É o mesmo padrão e o mesmo motivo da 0031, cujo
  comentário está no mesmo arquivo (`task_service.py:311`): a regra valia para
  quem usava a tela e não valia para o resto.
- **Medição pendente sobre o n8n:** em 06/08 ele não cria tarefa. Se um dia
  criar, com qual usuário e com qual lente? Este item está aberto desde o
  handoff de 04/08 e nunca foi respondido.
- **A rotatividade fica mais cara e mais explícita.** Mover alguém entre
  subtimes deixa de ser um clique. É o preço aceito: a alternativa era mover
  gente e deixar acesso para trás em silêncio.
- **Movimentos que NÃO disparam nada:** raiz → subtime (a lente de
  SUPERVISOR/OPERATOR é `{próprio time} + {raiz}` e portanto **cresce**), e
  qualquer movimento envolvendo tarefa cujo time é a raiz — que ninguém perde
  de vista. O gatilho real é **subtime → subtime** e **saída do workspace**.
- **Regra de leitura não conserta dado escrito.** No dia do deploy da E1,
  tarefas hoje alcançadas só pelo `created_by` somem da tela de alguém. A
  medição está em §Como medir.
- ✅ **As tarefas legadas sem responsável** (0031) não têm quem as reencontre.
  **Medido em 06/08: são 36, e ZERO delas é alcançada só pelo criador.** A
  interseção que podia perder trabalho não existe. Ver §Como medir.
- **ADMIN não muda.** A lente dele é `None` e nunca dependeu de relação.

## Como medir

Medido em produção (`task_manager`) em **06/08/2026**, antes de qualquer
implementação. Os números abaixo são a linha de base; refazer antes de subir.

**Tarefas vivas com UM responsável só, por escopo e semântica:**

| time | `OPEN` | `IN_PROGRESS` | `DONE` | `CANCELLED` |
|---|---|---|---|---|
| **raiz** | 120 | 47 | 165 | 1 |
| **subtime** | **26** | **7** | 17 | 1 |

**Só as 33 em negrito podem barrar uma movimentação.** As 333 da raiz não
contam: ninguém perde a raiz de vista.

**Concentração — quem barraria a própria saída hoje:**

| pessoa | subtime | tarefas que travariam |
|---|---|---|
| beatriz.fontes | Mídias Sociais | **18** |
| gisele.reis | SEO | **12** |
| gabriela.silva | Eventos | 1 |
| gabriel.cascadan | Design | 1 |
| pedro.mendonca | Audiovisual | 1 |

⚠️ **Duas pessoas carregam 30 das 33.** A mensagem *"reatribua antes de mover"*
sozinha não serve para quem tem 18 tarefas na lista — reatribuir uma a uma é o
tipo de fricção que faz a regra ser contornada em vez de seguida. **A spec
precisa de reatribuição em lote**, e isso não é enfeite: é o que torna a E4
executável.

⚠️ **E o número foi medido no mundo ERRADO, de propósito.** Hoje quase tudo
vive na raiz porque o quadro de subtime não existe. **A Spec 036 existe para
mover trabalho para dentro dos subtimes** — então estes 33 são o piso, não o
teto, e vão crescer por desenho. Dimensionar a E4 para 33 é dimensionar para o
passado.

**O que faltava medir — MEDIDO em 06/08/2026, e deu zero nos três:**

| # | pergunta | resultado |
|---|---|---|
| 1 | das tarefas vivas sem responsável, quantas só o criador alcança | **0** (de **36** sem responsável — este ADR dizia 37) |
| 2 | quantas tarefas têm `team_id` fora do alcance de quem as criou | **0** |
| 3 | quantas pessoas o `change_member_role` barraria hoje | **nenhuma** |

O SQL está em `specs/037-acesso-deriva-do-time/spec.md` §As medições da F1, com
a tradução da lente (`team_scope.visible_team_ids`) em SQL.

⚠️ **Consequência para a implementação:** a E1 é inofensiva em produção —
nenhuma tarefa some da tela de ninguém no dia do deploy, e **não existe fatia
de resgate**. O risco desta ADR concentra-se todo na **E3/E4** (a escrita), não
na E1.

⚠️ **Consequência para a leitura destes números:** eles são zero **porque o
quadro interno ainda não existe.** É a Spec 036 que move trabalho para dentro
dos subtimes; é ela que faria estas consultas voltarem com número. Este ADR ser
implementado antes da 036 é o que mantém os zeros em zero.

⚠️ **A medição 3 cobre só ADMIN/MANAGER**, e os gestores estão na raiz. O
gatilho com cliente real continua sendo movimentação de subtime: as **33**
tarefas da tabela acima, **30 delas em duas pessoas**.

## ⚠️ Correção de 06/08 — os pontos do `created_by` são DOIS, não quatro

Este ADR afirmava, no §Contexto e na E1, que o furo da 0013 estava implementado
em quatro pontos, incluindo o `project_service`. **Aberto o código, está
errado**, e a versão errada é perigosa:

- `project_service.py:215` é o filtro *"Privacidade: esconde pessoal alheio"*.
  É a única coisa que impede o projeto pessoal de todo mundo de aparecer no
  `GET /projects` do workspace inteiro;
- `task_repository.py:117` é o bloco `(A)`, que o próprio código marca como
  *"vale até pra admin"*, e `:130` é *"pessoal próprio: sempre visível"*.
  Nenhum dos dois é a 0013.

⚠️ **E não há teste de integração de listagem de projeto** — apagar aquele
bloco passaria no portão verde e vazaria em produção.

**Os pontos reais da E1: `task_guards.py:60` e `task_repository.py:126`.**

**Achado colateral, e ele fica registrado aqui porque contradiz o título deste
ADR:** `project_service` **não tem lente de time em lugar nenhum** —
`list_page` (:211) e `_assert_visible_to_current_user` (:462) só escondem
pessoal alheio. Acesso a projeto **não** deriva do time hoje. Isso está fora do
escopo da Spec 037 por decisão (arrastaria uma spec de tarefa para dentro do
módulo de projeto), e fica como dívida **com alarme**: a consulta 6 de
`scripts/invariantes.sql` conta projeto comum fora da raiz e deve voltar `0`.
Em 06/08 voltou `0` — os 20 projetos comuns estão todos na raiz. ⚠️ Se deixar
de voltar `0`, isto vira spec com prioridade, porque `project_service.py:140`
não trava projeto na raiz e o vazamento seria silencioso.

**Consulta que sustenta a invariante** (deve voltar `0` depois da
implementação; hoje volta o número acima):

```sql
-- Responsavel que NAO alcanca a propria tarefa.
-- Depois da E1/E3, este numero e zero e continua zero.
-- (a lente e calculada na aplicacao, entao esta versao SQL e aproximada:
--  cobre so o caso subtime, que e o unico em que a lente encolhe)
--
-- ⚠️ CORRIGIDA EM 10/08/2026. A versao anterior nao tinha o SEGUNDO
-- NOT EXISTS e contava como violacao quem tem vinculo com a RAIZ --
-- ADMIN/MANAGER da raiz alcancam os subtimes. Falso positivo garantido,
-- num criterio de aceite (criterio 10 da spec) que precisa devolver 0.
-- Nao volte a versao curta: ela devolve numero > 0 num banco saudavel.
SELECT count(*) AS responsavel_sem_alcance
FROM task_assignment ta
JOIN task t  ON t.id = ta.task_id
JOIN team tm ON tm.id = t.team_id
WHERE t.deleted_at IS NULL
  AND tm.parent_team_id IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM user_team ut
         WHERE ut.user_id = ta.user_id AND ut.team_id = t.team_id)
  AND NOT EXISTS (
        SELECT 1 FROM user_team ut2
        JOIN team r ON r.id = ut2.team_id
         WHERE ut2.user_id = ta.user_id AND r.parent_team_id IS NULL);
```

## Alternativas consideradas

**Só esconder, sem remover o estado (a leitura pura).** Rejeitada: cria
responsável nominal que não abre a tarefa. Dono invisível é pior que tarefa sem
dono, porque ninguém procura o que já tem dono.

**Só o `creator` para de furar a lente; `assignee` e `watcher` continuam,
marcados.** Rejeitada explicitamente: manteria o `out_of_scope` vivo e o
princípio meio aplicado. Se ser responsável concede leitura, a lente deixa de
ser hierarquia e vira sugestão.

**Deixar a tarefa órfã na saída do time.** Rejeitada: reabre o passivo que a
0031 fechou, e recria o estado exato que ela existe para impedir.

**Cair para um responsável automático (supervisor do time do quadro).**
Rejeitada: designa trabalho a quem não pediu e não sabe, e o supervisor
descobre pela notificação de prazo.

**Entregar a reatribuição em lote junto com a trava (a opção "B1").**
Rejeitada por escopo: arrastaria o front para uma spec que é de backend. A E8
existe para que isso NÃO custe caro depois — a fatia futura consome uma lista
que já nasce pronta.

**Barrar também o desligamento (`deactivate_member`).** Rejeitada: ver E7. Uma
trava que impede desligar quem já saiu da empresa é uma trava que será
contornada reativando a conta, e aí ela não protege nada e ainda ensina a
ignorar o produto.

**Permissão por quadro, fechando o quadro interno inclusive contra a gestão.**
Fora de escopo, e a 0035 já a tinha recusado: colide com a lente inteira. O
quadro interno **não é confidencial contra a gestão** e a tela não deve sugerir
que seja.
