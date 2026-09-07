# Spec 045 — A permissão carrega o time

**Status:** escrita em 02/09/2026, a partir do [`briefing.md`](briefing.md) e do
[`decisoes.md`](decisoes.md) desta pasta. Decisões tomadas; nenhuma fatia liberada
ainda.
**Escopo:** backend só. Papel de organização, permissão com escopo de time,
invariante de nível nova.
**Depende de:** Spec 024 (a invariante que esta reescreve), Spec 028 (os gates de
escopo), Spec 044 §6 (que registrou esta dívida por antecipação).
**Placar na abertura:** Front **1082** em 60 arquivos, com `tsc --noEmit` limpo —
**medido em 02/09**. Backend: ⚠️ **não medido** (Docker Desktop desligado, o
`db-test` não subiu); última medida conhecida, da Spec 044 fatias 1+2, é **1014**,
migrations `0021`. **Medir o backend antes da fatia A.**
**Não faz parte desta spec:** criar várias raízes (Spec 046) e as telas
(Spec 047). Ver §6.

---

## 1. Isto não é ideia nova — a Spec 044 já escreveu o bilhete

A [Spec 044 §6](../044-uma-pessoa-em-varios-times/spec.md) registrou esta dívida
antes de ela vencer:

> *"Com várias raízes, o argumento inteiro da Spec 024 cai. Ele diz que 'união
> dos papéis' e 'autoridade sobre a árvore' coincidem **porque ADMIN e MANAGER só
> existem na raiz única**. Com várias raízes, um MANAGER de TI carrega o papel sem
> que `permissions_for_roles` saiba de qual árvore."*

Esta spec é o pagamento. Ela **não** cria raízes — ela torna seguro criá-las.

E a conversa de 02/09 achou uma coisa que o briefing não tinha: **o buraco não são
as N raízes.** É que hoje o único lugar onde um papel pode existir é `user_team`
([organization.py:155](../../app/db/models/organization.py)), ou seja, **todo
papel exige um time**. Um gestor da organização — alguém que administra todas as
áreas sem pertencer a nenhuma — não tem onde morar. Com uma raiz só dava para
fingir que a raiz *era* a organização; com N raízes a ficção não fecha: ADMIN de
qual?

---

## 2. O que já existe — medido em 02/09, abrindo os arquivos

| ponto | onde | estado |
|---|---|---|
| o mapa estático de permissões | `permissions.py:53` | ✅ é a fonte única, e continua sendo |
| **a derivação descarta o time** | `permissions.py:136` | ⚠️⚠️ `permissions_for_roles(roles: frozenset[str])` — só as strings |
| o time **está** em memória, uma linha ao lado | `tenant.py:83-88` | ⚠️ `TenantContext` carrega `roles` (plano) **e** `memberships` (com `team_id`) |
| quem chama | `dependencies.py:107` | ⚠️ `permissions_for_roles(membership.roles)` — usa o plano |
| o vínculo já carrega o time | `organization.py:172` | ✅ `UNIQUE (user_id, team_id)` — um papel **por** time, quantos times quiser |
| a pessoa já pertence ao workspace sem time | `organization.py:118` | ✅ `users.workspace_id` é FK própria — metade do papel de organização já existe |
| `is_admin` lê os vínculos | `team_scope.py:74` | ⚠️ `any(m.role == "ADMIN")` — muda na fatia B |
| a raiz aceita os quatro papéis | `team_scope.py:160` | ⚠️ muda na fatia D |
| o escopo já desce a árvore | `team_scope.py:90-92` | ✅ MANAGER/ADMIN de T → T + descendentes |
| a lente de edição é um alias | `team_scope.py:108` | ⚠️ `return visible_team_ids(...)`, uma linha |
| `member.manage.subteam` só no SUPERVISOR | `permissions.py:114` | ⚠️⚠️ o mapa **não** é monotônico |
| e o que salva é um *early return* | `member_service.py:925` | ⚠️⚠️ `if self._tem_gestao_ampla(): return` |

### 2.1. ⭐ O achado desta seção: ADMIN e MANAGER têm o mesmo cartão

Lendo o mapa linha a linha: **`ADMIN` = `MANAGER` + `workspace.manage`.** As
outras dez permissões são idênticas — `team.manage`, `solicitation.review`,
`solicitation_form.manage`, `project.create/update/delete`,
`task.create/update/delete/assign`, `board.manage.root`, `board.manage.subteam`.

**A diferença real entre os dois papéis não é *o quê*, é *onde*:** `is_admin` faz
`visible_team_ids` devolver `None` (todos), e o MANAGER fica com a própria árvore.

