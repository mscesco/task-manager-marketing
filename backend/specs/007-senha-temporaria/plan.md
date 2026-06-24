# Plano 007 — sequência de implementação

> Implementado e validado (logica pura verde). Stubs preenchidos.
> ("Entrega 7") são preenchidos só após o OK. A migration vai completa.

## Ordem

1. **Migration `0007`** (completa neste pacote): adiciona
   `must_change_password BOOLEAN NOT NULL DEFAULT false` e
   `password_expires_at TIMESTAMPTZ NULL` em `users`. Idempotente
   (`ADD COLUMN IF NOT EXISTS`). Membros existentes herdam `false` — admin
   **não** é trancado.

2. **Modelo ORM** (`app/db/models/organization.py`): dois campos novos no
   `User`. `password_hash` permanece `nullable=False`.

3. **Primitiva pura** (`app/modules/auth/infrastructure/security.py`):
   `generate_temporary_password() -> str` — segredo aleatório de alta entropia
   (≥ 96 bits, alfabeto sem caracteres ambíguos pra entrega humana). Stub.
   Reusa `hash_password` existente.

4. **Schemas**
   - `users/api/schemas.py`: `MemberCreateRequest` **perde** `password`.
     Novo `MemberCreatedResponse(MemberResponse)` com `must_change_password`,
     `password_expires_at`, `temporary_password`. `ResetPasswordResponse` (mesmo
     shape, sem dados de criação).
   - `auth/api/schemas.py`: `ChangePasswordRequest(current_password, new_password)`.

5. **Service de membros** (`users/application/member_service.py`):
   - `create_member`: remove o param de senha do command; gera provisória,
     cria `User` com pendência + expiração; **devolve** o usuário **e** a
     senha em claro (tupla ou objeto de retorno) pro router serializar uma vez.
     Resto da regra (validações, team+role juntos, `_assert_one_subteam`,
     projeto pessoal) **inalterado**.
   - `reset_password(user_id) -> (User, str)`: nova; re-arma pendência +
     expiração, gera nova provisória. Stub.

6. **Service de auth** (`auth/application/service.py`):
   - `login`: acrescenta a checagem de provisória expirada (→ 401 genérico).
   - `change_password(user_id, current, new)`: nova; verifica atual, grava
     novo hash, zera `must_change_password` + `password_expires_at`, rejeita
     senha igual (422). Stub.

7. **Dependency do gate** (`auth/api/dependencies.py`):
   - Em `get_tenant_context`: após carregar a membership, **ler o flag**
     `must_change_password` do `User` e, se `true`, levantar
     `PasswordChangeRequiredError` (→ 409). É o ponto único que protege todas
     as rotas de negócio (custo: uma leitura barata do flag — ou estender a
     query de membership pra trazê-lo; ver stub).
   - Nova dependency `get_user_allowing_pending` (decodifica token + carrega
     `User`, **sem** o gate) usada **só** por `change-password`.
   - `GET /auth/me` migra pra essa dependency leniente (precisa funcionar com
     pendência pro front renderizar a tela de troca).

8. **Exceção nova** (`app/shared/exceptions/base.py`):
   `PasswordChangeRequiredError(DomainError)` → mapeada para **409** no handler
   (mesma família de Conflict/BusinessRule).

9. **Routers**
   - `users/api/router.py`: `POST /members` retorna `MemberCreatedResponse`;
     novo `POST /members/{user_id}/reset-password`.
   - `auth/api/router.py`: novo `POST /auth/change-password`; `GET /auth/me`
     troca pra dependency leniente.

10. **Testes**
    - Lógica pura (`tests/test_*`): geração de provisória (entropia/alfabeto),
      decisão do gate, validação do `change_password` (igual→422, curta→422),
      regra de expiração no login. Substituir os testes da E1 que validavam
      `create_member` **com senha** (campo removido).
    - Integração (`tests/integration/test_password_lifecycle_db.py`, novo):
      cadastro devolve provisória + pendência; login com provisória OK mas rota
      de negócio dá 409; `change-password` destrava; login após expiração →
      401; `reset-password` re-arma; admin do provisioning **não** nasce travado.

## Ritual do dump (ADR 0016) — atenção

A 0007 mexe no schema. Depois de aplicá-la na VPS:
1. regenerar `schema/schema_v5.sql`;
2. subir `SCHEMA_BASE_REVISION` no `conftest` para `0007_password_lifecycle`.

Hoje o `conftest` aponta `0006_me_assignments_indexes`. Como a 0007 é
idempotente, o `upgrade head` funciona mesmo se o dump ainda estiver em 0006 —
mas mantenha dump e revisão em sincronia.

## Smoke manual (após implementar, via `/docs`)

| # | Operação | Esperado |
|---|----------|----------|
| 1 | `POST /members` `{name, email, team_id, role}` | 201; `temporary_password` presente; `must_change_password=true`; `password_expires_at` setado |
| 2 | `POST /auth/login` com a provisória | 200, par de tokens |
| 3 | `GET /tasks` com esse token | **409** (gate) |
| 4 | `GET /auth/me` com esse token | 200 (passa o gate) |
| 5 | `POST /auth/change-password` `{current=provisória, new=nova}` | 200; pendência zerada |
| 6 | `GET /tasks` de novo | 200 (destravado) |
| 7 | `POST /auth/change-password` `{current, new=current}` | 422 (senha igual) |
| 8 | `POST /members/{id}/reset-password` (como admin) | 200, nova provisória, pendência re-armada |
| 9 | login com provisória após `password_expires_at` | **401** genérico |
| 10 | login do admin (provisioning) | 200, sem gate (nasceu `false`) |

## Gancho futuro (NÃO implementar agora) — opção A

Entrega curta e isolada: após o commit do `create_member`/`reset_password`,
disparar POST best-effort pro webhook do n8n com `{email, name,
temporary_password}`. Regras: **fora da transação**, falha não desfaz o
cadastro (membro já existe; reenvia depois). Documentado em ADR 0021.
