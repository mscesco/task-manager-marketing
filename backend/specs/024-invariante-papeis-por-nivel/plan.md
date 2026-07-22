# Plan 024 — Invariante de papéis por nível de time

Pequena. **3 fatias, todas de backend.** Sem front (nenhuma tela cria time raiz).
Produção já está conforme, então é só trancar a porta — o volume está nos
testes, não no código.

> **Pré-requisito operacional (antes da Fatia 1).** O dev já rodou
> `0004_solicitations` e `0005_solicitation_batch`. Como nada foi commitado nem
> subiu pra produção, essas migrations são **descartadas e reescritas** (ver
> Plan 025, Fatia 1). Sequência no dev, nesta ordem:
> ```
> docker compose run --rm api-dev alembic downgrade 0003_deadline_notif_flags
> rm backend/alembic/versions/0004_solicitations.py
> rm backend/alembic/versions/0005_solicitation_batch.py
> rm backend/alembic/versions/0006_solicitation_task.py   # se já tiver salvo
> ```
> ⚠️ O downgrade **dropa a tabela `solicitation`** — as solicitações de teste do
> dev são perdidas. É irreversível e intencional.
> Depois disso, a numeração limpa fica: `0004` = índice de raiz única (esta
> spec), `0005` = tabela de solicitações completa (Spec 025).

## Fatia 1 — Migration: uma raiz por workspace — GATED
- `alembic/versions/0004_unique_root_team.py` (novo, `down_revision =
  "0003_deadline_notif_flags"`):
  - `CREATE UNIQUE INDEX team_unica_raiz_por_workspace ON public.team
    (workspace_id) WHERE parent_team_id IS NULL;`
  - `COMMENT` explicando que é isso que torna "time principal" um fato
    estrutural (D2).
  - `downgrade`: `DROP INDEX IF EXISTS`.
  - **Sem backfill** — produção já está conforme (verificado por query).
- `app/db/models/organization.py::Team` — declarar o mesmo índice em
  `__table_args__` (`Index(..., unique=True, postgresql_where=...)`), pra o
  model não divergir do banco.
- Validação Claude: `py_compile`, `ruff`, revisão do `down_revision`.
  Validação Camila: `alembic upgrade head` no dev + tentar inserir uma segunda
  raiz via SQL e confirmar a recusa.
- Commit: `feat(db): indice unico de time raiz por workspace`.
- **DEPLOY.md:** anotar que esta migration precisa rodar no deploy (R2).

## Fatia 2 — Guards de nível de time (o coração da spec) — GATED
- `app/modules/auth/domain/team_scope.py` — duas funções puras novas, ao lado
  das que já existem:
  - `roles_permitidos_no_nivel(is_root: bool) -> frozenset[str]` — raiz → os
    **quatro** papéis; subtime → `{SUPERVISOR, OPERATOR}`. A regra é
    ASSIMÉTRICA (D1a): só ADMIN e MANAGER são exclusivos da raiz. Papel fora do
    enum conhecido **não é permitido em nível nenhum** (falha fechada, R5).
  - `role_permitido_no_nivel(role, *, is_root)` — predicado puro.
  - `assert_role_permitido_no_nivel(role, *, is_root)` — levanta
    `BusinessRuleError` (D5) com mensagem que nomeia a regra.
    **Desvio do plano original:** era `assert_role_permitido(role, team_id,
    tree)`. As quatro portas já têm o objeto `Team` em mãos, então carregar a
    árvore inteira só para descobrir `parent_team_id is None` era desperdício.
    Exceção: `change_member_role` só carregava o vínculo e passou a carregar
    o time.
  - Puras, sem banco: entram na suíte de lógica pura (roda em qualquer lugar,
    sem Postgres).
- `app/modules/users/application/member_service.py` — chamar
  `assert_role_permitido_no_nivel` nas **quatro** portas (D3), reusando o
  helper, sem copiar checagem:
  `create_member`, `assign_to_team`, `change_member_role`, `move_member_subteam`.
- `app/modules/workspaces/application/workspace_service.py` (D4 — o efeito
  colateral do índice):
  - `create(parent_team_id=None)` → antes do flush, verificar se já existe raiz
    no workspace; se sim, `ConflictError` com mensagem de domínio.
  - `move(new_parent_id=None)` → mesma verificação, antes do flush.
  - Sem isso, a Fatia 1 transforma as duas rotas em **HTTP 500**.
- `tests/test_team_role_levels.py` (novo, lógica pura) — critérios 1–5 no nível
  das funções puras.
- `tests/integration/test_role_invariant_db.py` (novo) — critérios 1–11 ponta a
  ponta, incluindo o 8 (workspace nunca fica sem raiz) e o 11 (isolamento de
  tenant).
- Validação Claude: `py_compile` + `ruff` + grep dos call-sites das quatro
  portas (prova de que nenhuma ficou de fora). Validação Camila: `pytest` do
  arquivo + suíte inteira.
- Commit: `feat(auth): invariante de papel por nivel de time`.

## Fatia 3 — Documentação da regra
- `app/modules/auth/domain/permissions.py` — comentário no topo explicando que
  o mapa estático **continua sendo o único lugar a editar** porque a invariante
  de nível garante que ADMIN/MANAGER só existem na raiz. Sem esse comentário, o
  próximo a mexer vai tentar criar permissão por time e desfazer o desenho.
- `app/modules/workspaces/application/team_seed_service.py` e
  `provisioning_service.py` — comentário curto apontando a invariante (D6).
- Validação: leitura. Sem código executável.
- Commit: `docs(auth): registrar invariante de papel por nivel`.

## Ordem
1 → 2 → 3, parando após cada uma pra você testar e commitar. A Fatia 2 **não
pode** sair sem a 1 (os guards ficariam sem a garantia do banco), e a 1 **não
deve** sair sem a 2 no mesmo deploy (as rotas de time responderiam 500 até a 2
chegar). Se precisar dividir o deploy, mande 2 antes de 1 — a ordem inversa é
segura, só não tem a trava do banco no intervalo.

---

## O que a execução mudou (registrado após o fato)

- **D1a — a regra saiu errada e os testes pegaram.** A primeira versão era
  simétrica (raiz só com ADMIN/MANAGER). Quebrou 11 testes de integração e
  atropelou a **Spec 003, decisões 7 e 17**: estar só no time geral, sem
  subtime, é estado de produto projetado — é assim que se "tira alguém do
  subtime". Corrigido para assimétrico. Lição: ler as specs antigas
  relacionadas **antes** de cravar decisão nova, não depois.
- **Dois testes existentes mudaram de expectativa**, não de implementação:
  - `test_team_move_to_root_works` afirmava que promover subtime a raiz era
    válido → agora afirma `ConflictError`. Ganhou um par novo para o caso de
    borda "árvore sem raiz nenhuma" (o índice parcial permite zero).
  - `test_admin_adiciona_qualquer_papel` (Spec 016) atribuía ADMIN a subtime →
    agora atribui SUPERVISOR e verifica que ADMIN em subtime é recusado. As
    duas regras são ortogonais: a matriz diz *quem o ator alcança*, a
    invariante diz *onde o papel pode existir*.
- **Achado colateral, fora de escopo:** os models declaram constraints com a
  `naming_convention` aplicada (`ck_<tabela>_<nome>`), enquanto as migrations
  em DDL raw usam nome simples. Vale para o projeto inteiro (`Team` tem o mesmo
  descasamento com a baseline). Inofensivo hoje porque ninguém usa
  `--autogenerate`; no dia em que alguém usar, o Alembic vai querer renomear
  toda constraint do banco. Merece spec própria.
