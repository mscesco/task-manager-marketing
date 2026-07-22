# Spec 024 — Invariante de papéis por nível de time

## Objetivo
Fechar a incoerência entre as duas metades da autorização. Hoje o **escopo** é
ciente de time (`team_scope.visible_team_ids`), mas a **permissão** não é
(`permissions_for_roles` une os papéis ignorando em qual time cada um foi
concedido). Resultado: um MANAGER de subtime tem escopo corretamente limitado ao
seu ramo, mas carrega `team.manage`, `project.delete` e `solicitation.review`
sem nenhuma noção de time.

A correção não é criar permissão por time — é **restringir onde cada papel pode
existir**:

- **ADMIN e MANAGER só no time raiz** (`parent_team_id IS NULL`).
- **Subtime aceita apenas SUPERVISOR e OPERATOR.**
- **A raiz aceita os quatro papéis** — ver D1a.
- **No máximo um time raiz por workspace** — garantido pelo banco, não por
  convenção.

Com isso, "união dos papéis" e "autoridade sobre a árvore" passam a coincidir
**por construção**, e o mapa estático de permissões continua sendo o único lugar
a editar quando surgir permissão nova.

## O que já existe (reuso, não invento)
- **Herança de escopo:** `app/modules/auth/domain/team_scope.py` já implementa
  *MANAGER/ADMIN de T → T + descendentes* e *SUPERVISOR/OPERATOR de X → X +
  raiz*. Funções puras `descendants()`, `root_of()`, `is_subteam()`,
  `is_admin()` prontas. **Nada disso muda.**
- **Precedente de gate de papel:** `MemberService.create_member` já recusa
  criar ADMIN quando o ator não é ADMIN (Spec 014, gate D2). Mesmo molde.
- **Padrão de erro de domínio antes do banco:** `TeamService.create` já
  documenta a prática — *"a FK composta no banco já garantiria, mas falhar aqui
  dá uma mensagem de domínio clara em vez de IntegrityError"*.
- **`team` NÃO tem soft-delete** (`UUIDPrimaryKeyMixin, TimestampMixin` apenas).
  Verificado: índice único parcial é seguro, sem risco de linha apagada
  ocupando a vaga da raiz.
- **Dados já conformes.** Duas queries rodadas em produção retornaram vazio:
  nenhum ADMIN/MANAGER em subtime, nenhum SUPERVISOR/OPERATOR em raiz, nenhum
  workspace com mais de uma raiz. **Esta spec é só trancar a porta** — sem
  migração de dados, sem backfill.

## Decisões cravadas
- **D1a — A regra é ASSIMÉTRICA (corrigido após a Fatia 2).** A versão inicial
  desta spec dizia que a raiz só aceitaria ADMIN/MANAGER. Estava errado: quebrou
  11 testes de integração e, mais importante, atropelou a **Spec 003 (decisões 7
  e 17)**, onde estar **só no time geral, sem subtime, é um estado de produto
  projetado** — é assim que se "tira alguém de um subtime" sem remover a pessoa
  (`move_member_subteam` para a raiz, preservando o papel).
  A regra correta é uma só: **ADMIN e MANAGER só existem no time raiz.**
  Raiz aceita os quatro papéis; subtime aceita SUPERVISOR e OPERATOR.
  O objetivo segue atendido: quem carrega ADMIN/MANAGER é membro da raiz, então
  "união dos papéis" e "autoridade sobre a árvore" coincidem. SUPERVISOR e
  OPERATOR na raiz não ganham permissão elevada — enxergam a raiz e só.
- **D1 — Papel por nível, não por time nomeado.** A regra olha
  `parent_team_id IS NULL`, não um slug (`marketing`) nem uma coluna
  `principal_team_id`. Menos peça pra manter e o `root_of()` que já existe passa
  a devolver a resposta certa por definição.
- **D2 — Uma raiz por workspace, garantida no banco (do seu aval).**
  `CREATE UNIQUE INDEX ... ON team (workspace_id) WHERE parent_team_id IS NULL`.
  É o que transforma "time principal" de convenção em fato estrutural.
  **Preço aceito conscientemente:** este workspace nunca poderá ter dois times
  de topo lado a lado. Se um dia TI ou RH precisarem existir no *mesmo*
  workspace, ou ficam pendurados embaixo do time principal (semanticamente
  errado) ou viram workspace separado.
- **D3 — Guard ÚNICO e compartilhado, chamado em todas as portas.** A invariante
  de papéis tem **quatro** pontos de entrada, não dois:
  `create_member`, `assign_to_team`, `change_member_role`, `move_member_subteam`.
  Guardar só os dois óbvios (criar e trocar papel) deixa escapar por
  `assign_to_team` e `move_member_subteam`. Uma função só, chamada nos quatro.
