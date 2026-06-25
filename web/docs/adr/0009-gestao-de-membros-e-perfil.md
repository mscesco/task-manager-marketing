# 0009 — Gestão de membros (gating, desativar) e perfil só-leitura

## Status

Accepted

## Contexto

A E15 abre no front três superfícies sobre um backend já pronto: ver o
próprio perfil, listar membros do workspace, e gerir membros (cadastrar/
resetar/desativar). Cada uma carrega uma decisão de alçada ou de limite que
vale registrar.

## Decisão

**Gating por `team.manage`.** Listar membros é para qualquer autenticado.
Cadastrar, resetar senha e desativar só aparecem para quem tem `team.manage`
(lido de `currentUser().permissions`). O esconder-botão é conforto de UX — a
trava real é o backend (403). Não se confia só no front.

**Ações de gestão por linha, nunca em si mesmo.** "Resetar senha" e
"Desativar" aparecem só em membro **ativo** que **não é o usuário logado**
(`me.id !== member.id`). Você se gerencia pelo `/perfil`. Confirmação é
**inline** (sem dialog do browser).

**Desativar, não deletar — e sem reativar pela tela.** Não há hard-delete;
só `deactivate` (soft). Como **não existe endpoint de reativar**, a UI avisa
na confirmação que a ação não tem desfazer pela tela. O backend ainda barra
auto-desativação.

**Perfil v1 é só-leitura.** Mostra nome, e-mail e papéis (de `auth/me`) + link
para `/trocar-senha`. **Não** edita nome/avatar — não há endpoint; seria
adição de backend, fora desta entrega.

**Papel fora da listagem.** `MemberResponse` traz subtime (`team_id`), não o
papel (mora no `user_team` por equipe). A lista mostra nome/e-mail/subtime/
ativo; o papel só aparece ao cadastrar. Exibir/editar papel na lista é backend
futuro (conecta com "trocar papel de membro existente").

## Consequências

**Positivas:** alçada clara e alinhada à E12 (`task.delete`/`team.manage`);
nenhuma ação destrutiva sem confirmação; o perfil entrega o essencial sem
endpoint novo.

**Negativas / dívidas registradas:**

- **Desativar é via única** pela UI até existir endpoint de reativar.
- **Reatribuir subtime/papel** de membro já criado não tem tela (o endpoint
  `/members/{id}/team` existe, mas só *atribui*, e dá conflito se a pessoa já
  está no time — "trocar papel" provavelmente pede endpoint novo).
- **Cache de membros**: `listMembers` é memoizado; cadastro/desativação
  chamam `invalidateMembers()` para a lista e os seletores de responsável não
  ficarem defasados.

## Alternativas consideradas

- **Perfil editável (nome/avatar) já na E15.** Adiada: exige backend novo.
- **Permissão dedicada de moderação de membros.** Desnecessária: `team.manage`
  (ADMIN/MANAGER) já é a alçada certa.

## Relacionados

- Front 0008 (reveal-once). Backend: rotas de membro (E7) e `team.manage`.
  Spec `012-membros-e-perfil`.
