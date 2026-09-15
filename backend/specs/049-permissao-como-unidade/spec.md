# Spec 049 — Permissão como unidade, papel como pacote

**Status:** escrita em 14/09/2026, a partir do documento de 10/09
(`~/Documents/gestor-de-tarefas-permissoes.html`) e da matriz CRUD do artefato
"Mapa do Gestor de Tarefas". **Fatias 0 e 0b entregues em 14/09.** As quatro perguntas
da §8 foram respondidas em 14/09 — a spec entrega o corte **e** o alvo (fatias
0 a H). Resta um detalhe de teto na fatia H, com recomendação.
**Escopo:** backend (mapa de permissões, escopo de comando, portões de rota e
de serviço) e os portões de **tela** que leem permissão. Nenhuma tela nova.
**Depende de:** **Spec 048** mergeada (#53). A fatia 0 registra o
comportamento **com** a 048 — os recortes por time e a lente da ADR 0007 nos
projetos entraram nela.
**Placar na abertura:** backend **1133**, front **1353**, `tsc --noEmit` limpo,
`next build` ok, `ruff` 49 — medido em 14/09 no branch `spec-048`.

---

## 1. O que ela pediu, e o que aconteceu no caminho

O pedido que abriu o assunto, em 10/09:

> *"E se a gente criar bonitinho as permissões bem separadas pra, quem sabe,
> fazer um seletor de permissões por pessoa (…) MAS NÃO QUERO TELA NEM NADA
> AGORA, é só uma ideia para deixar BEM estruturado."*

E a regra que gera a matriz inteira, na mesma conversa:

> *"A principal diferença entre gestor e admin é que admin pode deletar e
> gestor não (tirando pessoas, que gestor pode desativar)."*

⚠️⚠️ **O documento de 10/09 achou que isso não é preparo — é pré-requisito.**
*"Gestor cria e edita mas não apaga"* é **inexprimível** com as permissões de
hoje: `team.manage`, `board.manage.root` e `board.manage.subteam` empacotam
criar, editar e apagar num nome só. Quem recebe o pacote recebe o delete.

⚠️ **E em 14/09 o assunto mudou de peso.** Testando a 048 como admin da
organização, com o Comercial ativo, ela escreveu:

> *"Tem muitas coisas básicas de permissão e caminhos de criação que deveriam
> estar funcionando que de repente pararam. É possível fazer uma geral no CRUD
> dos produtos?"*

A geral achou que **o backend estava certo** e as quebras eram de **tela** (o
lápis e o renomear do quadro geral sumidos numa rota que não passava a
permissão). Mas mostrou a falta que motiva a fatia 0 desta spec: **não existe
teste que diga, para cada ação e cada papel, se ela é permitida.** Os testes de
hoje cobrem o *mapa* e o *escopo*; nenhum cobre a *matriz*. E ela decidiu onde
esse teste mora:

> *"Essa parte de testes não entraria junto com a spec da reestruturação das
> permissões que fizemos?"*

---

## 2. O que existe — medido em 14/09, abrindo os arquivos

### 2.1. O mapa: 15 permissões, 4 papéis de time, 2 de organização

`backend/app/modules/auth/domain/permissions.py`, `_ROLE_PERMISSIONS`.
⚠️ O documento de 10/09 dizia "catorze" — `area.create` entrou depois (Spec
046). **São 15**, contadas no arquivo:

| permissão | ADMIN | MANAGER | SUPERVISOR | OPERATOR |
|---|:-:|:-:|:-:|:-:|
| `workspace.manage` | ✓ | · | · | · |
| `area.create` | ✓ | · | · | · |
| `team.manage` | ✓ | ✓ | · | · |
| `member.manage.subteam` | ✓ | ✓ | ✓ | · |
| `solicitation.review` | ✓ | ✓ | · | · |
| `solicitation_form.manage` | ✓ | ✓ | · | · |
| `project.create` | ✓ | ✓ | · | · |
| `project.update` | ✓ | ✓ | ✓ | · |
| `project.delete` | ✓ | ✓ | · | · |
| `task.create` | ✓ | ✓ | ✓ | ✓ |
| `task.update` | ✓ | ✓ | ✓ | ✓ |
| `task.delete` | ✓ | ✓ | · | · |
| `task.assign` | ✓ | ✓ | ✓ | ✓ |
| `board.manage.root` | ✓ | ✓ | · | · |
| `board.manage.subteam` | ✓ | ✓ | ✓ | · |

Papel de **organização** (`_ORG_ROLE_PERMISSIONS`):

    ADMIN  = _ROLE_PERMISSIONS[ADMIN]
    GESTOR = _ROLE_PERMISSIONS[ADMIN] - {"workspace.manage"}

⚠️⚠️ **O GESTOR É UMA SUBTRAÇÃO.** Toda permissão nova escrita no ADMIN chega
ao GESTOR sem ninguém decidir. É assim que ele herdou todos os deletes — e é o
item 01 da matriz.

### 2.2. O escopo: duas parcelas, e uma lente que tem nome

`ActorPermissions` (mesmo arquivo) separa:

- `unscoped` — do papel de organização, vale em todo lugar;
- `by_team` — de cada vínculo: comando (`ADMIN`/`MANAGER`) alcança o time **e os
  descendentes**; execução (`SUPERVISOR`/`OPERATOR`) alcança o time **e a
  raiz** — exceto `_OWN_TEAM_ONLY` (`member.manage.subteam`,
  `board.manage.subteam`), que fica só no time do vínculo.

✅ **Conferido em 14/09:** `can_in` responde `True` pela parcela `unscoped`, e
`__contains__` também — o admin de organização **sem vínculo** passa nas travas
de serviço. Era a suspeita mais cara da geral, e não se confirmou.

A **lente de trabalho** tem nome: `team_scope.visible_team_ids` (e
`editable_team_ids`, que a reusa). O **escopo de comando** não tem — ver §3.2.

### 2.3. Onde a permissão é cobrada

⚠️⚠️ **Olhar só a rota diria que quadro, coluna e vínculo estão abertos.** O
documento de 10/09 avisou, e a medição confirma: parte da autorização mora no
serviço.

**Na rota** (`require_permission`): `workspaces` (`workspace.manage`,
`team.manage`), `users` (`team.manage`, `workspace.manage`), `projects`
(`project.*`), `tasks` (`task.create/update/delete`), `collaboration`
(`task.assign`), `solicitations` (`solicitation.review`),
`form_router` (`solicitation_form.manage`, no router inteiro).

**No serviço** (conferido linha a linha):

| onde | o que cobra |
|---|---|
| `workspace_service.py:250` | `area.create` — a mesma rota cria time e subtime; distingue pelo `parent_team_id` |
| `board_service.py` · `_assert_pode_gerir` | `board.manage.root` em time raiz; `board.manage.subteam` **mais** ser supervisor daquele subtime |
| `member_service.py` · `_tem_gestao_ampla` | `team.manage`, com `has_permission_in` quando o alvo é conhecido |
| `member_service.py` · `_assert_escopo_supervisor` | supervisor só mexe em OPERATOR do **próprio** subtime |
| `form_service.py` · `_assert_pode_gerir` | o time do formulário em `editable_team_ids` |

⚠️ **Duas funções diferentes se chamam `_assert_pode_gerir`** (quadro e
formulário). O documento de 10/09 falava em "três funções"; são quatro pontos.

### 2.4. Onde a TELA lê permissão

A tela lê a projeção achatada de `/auth/me` (`all_permissions`) — **"o que",
nunca "onde"**. Os pontos, medidos:

- `lib/permissoesMembros.ts` · `alcanceDe` — `team.manage` ⇒ amplo;
  `member.manage.subteam` ⇒ subtimes onde é SUPERVISOR
- `lib/seletorDeQuadro.ts` · `alcanceDeQuadro` — `board.manage.root` ⇒ amplo;
  `board.manage.subteam` ⇒ subtimes
- `lib/gestaoTimes.ts` — `team.manage`, `workspace.manage`
- `components/AppShell.tsx` — `solicitation.review`, `team.manage`,
  `solicitation_form.manage`
- `components/TaskDetail.tsx` — `task.delete` (apagar e moderar comentário),
  `task.create`
- `components/TeamScreen.tsx`, `app/organizacao/page.tsx` — `workspace.manage`,
  `area.create`
- `app/projetos/page.tsx`, `app/projetos/[id]/page.tsx` — `project.*`
- `app/formularios/page.tsx` — `solicitation_form.manage`
- `app/times/page.tsx` — `team.manage`

⚠️⚠️ **Cada um destes é uma STRING.** Renomear uma permissão no backend e
esquecer uma delas não dá erro: **o botão some**. É exatamente a classe do
defeito de 14/09.

A raiz do problema tem endereço: `web/lib/api.ts:258` tipa
`permissions: string[]`, e `permissoesMembros.ts:30` e `seletorDeQuadro.ts:45`
repetem o `string[]`. Com `string`, `.includes("qualquer.coisa")` compila.

### 2.5. Os testes que já existem

- `test_permissoes_com_escopo.py` (9) — o escopo com **duas raízes** em memória
- `test_team_role_levels.py` (19) — papel por nível
- `test_team_scope.py` (13) — a lente
- `test_comando_sem_subtime.py` (10) — comando não acumula subtime
- `test_solicitations_permissions.py` (5) — quem tria
- integração: `test_papel_de_organizacao_db`, `test_admin_de_org_edita_papel_db`,
  `test_task_team_alcance_http_db`, `test_projects_lente_http_db`,
  `test_perda_de_alcance_db`, `test_remocao_por_perda_de_alcance_db`

**Todos provam PEDAÇOS da regra. Nenhum prova a matriz.**

---

## 3. ⚠️⚠️ Os defeitos que esta spec existe para impedir

### 3.1. A regra de 10/09 não cabe no mapa

Com os pacotes de hoje não há como dar ao GESTOR "cria e edita" sem "apaga".
Qualquer tentativa sem cortar os verbos vira uma checagem avulsa no ponto de
apagar — uma quinta regra espalhada, que diverge das outras quatro.

### 3.2. O escopo de comando existe, espalhado, sem nome

A **lente de trabalho** (onde eu trabalho: subtime **+ raiz**) tem nome. O
**escopo de comando** (onde eu mando: **só** o meu subtime) mora em quatro
pontos do §2.3. As duas coincidem para MANAGER e **divergem para SUPERVISOR** —
e é essa divergência que impede tirar o nível do nome das permissões hoje.

### 3.3. ⚠️⚠️ A armadilha do `.root`

O princípio *"o mapa diz o quê; o escopo diz onde"* sugere trocar
`board.manage.root` e `board.manage.subteam` por um `board.update` só. **Isso
abriria um furo:** a lente de trabalho **inclui a raiz** para o supervisor, de
propósito (é onde ele trabalha). Se a checagem virasse *"este time está no meu
escopo?"* pela lente de trabalho, **o supervisor editaria o quadro geral**. O
`.root` no nome é o que impede. Ele só pode sair **depois** do §3.2.

### 3.4. A tela deduz permissão de um pacote

`alcanceDe` diz "amplo" porque vê `team.manage`. Quando `team.manage` virar
seis verbos, essa linha passa a olhar para uma string que não existe mais, e
responde "nenhum" — **sem erro**. O mesmo em `alcanceDeQuadro`, no `AppShell` e
em cada ponto do §2.4.

### 3.5. Não há guardião da matriz

Pedaços têm teste; o todo não. Uma mudança larga — muitos arquivos, risco
baixo por arquivo — é exatamente o perfil em que algo para de funcionar num
canto que ninguém olhou. Foi o que aconteceu em 14/09, por outro caminho.

### 3.6. ⚠️⚠️ O que a fatia 0 achou na primeira rodada — e não estava nesta spec

A tabela rodou com as minhas previsões lidas do código: **38 de 290 não
bateram**. Três eram montagem do teste (regra de cargo da raiz; publicar
formulário sem perguntas). As outras são **três defeitos contra decisões JÁ
tomadas antes desta spec** — e nenhum aparece no §2, que eu escrevi lendo os
mesmos arquivos. É o argumento da fatia 0 provado no primeiro dia.

1. **O GESTOR de organização não enxerga nada.** `team_scope.is_admin` só
   conta `org_role == "ADMIN"`; o GESTOR não tem vínculo, então a lente dele é
   vazia. Pela rota: toda ação de tarefa e comentário devolve 404 (criar, 422
   "time fora do seu alcance"), formulário 403, solicitação 404. Quadro, time,
   pessoa e projeto passam — porque esses **não** olham a lente (item 3).
   Contra: `045/decisoes.md`, tabela da lente — *"ADMIN / GESTOR | tudo"* — e
   *"Premissa em vigor: gestor vê tudo."*
   ⚠️ **E um teste protegia o defeito:** `test_papel_de_organizacao_db::
   test_gestor_nao_ve_tudo` esperava a lente vazia, e dizia que ver tudo
   *"é decisão de produto e entra aqui de propósito"*. A decisão já existia.
   Foi a única falha da suíte com a 0b, e o teste virou
   `test_gestor_ve_tudo_sem_ser_admin`, citando a decisão.
2. **O MANAGER do Marketing mexe no Comercial.** Cria e renomeia subtime,
   cadastra pessoa, reseta senha, desativa conta, cria e renomeia o quadro geral,
   apaga quadro, cria coluna. A trava pergunta `has_permission` ("em algum
   lugar"), e não `has_permission_in` ("neste time") — `board_service.py:1676`
   escreve a premissa: *"ADMIN e MANAGER só existem na raiz e respondem pela
   árvore inteira"*, verdade com **uma** raiz. Contra: a decisão dela de
   09/09, *"gerente só mexe na própria árvore"* — aplicada até hoje só na
   troca de cargo.
   ⚠️ E o vínculo só está certo por acidente: a sabotagem B mostrou que o
   MANAGER é barrado no Comercial **pela trava do supervisor**.
3. **Projeto se edita fora da lente.** `ProjectService.update`, `archive` e
   `soft_delete` buscam por id sem a lente (só o `get` a tem, desde 11/09), e
   `create` só confere que o time existe no workspace. **O SUPERVISOR do SEO
   editou um projeto do Comercial (200).** Contra: ADR 0007.

✅ **Os três foram consertados na fatia 0b** (§5), no mesmo dia — decisão dela:
*"aceito a fatia nova"*. Nenhuma linha da tabela carrega `defeito` hoje.

⚠️ **Contexto que tira a urgência, e não a necessidade** (ela, 14/09): *papel
de organização só existe no dev dela*, e **nada da 047 nem da 048 foi para
produção** — as três specs sobem juntas, depois de ela testar permissão e troca
de time. Nenhum destes defeitos chegou a um usuário.

---

## 4. As decisões

### 4.1. A unidade é a permissão; o papel é um pacote com nome

    concessão = (papel, permissão, escopo)

Permissão é `<componente>.<verbo>`. O papel continua sendo **a única fonte de
concessão** — um pacote nomeado, como `_ROLE_PERMISSIONS` já é.

⚠️ **O "por pessoa" fica fora, com as palavras dela:** *"NÃO QUERO TELA NEM
NADA AGORA"*. O ganho da estrutura é real sem tabela por pessoa: com os verbos
cortados, o alvo de 10/09 passa a ser **expressável**.

### 4.2. O corte

O padrão `<componente>.<verbo>`, com o nível ainda no nome onde o §3.3 exige.

| hoje | alvo |
|---|---|
| `workspace.manage` | `organization.update` · `organization.delete` · `org_role.grant` · `org_role.revoke` |
| `area.create` | `team.create` |
| `team.manage` | `team.update` · `team.delete` · `subteam.create` · `subteam.update` · `subteam.delete` · `person.create` · `person.update` · `person.deactivate` |
| `member.manage.subteam` | `membership.create` · `membership.update` · `membership.delete` |
| `board.manage.root` | `board.create.root` · `board.update.root` · `board.delete.root` |
| `board.manage.subteam` | `board.create` · `board.update` · `board.delete` |
| — (herda do quadro) | `column.create` · `column.update` · `column.delete` |
| `task.*` | `task.create` · `task.update` · `task.delete` · `task.archive` · `task.assign` |
| `project.*` | `project.create` · `project.update` · `project.delete` · `project.archive` |
| `solicitation_form.manage` | `form.create` · `form.update` · `form.delete` · `form.publish` |
| `solicitation.review` | `solicitation.read` · `solicitation.review` |

⚠️ **Nomes em inglês** (código novo), prosa em português. Os endpoints não
mudam — é contrato; muda a permissão que cada um cobra.

#### 4.2-bis. ⚠️⚠️ O corte de verdade, rota a rota (escrito na fatia A, 14/09)

A tabela de cima corta **por nome**. Implementar por ela mudaria comportamento,
porque os pacotes de hoje não protegem o que o nome diz: `workspace.manage` é
também o portão de **apagar, mover e esvaziar time**. A regra do corte é outra:
**cada rota cobra o verbo da ação que executa, e cada verbo é concedido
exatamente a quem tinha o pacote que protegia aquela rota.**

| pacote de hoje (quem tem) | verbos | onde é cobrado |
|---|---|---|
| `workspace.manage` (ADMIN) | `organization.update` | `PATCH /workspaces/current` |
| | `org_role.grant` · `org_role.revoke` | `PATCH /members/{id}/organization-role` — a rota aceita qualquer um dos dois; **o serviço ainda não distingue** (ver nota abaixo) |
| | `subteam.delete` | `DELETE /teams/{id}`, `GET …/previa-remocao`, `POST …/esvaziar-e-remover` |
| | `team.move` | `POST /teams/{id}/move` |
| `area.create` (ADMIN, GESTOR) | `team.create` | `TeamService.create` sem pai; rota `POST /teams` cobra `team.create` **ou** `subteam.create` |
| `team.manage` (ADMIN, GESTOR, MANAGER) | `subteam.create` · `subteam.update` | `TeamService.create` com pai · `PATCH /teams/{id}` |
| | `person.create` · `person.update` · `person.deactivate` | `POST /members` · `…/reset-password` · `…/deactivate` (+ `_assert_reaches_person`) |
| | `membership.update` · `membership.move` | `PATCH /members/{id}/teams/{t}` · `…/move-subteam` |
| `member.manage.subteam` (+ SUPERVISOR, só no próprio time) | `membership.create` · `membership.delete` | `POST …/team` · `DELETE …/teams/{t}` |
| `board.manage.root` (ADMIN, GESTOR, MANAGER) | `board.create.root` · `board.update.root` · `board.delete.root` | `_assert_pode_gerir` num time raiz |
| `board.manage.subteam` (+ SUPERVISOR, só no próprio time) | `board.create` · `board.update` · `board.delete` | `_assert_pode_gerir` num subtime |
| (herdado dos dois) | `column.create` · `column.update` · `column.delete` | criar · renomear, reordenar, alvo, aviso de prazo · apagar; o lote cobra os três |
| `solicitation.review` | `solicitation.read` · `solicitation.review` | os dois `GET` · triar, andamento, tarefa |
| `solicitation_form.manage` | `form.read` · `form.create` · `form.update` · `form.publish` · `form.delete` | listar/abrir · criar · editar, seções, perguntas · publicar · apagar |
| `project.update` · `task.update` | + `project.archive` · `task.archive` | arquivar **e** desarquivar |

⚠️ **O que NÃO entra, pela regra do `person.reactivate`** (permissão para ação
que não existe): `organization.delete`, e `team.update`/`team.delete` de time
**raiz** — renomear e apagar raiz são recusados pela regra (§6, item 04).

⚠️⚠️ **Coluna do quadro GERAL cobra `board.update.root`, e não `column.*` —
corrigido durante a fatia.** A primeira versão cobrava `column.*` também na
raiz, contando com `_OWN_TEAM_ONLY` para prender o supervisor ao próprio
subtime. **Com permissão com escopo isso vale; sem escopo, não.** O contexto
legado (`frozenset` — jobs e testes antigos) faz `has_permission_in` responder
a pergunta ampla de propósito, e o supervisor, que tem `column.create` em
algum lugar, criou coluna no Quadro geral: `test_board_coluna_http_db` pegou,
com a tabela da fatia 0 verde. Pela rota real nada mudava — mas a trava não
pode depender do escopo para dizer não. ⚠️ **E é por isso mesmo que o `.root`
de `board.*` fica** (§3.3): o argumento "o escopo já protege" tem a mesma
fraqueza enquanto existir contexto sem escopo.

⚠️ **`org_role.grant` e `.revoke` só se distinguem na rota.** A primeira versão
os separava também no serviço (`revoke` se `role` é nulo) e derrubou 5 testes
que chamam o serviço direto — mudança de comportamento, e para nada: os dois
estão nos mesmos papéis. A distinção nasce na fatia G, com o teto do GESTOR.

⚠️ **O router de formulários mantém um portão geral** (qualquer `form.*`) além
do verbo de cada rota. Sem ele, uma rota nova esquecida nasceria aberta — o
router inteiro era fechado por uma linha só.

⚠️ **Travas de serviço que perguntavam `team.manage` passam a receber o verbo
do chamador.** A que decide "é gestão ampla, e não supervisor?"
(`_assert_escopo_supervisor`) pergunta `membership.update`, que só papel de
comando tem — nome torto para a pergunta, e é exatamente o que a fatia B
existe para nomear (`command_team_ids`).

⚠️ `person.reactivate` **não entra**: é permissão para uma ação que não existe.
Nasce com ela (§6).

⚠️ **`task.archive` e `project.archive` entram no corte — decisão dela, 14/09.**
Hoje `POST /tasks/{id}/archive` e `/unarchive` cobram `task.update`
(`tasks_router.py:381,399`), e os de projeto cobram `project.update`
(`projects_router.py:176,190`). No corte, **arquivar e desarquivar** passam a
cobrar o verbo próprio, concedido a exatamente quem hoje tem o `update` — os
quatro papéis na tarefa; ADMIN, MANAGER e SUPERVISOR no projeto. Nada muda na
tela; o que muda é que "edita mas não arquiva" passa a ser uma linha no pacote.

### 4.3. O escopo de comando ganha nome

Uma função em `team_scope`, ao lado de `visible_team_ids`:

    command_team_ids(memberships, tree, org_role) -> frozenset | None
        papel de organização    -> None (tudo)
        MANAGER de T            -> T + descendentes
        SUPERVISOR de X         -> X, e só X
        OPERATOR                -> vazio

Os quatro pontos do §2.3 passam a perguntar a ela. **Só depois disso** os
sufixos `.subteam` podem sair dos nomes — e o `.root` é revisto então, não
antes (§3.3).

#### 4.3-bis. ⚠️⚠️ Revisto na fatia B (14/09): a função já existia, e com outro nome

**`command_team_ids` NÃO foi criada.** Esta seção foi escrita lendo os quatro
pontos do §2.3 e não o que a Spec 045 (fatia C) já tinha construído embaixo
deles: `permissions_for_actor` concede **cada verbo com o seu escopo** — o
papel de comando na árvore, o de execução no time e na raiz, e os verbos de
`_OWN_TEAM_ONLY` só no time do vínculo. "Onde eu mando" **é**
`has_permission_in(verbo, time)`, por verbo, que é mais fino que um conjunto
por papel. Uma `command_team_ids` ao lado seria **uma segunda fonte para a
mesma resposta** — a doença que esta spec existe para curar.

O que estava espalhado era outra coisa, e foi isso que a fatia B recolheu:

| onde | o que fazia | virou |
|---|---|---|
| `MemberService._subtimes_supervisionados` | recalculava "onde sou supervisor" dos vínculos | **saiu** |
| `BoardService._subtimes_supervisionados` | cópia idêntica ("deliberada") | **saiu** |
| `_assert_escopo_supervisor` | "é comando? então não é comigo" + teto antes do onde | `_assert_escopo_de_membro`: **onde** (o verbo neste time) para todo papel, depois **teto** (quem não troca cargo só mexe em OPERATOR) |
| `BoardService._assert_pode_gerir`, subtime | três perguntas (verbo, atalho de comando, subtime à mão) | **uma**: o verbo neste subtime |
| `FormService._assert_pode_gerir` | a lente de TRABALHO (`editable_team_ids`) | o verbo neste time |

⚠️⚠️ **O obstáculo real para tirar o `.root` não é um nome que falta — é o
contexto sem escopo.** Com `frozenset` (jobs e testes antigos),
`has_permission_in` responde a pergunta ampla, de propósito. A fatia A tropeçou
nisso (coluna do quadro geral) e a fatia B também: **quatro testes HTTP e o
arquivo de escopo do supervisor só distinguiam "subtime alheio" porque a
trava recalculava o subtime à mão.** Eles passaram a montar o contexto como a
requisição monta. Enquanto houver chamador de serviço com `frozenset`, o
`.root` é o que diz não sem depender do escopo — **ele fica**. Tirar o fail-open
é o pré-requisito, e é trabalho próprio (§6).

### 4.4. O GESTOR deixa de ser subtração

`GESTOR = ADMIN - {…}` vira **lista explícita**. Com os verbos cortados, a
subtração faria todo verbo novo de delete chegar ao GESTOR sem decisão — o mesmo
defeito de hoje, em escala maior.

### 4.5. Duas coisas que NÃO viram permissão

- **Teto por papel.** *"O gestor concede até gestor"* é um limite sobre o
  **valor** que a ação aceita, e mora no serviço.
- **Autoria.** *"Só o autor edita o próprio comentário"* vale até para o admin.
  É regra sobre a linha.

### 4.6. A bateria de testes é a fatia 0 — decisão dela, 14/09

A matriz vira **teste antes de qualquer mudança**, e cada fatia seguinte muda
linhas da tabela junto com o código. Ver §5.

### 4.7. O supervisor troca cargo no próprio subtime — decisão dela, 14/09

⚠️⚠️ **Isto DESFAZ uma decisão escrita**, e não preenche um vazio. A Spec 028
(D2) fechou o contrário: *"supervisor não promove; criar outro SUPERVISOR é
trabalho do MANAGER"*. Está no código (`member_service.py:989` e
`_assert_escopo_supervisor`, que recusa alvo que não seja OPERATOR) e em três
testes que existem para provar a recusa:

- `test_cadeado_do_vinculo_db.py::test_supervisor_NAO_troca_papel_de_ninguem`
- `test_supervisor_member_scope_db.py::test_supervisor_nao_troca_papel`
- `test_supervisor_member_scope_db.py` (linha 150, *"D2: supervisor não cria
  par"*)

⚠️ **Num subtime só cabem SUPERVISOR e OPERATOR** (`team_scope._SUBTEAM_ROLES`).
Então "trocar cargo" ali é, sempre, **promover a supervisor ou rebaixar a
operador** — não há terceira opção. A resposta dela é a regra; o que falta
decidir é **em quem**:

- **promover** um OPERATOR do próprio subtime a SUPERVISOR — sim, é o pedido;
- **rebaixar outro SUPERVISOR** do mesmo subtime — ⚠️ *em aberto.* Com dois
  supervisores, cada um poderia rebaixar o outro, e o último a clicar fica
  sozinho no posto. **Recomendação:** não — rebaixar um par continua sendo do
  MANAGER. É o mesmo desenho do teto do §4.5 (*"o gestor concede até gestor"*):
  o limite é sobre o **alvo**, e mora no serviço.

  ⚠️ **Consequência da recomendação, dita inteira:** como o único cargo acima
  de operador num subtime é supervisor, "não mexe em par" faz a troca do
  supervisor ser, na prática, **só promover**. Se ela quiser que ele também
  rebaixe, a regra passa a ser "rebaixa par", com o risco acima. É a única
  pergunta que sobra, e ela só trava a fatia H.

E, junto, sem decisão nova: **ninguém troca o próprio cargo** (C3) continua
valendo, e o **cadeado** da Spec 047 (fatia A, `GET /members/{id}/teams`) tem de
abrir na mesma linha em que o PATCH abre — é a mesma função, e é o que ela
existe para garantir.

### 4.8. Os nomes das permissões viram um tipo no front — decisão dela, 14/09

Ela aceitou *"se é o correto e coerente"*. **É**, pelo motivo do §2.4: o
defeito que a fatia A mais provavelmente produz (string esquecida, botão
sumido) é invisível aos quatro portões, e fechar o tipo o torna um erro de
`tsc`. O desenho, escolhido para caber no CI que existe:

- **Um arquivo gerado e commitado:** `web/lib/permissions.generated.ts`, com
  `export const PERMISSIONS = [...] as const` e
  `export type Permission = (typeof PERMISSIONS)[number]`. Sai de um script do
  backend que lê o mapa (`backend/scripts/`).
- **`permissions: Permission[]`** em `api.ts:258` e nos dois `string[]` do §2.4.
  Com isso, `me.permissions.includes("team.manage")` **deixa de compilar** no
  dia em que `team.manage` sair do mapa.
- ⚠️ **O guardião do arquivo é um teste do BACKEND**, e não um passo novo no CI:
  o job `backend` faz checkout do repositório inteiro, então um pytest compara o
  conteúdo que o script geraria com o arquivo commitado. Mapa mudado e arquivo
  velho = pytest vermelho, com a instrução de regenerar na mensagem.
- ⚠️ **O que ele não pega:** permissão que continua existindo, mas é a errada
  para aquele botão. Isso segue sendo a tabela da fatia 0 e a tela.

Por que não gerar no build: o job `front` não tem Python, e o `next build` dela
em dev passaria a depender do backend. Commitado, o front continua se bastando.

### 4.9. A conta de uma pessoa é de todas as árvores dela — confirmado por ela, 14/09

Resetar senha e desativar valem para a **pessoa inteira**, e não para um
vínculo. Na fatia 0b a pergunta passou a ser (`_assert_reaches_person`):

| quem age | alcança a conta? |
|---|---|
| papel de organização | sempre |
| MANAGER, e **todos** os vínculos da pessoa estão na árvore dele | sim |
| MANAGER, e **algum** vínculo está em outra árvore | **não** — só a organização |
| MANAGER, e a pessoa não tem vínculo de time | **não** — só a organização |

⚠️ **"Todos", e não "algum", foi escolha minha, e está aqui para ela confirmar**
(pergunta 7 da §8). Com "algum", o MANAGER do Marketing desativaria a conta de
quem também trabalha no Comercial, e o Comercial descobriria pela ausência. É a
leitura estrita de *"gerente só mexe na própria árvore"*. A tabela tem a linha:
`person.deactivate [alguem do Marketing E do Comercial]`.

⚠️ Resetar a **própria** senha não passa pela pergunta — já era permitido, e
não depende de árvore.

---

## 5. As fatias

Cada uma fica verde sozinha. A ordem das três primeiras não é negociável.

**Fatia 0 — a matriz de hoje, em teste (backend).** ✅ **Entregue em 14/09.**
58 ações × 5 papéis = **290 casos**, verdes. Duas marcas por linha: `diverge`
(o alvo dela, que uma fatia desta spec muda) e `defeito` (decisão anterior que
o código não cumpre — §3.6). Duas sabotagens executadas e registradas no
cabeçalho do arquivo.
Um arquivo de integração **por tabela**, pela ROTA:
`tests/integration/test_matriz_de_permissoes_http_db.py`.

- **O mundo:** duas raízes (Marketing com um subtime, Comercial), e os cinco
  papéis — ADMIN de organização **sem vínculo**, GESTOR de organização, MANAGER
  do Marketing, SUPERVISOR do subtime, OPERATOR do subtime.
- **A tabela:** `(componente, ação, papel, alvo, esperado)`, com
  `esperado ∈ {permitido, negado}`. O alvo importa: o MANAGER do Marketing
  mexendo no Comercial é uma linha própria.
- **O esperado é o comportamento DE HOJE**, e não o alvo. Onde hoje difere da
  matriz de 10/09, a linha diz: `# DIVERGE DO ALVO: item 01`.
- ⚠️ **Pela rota, e não pelo serviço**, pelo motivo do §2.3: o que se promete é
  a resposta HTTP, e parte da trava mora abaixo da rota.
- ⚠️ **Com o contexto de escopo de verdade** (`acting_as`, que monta
  `permissions_for_actor`). Um `frozenset` de permissões faz
  `has_permission_in` cair na pergunta ampla — fail-open, e a tabela passaria
  com a regra errada.

⚠️ **O tamanho é real:** ~17 componentes × ~4 verbos × 5 papéis, mais as linhas
de alvo cruzado, dá algumas centenas de casos. Por isso **uma tabela e um laço**,
e não um teste escrito à mão por caso — a revisão de cada fatia seguinte vira o
diff dessa tabela.

**Fatia 0b — os três defeitos do §3.6.** ✅ **Entregue em 14/09.**
Decisão dela: *"aceito a fatia nova"*. Vem antes de A de propósito: A a C
prometem não mudar a tabela, e consertar dentro delas quebraria a promessa.

| defeito | conserto |
|---|---|
| GESTOR sem lente | `team_scope.visible_team_ids`: **todo papel de organização** (`ORG_ROLES`) vê tudo, e não só `is_admin` |
| MANAGER na outra raiz | `has_permission_in` (neste time) em `TeamService.create` (subtime) e `update`, `BoardService._assert_pode_gerir` (os três ramos), `MemberService.create_member` e `move_member_subteam` (origem **e** destino); conta da pessoa por `_assert_reaches_person` (§4.9) |
| projeto fora da lente | `update`, `archive`, `unarchive` e `soft_delete` passam pelo `get` (404); `create` exige o time na lente (422, igual ao `POST /tasks`) |

A tabela ganhou 4 linhas (mover entre subtimes nas duas raízes, arquivar
projeto do Comercial, a conta de quem está nas duas árvores): **62 ações × 5 =
310 casos**. Três sabotagens executadas e registradas no cabeçalho do teste.

⚠️ **O que a 0b NÃO fez, de propósito:** o vínculo do MANAGER no Comercial
continua recusado **pela trava do supervisor** (sabotagem B da fatia 0). Está
certo na resposta e torto no caminho — é trabalho da fatia B, que dá nome ao
escopo de comando.

**Fatia A — cortar os verbos, sem mudar comportamento.**
O mapa passa a conceder os verbos do §4.2; cada pacote antigo vira exatamente
os verbos que ele já dava. Rotas e serviços passam a cobrar o verbo.
⚠️ **Os portões de tela do §2.4 mudam NA MESMA FATIA** — uma string esquecida é
um botão sumido (§3.4).
⚠️ **O tipo do §4.8 vem PRIMEIRO dentro da fatia**, num commit próprio, ainda
com os nomes de hoje: gerar o arquivo, trocar os `string[]`, `tsc` limpo. Só
depois se cortam os verbos — e aí o `tsc` lista cada tela a mudar, em vez de
uma conferência à mão.

✅ **Commit 1 da fatia A entregue em 14/09** — o tipo, com os 15 nomes de hoje:
- `ALL_PERMISSIONS` em `permissions.py`, **derivada** dos mapas (não uma lista
  paralela);
- `backend/scripts/gen_permissions_ts.py` gera `web/lib/permissions.generated.ts`;
  `tests/test_permissions_generated_ts.py` **falha** (não pula) se o arquivo
  estiver atrasado ou ausente;
- `permissions: Permission[]` em `api.ts`, `permissoesMembros.ts`,
  `seletorDeQuadro.ts` e `gestaoTimes.ts`;
- ⭐ **uma trava a mais, que a spec não previa:** `require_permission` e
  `require_any_permission` recusam, **no import**, nome que nenhum papel
  concede. Sem ela, uma rota com o nome velho subiria e responderia 403 a todo
  mundo — o mesmo defeito do front, do lado do servidor.
- ⚠️ **O `docker-compose.yml` passou a montar `./web/lib` no `api-dev`**: o
  container só via `./backend`, e o teste guardião precisa ler o arquivo.

Sabotagens: `"team.manag"` em `gestaoTimes.ts` → `tsc` recusa (TS2345);
`require_permission("team.manag")` numa rota → a coleta da suíte cai com
`ValueError: Permissao desconhecida em rota`.
Entram aqui `task.archive` e `project.archive` (§4.2), com as quatro rotas de
arquivar e desarquivar.
⚠️ **A tabela da fatia 0 não muda uma linha.** Se mudar, a fatia errou.

✅ **Commit 2 da fatia A entregue em 14/09** — o corte, pelo mapa do §4.2-bis:
**15 permissões viraram 40**, cada rota cobra o verbo da sua ação, e as travas
de serviço recebem o verbo do chamador. **A tabela da fatia 0 não mudou uma
linha (310 verdes).**
⚠️ **E ela não bastou:** os dois tropeços da primeira versão (coluna do quadro
geral por `column.*`; `org_role.grant/revoke` separados no serviço) passaram
verdes na matriz e caíram na suíte — um pelo contexto sem escopo, outro por
quem chama o serviço direto. A matriz prova a ROTA com escopo real; ela não
substitui os testes de serviço, e as duas notas do §4.2-bis dizem o porquê.
Sabotagem: `DELETE /teams/{id}` cobrando `subteam.update` → a matriz acusa
GESTOR e MANAGER apagando subtime.

**Fatia B — o escopo de comando ganha nome.** ✅ **Entregue em 14/09**, por
um caminho diferente do escrito: **a permissão com escopo é o nome** (§4.3-bis).
As duas cópias de `_subtimes_supervisionados` saíram; as travas de membro,
quadro e formulário perguntam `has_permission_in(verbo, time)`. O MANAGER do
Marketing é barrado no vínculo do Comercial **pelo onde**, e não mais por cair
na trava do supervisor (a sabotagem B da fatia 0 fica respondida).
A tabela da fatia 0 não mudou uma linha. Mudaram cinco testes antigos que
perguntavam escopo com contexto sem escopo, e a ordem de `criar_formulario`
(existência antes da permissão: 404 antes de 403).

**Fatia C — o GESTOR vira lista.** ✅ **Entregue em 14/09.**
§4.4. Ainda sem mudar comportamento: a lista reproduz a subtração de hoje —
**35 verbos escritos**, os 40 do ADMIN menos os cinco que eram
`workspace.manage`. O guardião é o assert que já existia
(`admin - gestor == {cinco}`): com a subtração ele era tautologia; com a lista,
um verbo novo no ADMIN entra nessa diferença e o teste cai até alguém decidir.

**Fatias D a H — as mudanças do alvo (decisão dela, 14/09: todas entram).**
Cada uma é um conjunto de linhas da tabela passando de `# DIVERGE DO ALVO` para
o esperado novo, **no mesmo commit** que o código. O diff da tabela é a revisão.
Depois de C, as cinco são independentes entre si; a ordem abaixo é a de risco,
do mais contido ao que desfaz decisão escrita.

- **D — item 01: o GESTOR não apaga.** ✅ **Entregue em 14/09.** Saem da lista
  do GESTOR (fatia C) os verbos de apagar, **exceto** `task.delete` e
  `person.deactivate` — as duas exceções da regra de 10/09. (O "só admin mexe
  em admin" é teto, e mora na fatia G.)
  ⚠️ **Quais saíram foi lido no Mapa de 10/09, e não deduzido do nome:** os
  seis componentes com `·` na coluna D do GESTOR — vínculo, coluna, quadro
  secundário da raiz, quadro de subtime, projeto, formulário. Seções e perguntas
  de formulário ficam (são U). **`membership.delete` não estava marcado como
  divergência** na tabela da fatia 0: tirar do time parecia "mover".
  ⚠️⚠️ **"Só pacote; nenhuma rota nova" não se confirmou**, e em três lugares:
  - **coluna do quadro da RAIZ** cobrava só `board.update.root` (fatia A), e o
    GESTOR, que o tem, apagaria coluna ali sem `column.delete` — agora cobra os
    dois; a tabela ganhou o quadro secundário do Marketing para ver isto;
  - **o lote de colunas** cobrava os três verbos sempre, e o GESTOR perderia até
    RENOMEAR coluna (a tela manda toda edição pelo lote) — agora cobra
    `column.update`, e `create`/`delete` só se o pedido cria ou apaga;
  - **a tela**: quatro botões apareciam ao GESTOR e dariam 403 — apagar quadro
    (`podeApagar` saía de `podeGerir`), o "x" de coluna, "Excluir" formulário e
    "Tirar do time" (alcance amplo respondia sim). Cada um passou a perguntar o
    próprio verbo, por prop **obrigatória** ou parâmetro de lib.
- **E — item 07: o MANAGER cadastra pessoa só no próprio time.** ✅ **Absorvida
  pela fatia 0b**: era a mesma linha do defeito "MANAGER na outra raiz"
  (`create_member` com `_assert_gestao_ampla_em`). Não sobra nada para E além
  de a fatia B passar esta trava a perguntar ao `command_team_ids`.
- **F — item 03: o SUPERVISOR edita o próprio subtime.** ✅ **Entregue em 15/09.**
  `subteam.update` entra no pacote do SUPERVISOR e em `_OWN_TEAM_ONLY` — só o
  subtime do vínculo. A linha "SUPERVISOR renomeia a **raiz**" continua `negado`,
  e entrou "SUPERVISOR edita o subtime **irmão**" = `negado`.
  ⚠️⚠️ **O custo estava na tela, não no mapa.** `podeEditar` olhava
  `subteam.update`, e isso só funcionava porque quem o tinha editava a árvore
  inteira: com o supervisor, o lápis apareceria em **todos** os subtimes. A
  listagem de times (`GET /teams`) passou a devolver **`can_update` por time**,
  calculado pela mesma pergunta do PATCH — o cadeado vem do servidor, como o
  `can_edit_role` da Spec 047 §3.1 — e a tela lê isso (`podeEditar(time)`,
  gaveta do subtime, cartão). Um teste compara o `can_update` de cada papel com
  as linhas da matriz.
- **G — item 02: o GESTOR edita a organização e promove até gestor.**
  `organization.update` e `org_role.grant` entram na lista; o teto (*"até
  gestor; só admin mexe em admin"*) mora no serviço (§4.5), com linha própria
  na tabela para "GESTOR promove a ADMIN" = `negado`.
- **H — o SUPERVISOR troca cargo no próprio subtime** (§4.7). Os três testes de
  recusa listados no §4.7 **mudam de lado, de propósito**, no mesmo commit — e
  a mensagem do commit diz que a Spec 028 D2 foi revogada, e por quem. O cadeado
  (`GET /members/{id}/teams`) abre junto; o front (`papeisAtribuiveis`) passa a
  oferecer SUPERVISOR ao supervisor. ⚠️ Trava no detalhe de teto do §4.7.

---

## 6. O que esta spec deliberadamente NÃO faz

- **Tabela de concessão por pessoa, tela, seletor, endpoint que aceite lista de
  permissões.** O documento de 10/09 os lista como "não fazer agora".
- **RBAC editável** — recusado por escrito (Spec 047 §4.3, `decisoes.md` §10.1):
  *"o que se escolhe é o cargo; o que se mostra é a consequência, em texto"*.
  Estruturar não reabre essa decisão; reabri-la teria de ser de propósito.
- **As mudanças que são REGRA, e não permissão:** renomear time raiz (item 04),
  `slug` editável (05), reativar pessoa (06), derrubar a trava da coluna com
  ponte (11). Com os verbos cortados, elas ficam mais simples — mas não são
  corte de verbo.
- **Reações no comentário** (item 10). Componente novo, spec própria.
- **A tarefa da solicitação órfã** com várias raízes (Spec 048 §8) — é regra de
  produto, não de permissão.
- **Tirar o fail-open de `has_permission_in`** (contexto `frozenset` respondendo
  a pergunta ampla). É o que impede o `.root` de sair (§4.3-bis), e mexe em
  todo teste antigo que monta contexto sem escopo — spec própria, com a
  contagem na mão antes.

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **Permissão renomeada e string esquecida na tela = botão sumido, com os
  quatro portões verdes.** O `tsc` não vê string. **Resolvido pelo tipo do
  §4.8** — desde que ele entre ANTES do corte (fatia A). Até lá, a armadilha
  está de pé.
- ⚠️ **O tipo não pega a permissão CERTA no botão errado.** `task.update` no
  lugar de `task.archive` compila. Isso é a tabela da fatia 0 (no servidor) e a
  tela (no botão).
- ⚠️ **Fatia H revoga a Spec 028 D2.** Os testes que a protegiam mudam de lado;
  um revisor que leia só "teste alterado" vê uma trava sendo afrouxada. A
  mensagem do commit tem de dizer que foi decisão.
- ⚠️ **`permissions_for_roles` ignora papel desconhecido em silêncio**, de
  propósito. Um papel escrito errado no mapa não levanta: nasce sem permissão.
- ~~**A subtração do GESTOR** (§2.1) enquanto a fatia C não chegar: um verbo
  novo de delete escrito no ADMIN chega ao GESTOR.~~ ✅ Fechado na fatia C —
  e o assert que o fecha **só pega verbo novo no ADMIN**. Verbo novo escrito
  direto na lista do GESTOR (e não no ADMIN) passa calado; a revisão do diff
  do mapa continua sendo a rede.
- **Olhar só a rota** (§2.3) diz que quadro, coluna e vínculo estão abertos.
- **Teste com `frozenset` no contexto** passa com escopo errado (§5, fatia 0).
- **A projeção `/auth/me` é com perda** ("o que", nunca "onde"). A tela nunca
  vai saber o escopo de comando; se precisar, **falta campo na rota** — a
  prescrição da Spec 047 §3.1, que a Spec 034 já pagou.

---

## 8. As perguntas, e o que ela respondeu em 14/09

1. **O tamanho da spec** — *"inclui"*. Os itens 01, 02, 03 e 07 entram, como
   fatias D a G (§5).
2. **Supervisor e cargo** — *"supervisor troca o cargo de alguém dentro do seu
   subtime"*. ⚠️ Medido depois da resposta: **hoje ele NÃO troca** (Spec 028
   D2), então isto é mudança, não conferência. Virou a fatia H e o §4.7.
3. **Tipo para os nomes** — *"aceito, se é o correto e coerente a se fazer"*.
   É; o desenho e o porquê estão no §4.8.
4. **`task.archive`** — *"separa a permissão e entra agora também"*. Entra na
   fatia A, com `project.archive` pelo mesmo motivo (§4.2).

### As que sobram

5. **Supervisor rebaixa outro supervisor?** (§4.7) Com a recomendação (não), a
   troca de cargo do supervisor é, na prática, só promover operador. Com "sim",
   dois supervisores de um subtime podem rebaixar um ao outro. **Só trava a
   fatia H**; 0 a G andam sem ela.

6. **Onde consertar os três defeitos do §3.6?** — *"aceito a fatia nova"*.
   Virou a fatia 0b, entregue. E a urgência: *papel de organização só existe
   no dev dela, e nada da 047/048 subiu nem sobe antes de ela testar a 049*.

7. **A conta de quem está em duas árvores** (§4.9) — *"confirmo o 'todos'"*
   (14/09). Resetar senha e desativar exigem todos os vínculos da pessoa na
   árvore de quem age; quem está em duas árvores é da organização.
