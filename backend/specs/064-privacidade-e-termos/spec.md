# Spec 064 — Política de privacidade e termos de uso

**Status:** perguntas respondidas por ela em 09/11/2026. **Os textos são um
rascunho técnico, fiel ao produto, e precisam de revisão jurídica antes de valer.**

Pedido: o Oniros não tinha política de privacidade nem termos. Esta spec cria os
dois textos, em português e conforme a LGPD, em páginas públicas, com link no
login e no formulário público. Só mexe no front: sem migration e sem rota de API.

## Decisões dela (09/11)

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Razão social, CNPJ, encarregado, canal do titular, foro, país da VPS | **Marcadores visíveis** até ela ter os dados. Depois ela pediu para usar o site oficial: CNPJ, grupo, sede e foro vieram de `unifecaf.com.br` (home e `/termos-e-condicoes`, 09/11). O encarregado e um canal para o titular não estão publicados lá |
| D2 | Prazos de retenção | **Descrever o que existe hoje**: sem eliminação automática na maior parte dos dados; elimina-se ou anonimiza-se a pedido, à mão |
| D3 | Alcance dos termos | **Equipe e quem envia o formulário**, com uma seção para cada |
| D4 | Aceite registrado | **Basta o link**: sem migration. A jurídica confirma se a base legal permite |

## O que o produto faz com dados pessoais (lido no código, 09/11)

### O que é coletado

| Origem | Dados | Onde |
|---|---|---|
| Conta | nome, e-mail, hash bcrypt da senha, papel, times, estado da conta | `db/models/organization.py` |
| Formulário público | nome e e-mail; telefone, departamento e polo se o formulário pedir; categoria, resumo, respostas livres | `db/models/solicitations.py`, `solicitations/api/schemas.py` |
| Triagem | nota, quem analisou, quando, tarefa criada | `db/models/solicitations.py` |
| Trabalho | tarefas, projetos, comentários, reações, seguidores, links, Bases | `db/models/operational.py`, `collaboration.py`, `bases.py` |
| Histórico | autor, campo, valor antigo e novo; imutável por trigger | `collaboration.py` (`task_history`) |
| Notificações | destinatário, autor, nome e título congelados | `db/models/notifications.py` |
| Logs | método, caminho, status, duração, id da requisição; `user_id` em eventos como login | `core/middleware.py`, `auth/application/service.py` |
| Erros do navegador | mensagem, pilha, caminho, navegador; só em log | `api/client_errors.py` |
| Navegador | tokens, tema, estado do menu, rascunho do formulário, em `localStorage` | `web/lib/api.ts`, `tema.ts`, `sidebar.ts`, `rascunhoSolicitacao.ts` |

**Não existe:** cookies, analytics, IP em tabela, upload de arquivo (link é só
texto), e-mail de notificação, captcha, login por terceiros, auto-cadastro,
exclusão de conta pelo produto.

⚠️ "Criar tarefa" a partir de uma solicitação copia nome, e-mail, telefone,
departamento, polo e respostas para a descrição da tarefa
(`solicitations/domain/briefing.py`). A partir daí, quem vê a tarefa vê esses dados.

### Quem acessa

- Conta: qualquer pessoa autenticada vê nome e e-mail de todas as outras em
  `GET /members`, inclusive desativadas.
- Tarefas e comentários: lente de times (`auth/domain/team_scope.py`). Papel de
  organização vê tudo; Gerente, o time e os subtimes; Supervisor e Operador, o
  próprio time e a raiz.
- Solicitações: Administrador e Gestor veem todas; Gerente, as dos formulários
  dos times da sua árvore; Supervisor e Operador não veem.

### Para quem vai

- **Hostinger**: VPS com aplicação, banco e backups.
- **n8n** (na mesma VPS): recebe, na mudança de status, nome, e-mail, telefone,
  departamento, polo, protocolo, resumo, categoria, prazo e motivo de recusa. As
  respostas livres não vão (`solicitations/infrastructure/aviso_de_status.py`).
- **Google (Gmail)**: o workflow `[TM] Aviso de Solicitação` envia o e-mail ao
  solicitante em aprovação, início, conclusão e recusa (conferido no n8n, 09/11).
- **GIPHY**, só com `NEXT_PUBLIC_GIPHY_KEY` no build: o navegador consulta a API e
  carrega as imagens direto de lá.

### Por quanto tempo fica

| Dado | Regra | Fonte |
|---|---|---|
| Access token / refresh token | 15 min / 7 dias | `core/config.py` |
| Senha provisória | 72 h | `core/config.py` |
| Tarefa em estado final | arquivada após 20 dias, sem apagar | `core/config.py` (`stale_archive_days`) |
| Tarefa, projeto, comentário excluídos | ocultos; ficam no banco, sem expurgo | `task_service.py`, `comment_service.py` |
| Base excluída | apagada após 10 dias | `bases/application/base_service.py` |
| Linha, coluna, opção, diário da Base | apagados após 1 dia | `bases/application/undo_service.py`, `purge_service.py` |
| Solicitação, histórico, notificação | sem prazo | modelos |
| Conta desativada | fica, sem prazo | `member_service.py` |
| Backup do banco | diário, 14 dias, na VPS | `scripts/backup_taskmanager.sh` |
| Rascunho do formulário | desconsiderado após 7 dias; apagado ao enviar | `web/lib/rascunhoSolicitacao.ts` |

## O que entrega

- `/privacidade` e `/termos`, públicas, em `MolduraPublica`, largura de até 760 px.
- `LinksLegais` no login e dentro de `MolduraPublica`, o que cobre `/solicitar`,
  `/solicitar/<slug>`, os avisos de erro e as duas páginas novas. Abrem em aba
  nova para não tirar a pessoa do formulário ou do login.
- Faixa de rascunho no topo das duas páginas e marcador `[A PREENCHER: …]` em cada
  dado faltante.

Página sem `AppShell` já é pública, e a CSP e o Traefik não pedem exceção.

## Antes de ir ao ar

**A faixa de rascunho e os marcadores têm de sair antes de a página valer.** Falta:

1. Revisão jurídica, incluindo as bases legais, que aqui são proposta.
2. Encarregado, canal do titular e a confirmação de que a Federal Educacional Ltda. é o controlador e de que o foro do contrato educacional serve aqui.
3. País da VPS da Hostinger.
4. Prazo das execuções guardadas no n8n, que têm dados do solicitante.
5. Prazo dos backups semanais da Hostinger.
6. Se o GIPHY está ligado em produção. O texto diz "quando ativo", o que vale nos dois casos.
7. Conferir na VPS o log de acesso do uvicorn, o do Traefik e a rotação do Docker.
   O texto afirma o que o código permite afirmar e diz que não há prazo definido.
8. Se menores de idade podem usar o formulário público (art. 14 da LGPD).

## Fora de escopo

Aceite registrado (D4), exclusão de conta na tela, prazos com job de eliminação
(D2) e portal do titular. Se a jurídica pedir prazos, o job de eliminação é outra
spec, e o texto só promete o prazo depois de o job existir (`AGENTS.md` §10).
