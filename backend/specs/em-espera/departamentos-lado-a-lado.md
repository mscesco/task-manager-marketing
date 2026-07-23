# [EM ESPERA] Departamentos lado a lado (Design, TI, Comercial…)

**Status: EM ESPERA — não desenhar nem codar até existir demanda concreta.**
Gatilho para reabrir: uma área da UniFECAF pedir, de verdade, para usar a
ferramenta. Registrado em 2026-07-22 para as decisões não se perderem
(como quase aconteceu com as specs 024/025).

## O problema

Hoje o time raiz do workspace `unifecaf` É o Marketing. Se outra área
(Gente e Gestão, TI, Comercial, Design) quiser entrar, "um time ao lado do
Marketing" colide com duas coisas deployadas em 2026-07-22:

1. **Índice único `team_unica_raiz_por_workspace` (migration 0004):** só
   existe UMA raiz por workspace. Criar uma segunda raiz é barrado pelo banco.
2. **Spec 024 — ADMIN/MANAGER só existem na raiz.** O modelo de visibilidade
   (`team_scope.py`) só tem dois andares: chefia na raiz (vê tudo) e
   SUPERVISOR/OPERATOR em subtime (vê o subtime + a raiz). **Não existe
   "chefe de um ramo da árvore"**: um MANAGER veria e editaria TODOS os
   departamentos; um SUPERVISOR de um time intermediário não enxerga nem os
   subtimes abaixo dele.

## A pergunta que decide o caminho (fazer à área interessada)

> "Vocês precisam VER e trocar tarefas com o Marketing, ou só precisam usar
> a mesma ferramenta?"

## Caminho 1 — cada departamento no seu workspace (barato)

Cada área = workspace próprio: login, quadro, chefia e dados isolados.
Invisíveis entre si.

- O backend JÁ suporta: `LoginRequest` exige `workspace_slug`
  (`auth/api/schemas.py`), e-mail é único por workspace, e o
  `provisioning_service` + `scripts/provision_workspace` criam
  workspace + admin.
- **Único bloqueio real:** o front fixa o slug em
  `web/lib/api.ts:16` (`NEXT_PUBLIC_WORKSPACE_SLUG || "unifecaf"`).
  Vira campo no login ou slug na URL. Sem migration, sem tocar domínio.
- Trade-off aceito: zero colaboração entre áreas; a mesma pessoa em duas
  áreas teria duas contas (decidido em 2026-07-22: cenário não requerido).

## Caminho 2 — mesma casa, um quarto por departamento (caro)

Raiz neutra ("UniFECAF Geral"); Marketing, TI, Design viram filhas dela.
Time geral compartilhado por todos.

Custos conhecidos (levantados, não resolvidos):
- (a) Inventar o papel "chefe de departamento" — rework da Spec 024 e do
  `team_scope.py` (funções puras `visible_team_ids`/`editable_team_ids`).
- (b) Reestruturação com ovo-e-galinha: o índice do 0004 impede criar a
  segunda raiz; criar a raiz nova e rebaixar o Marketing precisa acontecer
  **na mesma transação** (script de migração de dados dedicado).
- (c) Revisar tudo que assume "raiz = Marketing": destino da fila do
  formulário público (Spec 025), `default_team_id`, semântica do
  "time geral" na visibilidade, seeds.
- (d) A home pós-login listando departamentos nasce AQUI, como
  consequência — não construir antes.

## Decisões já tomadas (não rediscutir sem fato novo)

- **D1.** Cadastro aberto (estilo Trello) NÃO entra. Membro só por convite
  do admin. Elimina o estado "usuário sem time".
- **D2.** Mesma pessoa em dois workspaces: não requerido.
- **D3.** Criação de workspace/raiz: restrita ao admin via CLI até existir
  volume que justifique UI.
- **D4.** Não derrubar o índice do 0004 "para testar" — a invariante
  sustenta a regra de papéis da 024.

## Relacionado, também em espera

**UI para criar subtimes DENTRO do Marketing.** Independente da questão dos
departamentos (não colide com 0004 nem com a 024 — subtimes são ilimitados).
`TeamService.create/move` já existem com guards; falta só front. Reabrir se
a criação de subtime virar rotina; enquanto for evento raro, segue via
admin/API direta.
