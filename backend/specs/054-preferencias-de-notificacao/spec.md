# Spec 054 — Preferências de notificação

**Status:** escrita em 17/09/2026, a partir de quatro rodadas de perguntas
respondidas por ela no mesmo dia (§4). **Aprovada em 17/09**, com as seis
propostas da §9 como escritas. O código só começa
**depois do merge do PR #61** (Spec 053), porque esta spec depende dos tipos de
aviso, da tela `/notificacoes` e da trava que a 053 cria.
**Escopo:** backend (tabela de preferências, papel gravado no aviso, migration
com preenchimento dos avisos antigos, filtros de leitura) e front (cartão
"Notificações" no Meu perfil, aba "Silenciadas" em `/notificacoes`).
**Placar na abertura:** a medir quando a fatia A começar, na `main` com a 053.

---

## 1. De onde vem

Ela, em 17/09, com a 053 quase pronta:

> *"agora que estamos adicionando muitas coisas com notificações dentro da
> aplicação: talvez uma tela de configuração de notificações dentro do perfil
> que permite mudar as notificações que quero ou não receber (…) deixa TODAS as
> opções de notificações possíveis (…) com toggle em cada uma das
> possibilidades de notificações"*

---

## 2. O que existe — depois da Spec 053

- **Tipos de aviso**, 15 (`notifications/domain/notification.py`):
  - de tarefa, com audiência: `TASK_COMMENTED`, `TASK_COLUMN_CHANGED`,
    `TASK_DUE_CHANGED`, `TASK_DESCRIPTION_CHANGED`, `TASK_ARCHIVED`,
    `TASK_UNARCHIVED`, `TASK_DELETED`, `TASK_DUE_SOON`, `TASK_OVERDUE`;
  - pessoais: `TASK_MENTIONED`, `TASK_ASSIGNED`, `TASK_COMMENT_REACTED`,
    `TASK_WATCH_ADDED`, `TASK_WATCH_REMOVED`, `ACCESS_LOST`.
- **Audiência:**
  - comentário e mudanças de tarefa vão para **seguidores + responsáveis +
    criador** (053, D15);
  - prazo chegando e vencido vão para os **responsáveis ativos**, ou para o
    **criador** quando não há nenhum (Spec 023, D2).
- ⚠️ **O aviso não guarda por que chegou.** A tabela `notification` sabe quem
  recebe, mas não se foi "como seguidor", "como responsável" ou "como criador".
  É o que esta spec acrescenta.
- **Leitura:**
  - o sino mostra as 20 mais novas;
  - `/notificacoes` tem as abas "Não lidas" e "Todas" e filtros (053, fatia F);
  - `unread-count` alimenta o número do sino.
- **Perfil** (`web/app/perfil/page.tsx`): cartão com nome (editável), e-mail e
  papéis. Não há preferência nenhuma hoje.
- **Seguir** ainda não tem uso real em produção: a tela nasce com a 053. Quase
  todo aviso antigo chegou por "criou" ou "é responsável".

---

## 3. O que esta spec entrega

1. Um cartão **"Notificações"** no Meu perfil, com **24 toggles** e 3 linhas
   travadas, salvando a cada clique.
2. Aviso de tipo e papel desligados **continua sendo gerado**, mas vai para a
   aba **"Silenciadas"**: não aparece no sino, em "Não lidas" nem em "Todas", e
   não conta como não lido.
3. A preferência vale **na hora de ler**: desligar esconde também o que já
   chegou, e religar traz de volta.

---

## 4. Decisões dela (17/09)

- **D1 — Desligar esconde, não apaga.** O aviso é gerado e guardado. Religar
  mostra o histórico.
- **D2 — Um toggle por tipo e por papel.** Papéis: seguidor, responsável,
  criador.
- **D3 — Travados, sem toggle:** menção, designação e perda de acesso.
- **D4 — Vários papéis na mesma tarefa: aparece se QUALQUER papel estiver
  ligado.** Desligar "como seguidor" nunca cala o que se recebe como
  responsável.
- **D5 — Aba "Silenciadas"** em `/notificacoes`, ao lado de "Não lidas" e
  "Todas". O que está silenciado não aparece no sino nem em "Todas".
- **D6 — A tela de configuração mostra TUDO**, e os três obrigatórios aparecem
  **travados**: ligados, desabilitados e com uma linha explicando por quê.
- **D7 — Salva na hora**, a cada toggle, com aviso curto na pilha.
- **D8 — A lista de toggles** (§5).
- **D9 — Retroativo nos dois sentidos**: a preferência é aplicada na LEITURA.
- **D10 — Lugar:** seção no Meu perfil (`/perfil`). A tela de notificações ganha
  um link "Configurar".
