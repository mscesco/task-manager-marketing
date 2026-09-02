# Briefing — permissões, papéis e times como PRODUTO

**Isto não é uma spec.** É a entrada para uma. Escrito em 31/08/2026 para abrir
uma conversa nova sobre como a Camila quer que a organização, os times e os
papéis funcionem — antes de qualquer código.

⚠️ **O número 045 é provisório.** Renumere quando a spec de verdade nascer.

⚠️ **Regra de leitura:** tudo aqui tem `arquivo:linha`. **Confira antes de
afirmar.** Este projeto já teve três escopos desmentidos pelo próprio código, e
uma pergunta que a ADR 0039 chamou de "aberta" já estava respondida em código
havia semanas (ver §6).

---

## 1. O que a Camila quer decidir

Ela abriu assim, em 31/08:

> *"Gostaria de começar a reorganizar o gerenciamento do workspace/times e
> membros e afins para poder incluir outros times."*

Duas telas que ela propôs:

1. **Tela da organização** — gerenciar a organização, seus membros e os **times
   raiz**. *(Ela mesma disse: "concordo com a primeira".)*
2. **Tela dentro do time** — gerenciar o time, criar e gerir subtimes, mover
   membros dentro dele. **E: uma pessoa pode estar em mais de um time e em mais
   de um subtime.**

Sobre a segunda ela própria levantou a dúvida: *"será que essa é a forma mais
correta de fazer essa parte? Não é correto usar o que já tem, que seria o
`user_team` e dentro tem o `role`?"*

**A resposta é sim, e a §3 explica por quê** — o mecanismo já existe. A pergunta
que sobra é de produto: **que telas, com que recortes, para quem.**

---

## 2. O modelo de hoje, em uma página

### Quatro papéis, e onde cada um pode existir

| papel | pode existir na raiz | pode existir em subtime |
|---|---|---|
| `ADMIN` | ✅ | ❌ |
| `MANAGER` | ✅ | ❌ |
| `SUPERVISOR` | ✅ | ✅ |
| `OPERATOR` | ✅ | ✅ |

Guardado por `assert_role_permitido_no_nivel`
([team_scope.py:183](../../app/modules/auth/domain/team_scope.py)), aplicado nas
**quatro portas** do `MemberService` (linhas 314, 536, 610, 773).

⚠️ **`UserTeamRole` é `StrEnum` e NÃO tem ordem.** Está declarado em ordem
decrescente por coincidência de leitura. Qualquer regra que compare "maior que"
precisa de um mapa de posto explícito.

### O mapa de permissões

Fonte única: [permissions.py:53](../../app/modules/auth/domain/permissions.py).

| permissão | ADMIN | MANAGER | SUPERVISOR | OPERATOR |
|---|:--:|:--:|:--:|:--:|
| `workspace.manage` | ✅ | | | |
| `team.manage` | ✅ | ✅ | | |
| `member.manage.subteam` | | | ✅ | |
| `solicitation.review` | ✅ | ✅ | | |
| `solicitation_form.manage` | ✅ | ✅ | | |
| `project.create` / `.delete` | ✅ | ✅ | | |
| `project.update` | ✅ | ✅ | ✅ | |
| `task.create` / `.update` / `.assign` | ✅ | ✅ | ✅ | ✅ |
| `task.delete` | ✅ | ✅ | | |
| `board.manage.root` | ✅ | ✅ | | |
| `board.manage.subteam` | ✅ | ✅ | ✅ | |

⚠️⚠️ **ESTE MAPA NÃO É MONOTÔNICO, e é o fato mais fácil de esquecer.**
`member.manage.subteam` existe **só** no SUPERVISOR. Um MANAGER **não a tem**.
Quem desenhar "papel maior herda o menor" vai quebrar isso sem perceber.

Hoje isso não causa dano porque `_assert_escopo_supervisor` faz *early return*
para quem tem `team.manage`
([member_service.py:929](../../app/modules/users/application/member_service.py)) —
managers são governados por outra matriz. **É uma coincidência que funciona, não
um desenho.**

### As duas camadas — e só a primeira ignora o time

| pergunta | quem responde | olha o time? |
|---|---|---|
| **que tipo** de ação eu faço | `permissions_for_roles` — a **união** dos papéis | ❌ de propósito |
| **onde** eu a faço | `visible_team_ids`, `editable_team_ids`, `_subtimes_supervisionados`, `_assert_escopo_supervisor`, `_assert_escopo_do_quadro` | ✅ vínculo a vínculo |

`visible_team_ids` ([team_scope.py:78](../../app/modules/auth/domain/team_scope.py)):

- **ADMIN** → `None`, que significa *todos* (retorno antecipado, sem filtro).
- **MANAGER/ADMIN de T** → T **+ descendentes**.
- **SUPERVISOR/OPERATOR de X** → X **+ a raiz**.

`editable_team_ids` hoje é **idêntica** a `visible_team_ids` — chama ela e ponto
(linha 108). Se a conversa nova quiser "vê mas não edita", **é aqui que a
distinção nasce**, e hoje ela não existe.

