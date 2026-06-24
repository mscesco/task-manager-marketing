# Entrega 3 — Modelo de Times (escopo por time + tarefa avulsa)

> **Status:** Proposed (aguarda aprovação)
> **Módulos afetados:** `app/modules/tasks/`, `app/modules/projects/`,
> `app/modules/auth/`, `app/core/tenant.py`
> **ADRs relacionados (a escrever após aprovação do modelo):**
> - `docs/adr/0006-task-project-nullable-avulsa.md`
> - `docs/adr/0007-project-team-obrigatorio.md`
> - `docs/adr/0008-um-subtime-por-usuario.md`
> - `docs/adr/0009-papeis-por-time-escopo-hierarquico.md`
>
> **Reordenação de roadmap:** Assignment + Watchers passa a ser a
> Entrega 4 (era a 3). Esta entrega vem antes porque a autorização por
> time é a fundação onde o Assignment vai se apoiar.

---

## O que esta entrega entrega (em linguagem de produto)

Hoje, no workspace, qualquer pessoa enxerga e mexe em qualquer tarefa de
projeto comum — não existe noção de "isso é do meu time". Esta entrega
introduz **time** como o eixo que organiza quem vê e quem mexe no quê.

Depois desta entrega:

- **Todo projeto comum pertence a um time** (ex.: o projeto "Campanha Q3"
  é do Marketing). O projeto Pessoal continua sem time, privado como sempre.
- **Toda tarefa é designada a um time** — por padrão, o subtime de quem a
  criou (ex.: quem é da Automação cria tarefas da Automação sem precisar
  escolher nada).
- **Existe tarefa avulsa**: dá pra criar uma tarefa fora de qualquer
  projeto — um ajuste rápido, uma demanda solta — e ela aparece no quadro
  do time, sem precisar inventar um projeto pra ela.
- **Quem vê o quê passa a depender do time e do papel da pessoa.**
- **Quem mexe no quê também** — você pode enxergar uma tarefa e ainda
  assim não poder editá-la, se ela não é do seu time.

A ideia em uma frase: **o time decide a visibilidade e a edição; o
projeto continua sendo o "guarda-chuva" que agrupa o trabalho de vários
subtimes.**

### Os quatro papéis, em linguagem de produto

A organização do Marketing tem uma hierarquia: o time principal
(Marketing) e subtimes dentro dele (Automação, CRM, ...). Cada pessoa tem
um papel no time/subtime:

- **Admin** — controle total no workspace (hoje, só a dona).
- **Manager** (head e gerentes) — enxerga e mexe em tudo do seu time,
  incluindo todos os subtimes abaixo.
- **Supervisor** (coordenador de subtime) — enxerga e mexe no quadro
  geral do time e no seu próprio subtime; **não** mexe nos subtimes
  irmãos. Pode administrar os membros do seu subtime.
- **Operator** (abaixo do coordenador) — mesma visão e edição de tarefa
  do supervisor (quadro geral + seu subtime), mas **não** administra
  membros.

## Escopo

Esta entrega é fatiada em duas fases (sequência detalhada no `plan.md`):

**Fase A — estrutura e visibilidade (leitura):**
- `task.project_id` passa a ser **nullable** → tarefa avulsa.
- Nova coluna `project.team_id` (obrigatória em projeto comum; nula no
  Pessoal).
- `task.team_id` ganha semântica de "time designado" e passa a ser
  preenchido por padrão com o subtime do criador.
- Reescrita da query de visibilidade de tasks pra respeitar time + papel,
  cobrindo os dois regimes (com projeto / avulsa) e mantendo a
  privacidade do Pessoal.

**Fase B — autorização por papel-de-time (escrita):**
- `TenantContext` passa a carregar os pares `(team_id, role)` do usuário,
  em vez do conjunto plano de papéis atual.
- Trava de edição (move/update/archive/delete) por escopo de time, com
  alcance hierárquico pra Manager/Admin.
- Invariante **um subtime por usuário** (validação no fluxo de membros).

## Non-goals

- **Administração de membros escopada por time** — fica para entrega
  futura. O **modelo** está documentado aqui e na ADR 0009 (quem pode
  administrar quem), mas a implementação dos endpoints de membros não
  entra nesta entrega.
- **Assignment e watchers** — Entrega 4.
- **LTREE em time / materialização de caminho de time** — não nesta
  entrega (ver ADR 0009: a árvore de times é pequena, resolve-se sem
  isso). Reavaliar só se o número de times crescer muito.
- **Mudar o significado de `position`, comments, time entries** — entregas
  futuras, sem alteração aqui.

## Decisões

### Estruturais

1. **Tarefa avulsa via `project_id` nullable.** (ADR 0006) Uma tarefa
   pode existir sem projeto. A query de visibilidade deixa de ser um
   `INNER JOIN` com `project` e passa a `LEFT JOIN`, tratando dois
   regimes.
