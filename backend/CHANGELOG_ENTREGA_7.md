# CHANGELOG — Entrega 7 (Senha temporária + troca forçada no 1º acesso)

## Resumo

Substitui o cadastro de membro **com senha escolhida pelo provisionador**
por um fluxo onde o backend gera uma **senha temporária aleatória**, o membro
**troca no 1º acesso** e o provisionador **nunca conhece a senha definitiva**.
`password_hash` permanece **NOT NULL**. Entrega do segredo fica **fora do
backend** (opção B); o webhook pós-commit (opção A) está documentado como
gancho futuro, não implementado.

Decisões em `docs/adr/0019`, `0020`, `0021`. Spec em
`specs/007-senha-temporaria/`.

## Banco

- **Migration `0007_password_lifecycle`** (idempotente): adiciona em `users`
  `must_change_password BOOLEAN NOT NULL DEFAULT false` e
  `password_expires_at TIMESTAMPTZ NULL`. `password_hash` inalterado.
  Membros existentes herdam `false` — admin não é trancado.
- Produção aplicada e em `0007`. Dump `schema/schema_v5.sql` e
  `SCHEMA_BASE_REVISION` (conftest) sincronizados em `0007`.

## Endpoints

| Método | Rota | Mudança |
|--------|------|---------|
| POST | `/api/v1/members` | Request perde `password`. Resposta `MemberCreatedResponse` com `temporary_password` (uma vez), `must_change_password`, `password_expires_at`. |
| POST | `/api/v1/members/{user_id}/reset-password` | Nova (team.manage). Gera nova provisória, re-arma a pendência. |
| POST | `/api/v1/auth/change-password` | Nova (dependency leniente). Usuário troca a própria senha; zera pendência e expiração. |
| GET | `/api/v1/auth/me` | Dependency leniente (passa o gate); expõe `must_change_password`. |
| POST | `/api/v1/auth/login` | Assinatura inalterada; rejeita provisória expirada (401 genérico). |

## Gate (ADR 0020)

`must_change_password=true` → toda rota via `TenantContext` responde **409**
(`PasswordChangeRequiredError`), exceto `change-password`, `auth/me` (lenientes)
e as públicas (`login`, `refresh`). Enforcement server-side.

## Privacidade do segredo (verificado)

Middleware loga apenas metadados — não loga corpo de resposta. O
`temporary_password` não vaza para o log. Sem mascaramento necessário.

## TTL

`temporary_password_ttl_hours = 72` em `config.py`.

## Testes — números CONFIRMADOS

Rodada completa contra Postgres real (`db-test` recriado a partir do dump em
`0007`):

```
146 passed, 1 warning
```

- **Lógica pura: 95** (89 baseline E0–E6 + 6 novos em
  `tests/test_password_lifecycle.py`). Os 2 testes de `test_workspaces.py`
  (`test_create_member_command_*`) foram alterados, não removidos (perderam o
  kwarg `password`).
- **Integração: 51** (43 baseline + 8 novos em
  `tests/integration/test_password_lifecycle_db.py`): cadastro arma
  pendência+expiração; login com provisória válida funciona; provisória
  expirada → 401; `change_password` destrava; rejeita senha igual (422) e
  senha atual errada (401); `reset_password` re-arma; admin do factory não
  nasce travado.

**Total: 132 → 146, todos passando. ✅**

## Ferramenta nova

- `scripts/regen_schema.ps1` — regenera `schema/schema_v5.sql` a partir da
  produção (lê a senha do `.env`, `pg_dump` em container, sem `Out-File`) e
  faz o bump automático do `SCHEMA_BASE_REVISION`. Mitiga a dívida operacional
  da ADR 0016 (regeneração manual do dump). **Não** resolve a dívida
  arquitetural de fundo (a `0001` é baseline vazio → o dump ainda vem de
  produção); desacoplar exige reescrever o baseline (Caminho 2), planejado
  para a ida do projeto à VPS.

## Dívidas / riscos em aberto

- **Senha de produção comprometida** (vazou em histórico de terminal durante a
  regeneração do dump). Rotação adiada com gatilho: rotacionar **antes** de o
  repo sair da máquina, de entrar 2º dev, ou da ida à VPS (este último é certo).
- **Baseline vazio (`0001`)** força o dump a vir de produção — fricção em toda
  entrega com migration. Resolver no Caminho 2, junto da ida à VPS.
- Provisória é credencial de login completa; janela de interceptação mitigada
  por TTL 72h + canal de entrega controlado (ADR 0019).
- Opção A (entrega automatizada do segredo) não implementada (ADR 0021).

## Próximo passo

Entrega 8 — Google SSO. **Dependência externa bloqueante**: projeto no Google
Cloud Console (client ID/secret, redirect URIs, domínios `@fecaf.com.br` /
`@colegioser.com`) pronto **antes** de iniciar.
