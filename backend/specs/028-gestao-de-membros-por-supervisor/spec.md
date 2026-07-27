# Spec 028 — Supervisor gerencia operators do próprio subtime

> **Status: RASCUNHO. Não construir sem fechar as decisões abertas (§ Decisões
> a fechar).** Escrita durante a semana do lançamento (dia 27) para ser
> executada **depois** dele, com dados reais de como os times se organizam.

## Objetivo

Hoje só **ADMIN** e **MANAGER** (papéis do time raiz) mexem em membros. A tela
`web/app/membros/page.tsx` está trancada por `team.manage`, que nenhum
SUPERVISOR possui. Um supervisor de subtime não consegue puxar um operator
para dentro do próprio time nem tirá-lo — precisa pedir para a Camila.

Esta spec abre **uma fatia estreita**: o SUPERVISOR de um subtime pode
**adicionar e remover OPERATOR dentro do próprio subtime**, e nada além disso.

> **Isto NÃO é reabrir a Spec 024.** A 024 fechou a invariante de papéis por
> nível. Esta spec **não** dá ao supervisor poder de promover, de criar par ou
> superior, de mexer em quem está em outro subtime, nem de existir/apagar
> times (isso é a Spec 029). É estritamente "supervisor aloca braço operacional
> no próprio time".

## Por que isso é uma decisão de produto, não um `if`

O pedido inicial da Camila foi "o backend provavelmente já permite". **Não
permite** — e foi decisão consciente, não esquecimento:

- `member_service.py:557` `_assert_actor_can_target` — só ADMIN e MANAGER
  passam; SUPERVISOR cai no `else` e leva **403**.
- `member_service.py:571` `_assert_actor_can_assign` — idem para atribuir papel.
- `permissions.py:81-88` — SUPERVISOR tem `project.update` e `task.*`.
  **Nenhuma permissão de membro.** Não é bug: dar a um supervisor o poder de
  puxar gente para o time dele é dar poder de **alocação de pessoas**, que a
  024 deliberadamente concentrou no nível raiz.

Portanto a mudança altera a fronteira que a 024 fechou. É legítima, mas exige
esta spec — e a Camila cravar as decisões abaixo antes de qualquer código.

## O que já existe (reuso, não invento) — VERIFICADO no código

- **`MemberService` já tem os métodos.** `assign_to_team` (linha 265),
  `remove_member_from_team` (381), `change_member_role` (324),
  `move_member_subteam` (427), `list_members` (235). O que falta **não** é
  lógica de negócio — é **autorização** que reconheça SUPERVISOR.
- **A tela de membros já existe e já faz o trabalho.**
  `web/app/membros/page.tsx` importa `assignMemberToTeam`,
  `removeMemberFromTeam`, `moveMemberSubteam` (linhas 17-19), gated por
  `podeGerenciar = permissions.includes("team.manage")` (linha 67). **Não é
  tela nova; é ampliar o gate e o escopo de uma tela existente.**
- **A própria tela já previa este crescimento:** linha 223,
  *"Isso muda quando existir um quadro de subtime."*
- **`/auth/me` já devolve o papel por time.** `router.py:88-92` retorna
  `roles`, `permissions` e `teams=[{team_id, role}]`. O front já sabe em qual
  subtime o usuário é SUPERVISOR — a informação para escopar a tela **já chega
  pronta**, sem endpoint novo.
- **`_assert_one_subteam` (linha 534)** já garante que um membro está em no
  máximo um subtime — invariante que a fatia de "adicionar" precisa respeitar
  e que já está implementada.

## Decisões a fechar (só a Camila) — a spec NÃO avança sem elas

- **D1 — Escopo do supervisor: só o próprio subtime, confirmar.**
  Proposta: SUPERVISOR só enxerga e só mexe em membros **do subtime onde ele
  é supervisor**. Supervisor do subtime A **não alcança** o subtime B. Esta é a
  trava que **não existe hoje** e é o furo perigoso: sem ela, uma permissão
  `member.manage.subteam` global deixaria supervisor mexer em qualquer time.
  ☐ Confirmar: escopo por subtime do ator.

