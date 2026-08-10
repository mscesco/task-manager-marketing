# 0039 — Multi-subtime é necessário, e espera a fatia 5 da 036

## Status

Accepted — 10/08/2026. **Não supersede a ADR 0008**: a trava "um subtime por
usuário" continua valendo e continua em código. Esta ADR registra *por que ela
fica*, *qual é a contorna enquanto fica*, e *o que exatamente cai no dia em que
ela sair* — para que a próxima sessão não redescubra tudo do zero.

## Contexto

A ADR 0008 proibiu mais de um subtime por usuário e previu o caso contrário
como *"raro neste cliente — teria que ser modelado depois, se surgir"*.
**Surgiu.** Há uma redatora que o negócio precisa em **SEO** e em **Mídias
Sociais** ao mesmo tempo. `MemberService._assert_one_subteam`
(`member_service.py:858`) levanta 422 e o vínculo não é criado.

A necessidade declarada em 10/08 é mais ampla que o caso: **um usuário pode
estar em N subtimes dentro de um mesmo time raiz.** Não é "abrir uma exceção
para uma pessoa".

### O que foi medido no código antes de decidir

Aberto arquivo por arquivo, não inferido:

| ponto | estado | o que precisa |
|---|---|---|
| `user_team`, constraint de banco | `uq_userteam_user_team` só impede o par `(user, team)` repetido | **nada** — N subtimes já cabem no schema, sem migration |
| `team_scope.visible_team_ids` (`:89`) | já itera sobre TODOS os vínculos e faz união | **nada** — a lente nunca assumiu um subtime |
| `team_scope.editable_team_ids` (`:99`) | delega para `visible_team_ids` | **nada** |
| `MemberService._assert_one_subteam` (`:858`) | é a trava | remover |
| `UserRepository.list_all_with_subteam` (`:58`) | ⚠️ **defeito latente**, ver abaixo | agregar em vez de duplicar |
| `team_scope.default_team_id` (`:111`) | `subteams[0]`, sem desempate | ⚠️ **decisão de produto, não código** |

⚠️ **O raio de explosão é MENOR do que a 0008 temia** na parte da lente, e
**MAIOR do que ela previu** na parte da listagem de membros.

## Decisão

**1. A trava fica até a fatia 5 da Spec 036 estar em produção.**

O motivo não é custo de implementação — é que a regra de desempate certa
depende de uma coisa que ainda não existe.

**2. A regra de desempate escolhida é: a tarefa herda o time do QUADRO em que
está sendo aberta.**

`board.team_id` existe e é `NOT NULL`. A regra é implementável em código
pequeno. ⚠️ **Mas produção tem UM quadro e ele é do time raiz.** Hoje "herda o
time do quadro" significa "toda tarefa nova nasce no Marketing" — o oposto do
que se quer, e pioraria a concentração na raiz (medida em 10/08: **155 de 219**
tarefas de responsável único já estão na raiz).

A regra só passa a fazer sentido quando existir quadro por subtime, e isso é a
**fatia 5 da Spec 036**, que depende da 4, que depende da 3. Abrir multi-subtime
antes obriga a inventar um desempate provisório e jogá-lo fora depois.

**3. A contorna, enquanto isso: projeto comum.**

A redatora fica em **um** subtime; o trabalho do outro chega por projeto na
raiz.

⚠️ **A contorna proibida é colocá-la na RAIZ.** Quem está na raiz alcança tudo,
e é exatamente onde vivem os 155 — ou seja, resolveria o sintoma desfazendo na
prática o que a Spec 037 entregou em quatro janelas de deploy. Se alguém propuser
isso por pressa, esta linha é a resposta.

**4. Duas decisões de produto ficam ABERTAS e precisam de resposta antes de
escrever código.**

- **Papel efetivo com papéis divergentes.** SUPERVISOR em SEO e OPERATOR em
  Mídias Sociais: `visible_team_ids` recebe a lista inteira de memberships e não
  pergunta "supervisor de qual". Para a **lente** é indiferente — SUPERVISOR e
  OPERATOR caem no mesmo ramo (`{próprio time} + {raiz}`), e isso foi conferido.
  Para **permissão** não é: `member.manage.subteam` (Spec 028) e o
  `_assert_escopo_supervisor` passariam a valer em todo lugar que a pessoa
  alcança. Ninguém decidiu isso.
- **Flag de subtime principal.** A alternativa que a ADR 0008 rejeitou por custo
  (`N subtimes + flag em user_team`) continua sendo o desenho correto se a
  herança pelo quadro não cobrir todos os casos. Recusada por **custo**, nunca
  por mérito.

## Consequências