2. **`project.team_id` obrigatório em projeto comum.** (ADR 0007) Coluna
   nova, FK pra `team` (composta com `workspace_id`). Constraint
   condicional: `is_personal = true OR team_id IS NOT NULL`. Sem backfill
   (os projetos comuns existentes serão excluídos — não há nada ativo).
3. **Subtime = `team` com `parent_team_id` preenchido.** Não há entidade
   separada; a hierarquia já existe no schema. O "time geral" é a raiz da
   árvore daquele subtime (no caso atual, Marketing).
4. **Um subtime por usuário.** (ADR 0008) Uma pessoa pertence a no máximo
   um subtime. Isso torna o default de time da tarefa determinístico.
   Enforcement no serviço de membros (não dá constraint de banco limpa,
   porque "é subtime" depende do `parent_team_id` do time referenciado —
   provável trigger de apoio).

### Time designado da tarefa

5. **Default = subtime do criador.** Ao criar, se o usuário está em um
   subtime, a tarefa nasce com `team_id` daquele subtime.
6. **Criar "no geral" é escolha explícita.** O usuário pode setar
   `team_id` = time principal (Marketing) na criação. Qualquer papel pode
   criar no geral.
7. **Sem subtime → default é o time geral.** Se o criador está só no time
   principal (sem subtime), a tarefa nasce com o time principal. Se não
   está em time nenhum, a criação exige `team_id` explícito (senão 422).
8. **Tarefa em projeto:** o `team_id` da tarefa deve pertencer à subárvore
   do `team_id` do projeto (não dá pra marcar uma tarefa de um projeto do
   Marketing com um subtime de outro time). Violação → 422.

### Visibilidade (Fase A — leitura)

Conjunto de times visíveis por papel (a "lente" do usuário):

9. **Admin** → todos os times do workspace.
10. **Manager** → seu time + **todos os subtimes abaixo** (subárvore).
11. **Supervisor / Operator** → seu subtime + o time geral (a raiz da sua
    árvore). **Não** inclui subtimes irmãos.

Aplicação por superfície:

12. **Tarefa avulsa** (sem projeto): visível se `task.team_id` está na
    lente do usuário. (Logo, a avulsa de um subtime irmão **não** aparece.)
13. **Tarefa em projeto comum:** o projeto é visível se `project.team_id`
    está na lente. **Se você vê o projeto, vê _todas_ as tarefas dele** —
    inclusive de subtimes que não estão na sua lente. (O subtime, dentro
    do projeto, só governa a edição.)
14. **Pessoal** continua soberano: tarefa em Pessoal alheio → 404, acima
    de qualquer regra de time.

