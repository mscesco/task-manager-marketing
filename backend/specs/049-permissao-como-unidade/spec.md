# Spec 049 — Permissão como unidade, papel como pacote

**Status:** escrita em 14/09/2026, a partir do documento de 10/09
(`~/Documents/gestor-de-tarefas-permissoes.html`) e da matriz CRUD do artefato
"Mapa do Gestor de Tarefas". **Nenhuma fatia começou.** Há perguntas abertas
para a Camila na §8 — a principal decide o tamanho da spec.
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

⚠️ `person.reactivate` **não entra**: é permissão para uma ação que não existe.
Nasce com ela (§6).

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

---

## 5. As fatias

Cada uma fica verde sozinha. A ordem das três primeiras não é negociável.

**Fatia 0 — a matriz de hoje, em teste (backend).**
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

**Fatia A — cortar os verbos, sem mudar comportamento.**
O mapa passa a conceder os verbos do §4.2; cada pacote antigo vira exatamente
os verbos que ele já dava. Rotas e serviços passam a cobrar o verbo.
⚠️ **Os portões de tela do §2.4 mudam NA MESMA FATIA** — uma string esquecida é
um botão sumido (§3.4).
⚠️ **A tabela da fatia 0 não muda uma linha.** Se mudar, a fatia errou.

**Fatia B — o escopo de comando ganha nome.**
`command_team_ids` (§4.3), e os quatro pontos do §2.3 passam a usá-la.
Comportamento igual; a tabela da fatia 0 continua intacta.

**Fatia C — o GESTOR vira lista.**
§4.4. Ainda sem mudar comportamento: a lista reproduz a subtração de hoje.

**Fatia D em diante — as mudanças do alvo.**
Cada uma é um conjunto de linhas da tabela passando de "hoje" para "alvo", junto
com o código. Quais entram aqui é a pergunta 1 da §8.

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

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **Permissão renomeada e string esquecida na tela = botão sumido, com os
  quatro portões verdes.** O `tsc` não vê string. A fatia A precisa de uma
  lista dos pontos do §2.4 conferida à mão — ou de um tipo que feche os nomes
  (pergunta 3 da §8).
- ⚠️ **`permissions_for_roles` ignora papel desconhecido em silêncio**, de
  propósito. Um papel escrito errado no mapa não levanta: nasce sem permissão.
- ⚠️ **A subtração do GESTOR** (§2.1) enquanto a fatia C não chegar: um verbo
  novo de delete escrito no ADMIN chega ao GESTOR.
- **Olhar só a rota** (§2.3) diz que quadro, coluna e vínculo estão abertos.
- **Teste com `frozenset` no contexto** passa com escopo errado (§5, fatia 0).
- **A projeção `/auth/me` é com perda** ("o que", nunca "onde"). A tela nunca
  vai saber o escopo de comando; se precisar, **falta campo na rota** — a
  prescrição da Spec 047 §3.1, que a Spec 034 já pagou.

---

## 8. Perguntas para a Camila

1. **O tamanho da spec.** Esta spec é só o corte (fatias 0 a C, sem mudar
   comportamento) ou já entrega as mudanças de permissão do alvo? As candidatas,
   que viram "uma linha no pacote" depois do corte:
   - **01** — tirar os deletes do GESTOR (exceto apagar tarefa e desativar
     pessoa);
   - **02** — GESTOR edita a organização e promove até gestor;
   - **03** — SUPERVISOR edita o próprio subtime;
   - **07** — MANAGER cadastra pessoa só com vínculo no time dele.

   *Recomendação:* as quatro entram como fatias D a G. Sem elas, a spec entrega
   estrutura e nenhuma diferença que se veja — e a regra de 10/09 é o motivo de
   ela existir.

2. **O que o documento deixou como "conferir".** O supervisor hoje consegue
   trocar o cargo dentro do próprio subtime, ou só adicionar e remover? A fatia
   0 mede isso — mas o alvo precisa ser dela.

3. **Fechar os nomes num tipo.** Os nomes das permissões podem virar um tipo
   gerado do backend no front (uma lista `as const`), para o `tsc` apontar a
   string esquecida do §7. Custa um passo de geração; resolve a armadilha mais
   provável da fatia A.

4. **`task.archive` separado.** Hoje arquivar entra em `task.update`, e a matriz
   diz que SUPERVISOR e OPERATOR **arquivam no lugar de apagar** — o que já é
   verdade. Separar o verbo não muda nada hoje; ele só serve se um dia algum
   papel puder editar e não arquivar. Entra no corte, ou fica para quando for
   preciso?
