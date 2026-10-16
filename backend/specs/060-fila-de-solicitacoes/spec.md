# Spec 060 — Fila de Solicitações como caixa de entrada

**Status:** proposta e aprovada por ela em 15/10/2026, testada na tela numa
branch separada (fora do lançamento de 16/10) e aprovada para subir em 16/10,
num deploy próprio, depois do lançamento.

Pedido dela (15/10): a aba Solicitações era pouco intuitiva — para decidir um
pedido era preciso abrir o card, achar a seção e voltar, e aprovar e criar a
tarefa eram dois momentos (o segundo se esquecia). Depois, com uma referência
de caixa de entrada: "mais bonito, mais dinâmico".

## Decisões (15/10)

1. **Abas por situação, com número em todas:** Pendentes, Em andamento
   (aprovada OU em andamento), Concluídas, Rejeitadas e Todas. "Só sem tarefa"
   é um filtro à parte, que soma com qualquer aba.
2. **Busca** por nome, e-mail ou protocolo, e **filtro por formulário**.
3. **Decidir na própria lista:** o ✓ de um envio com uma demanda pendente **só
   aprova** (decisão dela, depois de ver na tela). A tarefa se cria no painel.
4. **"Aprovar e criar tarefa"** é a ação principal do painel; as outras ficam
   no menu da seta.
5. **Duas colunas:** lista à esquerda, o envio escolhido à direita (no celular,
   um de cada vez, com "Voltar").

## O que entrega

- **Lista:** cada envio com avatar, hora (fuso de Brasília), ponto de cor da
  situação e ponto de "tem pendente". O envio escolhido fica destacado.
- **Painel:** propriedades do envio (formulário, protocolo copiável, e-mail…),
  as demandas em abas, as respostas em tabela rótulo/valor, e os formulários
  de rejeitar e de marcar tarefa abrindo no lugar. O menu da seta abre por cima
  de tudo (e para cima no pé da tela) e fecha com Esc.
- **Movimento:** só `transform` e `opacity`; tudo respeita "reduzir movimento".

## Servidor

`GET /api/v1/solicitacoes` ganha `q` (busca), `form_id` e `without_task`, e o
filtro `ACTIVE`. A resposta traz `tab_totals` (o número de cada aba, em
demandas, com a mesma busca e o mesmo formulário da lista) e `form_options`
(os formulários que têm pedido nesta fila). O recorte por time (Spec 051) é o
mesmo da lista. **Sem migration.**

## Fora

- Paginação no servidor por aba com rolagem infinita (a lista continua paginada
  por envio).
- Atalhos de teclado de caixa de entrada (j/k, e, r).
