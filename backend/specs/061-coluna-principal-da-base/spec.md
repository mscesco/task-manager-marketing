# Spec 061 — Trocar a coluna principal da Base

**Status:** aprovada por ela em 16/10/2026.

Pedido dela (16/10): na Base não dá para escolher qual coluna é a principal —
a que vira o título do card no calendário e no quadro. Hoje toda Base nasce com
uma coluna de título fixa (Spec 056, D2), que se renomeia mas não se troca.

## Decisões (16/10)

1. **Trocar a coluna principal da Base inteira**, e não um "título do card"
   por visão (a opção 2, recusada: mais uma configuração por visão, e a tabela
   continuaria com o título antigo).
2. **Só coluna de texto** vira a principal.

## O que entrega

- No menu de uma coluna de **texto**, para quem edita coluna
  (`base_column.update`): **"Usar como coluna principal"**.
- A coluna escolhida vira o título; o título de antes vira **texto**. As duas
  **trocam de lugar**, e o título continua na primeira posição (a tabela o
  prende na rolagem e no arrastar).
- **Nenhum valor muda:** título e texto guardam a mesma string.
- Sem confirmação: o **Ctrl+Z** troca de volta (diário: `column.title`). O
  desfazer recusa se a principal foi trocada de novo por outra pessoa (D12).
- Continua havendo **um título só por Base**: a troca trava as colunas da Base
  até o commit, e duas trocas ao mesmo tempo não deixam dois títulos.

## Servidor

`POST /api/v1/bases/{id}/columns/{column_id}/make-title` — verbo
`base_column.update`, o mesmo de editar coluna. Coluna que não é texto: 422.
Coluna que já é o título: 200, sem mudar nada. **Sem migration.**

## Fora

- Data, seleção ou número como título.
- Título do card escolhido por visão.
