# Spec 007 — Senha temporária + troca forçada no 1º acesso

> **Status:** Accepted
> Fonte da verdade desta entrega. Implementação segue `plan.md`.

## Problema

Hoje um membro entra no sistema pelo `POST /members`, onde **quem cadastra
escolhe a senha** e, portanto, a conhece. Para uma operação onde admin/manager
provisiona contas de terceiros, isso é impersonação latente e furo de
auditoria: não dá pra provar que uma ação foi do usuário e não de quem sabia a
senha. Falta um mecanismo onde a pessoa **defina a própria senha** sem que o
provisionador conheça a credencial final.

## Decisão de desenho (resumo; detalhes nos ADRs 0019–0021)

- **`User` nasce no cadastro**, não num resgate posterior. `password_hash`
  continua **NOT NULL** — o backend gera uma **senha temporária aleatória**,
  hasheia, e cria o usuário já com ela. Consequência direta: o bug de
  `verify_password(senha, None)` **não existe** (não há hash nulo).
- A senha temporária **expira** (`password_expires_at`) e vem marcada com
  `must_change_password=true`.
- No 1º login a pessoa **troca a senha**. Enquanto não trocar, um **gate
  server-side bloqueia o resto da API** (ADR 0020) — a provisória não vira
  porta dos fundos permanente.
- O provisionador **nunca conhece a senha final**: ele vê só a provisória, que
  morre na troca. O segredo é **devolvido uma única vez** na resposta do
  cadastro; entrega (WhatsApp, e-mail) é **fora do backend** (ADR 0021).
- **Reset = admin gera nova provisória** (mesma mecânica do cadastro).

## Endpoints

```
POST /api/v1/members                       (team.manage) — ALTERADO
POST /api/v1/members/{user_id}/reset-password   (team.manage) — NOVO
POST /api/v1/auth/change-password          (autenticado, permite pendência) — NOVO
POST /api/v1/auth/login                    — inalterado na assinatura; ver regra de expiração
```

### `POST /members` — cadastra membro (ALTERADO)

- **Request perde o campo `password`.** O cliente não escolhe mais senha.
  (Quebra proposital de testes da E1 — ver `plan.md`, não é regressão.)
- Mantém `name`, `email`, `team_id?`, `role?` (a regra "team_id e role andam
  juntos", o `_assert_one_subteam` e o projeto pessoal automático seguem iguais).
- Backend gera senha temporária, cria `User` com `must_change_password=true` e
  `password_expires_at = now + TTL`.
- **Resposta 201** (corpo abaixo) traz o `temporary_password` **uma vez**.

```jsonc
{
  "id": "…", "workspace_id": "…", "name": "…", "email": "…",
  "is_active": true, "created_at": "…",
  "must_change_password": true,
  "password_expires_at": "2026-06-23T12:00:00Z",
  "temporary_password": "f3K9-2qLpZ7m"   // ⚠️ só aparece nesta resposta, nunca mais
}
```

### `POST /members/{user_id}/reset-password` — reset pelo admin (NOVO)

- `team.manage`. Gera **nova** senha temporária, re-arma
  `must_change_password=true` + novo `password_expires_at`. A senha anterior
  (definitiva ou provisória) deixa de valer no momento do reset.
- Resposta 200 com o mesmo formato do bloco acima (sem recriar o membro).
- Não pode resetar a própria conta? **Pode** — admin pode forçar a si mesmo a
  trocar. (Diferente do `deactivate`, que se proíbe pra não se trancar fora.)

### `POST /auth/change-password` — troca pelo próprio usuário (NOVO)

- Autenticado por dependency que **permite usuário com pendência** (senão a
  pessoa travada pelo gate nunca conseguiria trocar — ver ADR 0020).
- Request: `current_password`, `new_password` (≥ 8). Verifica a atual; grava o
  novo hash; **zera `must_change_password` e `password_expires_at`** (senha
  definitiva não expira).
- `new_password == current_password` → **422** (não aceita "trocar" pela mesma).
- Erros: senha atual errada → **401**; nova senha curta → **422**.

### `POST /auth/login` — regra de expiração (assinatura inalterada)

- Verificação de senha como hoje. **Acréscimo:** se
  `must_change_password=true` **e** `password_expires_at < now`, a provisória
  está morta → **401 genérico** (mesma mensagem dos outros erros de login, sem
  revelar o motivo). Login com provisória válida **funciona** e emite tokens
  normalmente; o gate (ADR 0020) é que restringe o que ela pode fazer depois.

## O gate de troca obrigatória (ADR 0020)

Com `must_change_password=true`, **toda rota que passa pelo `TenantContext`
responde 409** (`PasswordChangeRequiredError`), exceto:

- `POST /auth/change-password` (usa a dependency que permite pendência);
- `GET /auth/me` (pra o front saber o estado e renderizar a tela de troca);
- `POST /auth/refresh`, `POST /auth/login` (públicas, não passam pelo gate).

Enforcement é **server-side**. Não confiar no front pra redirecionar.

## Estado de banco (migration 0007)

Duas colunas em `users` (idempotentes, `ADD COLUMN IF NOT EXISTS`):

| coluna | tipo | regra |
|--------|------|-------|
| `must_change_password` | `BOOLEAN NOT NULL DEFAULT false` | membros existentes (admin) ficam `false` → **não são trancados** |
| `password_expires_at`  | `TIMESTAMPTZ NULL` | só preenchida enquanto há provisória pendente; `NULL` = senha definitiva |

`password_hash` **continua NOT NULL** — não há migration de nullabilidade.

## Provisioning preservado (não confundir com o gate)

O bootstrap do 1º admin (`provisioning_service`) **continua criando admin com
senha direta** e `must_change_password=false`. Se ele também caísse no fluxo de
provisória, não haveria admin "destravado" pra emitir o primeiro cadastro
(chicken-and-egg). A E7 troca o `POST /members`, **não** o provisioning.

## Fora de escopo (gancho A, ADR 0021)

A entrega automatizada do segredo (webhook pós-commit → n8n → Gmail) **não é
implementada nesta entrega**. Fica documentada como próximo passo: disparo
*best-effort* **depois** do commit, nunca dentro da transação de cadastro.

## Critérios de aceite

- [ ] `POST /members` cria membro com provisória + `must_change_password=true`
      + expiração, e devolve `temporary_password` uma vez.
- [ ] Campo `password` removido do request de `POST /members`.
- [ ] Login com provisória válida funciona; com provisória expirada → 401.
- [ ] Gate: rota de negócio com pendência → 409; `change-password` e
      `auth/me` passam.
- [ ] `change-password` zera pendência e expiração; rejeita senha igual (422).
- [ ] `reset-password` re-arma a pendência e devolve nova provisória.
- [ ] Provisioning do admin intacto (admin não nasce travado).
- [ ] Migration 0007 idempotente; admin existente não é trancado.
- [ ] Testes novos passando; testes da E1 que criavam membro com senha
      substituídos (troca proposital).