---

## 3. Por que a união de papéis é segura hoje (e o que a torna frágil)

O `permissions.py` tem 17 linhas de comentário defendendo isso, e o argumento é
bom:

> *A correção NÃO foi criar permissão por time. Foi restringir ONDE cada papel
> pode existir: ADMIN e MANAGER só existem no time RAIZ. Como quem carrega esses
> papéis é necessariamente membro da raiz, "união dos papéis" e "autoridade
> sobre a árvore" **coincidem por construção**.*

⚠️⚠️ **E É EXATAMENTE ESSA COINCIDÊNCIA QUE A REORGANIZAÇÃO QUEBRA.**

A Camila já decidiu (31/08) que a árvore vai virar **várias raízes de verdade** —
Marketing, TI e Design como irmãos, sem pai comum. Nesse mundo:

> Um MANAGER de TI carrega `team.manage` sem que `permissions_for_roles` saiba
> **de qual árvore**. "Membro da raiz" deixa de identificar uma raiz só, e a
> coincidência acima deixa de valer.

**Este é o item de arquitetura mais importante da conversa nova.** Não é o índice
`team_unica_raiz_por_workspace`; é isto. As saídas possíveis, em ordem crescente
de custo:

1. Manter a união e **escopar cada permissão sensível** no serviço (o que já se
   faz com `member.manage.subteam` e `board.manage.subteam` — o mapa diz *o
   quê*, o serviço diz *onde*).
2. Fazer `permissions_for_roles` devolver **permissões por time**, e não um
   conjunto plano. Muda a assinatura e todos os `require_permission`.
3. RBAC dinâmico em tabela. O `permissions.py` diz que isso foi conscientemente
   recusado na fundação: *"não quero RBAC complexo agora"*.

**Não decida isso sozinho. É decisão de produto com custo, e ela pede o custo.**

---

## 4. O que já existe de tela e de rota

**Telas:** `/membros`, `/times`, `/projetos`, `/quadro`, `/quadro/[teamId]`,
`/formularios`, `/solicitacoes`, `/arquivadas`, `/minhas-tarefas`, `/perfil`.

**Não existe** tela de organização/workspace. Renomear o workspace é rota sem
tela.

**Rotas de workspace/time** ([workspaces/api/router.py](../../app/modules/workspaces/api/router.py)):

| rota | gate |
|---|---|
| `PATCH /workspaces/current` (renomear) | `workspace.manage` — só ADMIN |
| `POST /workspaces/current/teams` (criar equipe) | **`team.manage`** — ADMIN + MANAGER |
| `POST .../teams/{id}/move` | `workspace.manage` |
| `DELETE .../teams/{id}` (equipe vazia) | `workspace.manage` |

⚠️ **Criar time RAIZ já funciona hoje:** basta `parent_team_id` nulo
([router.py:114](../../app/modules/workspaces/api/router.py)). O que impede
várias raízes é o índice único no banco, não a API.

⚠️ **Achado de documentação:** o docstring do módulo (linha 18) diz que criar
equipe exige `workspace.manage`. **Está desatualizado** — a Spec 029/D1 desceu o
gate para `team.manage` e o texto ficou. É pequeno, mas é exatamente a classe do
§10 do `AGENTS.md` ("texto que promete o que o código não faz").

---

## 5. Regra nova da Camila, já decidida (31/08)

> *"Ele não pode ter menos permissão no raiz do que tem no subtime."*

Ordenação pretendida: `OPERATOR < SUPERVISOR < MANAGER < ADMIN`.

| vínculo na raiz | vínculo no subtime | vale? |
|---|---|---|
| OPERATOR | SUPERVISOR | ❌ **é isto que a regra mata** |
| MANAGER | SUPERVISOR | ✅ *("mesmo não fazendo sentido")* |
| **nenhum** | SUPERVISOR | ✅ **ausência não é "menos"** — decisão dela |

✅ **Varredura rodada no Adminer em 31/08: nenhum registro em estado inválido.**
A regra liga sem remediação de cadastro. A consulta está na §4.1-bis da
[Spec 044](../044-uma-pessoa-em-varios-times/spec.md).

⚠️ **Seja honesto sobre o que ela faz:** ela **não** tapa furo de segurança — os
gates de escopo já seguram o caso. Ela impede **organograma incoerente**. Ainda
vale a pena, mas não venda como segurança.

---

## 6. Armadilhas — leia antes de propor qualquer coisa

⚠️ **1. "Papel efetivo com papéis divergentes" JÁ ESTÁ RESOLVIDO.** A ADR 0039
listou isso como pergunta aberta. Não é: a Spec 028 resolveu em código —
`_subtimes_supervisionados` filtra por `role == SUPERVISOR`, vínculo a vínculo
([member_service.py:900](../../app/modules/users/application/member_service.py)).
**Eu recomendei "consertar" isso numa spec e a recomendação era um no-op.** Abra
o arquivo antes de repetir o erro.

