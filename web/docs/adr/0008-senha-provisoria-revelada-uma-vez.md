# 0008 — Senha provisória revelada uma vez na UI

## Status

Accepted

## Contexto

Cadastrar membro (`POST /members`) e resetar senha
(`POST /members/{id}/reset-password`) devolvem `temporary_password` no corpo
da resposta — e **só ali** (backend ADR 0021). Não há serviço de e-mail/
convite: quem cadastra repassa a senha ao novo membro pelo canal que tiver.
Se a UI tratar isso como um campo qualquer, a senha pode vazar (log, estado
que persiste, re-render) ou se perder (some antes do admin copiar).

## Decisão

A senha provisória aparece num **bloco reveal-once** (`SenhaProvisoria`),
disparado tanto pelo cadastro quanto pelo reset, com:

- a senha em destaque (monoespaçada, `user-select: all`) + botão **Copiar**;
- aviso explícito em vermelho: "copie agora, não aparece de novo";
- um único botão **Concluir** que **limpa** o estado.

A senha vive **apenas** no estado do componente (`revelado`), some ao
Concluir, e **não é re-buscável** (nenhuma chamada relista a provisória). O
cadastro e o reset compartilham o mesmo bloco — uma fonte só pra essa UX
sensível.

## Consequências

**Positivas:** a senha existe pelo tempo mínimo e num lugar só; o admin é
forçado a copiar conscientemente; reset e cadastro não divergem.

**Negativas:** se o admin fechar sem copiar, a única saída é **resetar de
novo** (gera outra provisória). É o preço de não persistir segredo.

**Armadilha:** qualquer "melhoria" que guarde a senha (cache, toast
persistente, pré-preencher em outro lugar) reabre o vazamento. O reveal-once
é deliberado, não um rascunho.

## Alternativas consideradas

- **Mostrar a senha na lista/coluna do membro.** Rejeitada: segredo
  persistido na tela é exatamente o que se quer evitar.
- **Mandar por e-mail.** Não existe serviço de e-mail; fora de escopo.

## Relacionados

- Backend ADR 0021 (provisória no corpo, uma vez). Front 0009 (gestão de
  membros). Spec `012-membros-e-perfil`.
