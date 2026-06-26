# Plan 016 — Adicionar membro a um time (pela tela)

Pequena (~1.5 fatia). Backend reusa helper da Spec 015. Front reusa seletor de
time (Spec 014) e papéis gated (Spec 015). Backend spec+plan aprovados antes de
codar; front typechecado isolado.

## Fatia 1 — Matriz no assign_to_team (backend)
- `member_service.py::assign_to_team` — chamar `self._assert_actor_can_assign(role)`
  (após validar user/team, antes/junto do fluxo de criação). Docstring +Erros
  (AuthorizationError 403).
- `tests/integration/test_member_assign_db.py` (novo): ADMIN adiciona ADMIN ok;
  MANAGER adiciona OPERATOR/SUPERVISOR ok; MANAGER → ADMIN/MANAGER 403; já no
  time → 409; 2º subtime → 422.

Teste: pytest do arquivo + suíte inteira (toca rota existente, mas comportamento
novo é só o 403 — confirmar nenhuma regressão nos testes que usam assign).

## Fatia 2 — UI "+ Adicionar a um time" (frontend)
- `web/lib/api.ts` — `assignMemberToTeam(userId, teamId, role)` (se ainda não
  existir client) → POST /members/{id}/team; `invalidateMembers()` no sucesso.
- `web/app/membros/page.tsx` — no painel de papel: botão "+ Adicionar a um time"
  → mini-form com select de time (times onde a pessoa NÃO está, raiz rotulada
  "geral") + select de papel (`papeisAtribuiveis`, já gated). Submit → assign →
  recarregarVinculos() + onMudou(). Trata 403/409/422.
- esbuild isolado; depois `npm run build` + smoke.

## Ordem
1 → 2. Parar após cada fatia pra você testar/commitar, como sempre.
