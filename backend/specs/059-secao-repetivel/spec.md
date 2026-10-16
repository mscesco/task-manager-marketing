# Spec 059 — Seção repetível no formulário

**Status:** decidida e entregue em 15/10/2026, para o lançamento de 16/10.
Pedido dela: a pessoa poder responder a mesma seção mais de uma vez no mesmo
envio (vários eventos, por exemplo). Decisões no mesmo dia:

1. **Cada repetição vira uma solicitação própria** no mesmo lote (mesmo
   protocolo), triada separadamente — como as seções diferentes já eram.
2. **Até 20 repetições por seção** num envio.
3. **Entra no lançamento** de 16/10.

## O que entrega

- **Editor do formulário** (Editar seção): a caixa "Pode ser preenchida mais
  de uma vez no mesmo envio (até 20)" e o nome de cada repetição ("evento").
  Vazio = o título da seção em minúsculas. O cabeçalho da seção mostra
  "repete até 20×".
- **Formulário público:** a seção repetível empilha uma caixa por repetição
  ("Evento 1", "Evento 2"…), com "+ Adicionar outro evento" e "Remover" (só
  com mais de uma). No limite, o botão vira o aviso "Limite de 20 por envio".
  - A validação é por repetição, e o erro diz qual: `… "Data" (evento 2)`.
  - A revisão lista cada repetição; "Enviar N solicitações" conta as
    repetições.
  - O rascunho local guarda as repetições (`repeticoes`, opcional: rascunho de
    antes continua valendo, com uma repetição por seção).
- **Fila de triagem:** quando o envio traz a mesma seção mais de uma vez, o
  título ganha o número na ordem do envio — "Organizar um evento #2" (também no
  texto copiado do pedido).

## Servidor

- Migration `0030_secao_repetivel`: `solicitation_section.repeatable` (bool,
  padrão `false`) e `repeat_label` (varchar 60, opcional). **Migration antes do
  código** — as colunas têm padrão e o código velho não as lê.
- `PATCH /solicitacoes/secoes/{id}` aceita `repeatable` e `repeat_label`
  (texto vazio limpa); as respostas do editor e o formulário público os
  devolvem.
- `POST /solicitacoes/publico`: a mesma categoria mais de uma vez **só** em
  seção repetível do formulário do envio, e no máximo 20 vezes
  (`MAX_REPETICOES_POR_SECAO`). Sem `form_id` (o caminho antigo) nada repete.
  O teto do envio inteiro passou de 11 (o tamanho do menu antigo) para 60.

## Fora

- Repetir **dentro** de uma pergunta (lista de datas num campo só): a
  repetição é da seção inteira.
- Teto configurável por seção: é 20 para todas.
