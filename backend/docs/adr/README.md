# Architecture Decision Records (ADRs)

Decisões arquiteturais de escopo amplo moram aqui, fora de docstrings.
Cada decisão é um arquivo numerado: `NNNN-titulo-curto.md`.

## Quando criar um ADR

- Toda escolha que afeta múltiplos módulos.
- Toda escolha que vamos querer questionar/justificar no futuro
  ("por que essa abordagem em vez da óbvia?").
- Decisões pequenas, locais a uma entrega, podem ficar no `spec.md`
  da entrega sem virar ADR.

## Convenção de status

- **Proposed** — em discussão, ainda não vale.
- **Accepted** — em vigor, código segue.
- **Superseded by NNNN** — substituída; manter o arquivo, apontar
  para a nova.

ADRs **não são editados retroativamente**. Para revisar, crie um novo
ADR que supersede o antigo.

## Template

```markdown
# NNNN — <título>

## Status
Proposed | Accepted | Superseded by NNNN

## Contexto
O que está acontecendo, qual é o problema, quais forças atuam.

## Decisão
O que decidimos. Direto, em poucas linhas.

## Consequências
Bom e ruim. O que abrimos mão, o que ganhamos. Como medir.

## Alternativas consideradas
O que rejeitamos e por quê (não para flagelar — para ajudar quem
vier depois a entender o trade-off).
```

## Convivência com docstrings

Alguns docstrings deste projeto carregam decisões maduras (ex.: as 9
decisões do `TeamService`). Por hora ficam onde estão — não migramos
retroativamente. **Decisões novas a partir desta convenção vêm pra
cá.** Se uma decisão antiga precisar ser revisada ou citada em
escopo amplo, ela pode virar ADR no momento da revisão.