⚠️ Isso torna a dívida mais afiada do que o briefing a colocava: com N raízes, a
distinção ADMIN/MANAGER **é inteiramente uma distinção de escopo** — e escopo é
exatamente o que `permissions_for_roles` não sabe.

---

## 3. ⚠️⚠️ Esta spec não consegue se provar sozinha

Enquanto o índice `team_unica_raiz_por_workspace`
([organization.py:86](../../app/db/models/organization.py)) estiver de pé — e ele
**fica**, porque quem o remove é a Spec 046 — existe **uma raiz só**. E com uma
raiz só:

> escopo certo e escopo errado produzem exatamente o mesmo resultado, em toda
> rota, em todo teste.

Um `require_permission` que "esqueceu" de conferir o time passa verde nos cinco
portões. A coincidência da Spec 024 mascara o defeito **durante toda esta spec**, e
o vermelho só apareceria na 046 — depois de a segunda raiz existir em produção.

**Por isso os testes desta spec precisam criar a segunda raiz direto no banco**,
por trás do índice, sem passar pela API. É a mesma manobra que a Spec 044 §7 exigiu
para os dois vínculos:

> *"a fatia 1 precisa de um teste de repositório que monte os dois vínculos
> **direto no banco**, sem passar pelo serviço que ainda tem a trava."*

⚠️ **Sem esse teste, esta spec é fé.** O índice é parcial
(`WHERE parent_team_id IS NULL`), então inserir a segunda raiz por `INSERT` direto
**também** esbarra nele — o teste precisa criar as duas árvores em um workspace de
teste onde o índice foi derrubado na fixture, ou medir o escopo por função pura
(`team_scope`) com uma árvore de duas raízes montada em memória. **A segunda opção
é mais barata e cobre a maior parte:** `team_scope` já recebe a árvore como
`tuple[TeamNode, ...]` e não fala com o banco.

---

## 4. As decisões

Todas de 02/09, registradas com o raciocínio em [`decisoes.md`](decisoes.md).

### 4.1. O workspace É a organização

Não nasce entidade acima das raízes. O que nasce é **papel de organização**:
vínculo sem `team_id`.

Passam a existir duas pertenças, e a derivação vira duas perguntas:

| pertença | o que diz | permissões |
|---|---|---|
| organização | quem administra a organização | globais **de verdade** — o vínculo não tem time |
| time (`user_team`) | o que a pessoa faz em cada time | **por time**, lidas do vínculo |

### 4.2. ⭐ A permissão carrega o time

**Não é "criar escopo". É parar de descartar o escopo que já existe** (§2).

Por que é obrigatório e não preferência: uma pessoa pode ser MANAGER de **mais de
uma raiz** (4.3). Um conjunto plano com `team.manage` dentro é **incapaz** de dizer
em quais árvores ela manda. Escopar porta a porta no serviço não é a versão barata
disto — é isto feito à mão, N vezes, sem ninguém garantindo que a enésima foi
feita.

⚠️ **O vínculo de comando concede sobre a SUBÁRVORE, não sobre o nó.** É o que
`visible_team_ids` já calcula ([team_scope.py:90-92](../../app/modules/auth/domain/team_scope.py)).
As duas funções passam a dizer a mesma coisa, que hoje não dizem.

### 4.3. Os papéis e onde cada um existe

| nível | papéis |
|---|---|
| organização (sem time) | `ADMIN`, `GESTOR` |
| time raiz (área) | `MANAGER`, `OPERATOR` |
| subtime | `SUPERVISOR`, `OPERATOR` |

Cada papel tem **um** lugar — menos `OPERATOR`, o único que vive nos dois níveis de
time, e justamente o que não tem autoridade nenhuma.

Contra o que existe hoje (`roles_permitidos_no_nivel(is_root=True)` devolve os
quatro): **`ADMIN` sai do nível de time** e **`SUPERVISOR` sai da raiz**.

A intenção, em uma frase por papel — era a §8.2 do briefing, nunca escrita:

- **ADMIN** — define a organização. Renomeia, apaga área, promove gestor.
- **GESTOR** — opera a organização. Cria área, cadastra e desativa pessoas,
  distribui papéis de time. Não desfaz a organização.
- **MANAGER** — dono de uma árvore inteira. Pode ser dono de mais de uma.
- **SUPERVISOR** — dono de um braço operacional. Um subtime, o seu.
- **OPERATOR** — executa. Nada de estrutura.

⚠️ **Invariante nova que isto exige: a organização nunca fica sem ADMIN.** O
último ADMIN é barrado de se rebaixar ou se remover. Hoje ninguém pensou nisso
porque ADMIN é vínculo na raiz, e a raiz não some.