- **D2 — Só OPERATOR, confirmar.** Proposta: supervisor adiciona/remove apenas
  OPERATOR. Não promove ninguém a SUPERVISOR (isso seria criar par → viola a
  024). ☐ Confirmar: alvo restrito a OPERATOR.

- **D3 — "Adicionar" = mover pessoa existente, ou cadastrar do zero?**
  Cadastrar membro novo dispara senha temporária (ADR 0008), reveal-once, etc.
  Proposta: supervisor **só move um membro que já existe no workspace** para o
  seu subtime (`assign_to_team`), **não cadastra pessoa nova** — cadastro
  continua ADMIN/MANAGER. Reduz o blast radius e reaproveita `assign_to_team`
  puro. ☐ Confirmar: supervisor move, não cadastra.

- **D4 — "Remover do subtime" tira do subtime ou desativa a pessoa?**
  Proposta: `remove_member_from_team` tira o vínculo com o subtime; a pessoa
  continua ativa no workspace. Supervisor **nunca** desativa conta
  (`deactivate_member`, linha 509, segue ADMIN/MANAGER). ☐ Confirmar.

- **D5 — Nome da permissão nova.** Proposta: `member.manage.subteam`
  (concedida a SUPERVISOR), distinta de `team.manage` (ADMIN/MANAGER, poder
  amplo). O gate do front passa a ser
  `team.manage || member.manage.subteam`, e o backend escopa por subtime
  quando é a segunda. ☐ Confirmar o nome.

## Regra de autorização — o coração da spec

Os dois `_assert` ganham um terceiro caso. Hoje é binário (ADMIN vs
MANAGER-restrito); passa a ter o ramo do supervisor, **com a trava de subtime**:

```
_assert_actor_pode_gerenciar_membro(ator, alvo, subtime_alvo):
    se ator.has_role("ADMIN"): ok
    se ator.has_role("MANAGER") no raiz: ok se alvo in (SUPERVISOR, OPERATOR)
    se ator é SUPERVISOR de subtime_alvo:   # ramo novo
        ok SE E SOMENTE SE alvo == OPERATOR
        E subtime_alvo é exatamente o subtime onde ator é SUPERVISOR
    senão: 403
```

**A trava `subtime_alvo == subtime do ator` é a linha que não pode faltar.**
Sem ela, a spec vira "qualquer supervisor mexe em qualquer operator" —
exatamente o furo que eu (assistente) apontei. É o ponto que os testes têm que
provar por sabotagem (ver plan, Fatia 3).

## Critérios de aceitação (a VERIFICAR na execução, não agora)

1. SUPERVISOR do subtime A adiciona OPERATOR ao subtime A → **200**.
2. SUPERVISOR do subtime A tenta adicionar OPERATOR ao subtime B → **403**.
3. SUPERVISOR tenta promover alguém a SUPERVISOR → **403** (viola 024).
4. SUPERVISOR tenta desativar uma conta → **403**.
5. SUPERVISOR tenta mexer num MANAGER/ADMIN → **403**.
6. MANAGER e ADMIN continuam com o poder amplo de hoje, **sem regressão** (a
   suíte atual de membros passa inalterada).
7. Na tela, um SUPERVISOR vê **só** os membros do próprio subtime e **só** o
   botão de adicionar/remover OPERATOR — não vê promoção, não vê outros times.

## O que esta spec explicitamente NÃO faz

- Não cria, move, apaga ou desativa **times** → Spec 029.
- Não deixa supervisor cadastrar pessoa nova (senha temporária) → segue
  ADMIN/MANAGER.
- Não toca em papéis do time raiz nem na invariante da 024 para MANAGER/ADMIN.
- Não muda `deactivate_member`.

## Fronteira de risco

Blast radius baixo **se** a trava de subtime (D1) entrar e for testada por
sabotagem. O único jeito de esta spec causar dano é a autorização vazar entre
subtimes — por isso o critério 2 e o critério 7 são inegociáveis, e por isso o
plan sabota a trava de propósito antes de dar por pronto.
