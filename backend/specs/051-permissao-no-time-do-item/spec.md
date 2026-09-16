# Spec 051 — A permissão no time do item

**Status:** escrita em 16/09/2026, a partir da revisão de permissões do mesmo
dia (cinco frentes contra o Mapa de 10/09 e a Spec 049) e das **oito decisões
dela**, respondidas em 16/09 (§8), mais as duas que a escrita levantou (A e B,
respondidas no mesmo dia). **Fatias 0 e A entregues em 16/09.**
**Escopo:** backend (travas de serviço, matriz C2, duas rotas novas de leitura
de cadeado e uma de escrita) e as telas que hoje decidem sozinhas o que o
servidor deveria dizer.
**Depende de:** **PR #57** (`fix/conta-respeita-o-papel-do-alvo`) mergeado. A
trava de conta dele (`_assert_pode_agir_sobre_a_conta`) é a regra que as
fatias C e E reusam, e a matriz da fatia 0 parte das 4 linhas que ele pôs.
**Placar na abertura:** backend **1572** (com o #57). Depois da fatia 0:
**1734** (+162 casos da matriz, conta feita; a matriz sozinha rodou 552 verdes).
O front não mudou na fatia 0; o número entra na primeira fatia que o toca.

---

## 1. De onde vem

O pedido, em 16/09, com a 050 mergeada:

> *"o que eu quero agora é um code review das permissões, para saber se todas
> estão funcionando como mapeamos para todos os papéis pré-definidos"*

A revisão achou **uma falha de segurança em produção** (resetar senha e
desativar conta sem olhar o papel do alvo — tomada de conta), consertada à
parte no #57 por ser urgente, e **uma causa comum** para a maior parte do
resto. Esta spec é o resto.

⚠️ **A matriz HTTP da Spec 049 estava verde (370 de 370) com todos os buracos
abaixo de pé.** Nenhum é teste quebrado: é linha que a matriz não tem. O
motivo principal é um só — **o mundo dela não tem ninguém com vínculo em duas
árvores**, e é aí que mora a causa comum.

---

## 2. A causa comum: lente onde devia ser verbo

A Spec 049 separou duas perguntas e deu nome às duas:

| pergunta | quem responde |
|---|---|
| **posso ver?** (a lente) | `team_scope.visible_team_ids` / `editable_team_ids` |
| **posso fazer ISTO, NESTE time?** | `has_permission_in(verbo, team_id)` |

A rota pergunta `has_permission(verbo)` — **"em algum lugar"** —, porque ainda
não conhece o item. O serviço, que conhece, deveria perguntar **"neste time"**.
Em cinco componentes ele pergunta **a lente**:

| onde (medido em 16/09, `main` `410dd7c`) | o que pergunta |
|---|---|
| `task_service.py:1703` · `soft_delete` | `assert_visible` + `assert_editable` — a lente |
| `comment_service.py:318` · `delete_comment` (moderar) | `task.delete in tenant.permissions` — em algum lugar |
| `project_service.py:133-149` · `create` | `editable_team_ids` — a lente |
| `project_service.py:319,368,384,400` · `update`, `archive`, `unarchive`, `soft_delete` | `self.get` — a lente |
| `solicitations/infrastructure/repository.py:87-100` · fila e triagem | `visible_team_ids` — a lente |
| `form_service.py:319` · `listar_formularios` | `visible_team_ids` — a lente |

⚠️⚠️ **Com um time só, lente e verbo coincidem.** A lente de um MANAGER é a
árvore dele, e os verbos dele também. Por isso nenhum teste pegou. Elas
divergem com **uma pessoa em duas árvores**, que o cadastro permite:

> **MANAGER no Marketing e OPERATOR no Comercial.** A lente dela inclui o
> Comercial (é onde ela trabalha). A rota pergunta "tem `task.delete` em algum
> lugar?" — tem, no Marketing. O serviço pergunta "enxerga a tarefa?" —
> enxerga. **Ela apaga tarefa do Comercial.** O mesmo vale para moderar
> comentário, criar, editar, arquivar e apagar projeto, ver e triar a fila, e
> listar formulários.

É o mesmo defeito que a Spec 049 (§3.6, item 2) consertou em quadro, time e
pessoa — `has_permission` onde devia ser `has_permission_in`. Lá a pergunta
errada era "em algum lugar"; aqui é "enxergo". Os componentes que ficaram de
fora da 0b são exatamente os que não olhavam permissão nenhuma no serviço.

---

## 3. Os outros buracos, medidos

### 3.1. Vínculo

- **Supervisor puxa para o subtime qualquer pessoa ativa**, de qualquer árvore
  ou sem time. `assign_to_team` (`member_service.py:828`) confere o papel
  (C2), o onde (`membership.create` no subtime) e o nível — **nada sobre de
  onde a pessoa vem**.
- **Gerente põe no time dele alguém de outra árvore**, pelo mesmo caminho. Com
  a regra "todos os vínculos" da Spec 049 (§4.9), a pessoa vira "de duas
  árvores" e **nenhum dos dois gerentes** alcança mais a conta dela.
- **Mover entre subtimes aceita conta desativada.** `move_member_subteam`
  (`member_service.py:1172`) não chama `_assert_alvo_ativo`, que `assign_to_team`
  e `change_member_role` chamam. Remover do time continua permitido de
  propósito (limpeza de quem saiu, `_assert_alvo_ativo` explica).

### 3.2. A matriz C2 e o gestor

`_assert_actor_can_target` e `_assert_actor_can_assign`
(`member_service.py:1763,1777`) respondem **ADMIN → tudo; o resto → só
SUPERVISOR e OPERATOR**. `has_role("ADMIN")` conta o papel de organização, mas
**GESTOR não é ADMIN**. Resultado:

- **GESTOR não faz ninguém gerente pela troca de cargo** (nem mexe em vínculo
  de gerente), mas faz pelo **cadastro**: `create_member` (`:447`) não chama a
  matriz.
- **MANAGER também cadastra MANAGER** pelo mesmo buraco.
- O cadeado do painel (`pode_trocar_papel_do_vinculo`, `:762`) repete a
  matriz, e fecha para o GESTOR os vínculos de gerente.

### 3.3. Estrutura

- **Gerente não apaga subtime.** `subteam.delete` só está no ADMIN (era
  `workspace.manage`, Spec 049 §4.2-bis). As três rotas (`DELETE /teams/{id}`,
  `previa-remocao`, `esvaziar-e-remover`) chegam a `workspace_service.py:399,
  550,594`, que **não conferem a árvore** — inofensivo enquanto só o ADMIN
  tem o verbo, e o motivo de dar o verbo não bastar.
- **Mover time não confere a árvore.** `TeamService.move` (`:451`) recusa
  promover subtime a raiz, auto-referência e ciclo. **Aceita** jogar um
  subtime do Comercial para dentro do Marketing e **aceita** dar pai a um time
  raiz (a raiz vira subtime, e leva a árvore inteira). Não há botão na tela;
  a rota cobra `team.move`, só do ADMIN.

### 3.4. Leituras sem trava, só com o id

- `GET /boards/{id}` (`boards_router.py:233`) busca o quadro só por workspace
  (`_quadro_do_workspace`). **Qualquer pessoa lê quadro de outra árvore** ou de
  subtime irmão, com a contagem de tarefas.
- `obter_formulario` (`form_service.py:226`) não confere time. **O gerente lê
  formulário de outra árvore**, inclusive rascunho.
- **Solicitação sem formulário aparece para quem tem `solicitation.review` em
  qualquer time** (`repository.py:97`, `Solicitation.form_id.is_(None)`). A
  Spec 048 decidiu que ela fica só para a organização.

### 3.5. Tela

- **GESTOR sem time vê "Você não tem acesso ao quadro deste time".**
  `web/lib/lens.ts:109` abre tudo só para `ADMIN`; o comentário de `:81` ainda
  diz que "ninguém é GESTOR hoje". O servidor deixa desde a Spec 049, fatia 0b.
- **`/organizacao` abre para qualquer pessoa que digitar o endereço.** O link
  some (`AppShell.tsx:200`, `podeVerOrganizacao`), a página não confere. Só
  leitura — as escritas o servidor recusa.
- **Resetar senha e desativar aparecem para quem o servidor recusa.**
  `podeResetarSenha` e `podeDesativarConta` (`permissoesMembros.ts:76,81`)
  respondem por "alcance amplo", sem olhar a pessoa. Com o #57 a diferença
  cresceu: o gerente vê os dois botões na conta de outro gerente e leva 403.
- **O seletor de cargo** (`papeisAtribuiveis`, `permissoesMembros.ts:165`)
  decide por `souAdmin`; muda com a decisão 6.

### 3.6. Achados das frentes de revisão que eu não tinha conferido

Conferidos na fatia 0 (16/09):

- ✅ **Confirmado: `mark_task` vincula tarefa fora da lente.**
  `service.py:694` checa o `task_id` só contra o workspace
  (`_assert_tarefa_do_workspace`), e a fila mostra o título dela
  (`titulos_das_tarefas`, sem lente). O MANAGER do Marketing marca uma tarefa
  do Comercial numa solicitação do Marketing — e lê o título. Vira linha, e a
  correção entra na fatia B: tarefa fora da lente é 404, como em toda leitura.
- ⚖️ **Confirmado, e FICA: escrita em formulário de outra árvore responde
  403.** O mesmo vale para quadro, coluna, time e vínculo — toda a gestão
  responde 403 fora da árvore, desde a Spec 049. Trocar só o formulário para
  404 deixaria a regra desigual, e quem manda a escrita já tem o id. O que
  vira 404 é a **leitura** pelo id (§4.8, item 2), que é por onde alguém
  descobre o que não devia.

---

## 4. As decisões

### 4.1. Cada ação confere o verbo no time do item — decisão 1

Pessoa em duas árvores **continua permitida**. O que muda é a pergunta do
serviço, em todos os pontos do §2:

    item fora da LENTE                  -> 404 (como hoje: não vaza existência)
    item na lente, sem o VERBO no time  -> 403
    item na lente, com o verbo no time  -> segue

⚠️ **A ordem é essa de propósito.** Perguntar o verbo primeiro devolveria 403
para item de outra árvore — e 403 confirma que o id existe.

Para as **listas** (fila, formulários) não há item: a pergunta vira "em que
times eu tenho o verbo?". Hoje não existe essa função. Nasce uma, em
`ActorPermissions`:

    teams_with(permission) -> frozenset[UUID] | None
        papel de organização com o verbo  -> None (todos)
        senão                             -> os times de `by_team` que o têm

⚠️ **Contexto sem escopo (`frozenset`, Spec 049 §4.3-bis) responde `None`** —
o mesmo fail-open de `has_permission_in`, pelo mesmo motivo, escrito na
docstring. Tirar o fail-open segue fora (§6).

| ponto | verbo | time |
|---|---|---|
| apagar tarefa | `task.delete` | `task.team_id` |
| moderar comentário (apagar o de outro) | `task.delete` | o time da tarefa |
| criar projeto | `project.create` | `command.team_id` (422 no campo, como hoje) |
| editar / arquivar / desarquivar / apagar projeto | `project.update` / `project.archive` / `project.delete` | `project.team_id` |
| fila de solicitações (listar, abrir) | `solicitation.read` | `teams_with` sobre o time do formulário |
| triar, andamento, criar tarefa | `solicitation.review` | o time do formulário |
| listar e abrir formulário | `form.read` | `teams_with` / `form.team_id` |

⚠️ **O projeto do Comercial continua APARECENDO** para quem é operador lá: a
lente não muda. Some o botão (fatia A, tela) e a escrita dá 403.

### 4.2. Vincular exige que a pessoa já esteja na árvore — decisões 2 e 3

**A regra, uma só para os dois papéis:**

> Quem **não** é da organização só vincula, num time de uma árvore, **quem já
> tem vínculo em algum time dessa árvore** (a raiz ou qualquer subtime).
> Juntar alguém de fora da árvore é da organização (ADMIN e GESTOR).

- **Supervisor** (decisão 2, opção b): puxa para o subtime quem está na raiz
  **ou em outro subtime** da mesma árvore.
- **Gerente** (decisão 3, opção b): não põe no time dele quem está só em
  outra árvore.
- **Quem entra na empresa** entra pelo cadastro (`create_member`), que cria a
  pessoa já dentro da árvore — não passa por esta regra.

✅ **Confirmado por ela (§8, pergunta A):** quem **já está** em
duas árvores (Marketing e Comercial) pode ser vinculado a outro subtime do
Marketing pelo gerente ou supervisor do Marketing. A pessoa já é daquela
árvore; o vínculo novo não junta árvore nenhuma.

⚠️ **E quem tem papel de organização sem time nenhum** (a conta de
administração dela) **não é vinculável** por gerente nem supervisor: não está
em árvore nenhuma.

Onde: `assign_to_team`, depois do onde e antes do nível. Mover entre subtimes
não precisa — origem e destino já estão na árvore de quem move (Spec 049, 0b).

### 4.3. Gerente apaga subtime da própria árvore — decisão 4

`subteam.delete` entra no **MANAGER**. As três funções de
`workspace_service.py` passam a perguntar `has_permission_in("subteam.delete",
team.id)` — o escopo de comando do MANAGER é a árvore dele, então a trava de
árvore é essa linha.

✅ **O GESTOR fica sem** — confirmado por ela (§8, pergunta B): o gestor está
acima, mas o papel dele é ver a organização, não desfazer time.

⚠️ **O botão vem do servidor.** `GET /teams` já devolve `can_update` por time
(Spec 049, fatia F); ganha `can_delete`, pela mesma função da rota. Sem isso,
`podeApagar` voltaria a olhar o verbo "em algum lugar" e o gerente do
Marketing veria a lixeira no Comercial.

### 4.4. Supervisor apaga quadro com as tarefas — decisão 5

**Nada muda no código.** Medido em 16/09: a confirmação de apagar quadro
(`AcoesDoQuadro.tsx`) **já** mostra quantas tarefas vão junto, exige digitar o
nome e avisa se a contagem mudou no meio (`O aviso falava em N, mas M…`) — e
vale para todo papel que apaga quadro, supervisor incluído.

O que muda é o **Mapa**: a célula "supervisor apaga tarefa" continua `·` para
tarefa avulsa, com a nota de que apagar o quadro leva as tarefas dele. A matriz
ganha a linha "SUPERVISOR apaga quadro do SEO **com tarefas**" = OK.

### 4.5. Quem faz gerente — decisão 6

A matriz C2 muda. **A regra nova**, por papel de quem age:

| quem age | em quem mexe (alvo atual) | que cargo dá |
|---|---|---|
| ADMIN | qualquer um | qualquer um |
| GESTOR | MANAGER, SUPERVISOR, OPERATOR | MANAGER, SUPERVISOR, OPERATOR |
| MANAGER | SUPERVISOR, OPERATOR | **MANAGER**, SUPERVISOR, OPERATOR |
| SUPERVISOR | (inalterado: Spec 049, fatia H) | SUPERVISOR, OPERATOR |

- **Gestor faz gerente pelos dois caminhos** (cadastro e troca de cargo), e
  mexe em vínculo de gerente (rebaixar, tirar, mover).
- **Gerente faz gerente** na própria árvore — promove quem é supervisor ou
  operador, ou cadastra já como gerente.
- ⚠️⚠️ **Gerente SÓ PROMOVE** (resposta dela, 16/09, opção b): depois de
  promovido, o novo gerente é um par, e **rebaixar, tirar do time ou mover**
  um gerente continua com gestor e admin. A coluna "em quem mexe" do MANAGER
  não muda. Sem isso, dois gerentes da mesma árvore podiam se rebaixar um ao
  outro.
- **Resetar senha e desativar a conta de um gerente** continuam com gestor e
  admin (#57). Não muda.
- **Vínculo ADMIN antigo de time** conta como ADMIN (`is_admin`), como no #57:
  o gestor não mexe nele.

⚠️⚠️ **Isto REVOGA a Spec 015 (C2) em um ponto** — "MANAGER só atribui
SUPERVISOR/OPERATOR", que existe para impedir "criar par". Os testes que
provam a recusa **mudam de lado de propósito** — candidatos, pela busca de
16/09: `test_member_role_change_db`, `test_member_assign_db`,
`test_member_move_remove_db`, `test_member_root_bind_db`,
`test_cadeado_do_vinculo_db`, `test_team_management_db`; a lista exata sai da
suíte vermelha na fatia C —, e a mensagem do commit diz que foi decisão dela.

⚠️ **O item 4 da revisão ("gerente cadastra gerente") deixa de ser buraco** —
vira a regra. O que era buraco de verdade é o cadastro **não chamar a matriz**:
com a regra nova ele chama, e o GESTOR e o MANAGER passam por ela como na troca
de cargo.

Onde: `_assert_actor_can_target`, `_assert_actor_can_assign`,
`create_member` (passa a chamar a segunda), `pode_trocar_papel_do_vinculo`
(repete a primeira) e, na tela, `papeisAtribuiveis`, que troca o `souAdmin`
por um parâmetro do papel de quem olha.

### 4.6. Mover time só dentro da árvore — decisão 7

`TeamService.move` passa a recusar, com `BusinessRuleError` e mensagem
própria — a mesma forma da recusa de promover subtime a raiz que já existe ali:

- **time raiz ganhar pai** (a raiz vira subtime de outra árvore);
- **destino em outra árvore** (a raiz do novo pai ≠ a raiz do time).

Mover um subtime para baixo de outro subtime **da mesma árvore** continua como
está. ⚠️ **"Desenhar depois" fica registrado, não feito** — como a Spec 046 já
fez com promover subtime a raiz: as perguntas (quadro geral, membros, alcance
do gerente de origem) não têm resposta, e recusar é melhor que escolher calado.

### 4.7. Editar o próprio nome — decisão 8

*"liberar somente para próprio, eu posso editar meu próprio nome"*.

- **`PATCH /auth/me`** com `{ name }`. Sem permissão: é a própria conta, como
  `POST /auth/change-password`. Nome com espaço nas pontas é aparado; vazio é
  422.
- **Ninguém edita o nome de outra pessoa**, admin incluído. Não nasce
  `person.update` para isso — o `person.update` que existe é o reset de senha.
- **Tela:** no menu da conta, ao lado de "Sair". Depois de salvar, o nome muda
  no menu **e** nas listas sem recarregar a página (o cache de `listMembers`
  guarda o nome antigo).

### 4.8. O que já estava decidido, e falta código

Nenhuma decisão nova; cada item cita a de origem.

1. **Solicitação sem formulário só para a organização** (Spec 048 §8). A
   cláusula `form_id IS NULL` do `_base_select` passa a valer só quando
   `teams_with` responde `None`.
2. **Quadro e formulário de outra árvore pelo id → 404**, como tarefa e
   projeto. `GET /boards/{id}` pela lente de `list_boards`; `obter_formulario`
   por `form.read` no time (§4.1).
3. **`/organizacao` só para ADMIN e GESTOR.** A página confere o papel e
   manda para `/` quem não tem, pela mesma condição do link
   (`podeVerOrganizacao`), movida para `lib/`.
4. **GESTOR vê os quadros** (Spec 045, *"gestor vê tudo"*): `lib/lens.ts`
   passa a abrir tudo para **todo papel de organização**, espelhando
   `visible_team_ids` desde a 049 0b.
5. **Os botões de resetar senha e desativar vêm do servidor.** A listagem de
   membros ganha `can_reset_password` e `can_deactivate` por pessoa,
   calculados pelas **mesmas** funções da rota (`_assert_reaches_person` +
   `_assert_pode_agir_sobre_a_conta`, lidas como pergunta). ⚠️ Em lote, sem
   N+1: os vínculos das pessoas da página vêm numa consulta só.
6. **Conta desativada não muda de subtime** (§3.1): `move_member_subteam`
   chama `_assert_alvo_ativo`.

---

## 5. As fatias

Cada uma fica verde sozinha. A 0 vem primeiro; as outras são independentes
entre si e estão na ordem de risco.

**Fatia 0 — o ator de duas árvores, e as linhas das decisões.**
✅ **Entregue em 16/09**, em dois commits. Matriz: **552 casos** (92 linhas
× 6 papéis), verdes. Todas as previsões, lidas do código, bateram na primeira
rodada — a coluna nova (77) e as 14 linhas novas.
Sabotagem F (no cabeçalho do teste): a trava da fatia A só em
`TaskService.soft_delete` derruba **uma** célula, a do ator novo na tarefa do
Comercial.

Na matriz HTTP (`test_matriz_de_permissoes_http_db.py`):

- **um sexto ator: `DUAS_ARVORES`** — MANAGER no Marketing **e** OPERATOR no
  Comercial. A tabela ganha a coluna. (O nome não é `misto` porque a matriz já
  tem um ALVO `misto`, desde a 049.)
- **as linhas que mostram cada buraco**, com o esperado DE HOJE e a marca
  `# DIVERGE DO ALVO: 051 §x` — como a 049 fez. Cada fatia seguinte vira as
  linhas dela;
- **confirmar ou descartar o §3.6**, com uma linha cada;
- **a linha do §4.4** (supervisor apaga quadro com tarefas), já OK.

⚠️ **O mundo da matriz só tem um ator por coluna.** Adicionar `DUAS_ARVORES` como
coluna muda o formato de TODAS as linhas (5 → 6 valores). É mecânico, e é
um commit próprio, antes das linhas novas — para o diff de cada uma continuar
legível.

**Fatia A — tarefa, comentário e projeto no time do item** (§4.1, primeira
metade). `teams_with` nasce aqui, com teste unitário ao lado dos de
`test_permissoes_com_escopo.py`. Tela: o "Apagar" da tarefa, a moderação do
comentário e os botões do projeto passam a perguntar pelo time do item — a
resposta vem na leitura do item (`can_delete` na tarefa e no projeto,
`can_moderate` nos comentários), e não do `/auth/me`.

✅ **Entregue em 16/09.** Backend **1749**, front **1422**, `tsc` limpo,
`next build` ok, `ruff` sem erro novo (50 antes e depois — os mesmos).

- **Servidor:** `TaskService.soft_delete`, `CommentService.delete_comment` e
  as cinco escritas de `ProjectService` perguntam
  `has_permission_in(verbo, time do item)` **depois** da lente — fora dela
  continua 404 (e 422 no `create`), na lente sem o verbo é 403.
  `ActorPermissions.teams_with` e `TenantContext.teams_with_permission`
  nasceram, com o fail-open do contexto legado escrito e testado; quem os usa
  é a fatia B.
- **Os cadeados, e dois desvios do texto acima:**
  - ⚠️ **não nasceu `can_moderate` nos comentários.** Moderar é
    `task.delete` no time da TAREFA — a mesma pergunta do "Excluir". Um campo
    por comentário repetiria a resposta N vezes; a tela passa
    `task.can_delete` para cada linha (`podeModerar`, prop obrigatória).
  - ⚠️ **`can_delete` da tarefa e `can_update`/`can_archive`/`can_delete` do
    projeto são `computed_field` no SCHEMA**, e não montados no router como o
    `can_update` de `GET /teams`. Tarefa e projeto saem por muitas rotas
    (quadro, detalhe, minhas tarefas, arquivadas, criar, mover…); no router,
    a rota esquecida devolveria o item sem cadeado. É puro (lê o contexto da
    requisição, não o banco) e responde `False` sem contexto.
  - ➕ **`can_create_project` em `GET /teams`**, que a spec não previa. A tela
    de projetos oferecia como destino toda área que a pessoa alcança — para
    `DUAS_ARVORES`, o Comercial (e ativo, pré-selecionado), com 403 no POST.
    Agora só as áreas em que ela cria; nenhuma, e o botão some.
- **Matriz:** as 6 linhas de §4.1 desta fatia viraram NEGADO para
  `DUAS_ARVORES` (a da fila é da fatia B). E dois testes novos amarram o
  cadeado à tabela: `test_o_cadeado_do_item_concorda_com_a_matriz` (o campo de
  cada tarefa e projeto contra a linha da ação, por papel) e
  `test_listagem_de_times_diz_onde_cada_papel_cria_projeto`.
- ⚠️ **Um teste antigo afirmava o atalho:**
  `test_tarefa_apagada_ANTES_nao_muda_de_carimbo` apagava tarefa **como
  supervisor**, chamando o serviço direto — só a rota barrava. A preparação
  passou a ser de um MANAGER.
- **Sabotagens:** backend, a F do cabeçalho da matriz (fatia 0). Front,
  duas de uma vez — a tarefa voltando a ler `me.permissions` e o lápis do
  projeto sempre aberto: caíram exatamente os dois testes novos
  (`TaskDetailCadeado`, `ProjetoExcluir`), e só eles.

**Fatia B — solicitação e formulário** (§4.1, segunda metade; §4.8, itens 1 e
2 do formulário). A fila e a lista passam de lente a `teams_with`; a órfã sai
para quem não é da organização; `obter_formulario` responde 404 fora de
`form.read`.

**Fatia C — vínculo e cargo** (§4.2, §4.5, §4.8 item 6). A regra de "já está
na árvore", a matriz C2 nova e o cadastro passando por ela, o cadeado e o
`papeisAtribuiveis` juntos. ⚠️ **É a fatia que revoga decisão escrita** (Spec
015 C2); os testes de recusa mudam de lado com a mensagem do commit dizendo
por quê.

**Fatia D — estrutura** (§4.3, §4.6, §4.8 item 2 do quadro). `subteam.delete`
no MANAGER com a trava de árvore, `can_delete` em `GET /teams`, mover time só
dentro da árvore, e `GET /boards/{id}` pela lente. O `permissions.generated.ts`
é regenerado (o guardião da 049 cobra).

**Fatia E — conta** (§4.7, §4.8 item 5). `PATCH /auth/me`, a tela do nome,
`can_reset_password` e `can_deactivate`.

**Fatia F — telas que decidem sozinhas** (§4.8 itens 3 e 4). `lens.ts` para
papel de organização, e a guarda da `/organizacao`. Só front.

---

## 6. O que esta spec deliberadamente NÃO faz

- **Proibir pessoa em duas árvores.** Decisão 1: continua permitido.
- **Desenhar mover time entre árvores.** Decisão 7: recusado agora, spec
  própria depois (§4.6).
- **Editar o nome de outra pessoa**, nem o e-mail de ninguém (decisão 8).
- **Tirar o fail-open de `has_permission_in`** com contexto sem escopo. Segue
  com a justificativa da Spec 049 §6; `teams_with` herda o mesmo fail-open,
  escrito.
- **Reativar conta** (Spec 049 §6).

---

## 7. O que os portões não vão pegar

- ⚠️⚠️ **Botão calculado pelo `/auth/me` em tela de item.** O `/auth/me` diz
  "o que", nunca "onde" (Spec 049 §7). Toda tela que esta spec toca troca essa
  leitura por um campo do item; **uma que fique para trás mostra botão que dá
  403**, com os quatro portões verdes. A rede é a matriz com o ator `DUAS_ARVORES` —
  no servidor — e a tela aberta como essa pessoa.
- ⚠️ **`teams_with` com contexto sem escopo responde `None`** ("todos"). Job
  de fundo que liste fila ou formulário por ela veria tudo. Hoje nenhum lista.
- ⚠️ **A matriz C2 mora em três lugares** (as duas `_assert_actor_*`, o
  cadeado e o `papeisAtribuiveis`). `test_o_cadeado_concorda_com_o_patch`
  cobra os dois primeiros; o front não tem guardião que compare com o
  servidor.
- **Revogar a C2** faz um revisor ver testes de recusa virando aceite. A
  mensagem do commit tem de dizer que foi decisão, e de quem.

---

## 8. As decisões dela, 16/09

As oito, com a opção escolhida:

1. **Pessoa em duas árvores** — *a*: continua permitida; cada ação confere a
   permissão no time do item. §4.1.
2. **Quem o supervisor puxa** — *b*: quem está em qualquer time daquela
   árvore. §4.2.
3. **Gerente junta árvores** — *b*: não; só a organização. §4.2.
4. **Gerente apaga subtime** — *a*: sim, com trava de árvore. §4.3.
5. **Supervisor apaga quadro com tarefas** — *a, "colocando um aviso que as
   tarefas serão excluídas"*. O aviso já existe (§4.4).
6. **Quem faz gerente** — *a, "e gerente pode tornar alguém de dentro da sua
   árvore gerente"*. Detalhe respondido no mesmo dia: gerente **só promove**
   (opção b). §4.5.
7. **Mover time entre árvores** — *a, "mas desenhar depois"*. §4.6.
8. **Editar nome** — *"liberar somente para próprio"*. §4.7.

### As duas que sobraram, respondidas em 16/09

A. **Quem já está em duas árvores pode ganhar vínculo novo numa delas**, pelo
   gerente ou supervisor daquela árvore? — *"pode uai"*. Sim (§4.2).

B. **O GESTOR apaga subtime?** — **Não.** *"o gestor apesar de estar acima do
   gerente é alguém que basicamente só quer ver os times e subtimes, não
   necessariamente acabar com um do nada"*. O desenho não é torto: o gestor
   supervisiona a organização; quem opera a árvore é o gerente (§4.3).
