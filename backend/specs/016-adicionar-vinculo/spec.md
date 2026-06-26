# Spec 016 — Adicionar membro existente a um time (pela tela) + matriz no assign

## Objetivo
Expor na tela o caminho "adicionar um membro JÁ existente a um time, com um
papel" — hoje impossível pela UI. Destrava casos como "dar o Marketing geral a
quem só está num subtime" sem precisar mover/remover. E, junto, fechar o furo de
o `assign_to_team` ainda não passar pela matriz de autorização.

## Correção de premissa
O endpoint `POST /members/{id}/team` (`assign_to_team`) **já existe e funciona**:
valida user/team, recusa vínculo duplicado (409), respeita "1 subtime" (ADR
0008). O que falta é (a) UI e (b) a **matriz** — hoje qualquer `team.manage`
pode adicionar alguém como **ADMIN**, o mesmo furo fechado em todo o resto.

## Mudança
- **Backend:** `assign_to_team` passa a chamar `_assert_actor_can_assign(role)`
  (helper já existente, F2 da Spec 015). Resto intocado.
- **Frontend:** botão "+ Adicionar a um time" no painel de papel; escolhe time
  (onde a pessoa ainda NÃO está, incluindo a raiz "geral") + papel (limitado
  pela matriz: ADMIN todos; senão SUPERVISOR/OPERATOR).

## Decisões cravadas
- **C1 — Matriz no adicionar:** quem pode adicionar com qual papel = mesma regra
  do resto. ADMIN adiciona qualquer papel; MANAGER só SUPERVISOR/OPERATOR.
  Implementado com `_assert_actor_can_assign(role)`. (Não há "alvo atual" ao
  adicionar um vínculo novo, então **não** se usa `_assert_actor_can_target` —
  o papel que a pessoa tem em OUTRO time não restringe; permissão é união e
  adicionar SUP/OP nunca eleva ninguém.)
- **C2 — Sem self-guard no adicionar:** adicionar é aditivo (não tranca
  ninguém pra fora), então, diferente de trocar/remover papel, não se proíbe
  adicionar a si mesmo. (Um MANAGER ainda não consegue se auto-promover: a
  matriz barra MANAGER/ADMIN.)
- **C3 — "1 subtime" mantido:** `_assert_one_subteam` continua barrando
  adicionar um 2º subtime (422). Adicionar a raiz é sempre permitido (no-op da
  invariante).

## Riscos residuais
- **R1 — Duplicidade de papel:** quem já está no time → 409 (inalterado). A UI
  oferece só times onde a pessoa não está, então o 409 vira borda rara.
- **R2 — assignee órfão / E6:** nada aqui mexe em `task.team_id`; dormente.

## Fora de escopo
- Reativar membro; editar nome/avatar próprio; papel na lista; dívida de ADR.

## Critérios de aceite
1. ADMIN adiciona alguém a um time com qualquer papel.
2. MANAGER adiciona só SUPERVISOR/OPERATOR; tentar ADMIN/MANAGER → 403.
3. Adicionar a um time onde a pessoa já está → 409 (UI nem oferece).
4. Adicionar 2º subtime → 422 (invariante 1-subtime).
5. UI: "+ Adicionar a um time" lista só times faltantes (inclui raiz "geral") e
   papéis pela matriz; após adicionar, painel e lista refletem.
