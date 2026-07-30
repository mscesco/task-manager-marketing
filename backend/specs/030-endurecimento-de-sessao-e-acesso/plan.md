# Plan 030 — Endurecimento de sessão e acesso

> Decisões fechadas na `spec.md` (30/07). **Liberado para execução.**
> D2 = coluna. D4 = versão, não denylist. D6 = mantém 8 caracteres.

Porte: **pequeno.** Uma migration, ~60 linhas de backend, uma rota nova, um
arquivo de infra. O trabalho está nos testes e na ordem do deploy, não no código.

**Quatro fatias.** A 4 é independente das outras três e pode subir antes.

⚠️ **Ordem de deploy é regra, não sugestão.** A Fatia 1 sobe **sozinha e
primeiro**. Ela é a única que toca o caminho de toda requisição autenticada; se
algo quebrar, você quer saber que foi ela, não descobrir junto com outras duas.

---

## Fatia 1 — Revogação de sessão (backend)

**Migration `0007_token_version`**

```
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
```

⚠️ **`users`, no plural.** É a única tabela do schema assim, porque `user` é
palavra reservada no Postgres (`__tablename__ = "users"`,
`db/models/organization.py:107`). Escrever `"user"` estoura a migration.

⚠️ **A migration mora dentro da imagem** (armadilha conhecida): `build` da imagem
`api` **antes** de rodar `alembic upgrade`. Head atual esperado: `0006`.

Sem índice. A coluna é lida junto com a linha do usuário, nunca em `WHERE`.

**Arquivos:**

- `backend/app/db/models/organization.py`
  - `token_version: Mapped[int]`, default 0, `nullable=False`.

- `backend/app/modules/auth/infrastructure/security.py`
  - `_create_token` passa a receber `token_version` e gravar o claim `tv`.
  - `create_access_token` e `create_refresh_token` repassam.
  - ⚠️ **Não** mexer em `decode_token`. Ele valida assinatura, expiração e
    `type`; ele **não** sabe o que é usuário e não deve ir ao banco. A comparação
    de versão é de quem tem a linha do usuário na mão.

- `backend/app/modules/users/domain/membership.py`
  - `token_version: int` na `WorkspaceMembership`.

- `backend/app/modules/users/infrastructure/membership_repository.py`
  - Preenche `token_version=user.token_version`. **Nenhuma query nova** — o
    `session.get(User, ...)` da linha 45 já traz a linha inteira (critério 7).

- `backend/app/modules/auth/api/dependencies.py`
  - Depois da checagem de `is_active`, antes do gate de `must_change_password`:
    `payload.get("tv", 0) != membership.token_version` → `AuthenticationError`.
  - ⚠️ **`.get("tv", 0)`, não `payload["tv"]`.** É este default que faz os tokens
    já emitidos continuarem valendo no dia do deploy (critério 6). Um `KeyError`
    aqui desloga as 24 contas de uma vez.

- `backend/app/modules/auth/application/service.py`
  - `refresh()`: mesma comparação, contra `user.token_version`. A rota de refresh
    não passa por `get_tenant_context`, então precisa da checagem própria — é o
    critério 2, e é fácil de esquecer.
  - `change_password()`: `user.token_version += 1` (D3).
  - `logout(user_id)`: `user.token_version += 1`. Nada mais.
  - `_issue_tokens` passa a receber e repassar a versão.
    ⚠️ Emitir o par **com a versão nova** depois do incremento, senão a pessoa que
    acabou de trocar a senha se desloga sozinha.

- `backend/app/modules/users/application/member_service.py`
  - Linha ~227 (reset pelo gestor): `user.token_version += 1`.
  - Linha ~175 (criação de membro): **não mexer** (D3).

- `backend/app/modules/auth/api/router.py`
  - `POST /auth/logout` → 204. Exige token válido, **mas precisa funcionar com
    `must_change_password` pendente** — usar `get_user_allowing_pending`, como
    `change-password` e `me`. Senão quem está travado no gate não consegue sair.

**Portão:** `pytest` inteiro. Esperado **436 + os novos**.