### 4.4. Quem tem comando na raiz não tem vínculo de subtime

MANAGER na raiz **já significa** gerente de todos os subtimes. O vínculo de subtime
não acrescenta alcance nenhum e afirma algo falso no organograma ("está em"). E não
precisa acrescentar: a **Spec 034** existe exatamente porque gestor e admin **têm**
de aparecer nos seletores de subtime sem vínculo lá.

Trava de **escrita**, com mensagem que explica em vez de só barrar:
*"Gestores já alcançam todos os subtimes desta área."*

Efeito colateral bom: torna verdadeiro o nome de `_subtimes_supervisionados`
([member_service.py:900](../../app/modules/users/application/member_service.py)),
que hoje devolve a **raiz** quando o vínculo `SUPERVISOR` está lá — e, por
consequência, deixa um supervisor da raiz governar operadores da raiz por um gate
chamado "subtimes supervisionados".

✅ **Varredura rodada em 02/09 no Adminer.** `SUPERVISOR` em raiz: **nenhum
registro**. Comando na raiz com vínculo de subtime: **um registro** — Samantha
Rasquinho, MANAGER de Marketing + SUPERVISOR de Live Marketing.

⚠️ **A fatia D não pode ligar antes de aquele vínculo sair.** Barrar na escrita não
conserta cadastro que já existe — mesma regra da Spec 044 §4.1-bis.

### 4.5. A não-monotonicidade sai do tapete

`member.manage.subteam` existe **só** no SUPERVISOR — MANAGER e ADMIN **não a
têm** no mapa, e passam pelo *early return*. O mapa diz uma coisa e uma linha de
código diz outra.

**Decisão da Camila (02/09): "manager e admin administram absolutamente tudo do
time e sua árvore inteira."** A permissão vai para o mapa.

⚠️ **O *early return* FICA, e é load-bearing** — ele não era o remendo que
sustentava a permissão, era a camada de **escopo**. Depois desta fatia o mapa
concede *o quê* e ele participa do *onde*; removê-lo recusa o MANAGER, e isso foi
medido, não deduzido (§5, fatia A).

### 4.6. "Vê" e "edita" se separam — e o primeiro caso é este

`editable_team_ids` deixa de ser alias de `visible_team_ids`.

⚠️ **Primeira decisão concreta que isso força:** hoje um SUPERVISOR de subtime
**edita** tarefa no quadro geral da raiz, porque a lente de edição é a de leitura
e ela inclui `root_of(X)` ([team_scope.py:94-95](../../app/modules/auth/domain/team_scope.py)).
**Decisão: mantém.** O quadro geral é compartilhado e tirar isso quebraria o dia a
dia de quem está em subtime. Fica escrito porque, a partir desta spec, isso deixa
de cair de graça de uma coincidência e passa a ser uma linha que alguém escreveu.

---

## 5. As fatias

**Fatia A — o mapa ganha a intenção. ✅ ENTREGUE (02/09).**
`member.manage.subteam` entra em `ADMIN` e `MANAGER`
([permissions.py:53](../../app/modules/auth/domain/permissions.py)). Sem
migração, sem mudança de assinatura, e **sem mudança de comportamento** — as duas
rotas da Spec 028 já usam
`require_any_permission("team.manage", "member.manage.subteam")`, então ADMIN e
MANAGER já entravam por `team.manage`. Placar idêntico ao baseline (1014).

O guardião é o teste do **mapa**: os três papéis de comando e supervisão a têm, o
OPERATOR não, e — o que mais importa —
`permissions_for_roles({MANAGER, SUPERVISOR}) - permissions_for_roles({MANAGER})`
é **vazio**. É a não-monotonicidade da Spec 044 §4.1-bis morrendo com asserção.

⚠️⚠️ **ESTA SPEC ESTAVA ERRADA SOBRE ESTA FATIA, e a sabotagem provou.** O texto
anterior dizia que o teste *"continua verde se o `_tem_gestao_ampla` for
removido"*. **Não continua.** Sem o *early return*,
`_assert_escopo_supervisor` passa a escopar o MANAGER por
`_subtimes_supervisionados()` — que para ele é **vazio** — e ele é recusado;
medido, `test_manager_mantem_alcance_amplo` cai.

Aquela linha **não é gambiarra**: é a camada de **escopo** funcionando, e é a
armadilha 3 do briefing dita em código — *o mapa diz "o quê", o serviço diz
"onde"*. Para ADMIN e MANAGER o "onde" é a **árvore** deles
(`visible/editable_team_ids`), e não os subtimes que supervisionam. Ela fica, com
comentário explicando por quê.

