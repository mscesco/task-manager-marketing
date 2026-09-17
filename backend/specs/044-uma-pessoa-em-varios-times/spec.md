# Spec 044 — Uma pessoa em vários times

**Status:** ✅ **CONCLUÍDA em 02/09/2026.** Todas as fatias entregues. Escrita em 31/08, §4 revisada no mesmo dia; as fatias 3, 4 e 5 saíram em 02/09 e cada uma registra, na própria entrada da §5, o que desmentiu esta spec.
**Escopo:** backend (trava, listagem, herança de time) **e** frontend (tela de membros e os cinco consumidores da lista)
**Depende de:** ADR 0008 (a trava), ADR 0039 (a análise e a condição de saída), Spec 036 fatia 5 (quadro por time — **já entregue**, PR #14 / `e181c1d`)
**Placar na abertura, medido em 31/08:** Backend **1012**, Front **1079**, migrations `0021`
**Não faz parte desta spec:** a reorganização da árvore em várias raízes. Decisão da Camila em 31/08, spec própria depois desta. Ver §6.

---

## 1. Isto não é ideia nova — é uma dívida com data e condição de saída

A **ADR 0039**, de 10/08/2026, já decidiu que multi-subtime é necessário, já
mediu o raio de explosão arquivo por arquivo, e já escolheu a regra de
desempate. Ela adiou a execução com uma condição explícita:

> *"A trava fica até a fatia 5 da Spec 036 estar em produção."*

⚠️ **A condição foi cumprida e ninguém voltou para destravar.** A fatia 5 fechou
no PR #14 (`e181c1d`, "a raiz ganha quadro extra") e está em produção desde
então — o deploy da Spec 043, em 31/08, subiu de uma `main` que a contém.

O caso concreto que motivou a ADR continua bloqueado: **uma redatora que o
negócio precisa em SEO e em Mídias Sociais ao mesmo tempo.**
`MemberService._assert_one_subteam` levanta 422 e o vínculo não nasce.

Esta spec é a execução do que aquela ADR decidiu. Ela **não reabre o mérito** —
reabre só as duas perguntas que a própria ADR deixou marcadas como *"ninguém
decidiu isso"* (§4).

---

## 2. O que já existe — medido em 31/08, abrindo os arquivos

⚠️ A tabela abaixo **confere** a da ADR 0039 e **acrescenta a coluna que ela não
tinha: o lado do front.** A ADR disse "seis telas consomem essa rota" e parou
aí. O que as seis fazem com o valor é o que decide o tamanho desta spec.

### 2.1. Backend

| ponto | onde | estado |
|---|---|---|
| `user_team` é N:N de verdade | `organization.py:155` | ✅ a única constraint é `UNIQUE (user_id, team_id)` — impede o par repetido, não a segunda equipe. **Sem migration.** |
| trigger de apoio que a ADR 0008 previu | `schema_v5.sql` | ✅ **nunca existiu.** O único trigger do schema é `task_history_no_update_delete`. A ADR 0008 está em status `Proposed` até hoje. |
| a lente de visibilidade | `team_scope.py:78` | ✅ `visible_team_ids` já itera sobre **todos** os vínculos e faz união. Nunca assumiu um subtime. |
| a lente de edição | `team_scope.py:99` | ✅ delega para a de cima |
| **a trava** | `member_service.py:858` | ⚠️ é isto que sai |
| `default_team_id` | `team_scope.py:111` | ⚠️ `subteams[0]`, sem desempate — **decisão de produto, §4.2** |
| `list_all_with_subteam` | `user_repository.py:53` | ⚠️⚠️ **defeito latente, §3** |
| `MemberResponse.team_id` | `users/api/router.py:94` | ⚠️ campo **singular** no contrato: `team_id=m.subteam_id` |

### 2.2. Front — o que a ADR 0039 não mapeou

O campo singular `member.team_id` chega a cinco lugares, e **não é só rótulo**:

| consumidor | o que faz com o valor | gravidade |
|---|---|---|
| `membros/page.tsx:340` | `temAcaoPossivel(alcance, m.team_id)` — **decide se a linha tem ação** | ⚠️⚠️ é permissão, não desenho |
| `membros/page.tsx:271` | `nomeSubtime(m.team_id)` — o rótulo na linha | rótulo |
| `arquivadas`, `minhas-tarefas`, `tarefa/[id]` | montam `subtimePorMembro: Map<id, string \| null>` | alimenta o próximo |
| `TaskDetail.tsx:653` | `foraDoEscopo(subtimePorMembro, …)` — o aviso de responsável fora do escopo | ⚠️ o aviso passa a mentir |
| `Board.tsx:2366` | passa o mesmo mapa adiante | idem |

> **Nota de 17/09/2026:** `membros/page.tsx` não existe mais — a rota
> `/membros` saiu na Spec 047 (commit `3490a47`). Pessoas se administram na
> tela do time, `web/app/times/[id]/page.tsx`.

⚠️ **`temAcaoPossivel` é o achado desta seção.** A assinatura é
`(a: Alcance, subtimeDoMembro: string | null)` e a regra é
`a.subtimes.includes(subtimeDoMembro)`. Com N subtimes a pergunta certa deixa de
ser *"o subtime dele é um dos meus?"* e passa a ser *"**algum** subtime dele é um
dos meus?"* — e isso **muda quem um supervisor pode administrar**. Não é
refactor; é a §4.1 aparecendo no front.

---

## 3. ⚠️⚠️ O defeito latente, que dispara no dia em que a trava cair

`UserRepository.list_all_with_subteam` faz `LEFT JOIN` com a subconsulta de
subtimes. A própria docstring diz por que isso é seguro hoje:

> *"Pelo invariante 'um subtime por usuario' (ADR 0008), o LEFT JOIN com a
> subconsulta de subtimes devolve no MAXIMO uma linha por membro."*

Com dois subtimes ele devolve **duas linhas**, e o consumidor
(`member_service.py:440`) monta um `MemberWithSubteam` por linha, sem
deduplicar. **A pessoa aparece duplicada nas seis telas** que consomem
`GET /users` — TaskModal, Board, `tarefa/[id]`, membros, arquivadas,
minhas-tarefas —, seletores de responsável e de `@` incluídos.

**Não levanta erro, não quebra teste, não aparece no `tsc`.**

⚠️ É a mesma classe de defeito que apareceu **quinze vezes** na revisão da Spec
043, e que ficou nomeada no fim daquela sessão: *a regra mudou e um consumidor
ficou para trás*. A diferença é que desta vez ele está **anotado com três
semanas de antecedência**. Não há desculpa para ele passar.

**Ordem obrigatória: consertar a listagem ANTES de remover a trava.** Invertida,
a janela entre as duas fatias é uma janela de dados duplicados em produção.

### 3.1. E a trava não tem teste nenhum

Grep refeito em 31/08 (`"um subtime por usuario"` em `backend/tests`): **uma
linha, e é docstring** — `test_member_subteam_db.py:6`. Igual ao que a ADR 0039
mediu em 10/08.

⚠️ **Removê-la não vai acender nenhum vermelho, e isso é motivo para mais
cuidado, não menos.** Pior: `test_member_subteam_db.py` *depende* do invariante
para as suas expectativas ("na raiz E num subtime → deve vir o SUBTIME"). Ele
não vai falhar — vai continuar passando enquanto cobre um caso que deixou de ser
o único.

---

## 4. As decisões — revisadas em 31/08 pela Camila

⚠️ **Esta seção foi reescrita depois de a Camila contestar as duas
recomendações. As duas contestações estavam certas**, e a primeira desmontou uma
pergunta que a ADR 0039 tinha deixado aberta sem conferir se ela ainda existia.

### 4.1. ~~Papel efetivo quando os papéis divergem~~ — já está resolvido

**A pergunta da ADR 0039 não existe mais, e provavelmente já não existia quando
ela foi escrita.** A Spec 028 resolveu isso em código:

```python
# member_service.py:900
def _subtimes_supervisionados(self) -> frozenset[uuid.UUID]:
    return frozenset(
        m.team_id
        for m in require_tenant().memberships
        if m.role == UserTeamRole.SUPERVISOR.value   # <-- por TIME, do user_team
    )
```

A arquitetura real é de **duas camadas, e só a primeira ignora o time**:

| pergunta | quem responde | olha o time? |
|---|---|---|
| que **tipo** de ação eu faço | `permissions_for_roles` (união dos papéis) | não, de propósito |
| **onde** eu a faço | `_subtimes_supervisionados`, `_assert_escopo_supervisor`, `visible_team_ids` | ✅ vínculo a vínculo |

Na prática: SUPERVISOR em SEO + OPERATOR em Mídias Sociais administra membros
**só em SEO**. Já funciona, sem linha nova. **Nada a fazer nesta spec.**

⚠️ Assimetria que importa para a §4.1-bis: `_assert_escopo_supervisor` faz
*early return* para quem tem `team.manage` (`:929`). MANAGER da raiz não é
escopado — é governado pela matriz C2, de propósito.

### 4.1-bis. ⭐ REGRA NOVA (Camila, 31/08): o papel na raiz não pode ser menor

> *"Ele não pode ter menos permissão no raiz do que tem no subtime."*

Ordenação: `OPERATOR < SUPERVISOR < MANAGER < ADMIN`.

| vínculo na raiz | vínculo no subtime | vale? |
|---|---|---|
| OPERATOR | SUPERVISOR | ❌ **inversão — é isto que a regra mata** |
| MANAGER | SUPERVISOR | ✅ permitido (*"mesmo não fazendo sentido"*) |
| SUPERVISOR | OPERATOR | ✅ |
| **nenhum** | SUPERVISOR | ✅ **decisão da Camila: ausência não é "menos"** |

A invariante da Spec 024 continua **intocada**: subtime aceita só SUPERVISOR e
OPERATOR. Esta regra é ortogonal — ela compara níveis, não restringe o conjunto.

**O que ela faz e o que ela não faz.** Ela **não** tapa furo de segurança: os
gates da §4.1 já seguram OPERATOR@raiz + SUPERVISOR@sub, e a pessoa não alcança
nada indevido. Ela impede **organograma incoerente** — quem supervisiona um
subtime constando como mero operador do time acima.

⚠️ **Mas não é decorativa, e o motivo é que o mapa de permissões NÃO é
monotônico:** SUPERVISOR tem `member.manage.subteam` e **MANAGER não tem**
(`permissions.py:114` vs `:80`). MANAGER@raiz + SUPERVISOR@sub literalmente
ganha uma permissão vinda de baixo. Hoje o early return neutraliza; o dia em que
alguém mexer no mapa, não.

**Onde mora:** função pura em `team_scope.py`, irmã de
`assert_role_permitido_no_nivel`, aplicada nas **mesmas quatro portas** do
`MemberService` (`:314`, `:536`, `:610`, `:773`). Precisa de um mapa de posto —
`UserTeamRole` é `StrEnum` e **não tem ordem**; está declarado em ordem
decrescente por coincidência de leitura, e depender disso seria a mesma classe
de armadilha do `ColumnSemantic` (AGENTS.md §9).

⚠️ **Sobrevive às N raízes:** `root_of()` já devolve a raiz *daquela subárvore*,
não "a raiz". A comparação continua correta quando Marketing e TI forem irmãos.

✅ **Varredura rodada em 31/08 no Adminer: "Não existem registros."** Ninguém
está em estado inválido hoje, então a regra liga sem remediação de cadastro. A
consulta fica registrada porque ela é o portão para reabrir isto se a regra
mudar:

```sql
-- Quem tem papel MENOR na raiz do que num subtime (esperado: descobrir)
WITH posto AS (
  SELECT * FROM (VALUES ('OPERATOR',1),('SUPERVISOR',2),('MANAGER',3),('ADMIN',4))
    AS p(role, rank)
)
SELECT u.email, tr.name AS raiz, utr.role AS papel_raiz,
       ts.name AS subtime, uts.role AS papel_subtime
FROM user_team uts
JOIN team ts   ON ts.id = uts.team_id AND ts.parent_team_id IS NOT NULL
JOIN team tr   ON tr.id = ts.parent_team_id
JOIN user_team utr ON utr.user_id = uts.user_id AND utr.team_id = tr.id
JOIN users u   ON u.id = uts.user_id
JOIN posto ps  ON ps.role = uts.role::text
JOIN posto pr  ON pr.role = utr.role::text
WHERE pr.rank < ps.rank;
```

Se um dia voltar linha, **a regra não pode ser ligada sem antes decidir o que
fazer com essas pessoas** — barrar na escrita não conserta cadastro que já
existe.

### 4.2. De qual time nasce uma tarefa — o quadro responde, e o 422 some

**A Camila está certa: o quadro é a fonte, não o usuário.**

⚠️ **E a investigação de 31/08 mostrou que essa regra JÁ EXISTE — só que mora no
front.** `createTask` fixa a raiz antes de mandar (`web/lib/api.ts:1296`):

```js
const teamId =
  input.team_id !== undefined && input.team_id !== null
    ? input.team_id
    : await getRootTeamId();
```

O modal manda `team_id: null` em `/quadro`, e essa linha troca pela raiz. **Pela
tela, não dá para criar tarefa interna no quadro geral.**

O backend, por outro lado, não tem opinião: `_assert_board_and_team` faz
`if eh_padrao: return` (`:372`), e isso é deliberado — tarefa interna de subtime
vive no geral com o `team_id` do subtime e aparece só na lente dele. **São 216
em produção**, medidas em 18/08.

| quem cria | manda `team_id` | hoje |
|---|---|---|
| tela do quadro geral | raiz (pin do `createTask`) | ✅ nasce na raiz |
| tela da lente do subtime | o subtime, explícito | ✅ interna **de propósito** — são as 216 |
| n8n / Swagger / direta | nada | ⚠️ `default_team_id` → **o subtime de quem chamou** |
| n8n / Swagger / direta | um subtime | ⚠️ passa, sem checagem |

⚠️⚠️ **Ou seja: a regra vale para quem usa a tela e não vale para o resto.** É o
mesmo formato exato que a **ADR 0031** já corrigiu aqui — *"toda tarefa nasce com
responsável"* vivia só em `criacaoTarefa.motivoNaoCria` e foi movida para o
serviço, com o comentário a poucas linhas daqui (`task_service.py:534`).

**Decisão: mover o pin do front para o backend.** Sem `team_id` explícito, o
time vem do quadro:

| quadro | time da tarefa |
|---|---|
| **avulso** (de time) | o time do quadro |
| **geral**, ou nenhum pedido (cai no geral da raiz, `:643`) | **a raiz** |

⭐ **Consequência que resolve o problema desta spec de graça:**
`default_team_id` **sai inteiro do caminho de criação**. Toda tarefa termina com
quadro — quem não pede um cai em `default_board_and_column_for_status`, que
filtra a raiz no SQL (`:612`). Com o time vindo do quadro, **a ambiguidade dos N
subtimes desaparece, e o 422 que a versão anterior desta seção propunha deixa de
ser necessário.**

O caminho deliberado continua intacto: a lente do subtime manda `team_id`
explícito, e explícito sempre ganha. As 216 não são tocadas.

⚠️ **O pin do front FICA.** Ele deixa de ser a única linha de defesa, mas
removê-lo trocaria uma chamada a mais de rede (`getRootTeamId`) por nada — e
duas defesas concordando é o desenho de `_assert_team_in_reach` e
`_assert_board_in_reach`, que também existem apesar de a tela não oferecer o
caminho.

---

## 5. As fatias

Ordem não negociável nas duas primeiras — ver §3.

**Fatias 1 + 2 — a listagem para de assumir um subtime só. ✅ ENTREGUE (31/08).**

⚠️⚠️ **AS DUAS VIRARAM UMA, e esta spec estava errada em separá-las.** No
instante em que `MemberResponse.team_id` vira `team_ids`, o front não compila:
uma PR só de backend deixaria a `main` com `tsc` vermelho, contra o §1 do
`AGENTS.md`. Só dá para saber isso *depois* de trocar o campo e ver o `tsc`
falar — o que é, ele mesmo, o argumento a favor de trocar o nome.

`list_all_with_subteams` usa `array_agg(ORDER BY team.name)` e devolve
estruturalmente **uma linha por membro**. Não é agregação em Python de
propósito: um consumidor futuro que esqueça de deduplicar não tem linha
repetida para ignorar. `MemberWithSubteams.subteam_ids` e
`MemberResponse.team_ids`; lista vazia é a única forma de "sem subtime".

⚠️ **Substituir o campo, não acrescentar um ao lado.** Manter `team_id` e somar
`team_ids` deixaria os consumidores compilando e errados — exatamente o roteiro
do defeito que esta spec existe para não repetir. **O portão que pega isto é o
`tsc`, e ele só pega se o campo mudar de nome.** Ele apontou **cinco
consumidores de produção** — e um deles, `components/Board.tsx:457`, **não
estava no mapeamento da §2.2**, que foi feito por grep.

⚠️ **Achado: `subtimePorMembro` e `rootTeamId` do `TaskDetail` eram PROP
MORTA** — desestruturadas, tipadas, nunca lidas. A Spec 034 (03/08) removeu o
`foraDoEscopo` que as consumia e deixou as props para trás; **três telas
montavam um mapa só para preencher o argumento.** Removidas: portá-las para o
plural seria manter código morto atualizado. O que sobrou de trabalho real foi
`Board` (que usa mesmo) e a tela de membros.

⚠️ **O que NÃO entrou:** a regra de 1-subtime no `timesParaAdicionar` da tela de
membros continua de pé — ela espelha a trava do backend, que só sai na fatia 3.
Soltá-la agora ofereceria um destino que daria 422.

**Sabotagens rodadas** (os quatro guardiões novos falham sem o conserto): LEFT
JOIN de volta → `assert 2 == 1`; `array_agg` sem `ORDER BY` → ordem por
sorteio; só o primeiro subtime conta → a tarefa da redatora some da lente.

**Placar:** Backend **1014** (era 1012), Front **1082** (era 1078).

**Fatia 3 — a trava sai. ✅ ENTREGUE (02/09).**
Remove `_assert_one_subteam` e as três chamadas. Testes novos: pôr alguém em
dois subtimes **pelo serviço** (a fatia 1 só conseguia pela factory), a lente
devolve os dois, o vínculo repetido no mesmo time segue 409, e o escopo do
supervisor com papéis divergentes (SUPERVISOR em SEO + OPERATOR em CRM →
administra só SEO) — caso que era **impossível de cadastrar** até esta fatia.

⚠️⚠️ **A §3.1 DESTA SPEC ESTAVA ERRADA: o 422 TINHA teste.** Era
`test_adicionar_segundo_subtime_422` (`test_member_assign_db.py`), com
`pytest.raises(ValidationError)`. O grep de 31/08 procurou a **frase** *"um
subtime por usuario"* dentro de `tests/` e não achou a **asserção** — o
arquivo nunca escreveu aquela prosa. Remover a trava acendeu vermelho na hora,
ao contrário do que a spec previa. A lição é sobre o grep: procurar por prosa
não encontra comportamento.

⚠️ **E O FRONT VEIO JUNTO, pelo mesmo motivo das fatias 1+2.** `app/membros/
page.tsx` filtrava o segundo subtime para não oferecer um destino que daria 422
— com a trava fora e o filtro de pé, **a redatora continuaria bloqueada na
tela**, e a fatia entregaria nada visível. A regra saiu de `app/` e virou
`candidatosParaAdicionar` em `lib/permissoesMembros.ts`: `app/` está fora do
`include` do vitest, então ali a ausência da trava **não teria guardião** — e
ela é permissão, não desenho (§2.2).

**Sabotagem rodada:** com `_assert_one_subteam` restaurada, os dois testes
novos falham (`2 failed, 17 passed`).

**Placar:** Backend **1016** (era 1014), Front **1085** (era 1082).

**Fatia 4 — o time vem do quadro. ✅ ENTREGUE (02/09).**
Aplica a §4.2: o pin que morava no `createTask` do front passa a valer no
serviço, para todo cliente. `default_team_id` **saiu do caminho de criação — e
saiu do código**, junto com os quatro testes dela: sem chamador, ela guardaria
uma regra que o produto não segue mais.

⚠️ **NÃO foi feito movendo a resolução de time para depois da do quadro**, como
esta spec previa. Aquele caminho arrastaria junto a checagem de subárvore do
projeto e a construção do `Task`, que leem `team_id` no meio. O que mudou foi só
o **terceiro item da precedência**: `TaskService._time_do_quadro_alvo` responde
"de quem é o quadro que vai receber esta tarefa?" — o dono do quadro pedido, ou
a raiz quando não há quadro pedido, que é onde
`default_board_and_column_for_status` põe a tarefa de qualquer jeito (ADR 0032).
Mesma tabela da §4.2, um décimo do risco.

A precedência continua **explícito > pai > quadro**: as 216 tarefas internas de
subtime e a herança da ADR 0024 têm teste próprio nesta fatia.

Testes novos em `test_task_time_vem_do_quadro_db.py`, entre eles o que faltava —
o **cliente que não é a tela**: `POST /tasks` sem `team_id`, por quem só tem
subtime, nasce na **raiz**. Antes devolvia `subteams[0]`, ou seja, SEO ou Mídias
conforme a ordem dos vínculos.

**Fatia 5 — o papel na raiz não pode ser menor. ✅ ENTREGUE (02/09).**
Aplica a §4.1-bis. ✅ **Varredura rodada em 31/08 no Adminer: nenhum registro.**
A regra ligou sem remediação de cadastro.

O **mapa de posto** nasceu aqui, explícito, e é o que a §4.1-bis avisava que
faltava: `team_scope._POSTO` mais `posto_do_papel`, `raiz_menor_que_subtime` e
`assert_raiz_nao_menor_que_subtime`. Papel sem posto **recusa** em vez de
responder 0 — mesma falha fechada da R5 da Spec 024.

⚠️ **A regra vale nos DOIS sentidos, e o segundo é o que importa na prática.**
Barrar só "promover no subtime" deixaria a inversão entrar por **rebaixar a
raiz** de quem já supervisiona — que é o caminho provável, e é o formato exato
do defeito que a ADR 0031 corrigiu. As duas portas têm teste.

⚠️ **A comparação é dentro da MESMA árvore**, via `root_of`, e não contra "a
raiz". Com as N raízes da Spec 046, um OPERATOR no topo do TI não invalida um
SUPERVISOR num subtime do Marketing. Já nasce sobrevivendo a isso.

⚠️ **O nível vem do banco, não do `team_tree` do `TenantContext`.** A árvore do
contexto chega **vazia** em teste que não a passa — e regra que vira no-op
silencioso em metade dos testes não é regra.

A porta 1 (`create_member`) recebeu a chamada e é **estruturalmente um no-op**:
o usuário é novo, nasce com um vínculo só e o guard sai pelo curto-circuito sem
tocar o banco. Fica pelo mesmo motivo que `_assert_gestao_ampla` existe.

### ⚠️ BARRAR foi escolha, e a Camila a confirmou em 02/09

A regra de 31/08 descreve um **estado proibido** — ela não diz o que o sistema
faz quando alguém tenta chegar lá. Havia duas leituras:

- **barrar** — a operação é recusada e quem promove faz dois passos (mudar o
  papel na raiz **e** dar o supervisor no subtime);
- **arrastar junto** — promover no subtime **sobe** o papel na raiz na mesma
  operação: um passo só, nenhum 409, mas um clique mexendo em dois vínculos, e
  "subir papel sozinho" é a classe de coisa que ninguém percebe até auditar.

**Decisão: barrar** — porque a **Spec 045** resolve o atrito por construção. Lá
a Camila decidiu que `SUPERVISOR` não existe na raiz; quando isso entrar,
supervisor de subtime simplesmente não tem papel no time geral e a escolha
acima deixa de importar.

⚠️ **Consequência enquanto a 045 não entra:** promover um operador do time geral
a supervisor de subtime devolve 409, e o caminho é tirar o vínculo dele da raiz
(ou subir o papel lá). Não recrie "arrastar junto" sem reabrir esta decisão.

**~~Fatia 6 — a tela de membros mostra o plural.~~ ✅ JÁ FEITA nas fatias 1+2.**

⚠️ **Esta fatia estava numerada como "5", duplicando a de cima** — erro de
numeração encontrado em 02/09. E ela já não tinha conteúdo: as fatias 1+2
portaram o front inteiro para `team_ids`, e a linha da tela já mostra os
vínculos por `nomeSubtimes(m.team_ids)`. Fica riscada, e não removida, para
quem procurar a "fatia 5 da tela" saber que ela não sumiu — ela foi absorvida.

---

## 6. O que esta spec deliberadamente NÃO faz

**A reorganização da árvore.** A Camila decidiu em 31/08 por **várias raízes de
verdade** — Marketing, TI e Design como irmãos, sem pai comum —, e isso é spec
própria, depois desta. Fica registrado aqui porque **uma decisão desta spec
depende disso**, e é melhor escrevê-la agora do que descobrir depois:

⚠️ `list_all_with_subteam` **ignora a raiz de propósito** (docstring, `:58`):
*"quem está na raiz não deve ser rotulado com o id do Marketing geral"*. Com N
raízes, "ignorar a raiz" vira "ignorar todos os times de topo" — e aí Marketing,
TI e Design sumiriam do rótulo de todo mundo.

**A fatia 1 não deve embutir "não-raiz" como se fosse regra eterna.** O correto
é que ela devolva **os times do membro** e deixe quem desenha decidir o que
mostrar. Isso não custa nada agora e evita reescrever a mesma consulta duas
vezes em duas specs seguidas.

⚠️ E a spec das raízes vai ter de responder o que esta não responde: com N
raízes, o argumento inteiro da **Spec 024** cai. Ele diz que "união dos papéis" e
"autoridade sobre a árvore" coincidem **porque ADMIN e MANAGER só existem na
raiz única**. Com várias raízes, um MANAGER de TI carrega o papel sem que
`permissions_for_roles` saiba de qual árvore — e o mapa de permissões ignora o
time de propósito, com um comentário de 17 linhas explicando por quê. Isso é o
maior item daquela spec, e não é desta.

---

## 7. O que os portões não vão pegar

- **A duplicação da §3 não quebra teste nenhum** enquanto ninguém estiver em dois
  subtimes. O único jeito de vê-la é um teste que **crie** o segundo vínculo — e
  ele só pode existir depois da fatia 3. ⚠️ Por isso a fatia 1 precisa de um
  teste de repositório que monte os dois vínculos **direto no banco**, sem passar
  pelo serviço que ainda tem a trava.
- **`temAcaoPossivel` é `lib/`**, então tem guardião. `subtimePorMembro` mora em
  `app/`, que o `include` do vitest não cobre — os testes dele precisam morar em
  `components/__tests__/`, como o de `FilaDeSolicitacoes`.
- **A concentração na raiz** (155 de 219 tarefas em 10/08) é o pano de fundo de
  tudo isto e **está três semanas velha**. A consulta 2 da ADR 0039 precisa ser
  refeita no Adminer antes da fatia 4.