---

## Fatia 2 — Testes da Fatia 1

Arquivo novo: `backend/tests/integration/test_session_revocation_db.py`

Contra Postgres real, **pela rota**. A lição da 028 (12 testes de service verdes
com o gate da rota revertido) vale inteira aqui: revogação testada só no service
não prova que a dependency confere.

1. `test_troca_de_senha_derruba_outra_sessao` — access antigo → 401 (critério 1)
2. `test_troca_de_senha_invalida_refresh_antigo` — critério 2
3. `test_reset_pelo_gestor_derruba_sessao_do_alvo` — critério 3
4. `test_reset_pelo_gestor_nao_derruba_terceiros` — critério 3
5. `test_logout_invalida_refresh` — critério 4
6. `test_logout_de_um_nao_afeta_outro_usuario` — critério 5
7. **`test_token_sem_claim_tv_continua_valido`** — forja um token sem `tv`,
   espera 200. **É o teste que protege o dia do deploy** (critério 6)
8. `test_logout_funciona_com_troca_de_senha_pendente`
9. `test_par_emitido_no_change_password_ja_vale` — a pessoa não se desloga

> **Sabotagens** (confirmar com `grep` que entraram no arquivo **antes** de rodar):
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | trocar `.get("tv", 0)` por `payload["tv"]` | 7 |
> | tirar o `+= 1` do `change_password` | 1 e 2 |
> | tirar a comparação de `refresh()` e deixar só a de `dependencies.py` | 2 |
> | tirar a comparação de `dependencies.py` e deixar só a de `refresh()` | 1 |
> | incrementar a versão **depois** de emitir o par novo | 9 |
> | trocar o incremento por atribuição fixa (`= 1`) | 1 na segunda troca de senha |
>
> ⚠️ A quarta e a quinta existem porque são **dois** pontos de checagem
> independentes. Um teste que passe com qualquer um dos dois removido não está
> provando o que parece.
>
> ⚠️ Lição da 029: conferir a **mensagem**, não só o status. Um 401 de "token
> revogado" e um 401 de "usuário inativo" são o mesmo código.

⚠️ `session.rollback()` expira objeto ORM — capturar `id` e `token_version`
**antes** de qualquer ponto que possa rolar back.

---

## Fatia 3 — Freio por conta e senha mínima (backend, sem migration)

- `backend/app/core/rate_limit.py`
  - `SlidingWindowRateLimiter` ganha três métodos, sem tocar no `hit()` que já
    tem teste:
    - `check(key)` → `RateLimitDecision`, **sem registrar**
    - `record(key)` → registra
    - `reset(key)` → esvazia o balde
  - `account_login_limiter`, com números próprios de env.
  - ⚠️ Chave **normalizada**: `email.strip().lower() + "|" + workspace_slug`.
    Sem isso, `Fulano@x.com` e `fulano@x.com` são dois baldes e o freio vira
    decorativo.

- `backend/app/core/config.py`
  - `account_login_limit_max: int = 10`
  - `account_login_limit_window_seconds: int = 900`

- `backend/app/modules/auth/api/router.py` (rota de login)
  - `check` **antes** de chamar o service; cheio → mesmo 401 de sempre, **não**
    429 (critério 10 — um 429 diferenciado entrega que a conta existe e está
    sendo atacada).
  - `AuthenticationError` do service → `record`.
  - Sucesso → `reset`.
  - ⚠️ **Fora do fluxo de exceção**, e não dentro de um `except` que engula
    outros erros. Erro de banco não é senha errada.

> **D6 fechada em 8 caracteres — `schemas.py` não é tocado nesta fatia.**
> A lista de recusa de senha óbvia (D6-bis) está fora do escopo até decisão.

- `backend/.env.prod.example`
  - Acrescentar as duas variáveis novas **e** as três que já faltavam:
    `TEMPORARY_PASSWORD_TTL_HOURS`, `PUBLIC_FORM_RATE_LIMIT_MAX`,
    `PUBLIC_FORM_RATE_LIMIT_WINDOW_SECONDS`.

