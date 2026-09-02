# Decisões — permissões, papéis e times como produto

**Isto não é a spec.** É o resultado da conversa de **02/09/2026**, aberta pelo
[`briefing.md`](briefing.md) desta mesma pasta. O briefing fez as perguntas;
este arquivo registra as respostas da Camila, o que elas implicam e o que ainda
falta.

⚠️ **O número 045 continua provisório.** Renumere quando a spec nascer.

⚠️ **Regra de leitura, herdada do briefing:** tudo aqui tem `arquivo:linha`.
**Confira antes de afirmar.** Este documento já corrigiu duas recomendações
minhas que estavam erradas (§10).

---

## 1. O modelo — duas pertenças, não uma

**O workspace É a organização.** Não nasce entidade acima das raízes.

O buraco estrutural que a conversa achou não são as N raízes: é que **hoje o
único lugar onde um papel pode existir é `user_team`**
([organization.py:155](../../app/db/models/organization.py)), ou seja, **todo
papel exige um time**. Um gestor da organização — alguém que administra todas as
áreas sem pertencer a nenhuma — não tem onde morar. Com uma raiz só dava para
fingir que a raiz *era* a organização; com N raízes a ficção não fecha (admin de
qual?).

Metade da solução já existe: `users` já é escopado ao workspace por FK
([organization.py:118](../../app/db/models/organization.py)) — a pessoa já
pertence à organização sem depender de time. **Falta o papel nesse nível.**

Então passam a existir duas pertenças:

| pertença | o que diz | onde mora |
|---|---|---|
| **organização** | quem administra a organização | papel sem `team_id` |
| **time** | o que a pessoa faz em cada time | `user_team`, como já é |

E a derivação de permissão vira **duas perguntas** em vez de uma: permissões de
organização (globais de verdade, porque o vínculo não tem time) e permissões
**por time** (lidas do vínculo, que já carrega o `team_id`).

---

## 2. ✅ A permissão passa a carregar o time

**Decidido em 02/09.** É a saída 2 da §3 do briefing, e a mais cara do conjunto.

`permissions_for_roles(roles: frozenset[str])`
([permissions.py:136](../../app/modules/auth/domain/permissions.py)) recebe só as
strings dos papéis e **descarta o time na porta**. O dado existe: o
`TenantContext` carrega `roles` (plano) **e** `memberships` (com `team_id`) lado a
lado ([tenant.py:83-88](../../app/core/tenant.py)), e a derivação usa o primeiro
([dependencies.py:107](../../app/modules/auth/api/dependencies.py)).

**Não é "criar escopo". É parar de descartar o escopo que já existe.** Nenhuma
migração de dado nesta parte — muda assinatura, em lote.

Por que é obrigatório e não preferência: uma pessoa pode ser MANAGER de **mais de
uma raiz** (§4). Um conjunto plano com `team.manage` dentro é **incapaz** de dizer
em quais árvores ela manda. Escopar porta a porta no serviço não é a versão
barata disso — é isto feito à mão, N vezes, sem ninguém garantindo que a enésima
foi feita.

⚠️ **Consequência da decisão:** o vínculo de comando concede sobre a
**subárvore**, não sobre o nó. Isso já é o que `visible_team_ids` calcula
([team_scope.py:90-92](../../app/modules/auth/domain/team_scope.py)) — as duas
funções passam a dizer a mesma coisa, que hoje elas não dizem.

---

## 3. Os papéis, e onde cada um pode existir

**Invariante de nível nova**, decidida em 02/09:

| nível | papéis |
|---|---|
| organização (sem time) | `ADMIN`, `GESTOR` |
| time raiz (área) | `MANAGER`, `OPERATOR` |
| subtime | `SUPERVISOR`, `OPERATOR` |

Cada papel tem **um** lugar — menos `OPERATOR`, o único que vive nos dois níveis
de time, e justamente o que não tem autoridade nenhuma.