- **A pessoa continua bloqueada até a 036 andar (~6 sessões).** É o preço
  aceito. Nenhuma tarefa está parada por causa disso hoje — a contorna por
  projeto funciona.
- ⚠️ **`list_all_with_subteam` é um defeito latente que dispara no dia em que a
  trava cair.** Ele faz `LEFT JOIN` com a subconsulta de subtimes e a própria
  docstring diz que o invariante da 0008 garante **no máximo uma linha por
  membro**. Com dois subtimes, **a pessoa aparece duplicada**, e o consumidor
  (`member_service.py:440`) monta um `MemberWithSubteam` por linha, sem
  deduplicar. **Seis telas consomem essa rota**, os seletores de responsável e
  de `@` incluídos.

  **Não levanta erro, não quebra teste, não aparece no `tsc`.** É a mesma classe
  do parser de erro achado em 10/08: os dois lados corretos, e a costura entre
  eles assumindo algo que deixou de ser verdade. **Consertar ANTES de remover a
  trava, não depois.**
- **Nenhum teste afirma o 422 da trava.** O grep de 10/08 (`"um subtime por
  usuario"` em `backend/tests`) devolve **uma linha, e é docstring**
  (`test_member_subteam_db.py:6`). O invariante nunca teve teste de asserção —
  então removê-lo não vai acender nenhum vermelho, e **isso é motivo para mais
  cuidado, não menos**.
- **A 036 destrava isto de graça.** A fatia 5 entrega quadro por subtime; o
  `default_team_id` deixa de ser ambíguo sozinho.

## Como medir

Antes de abrir a trava, refazer estas duas:

```sql
-- 1. Quem está em mais de um subtime hoje (esperado: 0, a trava está de pé)
SELECT u.email, count(*) AS subtimes
FROM user_team ut
JOIN team t  ON t.id = ut.team_id
JOIN users u ON u.id = ut.user_id
WHERE t.parent_team_id IS NOT NULL
GROUP BY u.email HAVING count(*) > 1;
```

```sql
-- 2. Concentração na raiz -- o que a herança pelo quadro precisa corrigir.
-- Medido em 10/08/2026: RAIZ (Marketing) 155 | SEO 43 | Midias Sociais 18 |
-- Desenvolvimento 1 | Design 1 | Eventos 1.
SELECT CASE WHEN tm.parent_team_id IS NULL THEN 'RAIZ' ELSE 'SUBTIME' END AS onde,
       tm.name AS time, count(*) AS tarefas
FROM task t
JOIN board_column c    ON c.id = t.column_id AND c.board_id = t.board_id
LEFT JOIN project p    ON p.id = t.project_id AND p.workspace_id = t.workspace_id
LEFT JOIN team tm      ON tm.id = COALESCE(p.team_id, t.team_id)
JOIN task_assignment a ON a.task_id = t.id
JOIN users u           ON u.id = a.user_id
WHERE t.deleted_at IS NULL AND t.is_archived = false
  AND COALESCE(p.is_personal, false) = false
  AND c.semantic::text NOT IN ('DONE','CANCELLED')
  AND u.is_active = true
  AND (SELECT count(*) FROM task_assignment x WHERE x.task_id = t.id) = 1
GROUP BY 1, tm.name ORDER BY tarefas DESC;
```

Se a consulta 2 continuar mostrando a raiz com a maioria depois da fatia 5, a
herança pelo quadro não está sendo usada e a decisão desta ADR precisa ser
revista **antes** de abrir a trava.

## Alternativas consideradas

**Abrir agora, com desempate provisório determinístico** (ordem por
`joined_at` ou alfabética em `default_team_id`). Rejeitada como caminho padrão:
é barata e **erra calado** — a tarefa nasce num subtime sem que ninguém tenha
escolhido, e o erro só aparece quando alguém procura a tarefa onde ela não está.

Continua sendo a saída honesta **se o negócio não puder esperar as ~6 sessões**:
custa uma sessão (remover `_assert_one_subteam` + consertar
`list_all_with_subteam` + cravar a ordem) mais uma dívida declarada em ADR nova
que morre na fatia 5. **Não faça isso sem registrar a ADR.**

**Colocar a pessoa na raiz.** Rejeitada — ver §Decisão, item 3.

**Duas contas para a mesma pessoa.** Rejeitada: parte a identidade, duplica
notificação, e faz `task_assignment` mentir sobre quantas pessoas carregam uma
tarefa. Toda a medição de concentração desta semana (Q1, 226 tarefas) deixaria
de ser confiável.

**Flag `is_primary` em `user_team` agora.** Não rejeitada — **adiada**. Se a
herança pelo quadro não cobrir todos os casos depois da fatia 5, é este o
desenho a implementar.