⚠️ **2. Não reconstrua escopo no front a partir de `team_id`.** A Spec 034
desfez exatamente isso. `GET /members` **nunca devolveu papel**, e a regra
espelhada no front fazia gestor e admin sumirem dos seletores em tarefa interna
de subtime — reportado duas vezes com captura. Hoje quem responde "quem alcança"
é o backend, pela mesma função que o POST de designação usa. Se aparecer
necessidade de filtrar escopo no front, **falta parâmetro na rota**.

⚠️ **3. A trava de escopo não mora no mapa de permissões.** O mapa diz *o quê*;
o serviço que tem o `team_id` do alvo diz *onde*. Vale para
`member.manage.subteam` e `board.manage.subteam`, e é o padrão a seguir.

⚠️ **4. Mudar quem aparece num seletor é mudança de permissão, não de UI.**
`temAcaoPossivel` ([permissoesMembros.ts](../../../web/lib/permissoesMembros.ts))
decide se a linha tem botão. Parece desenho; muda quem administra quem.

⚠️ **5. A lista de membros mostra TODO MUNDO, de propósito** (decisão da Camila,
27/07). Esconder linha fazia o contador do cabeçalho divergir do corpo. O que
varia é o **botão**, nunca a presença.

⚠️ **6. Regra que vale só na tela não vale para o n8n, o Swagger e a chamada
direta.** Já aconteceu duas vezes aqui: a ADR 0031 (`assignee_ids`) e o pin de
time do `createTask`. Toda regra nova precisa decidir se mora no serviço.

---

## 7. O que está em voo

**Spec 044 — uma pessoa em vários times.** Executa o que a ADR 0039 decidiu em
10/08.

- ✅ **Fatias 1+2 em `main`** (PR #40, merged 31/08, CI verde). A listagem parou
  de assumir um subtime por pessoa: `MemberResponse.team_ids` é lista,
  `array_agg` no repositório, front inteiro portado.
- ⏳ **Fatia 3, não começada** — remove `_assert_one_subteam` e as três chamadas.
  **É a que desbloqueia a redatora** que o negócio precisa em SEO e Mídias
  Sociais, parada desde agosto.
- ⏳ **Fatia 4** — o time da tarefa passa a vir do quadro, no backend.
- ⏳ **Fatia 5** — a regra da §5 acima.

⚠️ **A trava de um-subtime AINDA ESTÁ DE PÉ.** Enquanto ela existir, nada de
multi-subtime funciona pela tela. E **nenhum teste afirma o 422 dela** —
removê-la não acende nada sozinha; o que segura é o teste escrito na fatia 1,
que já está na `main`.

**Depois da 044, por decisão dela:** a spec das **várias raízes**.

---

## 8. Perguntas que a conversa nova precisa responder

Perguntas de **produto**, não de implementação:

1. **Organização vs. time raiz.** Hoje a raiz se chama `marketing` e acumula os
   dois papéis. Com N raízes, quem é "a organização"? Existe uma entidade acima
   das raízes, ou o workspace já é isso?
2. **Quem administra o quê, em uma frase por papel.** O mapa de hoje cresceu por
   spec; ninguém escreveu a intenção. ⚠️ Escrever isso provavelmente revela
   incoerências — a não-monotonicidade da §2 é uma.
3. **ADMIN e MANAGER com N raízes.** Um MANAGER pertence a *uma* raiz ou pode
   gerir várias? A resposta decide qual das três saídas da §3 é necessária.
4. **"Vê" e "edita" são a mesma coisa?** Hoje sim, literalmente. Se as telas
   novas precisarem separar, é mudança estrutural.
5. **Quem cria e quem apaga time?** Criar é `team.manage`; apagar é
   `workspace.manage`. A assimetria é deliberada ("criar é reversível, remover
   não") — vale para as telas novas?
6. **A tela do time é uma só, ou uma por nível?** Gerir um subtime e gerir uma
   raiz são trabalhos diferentes, com públicos diferentes.

---

## 9. Onde ler, na ordem

1. [`permissions.py`](../../app/modules/auth/domain/permissions.py) — o mapa e as
   17 linhas que explicam por que ele ignora o time.
2. [`team_scope.py`](../../app/modules/auth/domain/team_scope.py) — as lentes e a
   invariante de nível.
3. [`member_service.py`](../../app/modules/users/application/member_service.py) —
   os gates de escopo (`_assert_escopo_supervisor`, `_tem_gestao_ampla`).
4. [ADR 0008](../../docs/adr/0008-um-subtime-por-usuario.md) e
   [ADR 0039](../../docs/adr/0039-multi-subtime-adiado-ate-a-036.md).
5. [Spec 044](../044-uma-pessoa-em-varios-times/spec.md) — em especial a §4, que
   foi **reescrita depois de a Camila contestar duas recomendações minhas, e as
   duas contestações estavam certas.**
6. [`AGENTS.md`](../../../AGENTS.md) — processo, portões e armadilhas do domínio.
