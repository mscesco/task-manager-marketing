# Plan — Entrega 15 (Membros + Perfil)

> Referência: `specs/012-membros-e-perfil/spec.md`
> ADRs: front `0008`, `0009`
> **Status:** PROPOSTA — não codar antes do OK na spec.

## 0. Pré-flight

- Build verde a partir da E14 já pushada.
- Backend com as rotas de membro no ar na VPS que o `npm run dev` consome
  (todas já existem; confirmar que respondem).

## Fatia 1 — `web/lib/api.ts` (surface, sem UI)

- Tipos: `MemberCreated` (= `Member` + `temporary_password`),
  `ResetPasswordResult` (`{user_id, temporary_password, ...}`).
- Funções: `createMember(name, email, teamId?, role?)`,
  `resetMemberPassword(userId)`, `deactivateMember(userId)`,
  `assignMemberTeam(userId, teamId, role)`.
- **Bust de cache:** expor `invalidateMembers()` (zera o `_members`
  memoizado) e chamá-lo dentro de `createMember`/`deactivateMember` após o
  sucesso. `listMembers` volta a buscar na próxima chamada.
- `currentUser()`/`listSubteams()` já existem (E13/E14) — reuso.
- Smoke: `npm run build`.

## Fatia 2 — Página Perfil (`/perfil`) — só leitura

- `app/perfil/page.tsx`: usa `currentUser()` → mostra nome, e-mail, papéis
  (`roles`), e o subtime (cruza `me.id` com `listMembers()` p/ achar o
  `team_id`, resolvido via `listSubteams()` p/ o nome). Link "Trocar senha"
  → `/trocar-senha`.
- `AppShell`: item "Perfil" (nav ou canto do cabeçalho — decidir aqui).
- Sem ações de escrita. Smoke: abrir `/perfil` logado.

## Fatia 3 — Página Membros (`/membros`) — só leitura

- `app/membros/page.tsx`: `listMembers()` + `listSubteams()` (mapa
  id→nome do subtime). Tabela/cards: nome, e-mail, subtime (ou "—"), ativo.
  Ordena por nome. Estado vazio e erro tratados.
- `AppShell`: item "Membros" no nav.
- Sem ações ainda. Smoke: lista renderiza.

> **Nota de 17/09/2026:** `app/membros/page.tsx` não existe mais — a rota
> `/membros` saiu na Spec 047 (commit `3490a47`). Pessoas se administram na
> tela do time, `app/times/[id]/page.tsx`.

## Fatia 4 — Gestão (na página Membros) — gated por `team.manage`

- Lê `me.permissions` via `currentUser()`. Se não tem `team.manage`, nenhuma
  ação aparece (página fica só-leitura).
- **Cadastrar membro:** form (nome, e-mail, subtime opcional via
  `listSubteams`, papel opcional). `createMember` → no sucesso:
  - bloco **reveal-once** da `temporary_password` (destaque + copiar + aviso
    "não volta"); limpa ao fechar (ADR 0008);
  - invalida cache + recarrega a lista.
  - Erros: 409 (e-mail repetido), 422 (1-subtime / campos), 403 → mensagens
    claras, form não some.
- **Resetar senha:** botão por linha → confirma → `resetMemberPassword` →
  mesmo bloco reveal-once.
- **Desativar:** botão por linha (escondido no próprio cartão) → confirma
  ("sem desfazer pela tela hoje", D5) → `deactivateMember` → invalida cache +
  recarrega. Linha passa a "inativo".
- Smoke (roteiro no `dev`, como ADMIN e como OPERATOR): ver spec.

## Fecho

- ADRs front `0008` (reveal-once) e `0009` (gestão: gating, desativar-não-
  deletar, perfil só-leitura). Esta spec/plan commitados **junto** (não
  repetir a dívida de doc da E12/E13/E14).
- Cada fatia é commit isolado; `npm run build` por parada e roteiro no `dev`
  com backend real na Fatia 4 (é onde o reveal-once e o gating viram reais).

## Sequência de risco (por que esta ordem)

Fatias 1–3 não tocam em nada destrutivo nem sensível — leitura e tipos. Toda
a superfície de risco (senha provisória, permissão, desativar-sem-volta) está
concentrada na Fatia 4, isolada e testável de uma vez. Se a Fatia 4 precisar
voltar pra prancheta, as 1–3 já entregaram valor (perfil + ver membros).