> **⚠️ DECISÃO PRA CONFIRMAR NA REVISÃO — assimetria proposital.**
> As regras 12 e 13 produzem uma assimetria: um Operator da Automação
> **vê** uma tarefa do CRM se ela está num projeto compartilhado (regra
> 13), mas **não vê** a mesma tarefa do CRM se ela for avulsa (regra 12).
> Isso é o que ficou combinado ("dentro do projeto vê tudo; avulsa fica no
> subtime"), mas é o ponto que um revisor mais estranha. Se a intenção for
> uniformizar (projeto também só mostra a sua fatia), me avise antes da
> implementação — muda a regra 13 e simplifica a query.

### Autorização de edição (Fase B — escrita)

Conjunto de times **editáveis** por papel:

15. **Admin** → tudo.
16. **Manager** → seu time + todos os subtimes abaixo (mesma subárvore da
    visibilidade).
17. **Supervisor / Operator** → time geral + seu próprio subtime.
    **Não** edita subtimes irmãos, mesmo que os enxergue via projeto
    compartilhado.

18. **Edição ⊆ visão**, com uma exceção desenhada: dentro de um projeto
    compartilhado a pessoa vê mais do que edita (vê a tarefa do irmão, não
    edita). Em todo o resto, só edita o que vê.
19. **Duas camadas de autorização:** a permissão grossa (o papel concede a
    ação? — mapa de permissões atual, `task.update`/`task.delete`/...)
    continua no router via `require_permission`. A camada nova é o **cheque
    de escopo no serviço** (o time da tarefa está no conjunto editável?),
    que roda depois de carregar a tarefa.
20. **Códigos:** ação fora de escopo numa tarefa que a pessoa **vê** →
    403. Numa tarefa que a pessoa **não vê** → 404 (não vaza existência).

### Administração de membros (modelo documentado, implementação adiada)

21. (ADR 0009) Administrar membros de **time** (principal): só `MANAGER` e
    `ADMIN`. Administrar membros de **subtime**: `MANAGER`, `SUPERVISOR`
    do subtime, e `ADMIN`. `OPERATOR`: nenhum. **Não implementado nesta
    entrega** — fica registrado para a entrega de membros.

### Autorização — fundação (Fase B)

22. **`TenantContext` carrega `(team_id, role)`.** Hoje os papéis são um
    `frozenset[str]` plano que esquece de qual time veio cada papel. Pra
    responder "essa pessoa é Manager do time _dono desta tarefa_?", o
    contexto precisa carregar os vínculos com o time. O mapa
    role→permissão continua existindo como a camada de "quais ações".
23. **Resolução da árvore de times sem overengineering.** (ADR 0009) A
    quantidade de times é pequena; resolver ancestrais/descendentes via
    `parent_team_id` (CTE recursivo ou carga em memória) é suficiente.
    Nada de LTREE em time por ora.

## Contratos públicos (HTTP)

Endpoints de tasks mantêm os paths da Entrega 2. Mudanças:

| Método | Path        | Mudança nesta entrega |
|--------|-------------|------------------------|
| POST   | /tasks      | `project_id` agora **opcional** (avulsa). `team_id` opcional (default = subtime do criador). |
| GET    | /tasks      | Resultado já filtrado pela lente de time do usuário. Novo filtro opcional `team_id` já existia; ganha sentido real. |
| PATCH  | /tasks/{id} | Sujeito ao cheque de escopo de time (403/404). |
| POST   | /tasks/{id}/move | Idem. Mover entre times respeita escopo de origem e destino. |
| DELETE | /tasks/{id} | Idem. |
| POST   | /projects   | `team_id` **obrigatório** em projeto comum; ignorado/proibido no Pessoal. |

### Mudanças de schema (resposta)

- **`TaskResponse`**: `project_id` passa a poder ser `null`. `team_id`
  continua presente (agora quase sempre preenchido).
- **`ProjectResponse`**: ganha `team_id` (`null` no Pessoal).

### Códigos de erro (novos/alterados)

- `403 AuthorizationError` — ação fora do escopo de time (tarefa visível,
  edição negada).
- `404 EntityNotFoundError` — tarefa fora da lente de visibilidade (não
  vaza existência), além dos casos da Entrega 2.
- `422 ValidationError` — projeto comum sem `team_id`; `task.team_id` fora
  da subárvore do time do projeto; criação sem time e sem subtime do
  criador; tentativa de pôr usuário em um segundo subtime.

## Critérios de aceite

**Estrutura (Fase A):**
- [ ] Criar tarefa sem `project_id` → 201, `project_id=null`, aparece no
      quadro do time do criador.
- [ ] Criar tarefa sem `team_id`, criador em subtime → herda o subtime.
- [ ] Criar tarefa com `team_id` = time principal → aceito (criar "no geral").
- [ ] Criar tarefa em projeto com `team_id` fora da subárvore do projeto → 422.
- [ ] Criar projeto comum sem `team_id` → 422.
- [ ] Criar/obter projeto Pessoal → `team_id=null`, sem exigir time.

**Visibilidade (Fase A):**
- [ ] Operator da Automação **não** vê avulsa do CRM.
- [ ] Operator da Automação **vê** tarefa do CRM dentro de projeto compartilhado.
- [ ] Supervisor vê seu subtime + quadro geral; não vê subtime irmão (avulsa).
- [ ] Manager vê toda a subárvore do seu time.
- [ ] Admin vê tudo do workspace.
- [ ] Pessoal alheio → 404 (inalterado).

**Autorização de edição (Fase B):**
- [ ] Operator edita tarefa do seu subtime e do geral; tarefa de subtime
      irmão visível via projeto → PATCH → 403.
- [ ] Supervisor: mesmo escopo de edição de tarefa que o operator.
- [ ] Manager edita qualquer subtime abaixo do seu time.
- [ ] Editar tarefa fora da lente (não visível) → 404, não 403.
- [ ] Ação cujo papel não concede (ex.: delete sem `task.delete`) → 403,
      antes mesmo do cheque de escopo.

**Invariante de subtime (Fase B):**
- [ ] Pôr usuário num segundo subtime → 422.

## Riscos

- **Mudança de fundação na autorização.** Reestruturar o `TenantContext`
  toca todo mundo que lê papéis. Mitigação: Fase B isolada, com a Fase A
  já entregando valor (visibilidade) sem mexer na escrita.
- **`project_id` nullable rompe premissas da Entrega 2.** A query de
  visibilidade e o fluxo de criação assumem projeto sempre presente.
  Mitigação: cobertura de teste dos dois regimes; a migration que afrouxa
  o NOT NULL é simples, mas o código ao redor precisa de revisão cuidadosa.
- **Assimetria projeto vs. avulsa (regras 12–13).** Risco de confundir
  usuário e revisor. Mitigação: confirmar na aprovação; documentar no
  frontend.
- **Enforcement de "um subtime por usuário".** Sem constraint de banco
  limpa. Mitigação: validação no serviço + trigger de apoio; teste do caso.