- **D11 — Começa tudo ligado**, e um tipo criado no futuro também nasce ligado.
- **D12 — O papel é o do MOMENTO em que o aviso nasceu.** Deixar de seguir
  depois não muda o que aquele aviso foi.
- **D13 — Avisos antigos: descobrir o papel** na migration (§6.3). Quando não
  der para saber, o aviso nunca é silenciado.
- **D14 — Silenciado só conta como não lido dentro da aba "Silenciadas".** Não
  entra no número do sino nem no "Marcar todas" do sino.
- **D15 — Só a própria pessoa** mexe nas próprias preferências. Ninguém mais,
  nem admin.

---

## 5. Os toggles (D8)

| Grupo | Aviso | Seguidor | Responsável | Criador |
|---|---|:-:|:-:|:-:|
| Comentários | Comentário novo | ✓ | ✓ | ✓ |
| Andamento | Mudança de coluna | ✓ | ✓ | ✓ |
| Andamento | Mudança de prazo | ✓ | ✓ | ✓ |
| Andamento | Edição da descrição | ✓ | ✓ | ✓ |
| Andamento | Arquivar e desarquivar | ✓ | ✓ | ✓ |
| Andamento | Exclusão | ✓ | ✓ | ✓ |
| Prazos | Prazo chegando | — | ✓ | ✓ |
| Prazos | Prazo vencido | — | ✓ | ✓ |
| Sobre você | Reação ao seu comentário | um toggle | | |
| Sobre você | Alguém pôr ou tirar você como seguidor | um toggle | | |
| Sempre ligados | Menção · Designação · Perda de acesso | travados (D3, D6) | | |

**Total: 24 toggles + 3 linhas travadas.**

- `TASK_ARCHIVED` e `TASK_UNARCHIVED` dividem um toggle.
- `TASK_WATCH_ADDED` e `TASK_WATCH_REMOVED` dividem outro.

A tela desenha uma **grade**: uma linha por aviso e uma coluna por papel.
Assim os 24 toggles cabem em 10 linhas, e não numa lista de 24.

Textos das linhas travadas (proposta):
- **Menção:** "Alguém chamou você com @ — sempre avisa."
- **Designação:** "Você virou responsável — sempre avisa."
- **Perda de acesso:** "Você deixou de ver tarefas — sempre avisa."

---

## 6. Consequências técnicas

### 6.1. Preferência como EXCEÇÃO, não como linha para tudo

Tabela `notification_mute` (nome em inglês, regra do projeto):
- `user_id`, `workspace_id`, `type` (`String(40)`) e `role` (`watcher` |
  `assignee` | `creator` | `none`);
- `UNIQUE (user_id, type, role)`.

**Uma linha = um toggle DESLIGADO.** A ausência significa ligado, e é isso que
cumpre a D11 sem migration a cada tipo novo.

- Os dois toggles que dividem tipos gravam as duas linhas juntas
  (arquivar + desarquivar; pôr + tirar como seguidor).
- Os toggles de papel único ("reação", "pôr ou tirar você") usam
  `role = none`.

### 6.2. O papel gravado no aviso (D12)

- **Nova coluna** `notification.roles text[]`, com um ou mais de `watcher`,
  `assignee`, `creator`.
- **Tipos sem papel** (menção, designação, reação, pôr/tirar, perda de acesso)
  gravam `{}` e nunca silenciam por papel. Os dois desligáveis entre eles
  ("reação" e "pôr/tirar") silenciam pelo tipo, com `role = none`.
- **Na emissão**, cada destinatário carrega o conjunto dos papéis que ele tem na
  tarefa naquele instante:
  - `TaskNotices._destinatarios` passa a devolver `dict[user_id, set[role]]`;
  - `comment_service` faz o mesmo;
  - o job de prazo usa `assignee`, ou `creator` no fallback.
- ⚠️ **Na junção de avisos (053, D18)**, os papéis se UNEM: o aviso juntado
  guarda os papéis dos dois.

### 6.3. Migration: preencher os avisos antigos (D13)

Para cada notificação existente de um tipo de tarefa com audiência, o papel é
reconstruído pelo que existe HOJE:
- `assignee` se há `task_assignment` do destinatário na tarefa;
- `creator` se `task.created_by` é o destinatário;
- `watcher` se há `task_watcher`.

Nenhum encontrado (a pessoa deixou de ser responsável, por exemplo) → `{}` →
**nunca silenciado**. Na dúvida, o aviso aparece.

⚠️ **É aproximado, e a aproximação erra para o lado seguro:** um aviso antigo
pode ganhar um papel a mais (a pessoa virou responsável depois), mas nunca é
escondido por um papel que não teve.

Antes do deploy, uma query para ela medir no Adminer, em SQL puro: quantos
avisos existem, e quantos ficariam sem papel.

