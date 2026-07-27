# Plan 028 — Supervisor gerencia operators do próprio subtime

> **CONCLUÍDO em 2026-07-27.** D1–D5 fechadas conforme as propostas. As 4
> fatias foram executadas, mais uma quinta não prevista (ver abaixo).
> Placar: backend **400**, front **121**.
>
> **Desvio do plano, registrado:** a Fatia 2 dizia *"Portão: testes de
> integração da Fatia 3"* — e a Fatia 3, como escrita, testava só o service.
> O gate da rota ficou sem cobertura até ser detectado numa revisão de
> fechamento. Daí a **Fatia 5**. Lição para os próximos planos: quando uma
> fatia muda um gate de rota, o portão dela tem de ser um teste que
> **percorre a rota**, não o serviço por baixo.

## Fatia 5 (não prevista) — testes de rota

`backend/tests/integration/test_supervisor_member_routes_http_db.py` — 9 testes
via cliente ASGI: as 2 rotas abertas, as 4 que seguem fechadas, as travas D1/D2
pelo caminho HTTP e o MANAGER sem regressão.

Sem ela, reverter o gate do router deixava a suíte inteira verde com a
funcionalidade morta.

Porte: **pequeno-médio.** O volume está na autorização e nos testes de
vazamento entre subtimes, não em código novo de negócio. Nenhuma migration de
dados. Uma linha nova no mapa de permissões.

Ordem de deploy: **padrão do DEPLOY.md** (código antes; sem migration de
schema, então não há a exceção da 026). Fatia 1 é backend auto-suficiente e
segura para subir sozinha — ela só *amplia* quem passa nas autorizações; com o
front velho, ninguém exerce o poder novo.

---

## Fatia 1 — Autorização + permissão (backend, auto-suficiente)

Arquivos:
- `backend/app/modules/auth/domain/permissions.py`
  - Adicionar `"member.manage.subteam"` ao frozenset de `SUPERVISOR`
    (D5). **Não** dar a OPERATOR. **Não** tocar ADMIN/MANAGER.
- `backend/app/modules/users/application/member_service.py`
  - Reescrever `_assert_actor_can_target` e `_assert_actor_can_assign` para o
    ramo do supervisor com a **trava de subtime** (spec, "Regra de
    autorização"). O método precisa receber/derivar o `subtime_alvo` — hoje os
    `_assert` recebem só o papel; vão precisar do `team_id` alvo. Revisar a
    cadeia de chamada de `assign_to_team` / `remove_member_from_team` /
    `change_member_role` para passar o `team_id`.
  - **Cuidado (armadilha §8 do handoff):** isto mexe na assinatura de métodos
    internos. Rodar `tsc` não pega backend, mas revisar à mão toda chamada dos
    `_assert` e rodar `pytest` inteiro (não só os testes novos).

**Portão:** `pytest` inteiro verde (esperado: 379 + os novos). A suíte atual de
membros **não pode regredir** — se algum teste de MANAGER/ADMIN quebrar, a
reescrita vazou para o ramo errado.

---

## Fatia 2 — Endpoint (backend)

Decisão: **reusar as rotas de membro que já existem** em vez de criar rotas de
supervisor. As rotas em `users/api/router.py` já chamam o `MemberService`; com
a Fatia 1, a mesma rota passa a aceitar o supervisor **e** a barrar o que ele
não pode. Menos superfície, um caminho de autorização só.

- Conferir que as rotas de `assign`/`remove`/`role` estão sob
  `require_permission(...)` de forma que aceite `member.manage.subteam` **ou**
  `team.manage`. Se hoje exigem `team.manage` fixo, trocar por um gate que
  aceite os dois — a checagem fina (subtime, papel-alvo) fica no service, que é
  onde tem o dado.

**Portão:** testes de integração da Fatia 3.

---

## Fatia 3 — Testes de integração (backend) — a fatia que prova a spec

Arquivo novo: `backend/tests/integration/test_supervisor_member_scope_db.py`

Cada critério de aceitação da spec vira um teste. Os que **provam a trava**:

1. `test_supervisor_adiciona_operator_no_proprio_subtime` → 200.
2. `test_supervisor_nao_alcanca_outro_subtime` → 403. **(a trava D1)**
3. `test_supervisor_nao_promove_supervisor` → 403.
4. `test_supervisor_nao_desativa_conta` → 403.
5. `test_supervisor_nao_mexe_em_manager` → 403.
6. `test_manager_admin_sem_regressao` → o poder amplo segue.

> **Sabotagem obrigatória (regra da Camila, §8).** Antes de dar por pronto:
> remover **de propósito** a trava `subtime_alvo == subtime do ator` da Fatia 1
> e confirmar que o teste 2 **fica vermelho**. Conferir com `grep` que a
> sabotagem entrou no arquivo (o `sed` engasga com escapes) antes de rodar.
> Teste que passa contra a trava removida não está testando a trava —
> reescrever até falhar. Depois, restaurar e confirmar verde.

**Sem `monkeypatch`/espião** de símbolo que a Fatia 1 possa renomear — o teste
exercita a rota real contra o Postgres real, não espiona função interna.

---

## Fatia 4 — Front: ampliar a tela de membros (não criar nova)

Arquivos:
- `web/app/membros/page.tsx`
  - Gate hoje: `podeGerenciar = permissions.includes("team.manage")`
    (linha 67). Passa a `team.manage || member.manage.subteam`.
  - Quando o poder vem de `member.manage.subteam` (supervisor), a tela **filtra
    a lista** para o subtime do ator (o `teams=[{team_id, role}]` de `/auth/me`
    já diz qual é) e **esconde** promoção de papel e ações de outros times.
    `souAdmin`/`podeGerenciar` já modelam ramos assim — é mais um ramo, não uma
    reescrita.
  - Trocar o texto da linha 223 ("Isso muda quando existir um quadro de
    subtime") pelo comportamento real.
- `web/lib/api.ts` — os métodos `assignMemberToTeam` /
  `removeMemberFromTeam` já existem; provável que nenhum precise mudar.

> **Regra da fronteira do front (Spec 027):** a lógica de "o que este ator pode
> ver/fazer" é decisão → vai para `web/lib/`, função pura, testável. **Não**
> enfiar `if souSupervisor` espalhado no JSX de 300+ linhas — foi assim que
> nasceu o bug do modal. Extrair algo como
> `web/lib/permissoesMembros.ts::acoesPermitidas(me, membroAlvo)` e testar.

**Portão:** `npm test` (com testes novos da função pura de permissão),
`tsc --noEmit`, `next build`.

---

## Fora de escopo (não fazer nesta spec)

- Qualquer coisa com **times** (criar/mover/remover) → Spec 029.
- Supervisor cadastrar pessoa nova → depende de D3; se aprovado, é fatia
  própria por causa do fluxo de senha temporária.
- Auditoria/log de "quem adicionou quem" — `task_history` é de tarefa, não de
  membro. Se quiser trilha de mudança de membro, é escopo à parte.

## Estimativa honesta

Fatias 1–3 (backend + prova): o grosso do trabalho e do risco. Fatia 4 (front):
menor, porque a tela existe. **Não é trabalho de semana de lançamento** — é
uma spec de médio porte que mexe em autorização, a parte do sistema onde um
erro é silencioso e perigoso.