Hoje a invariante é outra: `roles_permitidos_no_nivel(is_root=True)` devolve os
**quatro** ([team_scope.py:160](../../app/modules/auth/domain/team_scope.py)).
As mudanças são: `ADMIN` sai do nível de time (§7.2) e `SUPERVISOR` sai da raiz.

**A intenção de cada papel, em uma frase** (era a §8.2 do briefing, nunca escrita):

- **ADMIN** — define a organização. Renomeia, apaga área, promove gestor.
- **GESTOR** — opera a organização. Cria área, cadastra e desativa pessoas,
  distribui papéis de time. Não desfaz a organização.
- **MANAGER** — dono de uma árvore inteira. Pode ser dono de mais de uma.
- **SUPERVISOR** — dono de um braço operacional. Um subtime, o seu.
- **OPERATOR** — executa. Nada de estrutura.

A fronteira ADMIN/GESTOR: **gestor opera, admin define.** É a mesma assimetria
que já existe entre criar e apagar time, subida um nível.

⚠️ **Invariante nova que esse desenho exige: a organização nunca fica sem ADMIN.**
O último ADMIN precisa ser barrado de se rebaixar ou se remover. Hoje ninguém
pensou nisso porque ADMIN é vínculo na raiz.

---

## 4. Regras de vínculo

### 4.1 ✅ MANAGER pode ser de mais de uma raiz

Dois vínculos, dois escopos. O banco já aceita: `UNIQUE(user_id, team_id)`
([organization.py:172](../../app/db/models/organization.py)) — um papel **por
time**, quantos times quiser. É esta decisão que torna a §2 obrigatória.

### 4.2 ✅ Quem tem comando na raiz não tem vínculo de subtime

**Decidido em 02/09, e substitui uma proposta minha pior** (§10.2).

