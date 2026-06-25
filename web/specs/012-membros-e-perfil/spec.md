# Entrega 15 — Membros do workspace + Perfil

> **Status:** PROPOSTA — aguardando aprovação da Camila. Nada é codado antes
> do OK. Decisões abaixo estão recomendadas, não cravadas.
> **Tipo:** front sobre backend **pronto** (todas as rotas de membro já
> existem e foram testadas; ver "Endpoints usados").
> **Migration:** nenhuma.
> **ADRs a criar (após aprovação):** front `0008` (senha provisória revelada
> uma vez na UI), `0009` (gestão de membros: gating, desativar-não-deletar,
> perfil só-leitura).

## O que entrega (linguagem de produto)

Hoje o workspace UniFECAF tem membros (o admin cadastra por API), mas no
produto não dá pra **ver quem são**, **ver seu próprio perfil**, nem
**cadastrar gente pela tela**. Esta entrega abre três superfícies:

1. **Perfil** (`/perfil`): você vê seus dados (nome, e-mail, papéis, subtime)
   e tem um atalho pra trocar a senha.
2. **Membros** (`/membros`): a lista de todo mundo do workspace — nome,
   e-mail, subtime, e se está ativo.
3. **Gestão de membros** (na mesma página, só pra ADMIN/MANAGER): cadastrar
   um novo membro, resetar a senha de alguém, e desativar um membro.

## Decisões PROPOSTAS (precisam do seu OK)

**D1 — Read-only primeiro, gestão depois (4 fatias).** Perfil e lista de
membros (leitura, baixo risco, já úteis) saem antes das ações sensíveis de
gestão. Ver "Plano".

**D2 — Senha provisória aparece UMA vez (ADR 0008 do front; ADR 0021 do
backend).** Cadastrar membro e resetar senha devolvem `temporary_password` no
corpo — e **só ali**. A UI mostra num bloco destacado com aviso "copie agora,
não aparece de novo" + botão copiar, e **limpa ao fechar**. Não há e-mail/
convite automático (sem serviço de e-mail) — o admin repassa a provisória pelo
canal que tiver. Quem espera "o sistema avisa o novo membro" precisa saber que
isso **não existe** hoje.

**D3 — Gating por `team.manage`.** Listar membros é pra qualquer autenticado.
Cadastrar/resetar/desativar é só ADMIN/MANAGER. A UI esconde essas ações de
quem não tem `team.manage` (vem no `getMe().permissions`); o backend ainda
devolve 403 se vazar (defesa em profundidade).

**D4 — Subtime + papel opcionais na criação, com a regra do "1 subtime".** Dá
pra já vincular o novo membro a um subtime + papel (ou deixar sem). O backend
recusa (422) pôr alguém num **segundo** subtime — a UI trata esse 422 com
mensagem clara, sem quebrar o formulário.

**D5 — Desativar, não deletar — e sem volta pela UI v1.** Não existe "excluir
membro"; só desativar (soft). **Não há endpoint de reativar** no backend hoje
→ desativar é **via única** pela API. A UI confirma antes ("Desativar fulano?
Isso não tem desfazer pela tela hoje") e **esconde** a ação no próprio cartão
(o backend também barra desativar a si mesmo).

**D6 — Perfil v1 é só-leitura.** Mostra nome, e-mail, papéis e subtime, + link
pra `/trocar-senha` (tela que já existe). **Não** dá pra editar o próprio
nome/avatar — não há endpoint pra isso; seria adição de backend, fica fora
desta entrega (non-goal).

**D7 — Papel não aparece na lista.** O `MemberResponse` traz nome, e-mail,
ativo e subtime (`team_id`), mas **não** o papel (mora no `user_team` por
equipe). A lista de membros mostra nome/e-mail/subtime/ativo; o papel só
aparece no momento de **cadastrar/atribuir**. Mostrar papel na lista seria
mais backend — non-goal por ora.

**D8 — Bust do cache de membros.** `listMembers` é memoizado (limpa só no
logout). Depois de cadastrar/desativar, a UI invalida esse cache, senão a
lista e os seletores de responsável (Board/TaskDetail) ficam defasados.

**D9 — Navegação.** `AppShell` ganha "Membros" no nav; "Perfil" entra no nav
ou no canto do cabeçalho (a definir no detalhe da Fatia 2).

## Non-goals (fora desta entrega, de propósito)

- E-mail/convite automático ao novo membro (sem serviço de e-mail).
- Editar o próprio nome/avatar (sem endpoint; seria backend).
- Excluir membro de verdade (hard-delete) — só desativar.
- **Reativar** membro (não há endpoint; desativar é one-way hoje).
- Mostrar/editar o **papel** de um membro existente na lista.
- Editar o subtime de um membro já cadastrado pela tela (o endpoint
  `/team` existe, mas a UX fica pra depois).

## Endpoints usados (todos já existentes no backend)

- `GET /auth/me` — dados do perfil (nome, e-mail, papéis, permissões).
- `GET /members` — lista (com `team_id` = subtime, da E13).
- `POST /members` `{name, email, team_id?, role?}` — cadastra; devolve
  `temporary_password` UMA vez (`team.manage`).
- `POST /members/{id}/reset-password` — nova provisória UMA vez (`team.manage`).
- `POST /members/{id}/deactivate` — desativa (`team.manage`).
- `POST /members/{id}/team` `{team_id, role}` — vincula a subtime (`team.manage`).
- `GET /workspaces/current/teams` — subtimes pro seletor (`listSubteams`, já no front).

## Riscos / armadilhas

- **Vazamento da provisória.** Se a UI logar, mandar pra analytics, ou deixar
  a senha em estado que persiste além do fechar, vira incidente. Ela vive só
  no estado do componente, some ao fechar, e nunca é re-buscável.
- **Gating só na UI não basta** — é conforto, não segurança. O backend é a
  trava real (403). Não confiar no esconder-botão.
- **Cache defasado** se esquecer o bust após criar/desativar.
- **Desativar sem volta.** Sem reativar no backend, um clique errado deixa o
  membro fora até alguém mexer no banco. Daí a confirmação obrigatória.

## Definição de pronto

- [ ] `/perfil` mostra nome, e-mail, papéis, subtime + link trocar senha.
- [ ] `/membros` lista nome, e-mail, subtime, ativo; itens de nav.
- [ ] Cadastrar membro com reveal-once da provisória; subtime+papel opcionais.
- [ ] Resetar senha (reveal-once) e desativar (com confirmação), gated.
- [ ] Ações escondidas sem `team.manage`; 403 tratado.
- [ ] Cache de membros invalidado após criar/desativar.
- [ ] `npm run build` verde + roteiro no `dev` contra backend real.
- [ ] ADRs `0008`/`0009` escritos.