**Sabotagens rodadas:** mapa revertido → o teste novo cai; *early return*
removido → `test_manager_mantem_alcance_amplo` cai.

**Fatia B — o papel de organização nasce.**
Papel sem `team_id`. `ADMIN` migra de `user_team` para lá; `GESTOR` nasce.
`is_admin` passa a ler o papel de organização, não os vínculos
([team_scope.py:74](../../app/modules/auth/domain/team_scope.py)).

⚠️⚠️ **É a única fatia do projeto inteiro que mexe em quem consegue ENTRAR no
sistema.** Vai sozinha, num PR só dela.
⚠️ **Cria tabela/coluna → precisa do portão de DRIFT** (`AGENTS.md` §5).
⚠️ Confere o bootstrap: `team_seed_service` cria a raiz e o primeiro ADMIN. Se o
ADMIN sair de `user_team` e o seed não acompanhar, **workspace novo nasce sem
dono**.
⚠️ E a invariante "nunca sem ADMIN" (4.3) entra aqui, não depois.

**Fatia C — `permissions_for_roles` ganha escopo.**
A assinatura muda e todos os `require_permission` acompanham, em lote. A permissão
de organização vem sem time; a de time vem com o `team_id` do vínculo e, para
papel de comando, **sobre a subárvore**.
Aqui entra o teste da §3, em `team_scope` puro, com duas raízes montadas em
memória.

**Fatia D — a invariante de nível nova.**
`roles_permitidos_no_nivel` passa a devolver `{MANAGER, OPERATOR}` na raiz e
`{SUPERVISOR, OPERATOR}` em subtime, e nasce a trava da 4.4. Aplicada nas **mesmas
quatro portas** do `MemberService` (`:314`, `:536`, `:610`, `:773`) — a Spec 044
§4.1-bis já mapeou onde elas ficam.
⚠️ **Requer o vínculo da Samantha removido antes** (4.4).

Ordem: **A → B → C → D**. A é independente e pode ir a qualquer momento; C depende
de B; D depende de C.

---

## 6. O que esta spec deliberadamente NÃO faz

- **Criar várias raízes.** É a Spec 046. Esta torna seguro; aquela permite. ⚠️ E é
  por isso que a §3 existe: nesta spec o índice único continua de pé, então nada
  aqui se prova sozinho.
- **As telas.** Spec 047. Elas dependem da **Spec 044 fatia 3**, não desta.
- **A regra "o papel na raiz não pode ser menor"** — é a **fatia 5 da Spec 044**, e
  fica lá. Ela e a 4.4 cuidam de direções opostas e não conflitam: a 4.4 impede
  "forte em cima com vínculo embaixo", a da 044 impede "fraco em cima, forte
  embaixo".
- **O mapa de posto de papéis.** Nasce com a fatia 5 da 044. Esta spec não precisa
  dele: nenhuma regra daqui compara postos. ⚠️ Se a 045 andar primeiro, o mapa
  continua não existindo — e `UserTeamRole` é `StrEnum` **sem ordem**
  ([enums.py:21](../../app/db/models/enums.py)).
- **RBAC editável em tabela.** Recusado em 02/09, com o motivo em
  [`decisoes.md` §10.1](decisoes.md). O que dói não é a falta de tabela, é a falta
  de intenção declarada — e a §4.2 é justamente o que torna a tabela barata depois,
  como [`permissions.py:13-16`](../../app/modules/auth/domain/permissions.py) já
  promete.
- **Área fechada** (raiz que esconde o próprio trabalho da liderança). Não há caso
  hoje; se aparecer, é propriedade do **time**, não do papel do gestor.

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **Escopo errado, em toda a spec.** É a §3, e é o risco número um: com uma
  raiz só, os cinco portões ficam verdes com ou sem a conferência de time. O
  guardião tem de ser escrito de propósito, com árvore de duas raízes.
- **O drift**, na fatia B. `pytest` verde não diz nada sobre divergência entre
  modelo e migration (`AGENTS.md` §5).
- **A imagem de produção**, se alguma fatia acrescentar `import` de biblioteca em
  `app/`. Cinco portões verdes e o app não sobe — aconteceu em 31/08 com o `httpx`.
- **O bootstrap**, na fatia B. Nenhum teste cria workspace do zero pelo caminho de
  produção; um seed que não acompanhe a migração de ADMIN só aparece no próximo
  workspace criado — que pode ser daqui a meses.
- **A remediação de cadastro** da 4.4. A trava barra escrita nova; o vínculo da
  Samantha continua lá até alguém apagá-lo à mão, e nenhum teste olha para
  produção.