MANAGER na raiz **já significa** gerente de todos os subtimes. O vínculo de
subtime não acrescenta alcance nenhum e afirma algo falso no organograma ("está
em"). E não precisa acrescentar: a Spec 034 existe exatamente porque gestor e
admin **têm** de aparecer nos seletores de subtime sem vínculo lá — quem responde
"quem alcança" é o escopo, não a linha.

A trava é de **escrita**, com mensagem que explica em vez de só barrar:
*"Gestores já alcançam todos os subtimes desta área."*

Isso torna verdadeiro o nome de `_subtimes_supervisionados`
([member_service.py:900](../../app/modules/users/application/member_service.py)),
que hoje devolve a raiz quando o vínculo `SUPERVISOR` está lá.

### 4.3 ✅ A regra de 31/08 continua de pé

*"Ele não pode ter menos permissão no raiz do que tem no subtime"*, com
`OPERATOR < SUPERVISOR < MANAGER < ADMIN` e **"ausência não é menos"**. Ela e a
4.2 cuidam de direções opostas e não conflitam.

⚠️ **As duas precisam de um mapa de posto explícito.** `UserTeamRole` é `StrEnum`
e **não tem ordem** ([enums.py:21](../../app/db/models/enums.py)); a sequência em
que os quatro aparecem no arquivo é coincidência de leitura. Essa peça não
existe, e duas regras dependem dela.

### 4.4 ✅ A relação do subtime com a raiz vem da árvore, não de um vínculo

`SUPERVISOR`/`OPERATOR` de um subtime enxergam **o subtime + a raiz dele**
([team_scope.py:94-95](../../app/modules/auth/domain/team_scope.py)). A supervisora
do Live Marketing lê o quadro geral do Marketing e trabalha nele; autoridade lá,
não tem. **Lê a raiz, não manda nela.**

⚠️ Hoje ela também **edita** tarefa na raiz, porque `editable_team_ids` é
literalmente `visible_team_ids`
([team_scope.py:108](../../app/modules/auth/domain/team_scope.py)). **Decisão:
mantém** — o quadro geral é compartilhado e tirar isso quebraria o dia a dia de
quem está em subtime. Fica registrado como escolha consciente, porque com a §2 ela
deixa de cair de graça e passa a ser uma linha que alguém escreve.

---

## 5. O que cada papel faz

Legenda: ▸ = decisão de 02/09, não existe em código. O resto é o mapa de hoje,
conferido em [`permissions.py:53`](../../app/modules/auth/domain/permissions.py).

### Nível organização

| ação | ADMIN | GESTOR ▸ |
|---|:--:|:--:|
| renomear a organização | ✅ | — |
| ▸ criar área (time raiz) | ✅ | ✅ |
| apagar / esvaziar área | ✅ | — |
| ▸ promover ou rebaixar gestor | ✅ | — |
| cadastrar pessoa · desativar · resetar senha | ✅ | ✅ |
| ▸ dar papel de time em qualquer área | ✅ | ✅ |
| ver estrutura **e** trabalho de todas as áreas | ✅ | ✅ |

### Nível time

| ação | MANAGER<br>raiz | OPER.<br>raiz | SUPERV.<br>subtime | OPER.<br>subtime |
|---|:--:|:--:|:--:|:--:|
| criar / renomear subtime | ✅ | — | — | — |
| dar papel de time | ✅ árvore | — | — | — |
| ▸ administrar membros | ✅ árvore | — | ✅ só o próprio | — |
| triar solicitação | ✅ | — | — | — |
| desenhar formulário de entrada | ✅ | — | — | — |
| criar / apagar projeto | ✅ | — | — | — |
| editar projeto | ✅ | — | ✅ | — |
| criar / atualizar / designar tarefa | ✅ | ✅ | ✅ | ✅ |
| apagar tarefa | ✅ | — | — | — |
| montar quadro da raiz | ✅ | — | — | — |
| montar quadro de subtime | ✅ | — | ✅ só o próprio | — |

### Alcance

| papel | enxerga |
|---|---|
| ADMIN / GESTOR | tudo |
| MANAGER de uma área | a área **+ todos os descendentes** |
| SUPERVISOR ou OPERATOR de subtime | o subtime **+ a raiz** |
| OPERATOR da raiz | **só a raiz** |

⚠️ **Quem está só na raiz enxerga menos que quem está num subtime.** Entrar num
subtime **aumenta** o alcance. É contraintuitivo, foi conferido, e a Camila
decidiu em 02/09 **manter**: quem não é manager não enxerga os subtimes.

### ▸ A não-monotonicidade, resolvida

`member.manage.subteam` existe **só** no SUPERVISOR
([permissions.py:114](../../app/modules/auth/domain/permissions.py)) — MANAGER e
ADMIN **não a têm** no mapa, e passam pelo *early return* de `_tem_gestao_ampla`
([member_service.py:925](../../app/modules/users/application/member_service.py)).
O mapa diz uma coisa e uma linha de código diz outra.

**Decisão de 02/09: "manager e admin administram absolutamente tudo do time e sua
árvore inteira."** A permissão vai para o mapa, e o *early return* deixa de ser o
que sustenta a regra.

---

## 6. As telas

### `/organizacao`

Nome da organização (editável), os **gestores no cabeçalho** (papel de
organização, gente pouca, pertence junto do nome), grade de **cards de área** com
contagem (`12 pessoas · 3 subtimes`) e quem gere, botão de criar área, e **busca
por pessoa atravessando as áreas** — com N raízes, "onde está a Fulana?" não tem
outra resposta na tela.

⚠️ **Card "Pessoas sem área".** Sem ele, quem é cadastrado e nunca alocado não
aparece em lugar nenhum do produto — cards são áreas. Some sozinho quando vazio.

Clicar num card leva para a tela do time. **Sem sidebar** — a organização
administra áreas, e só.

### `/times/[id]`

Tabela de membros: nome, e-mail, status (ativo/inativo **na organização**), e as
cápsulas de subtime **com o cargo junto** (`SEO · supervisora`) — sem o cargo, a
coluna mostra onde e esconde o quê.

- **A tabela lista quem tem vínculo na área *ou em qualquer subtime dela*.**
  Alguém pode estar só no SEO, sem vínculo na raiz, e precisa aparecer.
- **O lápis** abre um seletor de subtimes, no padrão do popover de responsáveis
  ([TaskDetail.tsx:726-730](../../../web/components/TaskDetail.tsx)). Copiar de lá a
  regra "quem já está marcado nunca some da lista, mesmo inativo ou fora do
  escopo" — sem isso, salvar remove em silêncio um vínculo que você não via.
- **Novo subtime entra como `OPERATOR`.** Bom default por um motivo estrutural:
  operadora é o piso, então adicionar alguém **nunca** viola a regra da §4.3.
- ⚠️ **Desmarcar um subtime apaga o cargo.** Remarcar traz a pessoa de volta como
  operadora. Livre quando o cargo é operadora; **pede confirmação** quando não é.
- ⚠️ **Se ocultar inativos, o contador precisa dizer "12 de 15".** É a armadilha 5
  do briefing literal: em 27/07 esconder linha fez o cabeçalho divergir do corpo.
- ⚠️ **`remover da área` ≠ `desativar pessoa`** — são duas rotas
  ([users/api/router.py:252 e :297](../../app/modules/users/api/router.py)). Numa
  tela com o nome de *um time* no topo, "desativar" lê como "tirar deste time" e
  desliga a pessoa da organização inteira. Ambas vão para o menu `⋯`; na linha
  ficam só cargo e subtime.

### Painel do membro

Lista de vínculos com o cargo ao lado, em cápsula clicável — o padrão da pílula de
prioridade, que já aplica direto
([TaskDetail.tsx:1524](../../../web/components/TaskDetail.tsx), Spec 039/F6) sobre
o `Badge` compartilhado.

- **O papel de organização fica no topo, separado dos times** — ele não tem time.
- **Mostra TODOS os vínculos da pessoa; edita só os do seu escopo.** É a primeira
  aplicação concreta de "vê amplo, edita estreito": um MANAGER de Marketing vê que
  ela é operadora em TI e não mexe.
- ⚠️ **Cargo não aplica no clique como prioridade.** Prioridade erra e você
  desfaz; cargo erra e a pessoa ganha alcance no sistema inteiro, em silêncio.
  Mesma cápsula, com um passo que nomeia a consequência: *"Supervisora no SEO:
  administra os operadores do SEO e monta o quadro do SEO."*
- ⚠️ **Nada de toggle por permissão.** A quarta referência da Camila tinha
  `Create cards` / `Add beneficiaries` como chaves individuais — isso é RBAC
  editável entrando pela porta dos fundos, e §10.1 diz por que não. O que se
  **escolhe** é o cargo; o que se **mostra** é a consequência, em texto.
- ⚠️ **Quando o papel vem de cima, some o select.** Para quem tem comando na raiz,
  a linha do subtime não é cargo, é alocação — e por causa da invariante de nível
  ela **nunca** conseguirá repetir o papel da raiz. Mostra
  `alocada · autoridade de Marketing`, não `Operador`.

### Divisão de trabalho, sem sobreposição

**a tabela** mostra · **o lápis** define em *quais* subtimes · **o painel** define
*com que cargo* em cada um.

---

## 7. O que isso mexe no código

### 7.1 O que já existe e serve

- `GET /members/{id}/teams` já devolve `(team_id, role)` por vínculo desde a Spec
  015 ([users/api/router.py:102](../../app/modules/users/api/router.py)). É o
  endpoint do painel — o dado que parecia faltar não falta.
- `MemberResponse.team_ids` já é lista
  ([users/api/schemas.py:41](../../app/modules/users/api/schemas.py)), Spec 044
  fatias 1+2, em `main`.
- `Badge.tsx` já é a pílula compartilhada, com os eixos `soft` e `outline` — a
  distinção entre "subtime de verdade" e o fallback "só na área".

### 7.2 O que muda

⚠️ **`ADMIN` sai de `user_team`.** É a mudança mais cara do desenho inteiro e a
única que mexe em **quem consegue entrar no sistema**. Hoje `is_admin` lê os
vínculos ([team_scope.py:74](../../app/modules/auth/domain/team_scope.py)) e
`visible_team_ids` devolve `None` a partir disso. Vira papel de organização:
migração de dado, fatia sozinha, antes das raízes (§9).

- `permissions_for_roles` muda de assinatura, e com ela todo `require_permission`.
- Cai o índice `team_unica_raiz_por_workspace`
  ([organization.py:86](../../app/db/models/organization.py)). Ele encosta em pelo
  menos quatro lugares além do model — `team_seed_service`, `workspace_service`,
  `team_repository` e um comentário em `boards.py`.
- `roles_permitidos_no_nivel` muda nos dois níveis (§3).
- **Falta campo em `GET /members/{id}/teams`: "posso editar este vínculo?"** Hoje a
  rota exige só estar autenticado. O cadeado do painel **não pode** ser o front
  deduzindo pelo `team_id` — foi exatamente isso que a Spec 034 desfez. Vem do
  mesmo lugar que o PATCH usa.
- `esvaziar-e-remover` move o conteúdo *"para o time principal"*
  ([workspaces/api/router.py:222](../../app/modules/workspaces/api/router.py)). Com
  N raízes isso deixa de ser um endereço.

### 7.3 Dívida de documentação encontrada

O docstring de [`workspaces/api/router.py:18`](../../app/modules/workspaces/api/router.py)
diz que criar equipe exige `workspace.manage`. **Está desatualizado desde a Spec
029/D1** — o gate é `team.manage` (linha 112). É a classe do §10 do `AGENTS.md`:
texto que promete o que o código não faz.

---

## 8. Varreduras já rodadas no banco (02/09, Adminer)

| o que | resultado |
|---|---|
| `SUPERVISOR` em time raiz | **nenhum registro** — a invariante da §3 liga limpa |
| comando na raiz **com** vínculo de subtime | **1 registro**: Samantha Rasquinho, MANAGER de Marketing + SUPERVISOR de Live Marketing |

O caso da Samantha é o único do banco e é redundante em todos os eixos: alcance,
quadro de subtime e administração de membros já vêm do papel de gestora do
Marketing. Removível. Único efeito visível: **ela sai da lista de membros do Live
Marketing** — que é o comportamento correto pelo modelo novo.

⚠️ **Tarefa criada pela tela não é afetada**: o `createTask` já fixa o `team_id`
do quadro ([web/lib/api.ts:1294](../../../web/lib/api.ts)), espelhado em
`escopoTarefa.ts` como contrato. O `default_team_id` do usuário só entra como
**fallback**, quando nenhum `team_id` chega
([task_service.py:491](../../app/modules/tasks/application/task_service.py)) — ou
seja, fora da tela: n8n, Swagger, chamada direta. É a armadilha 6 do briefing em
estado puro, e é o que a **fatia 4 da Spec 044** resolve.

---

## 9. Ordem de execução

1. **Spec 044, fatia 3** — remove `_assert_one_subteam`
   ([member_service.py:340, 555, 823](../../app/modules/users/application/member_service.py)).
   Está na frente de tudo: **nenhuma tela nova funciona com a trava de pé**, e é a
   fatia que desbloqueia a redatora, parada desde agosto.
2. **`ADMIN` vira papel de organização.** Sozinha, com migração. ⚠️ **Antes das
   raízes**: enquanto ADMIN for uma linha na raiz, criar a segunda raiz deixa
   "admin de qual?" sem resposta — funcionaria, mas pelo motivo errado.
3. **Permissão com escopo** (§2). Mudança de assinatura, em lote.
4. **Cai o índice único.** É aqui que criar time raiz passa a existir de fato.
5. **Mapa de posto + a regra de 31/08** (fatia 5 da 044).

As telas entram depois da 1 e podem andar em paralelo a partir da 3.

---

## 10. Alternativas recusadas — e por quê

Registradas para ninguém repropor.

**10.1 RBAC editável em tabela.** O que dói hoje não é a falta de tabela, é a
falta de intenção declarada — a prova é a não-monotonicidade da §5, que ninguém
decidiu, foi acumulada. Uma tabela move a incoerência do código (onde um teste
pega) para dado de produção (onde nada pega), e traz junto uma tela em que alguém
se tranca para fora. RBAC editável se paga quando **o cliente** precisa inventar
cargos; aqui a dona do produto faz deploy. E a §2 é o que torna a tabela barata
**depois**: com a permissão nascendo do vínculo, trocar mapa estático por consulta
ao banco é substituir uma função — o que o próprio
[`permissions.py:13-16`](../../app/modules/auth/domain/permissions.py) já promete.

**10.2 "Herança: o papel de baixo só soma, nunca subtrai."** Proposta minha, em
02/09, derivada do cadastro da Camila (ADMIN em Marketing + OPERATOR no CRM). Ela
apontou que aquele registro era artefato de ela ser a dev do projeto, não caso de
produto. A regra da §4.2 é melhor: torna a divergência **não representável**, em
vez de resolvê-la em tempo de execução — e dispensa a herança inteira.

**10.3 "Um papel só por árvore."** Não fecha: supervisora do SEO e não do Mídias
é diferença legítima entre subtimes, decidida vínculo a vínculo
([member_service.py:900](../../app/modules/users/application/member_service.py)).
Se o papel morar só na raiz, isso deixa de ser dizível.

**10.4 Nivelar por baixo** (ser operadora no Marketing por ser operadora no CRM).
Descartada pela Camila na hora: o remédio fica pior que a doença.

**10.5 Manter o conjunto plano e escopar porta a porta.** Recomendação minha,
rejeitada. É a mesma decisão da §2 tomada N vezes à mão, e cada porta nova pode
esquecer em silêncio.

**10.6 "Arrastar junto" o papel da raiz ao promover no subtime.** A regra da
Spec 044 fatia 5 (o papel na raiz não pode ser menor) podia ser cumprida
**subindo** o papel da raiz na mesma operação, em vez de recusar. Descartada
pela Camila em 02/09: **barrar**, porque esta spec resolve o atrito por
construção — com `SUPERVISOR` fora da raiz (§3), supervisor de subtime não tem
papel no time geral e a escolha deixa de existir. ⚠️ Até a fatia D entrar,
promover um operador do time geral a supervisor de subtime devolve 409.

**10.7 Copiar o modelo da AWS/IAM.** O eixo está certo — *toda permissão tem um
alvo* — e é exatamente o que a §2 adota. O maquinário não: documentos de política,
`deny` explícito vencendo `allow`, ordem de avaliação, tela de edição de política.
IAM resolve "milhões de recursos, ninguém se conhece". Aqui são algumas áreas e
dezenas de pessoas.

---

## 11. O que continua aberto

1. **Área fechada.** Se um dia existir área cujo trabalho não deva ser legível
   pela liderança (RH, financeiro, cliente com sigilo), a resposta **não é** mudar
   o papel do gestor — é a **área** se declarar fechada, propriedade do time, como
   o Trello faz com quadro privado. Hoje não há caso, e nada do desenho atual
   atrapalha isso depois. **Premissa em vigor: gestor vê tudo.**
   ⚠️ E "vê só a estrutura" seria ficção enquanto o GESTOR puder se dar vínculo em
   qualquer área — só existiria de verdade na forma "vê quando precisa, e fica
   registrado".
2. **A conta separada da Camila.** Dona-que-também-é-empregada: conta de
   administração distinta da conta de operadora no CRM. É o primeiro habitante real
   do papel de organização — ADMIN sem time nenhum. ⚠️ **Confira se é a única conta
   ADMIN antes de mexer**; rebaixar primeiro tranca todo mundo para fora. Ordem:
   cria a nova, confirma que entra, depois ajusta.
3. **Cargos nomeados.** Decidido: catálogo como **documento** agora (§3 e §5 deste
   arquivo são ele), código fixo, tabela na prateleira. Reabre quando existir uma
   segunda pessoa pedindo um cargo que não existe.
4. **Onde o conteúdo de `esvaziar-e-remover` vai parar**, com N raízes (§7.2).
