# 0001 — Projeto pessoal automático por usuário

## Status

**REVERTIDA em 10/09/2026.** Implementada e retirada — ver a nota no fim
deste documento. O texto original fica **inteiro**, porque o raciocínio
continua válido: ele é o registro de por que a opção 3 venceu as outras
duas, e quem for reabrir o assunto precisa começar de onde ele parou.

(Status anterior: Proposed, aguardando aprovação junto da Entrega 1.)

## Contexto

O schema v5 define `task.project_id` como **NOT NULL** (confirmado por
`information_schema` no banco da VPS). Toda task precisa pertencer a
algum projeto. O produto exige "quadros pessoais" — espaço onde cada
user organiza tarefas pessoais sem precisar criar um projeto formal
toda vez.

Três opções no espaço de design:

1. **Relaxar a invariante:** migration que torna `project_id` nullable.
   Task pessoal vira "task com `project_id = NULL`". Simples no
   primeiro momento mas espalha branches em todo lugar que toca em
   task (filtros, joins, agrupamentos, board pessoal vs. compartilhado).
2. **Entidade nova "personal_board":** task pode pertencer a project
   **ou** a personal_board. Dobra o domínio, dobra as queries.
3. **Projeto pessoal automático:** todo user recebe um projeto com flag
   `is_personal=true` no momento do cadastro. Task pessoal = task em
   projeto com `is_personal=true`. Mantém a invariante do schema.

A invariante NOT NULL é uma decisão consciente do schema v5 que tem
benefícios reais (queries mais simples, FKs estáveis, agregações
diretas). Quebrá-la pra resolver um caso particular é caro.

## Decisão

Adotamos a opção 3. Os pontos firmes:

- **Coluna nova:** `project.is_personal BOOLEAN NOT NULL DEFAULT false`.
- **Unicidade:** índice parcial
  `UNIQUE (workspace_id, created_by) WHERE is_personal`. Garante no
  máximo 1 pessoal por user por workspace.
- **Criação atômica em dois pontos do código:**
  - `WorkspaceProvisioningService.execute` — cria pessoal do admin
    junto do workspace, team e user, tudo no mesmo UoW.
  - `MemberService.create_member` — cria pessoal do novo user no
    mesmo UoW.
- **Backfill:** migration 0002 cria pessoal pra cada user já
  existente (idempotente, via `NOT EXISTS`).
- **Privacidade — defesa em duas camadas:**
  - **Leitura:** `ProjectService.list_page` e `.get` filtram pessoal
    alheio. Tentativa de acessar pessoal de outro user devolve **404**
    (não 403), pra não vazar existência.
  - **Escrita** (a partir da Entrega 2): `TaskService` rejeita
    criar/mover task pra projeto pessoal alheio com 404.
- **Privacidade vale inclusive contra Admin.** Admin não vê pessoal
  alheio. Se algum dia produto pedir "modo admin vê tudo", vira ADR
  novo + endpoint dedicado.
- **Proteções no `ProjectService`:** pessoal é **imutável via API**
  (PATCH, archive e soft-delete em pessoal devolvem 409
  `BusinessRuleError`). `is_personal` e `created_by` são blindados
  por design (nem entram no `UpdateProjectCommand`). O usuário
  interage com o pessoal exclusivamente via as tasks dentro dele.
- **Title fixo: `"Pessoal"`.** Não renomeável. Frontend exibe
  sempre "Pessoal" como label do container, sem fallback nem badge
  condicional.

## Consequências

**Positivas:**

- Schema permanece coerente; invariante NOT NULL preservada.
- Task pessoal é só "task num projeto" — código de task não ganha
  branch.
- Permissões aplicam-se uniformemente (`project.create`/`update`/
  `delete` continuam significando a mesma coisa; as proteções de
  pessoal vivem em uma única camada — o service).
- Backfill resolve o estado atual (Camila) sem migração de dados
  complexa.
- Frontend descobre o pessoal por um endpoint dedicado
  (`GET /me/personal-project`), sem precisar adivinhar.

**Negativas (e como conviver):**

- Um projeto "fantasma" por user infla a tabela `project`. Custo
  marginal: 1 linha por user. Não é problema em escala razoável.
- Filtro de privacidade vira responsabilidade do `ProjectService` em
  list/get — não é automático no `BaseRepository`. Documentado como
  exceção justificada (a única ponta solta do isolamento por tenant
  vira "isolamento por user para `is_personal=true`").

**Medível por:**

- 100% dos users do workspace têm exatamente 1 projeto com
  `is_personal=true` (query de auditoria).
- Tentativa de cross-user no pessoal devolve 404 em testes
  automatizados.

## Alternativas consideradas

**Opção 1 — `project_id` nullable.** Rejeitada porque:
- espalha `IS NULL` em filtros, joins e agregações;
- task órfã sem projeto fica difícil de governar (a quem pertence?
  como aplicar permissão?);
- o que ganha em simplicidade pontual perde em complexidade global.

**Opção 2 — entidade `personal_board`.** Rejeitada porque:
- duplica conceitos (board ≈ projeto, mas separado), o que multiplica
  os caminhos de código em task;
- exige novo módulo, novas tabelas, novas permissões — custo alto pra
  resolver um caso de uso que cabe no modelo existente.

**Opção 3a — convenção por título (sem flag).** Rejeitada: frágil.
Qualquer renomeação acidental quebra a semântica. Flag explícita
custa uma coluna boolean e ganha um invariante claro.

**Opção 3b — `is_personal` sem unique parcial.** Rejeitada: abre
porta pra ter 2 pessoais por user em caso de bug. O índice é a
salvaguarda final.

---

## Reversão — 10/09/2026

**Decisão da Camila**, com estas palavras: *"não sei como implementar projeto
pessoal, muito confuso, minha intenção é tirar, pois foi pensado de outra
forma"*.

### O que foi medido antes de tirar

- **29 projetos pessoais no banco, todos com ZERO tarefas.** A consulta está
  registrada no commit da remoção.
- **Nenhuma tela.** A rota `GET /me/personal-project` existia desde a Entrega 1
  e o front **nunca a chamou**. A D3 da Spec 034 já havia medido isso e usado
  como argumento para não expor um filtro na API: *"projeto pessoal não tem
  como ser criado pela interface"*.

Ou seja: a decisão foi implementada de verdade, viveu no schema por um ano, e
nunca chegou ao produto.

### O que saiu junto, e é o que importa lembrar

O projeto pessoal era a **única regra de privacidade do sistema**. Uma tarefa
dentro dele era invisível para todo mundo — **inclusive para o ADMIN** — e o
dono podia editá-la mesmo com o time dela fora da lente de edição. Isso vivia
em cinco lugares: dois ramos em `task_guards.py`, dois predicados SQL em
`task_repository.py` e um filtro em `ProjectService.list_page`.

**Hoje não há nada privado neste produto.** Tudo o que existe pertence a um
time, e quem alcança o time vê. Se um dia voltar a fazer sentido esconder algo
de todos, é um recorte NOVO — e não a volta de uma flag booleana num projeto.

### O que a reversão simplificou

A invariante do schema ficou mais forte. O CHECK
`project_team_required_when_common` dizia
`is_personal OR team_id IS NOT NULL OR deleted_at IS NOT NULL`; hoje diz
`team_id IS NOT NULL OR deleted_at IS NOT NULL`. **Projeto vivo tem time**, sem
exceção — e o `is_personal OR` era a única razão de a coluna `team_id` poder
ser nula.

Migration: `0024_sai_o_projeto_pessoal`.