- **D4 — Erro de domínio antes do flush, nunca IntegrityError.** Tanto em
  `TeamService.create(parent_team_id=None)` quanto em
  `TeamService.move(new_parent_id=None)`, a checagem de "já existe raiz" acontece
  **antes** do flush e levanta `ConflictError` (409). Sem isso, o índice de D2
  transforma essas duas rotas em HTTP 500 com `IntegrityError` cru na cara do
  usuário. **Este é o efeito colateral mais provável de D2 e o motivo principal
  desta fatia existir.**
- **D5 — Papel inválido para o nível recusa com `BusinessRuleError` (409).**
  Mensagem nomeia a regra ("ADMIN e MANAGER só existem no time principal"), não
  o detalhe técnico.
- **D6 — Provisionamento e seed continuam válidos sem mudança.**
  `provision_workspace` cria a raiz com `parent_team_id=None` e vincula o admin
  a ela com papel ADMIN — já conforme. `team_seed_service` cria subtimes sob a
  principal — já conforme. Ambos ganham teste que trava isso.

## Riscos residuais
- **R1 — Rotas que hoje respondem 2xx passam a responder 409.** Criar um segundo
  time raiz e promover subtime a raiz eram operações permitidas. Se existir
  automação, script ou hábito operacional que faça isso, quebra. Não achei
  nenhum no repo, mas é o tipo de coisa que vive fora dele.
- **R2 — Migration no deploy.** O índice exige `alembic upgrade head`. Ponto de
  falha canônico de vocês; entra no `DEPLOY.md`.
- **R3 — Workspace sem raiz nenhuma (modo de trancar a porta).** O índice
  parcial permite **zero** raízes. Hoje isso é inalcançável por acidente: não
  existe rota de deletar time, e mover a raiz para debaixo de um descendente é
  barrado pela detecção de ciclo. Mas essa segurança é **consequência acidental
  de duas outras regras**, não garantia explícita. Vai como teste travando o
  comportamento — se alguém mexer na checagem de ciclo um dia, o teste acusa.
- **R4 — A invariante mira o formato "ferramenta do marketing".** D2 assume um
  departamento por workspace. Se a direção de médio prazo for virar ferramenta
  da instituição inteira com vários departamentos convivendo, D2 vira obstáculo
  e a conversa é outra (multi-workspace vs. multi-raiz).
- **R6 — A assimetria precisa ser lembrada.** É tentador "arrumar" a regra
  deixando-a simétrica (raiz só com ADMIN/MANAGER) por parecer mais limpa.
  Isso quebra o fluxo "tirar do subtime" da Spec 003. O teste
  `test_move_supervisor_para_raiz_e_o_fluxo_tirar_do_subtime` existe para
  acusar essa regressão.
- **R5 — Papel novo no enum.** Se um dia entrar um papel novo em
  `UserTeamRole`, ele precisa ser classificado como "de raiz" ou "de subtime",
  senão cai num limbo. O guard falha fechado (recusa) para papel não
  classificado, e isso é intencional.

## Fora de escopo
- Permissão calculada por contexto / RBAC em tabela. A invariante existe
  justamente para **não** precisar disso.
- Mudança em `team_scope` ou na herança de escopo — já está correta.
- Interface para transferir o papel de time principal entre times.
- Migração/backfill de dados (desnecessário: produção já está conforme).

## Critérios de aceite
1. Criar membro com papel ADMIN ou MANAGER apontando um **subtime** → 409, nada
   gravado.
2. Criar membro com papel SUPERVISOR ou OPERATOR apontando o **time raiz** →
   **aceito** (membro "do geral", sem subtime — D1a).
3. `assign_to_team` com ADMIN/MANAGER em **subtime** → 409; com
   SUPERVISOR/OPERATOR na **raiz** → aceito (D1a).
4. `change_member_role` promovendo a MANAGER alguém que está em subtime → 409.
5. `move_member_subteam` levando ADMIN/MANAGER para subtime → 409. Levando
   SUPERVISOR/OPERATOR de subtime para a raiz → **aceito**: é o fluxo "tirar do
   subtime" da Spec 003, e a invariante não pode barrá-lo (D1a).
6. `TeamService.create(parent_team_id=None)` num workspace que já tem raiz →
   **409 com mensagem de domínio**, nunca 500/IntegrityError.
7. `TeamService.move(new_parent_id=None)` promovendo subtime a raiz quando já
   existe raiz → **409 com mensagem de domínio**, nunca 500/IntegrityError.
8. Mover o time raiz para debaixo de um descendente continua barrado por ciclo →
   o workspace nunca fica sem raiz (R3).
9. `provision_workspace` e `team_seed_service` rodam limpos sob a invariante.
10. Índice único: tentativa de inserir segunda raiz direto no banco falha.
11. Isolamento de tenant: raiz do workspace A não conflita com raiz do B.