⚠️ **Portão de drift** (tabela nova e coluna nova).

### 6.4. A regra de silêncio, num lugar só (D4, D9, D14)

Um aviso está **silenciado** quando:
- **tipo com papel** (comentário, andamento, prazos): `roles` NÃO está vazio
  **e** existe linha em `notification_mute` para **cada** papel de `roles`. Um
  papel ligado basta para aparecer (D4). `roles` vazio nunca silencia (D13).
- **tipo de papel único** (reação, pôr/tirar como seguidor): existe a linha com
  `role = none`.
- **tipo travado** (menção, designação, perda de acesso): nunca.

Em SQL, um `NOT EXISTS` sobre `unnest(roles)` contra `notification_mute`.
**Uma função só no repositório**, usada por:
- `list_for_me`: abas "Não lidas" e "Todas" EXCLUEM silenciadas; a aba
  "Silenciadas" INCLUI SÓ elas;
- `count_unread` (o sino);
- `mark_all_read`: o sino e as abas comuns não tocam silenciadas; a aba
  "Silenciadas" marca só elas.

⚠️ **Guardião:** um teste que desliga um toggle e afirma as QUATRO leituras
(sino, "Todas", "Silenciadas" e contagem) ao mesmo tempo. Se uma delas usar
outra regra, ele cai.

### 6.5. Rotas

- `GET /me/notification-preferences` → os toggles como a tela os desenha:
  `[{type_group, role, enabled, locked}]`.
- `PUT /me/notification-preferences` com `{type_group, role, enabled}` → liga
  ou desliga UM toggle.
  - Idempotente.
  - Recusa **422** para tipo travado.
  - Só a própria pessoa: a rota é `/me` e não recebe `user_id` (D15).
- `GET /notifications` ganha `muted=true` para a aba "Silenciadas".

### 6.6. Front

- **Cartão "Notificações"** em `/perfil`:
  - a grade de §5, com um interruptor de liga/desliga em cada célula;
  - otimista: grava a cada clique e volta atrás com aviso se falhar;
  - as três linhas travadas.

  ⚠️ **Escrito aqui como "o `Toggle` que já existe", e na fatia D isso mudou.**
  O `Toggle` da Spec 047 escolhe entre **dois assuntos**, com as duas palavras à
  vista, e ocupa 320px — inviável em 24 células. A fatia D criou
  `components/Switch.tsx`, e agora são três componentes com papéis distintos:
  `Tabs` recorta uma lista, `Toggle` troca de assunto, `Switch` liga um valor.
- **`/notificacoes`:**
  - terceira aba, "Silenciadas";
  - link "Configurar" no cabeçalho, levando a `/perfil#notificacoes`.

  ⚠️ **O `muted` entra no FILTRO, e não só na listagem** (achado da fatia D). O
  "marcar todas" mandava `{}` quando não havia recorte de tipo ou tarefa — e na
  aba "Silenciadas" isso marcaria as notificações das OUTRAS abas, deixando
  intactas as que estavam na tela. A regra virou `filtroDeMarcar`, com teste.
- **Regra em `lib/notificationPreferences.ts`:** grupos, rótulos, travados e o
  mapa toggle → tipos. Com teste.

---

## 7. Fatias

| Fatia | O quê | Portões extras |
|---|---|---|
| **A** | Migration: `notification_mute`, `notification.roles` e o preenchimento (§6.3) | **drift**; query de medição para ela |
| **B** | Emissão grava `roles` (§6.2), inclusive na junção | — |
| **C** | Regra de silêncio nas quatro leituras, `muted=true` e rotas de preferência (§6.4–6.5) | guardião das quatro leituras |
| **D** | Front: cartão no perfil, aba "Silenciadas" e link "Configurar" | `next build` |

⚠️ **Deploy:** A cria tabela e coluna em model existente → **migration antes do
código**, como a 0027.

---

## 8. Fora do escopo

- E-mail e push: não existem no produto.
- Silenciar UMA tarefa específica: seguir e deixar de seguir já cobrem.
- Horário de silêncio (não perturbe).
- Admin mexer na preferência de outra pessoa (D15).

---

## 9. Propostas que nenhuma pergunta cobriu — APROVADAS em 17/09

1. **Nomes:** `notification_mute` (uma linha = desligado) e `notification.roles`.
2. **Grade** (linhas × papéis) em vez de lista de 24 (§5).
3. **Textos das linhas travadas** (§5).
4. **Aviso "Preferência salva"** a cada toggle (D7 disse "aviso curto"). Se
   ficar barulhento, a alternativa é avisar só quando falhar.
5. **Silenciadas também filtram** por tipo e por tarefa ou projeto, como as
   outras abas.
6. **Link "Configurar"** no cabeçalho de `/notificacoes`, e não no sino.
