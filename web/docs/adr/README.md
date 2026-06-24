# Architecture Decision Records (ADRs) — front

Mesma convenção do backend, aplicada ao repo `task-manager-web`. Decisões
de escopo amplo do front moram aqui, fora dos componentes. Cada decisão é
um arquivo numerado: `NNNN-titulo-curto.md`. A numeração é própria do
front (independente da do backend).

## Quando criar um ADR

- Escolha que afeta múltiplas telas/fluxos.
- Escolha que vamos querer questionar/justificar no futuro
  ("por que assim em vez do óbvio?").
- Decisões pequenas, locais a uma entrega, ficam no `spec.md` da entrega.

## Convenção de status

- **Proposed** — em discussão, ainda não vale.
- **Accepted** — em vigor, código segue.
- **Superseded by NNNN** — substituída; manter o arquivo, apontar pra nova.

ADRs **não são editados retroativamente**. Para revisar, crie um novo ADR
que supersede o antigo.

## Template

```markdown
# NNNN — <título>

## Status
Proposed | Accepted | Superseded by NNNN

## Contexto
O que está acontecendo, qual o problema, quais forças atuam.

## Decisão
O que decidimos. Direto.

## Consequências
Bom e ruim. O que abrimos mão, como medir.

## Alternativas consideradas
O que rejeitamos e por quê.
```

## Índice

- `0001-pin-time-raiz-criacao.md` — toda task criada no quadro nasce no
  time raiz (Marketing), não no subtime de quem cria.
- `0002-edicao-reusa-objeto-lista.md` — editar prefilla com o objeto da
  listagem; sem `GET /tasks/{id}` (contorna o bug E6).