**Testes** — `backend/tests/test_account_rate_limit.py` (unitário, relógio fake,
sem banco; espelha o teste que já existe do balde por IP):

1. `test_dez_falhas_bloqueiam_a_decima_primeira` (critério 8)
2. `test_sucesso_zera_o_balde` (critério 9)
3. `test_email_inexistente_mesma_resposta_e_mesmo_status` (critério 10)
4. `test_destrava_sozinho_ao_fim_da_janela` (critério 11)
5. `test_balde_por_ip_continua_valendo` (critério 12)
6. `test_email_com_maiuscula_cai_no_mesmo_balde`
> **Sabotagens:**
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | trocar `record` só-em-falha por `record` sempre | 2 |
> | tirar o `.lower()` da chave | 6 |
> | devolver 429 quando o balde da conta enche | 3 |
> | não chamar `reset` no sucesso | 2 |

**Portão:** `pytest` inteiro.

---

## Fatia 4 — Transporte (infra) — INDEPENDENTE

**Arquivo:** `docker-compose.prod.yml` (já entregue, pendente de deploy).

Divide cada serviço em dois routers: `:80` só redireciona, `:443` serve com os
cabeçalhos. Middlewares `tm-https` e `tm-sec` declarados no serviço `api` e
referenciados pelos dois. Prefixo `tm-` evita colisão com o stack do n8n, que
divide o mesmo Traefik.

**Sem portão automatizado.** A validação é manual, no browser (critérios 15–18).

⚠️ **Não é `restart`** — é `docker compose -f docker-compose.prod.yml up -d`.
Label só é lida na recriação do container.

⚠️ **Suba com `stsSeconds=300` primeiro.** Confirme por um dia que nada quebrou e
só então troque para `31536000`. É o único passo de toda a spec sem rollback pelo
servidor.

---

## Ordem de deploy

| # | Fatia | Sobe | Como sei que deu certo |
|---|---|---|---|
| 1 | **4 — transporte** | sozinha, qualquer dia | `http://` redireciona; app carrega |
| 2 | **1 + 2 — revogação** | sozinha, com migration | **ninguém foi deslogado**; troca de senha derruba a outra aba |
| 3 | **3 — freio por conta** | pode ir junto de outra coisa | 11 senhas erradas na mesma conta são barradas |

Junto do passo 3, reverter `AUTH_RATE_LIMIT_MAX` de 60 para **10** se ele chegou
a ser aplicado durante o treinamento (§Contexto da spec). Exige
`docker compose ... up -d api` — `restart` não recarrega `env_file`.

**Não subir nada disso na sexta.** Mexer em roteamento do Traefik ou no caminho
de toda requisição autenticada na manhã de uma apresentação de lançamento é como
se ganha um 404 na frente da equipe inteira. Segunda, com tempo de olhar log.

**Rollback:**

- Fatia 4: arquivo antigo + `up -d`. **Menos o HSTS**, que fica no browser.
- Fatia 1: `alembic downgrade -1` derruba a coluna, mas os tokens em circulação
  já carregam o claim `tv`, que passa a ser ignorado. Ninguém é deslogado na
  volta. **Confirmar isso rodando**, não confiando neste parágrafo.
- Fatia 3: sem estado no banco. Reverter é redeploy da imagem anterior.

---

## O que eu não consigo validar daqui

- Nada em produção: não tenho a VPS, o Traefik, nem sei a versão dele.
- A migration head real em produção (§Contexto da spec).
- O comportamento de HSTS e redirect: sintaxe de label v2/v3 é a mesma para
  `redirectscheme` e `headers`, mas quem confirma é `docker logs traefik` depois
  do `up -d`.
- `pytest` do backend: não montei o Postgres nesta análise. O front eu rodei —
  `npm test` 215 passed, `tsc --noEmit` limpo, no zip que você mandou.
- O `downgrade` da `0007`: o parágrafo de rollback é raciocínio, não medição.
  Rodar o `downgrade` uma vez em ambiente local antes de precisar dele em prod.
