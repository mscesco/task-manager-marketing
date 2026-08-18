<!--
=====================================================================
Template de PR -- feito das regras de validacao que o projeto ja tinha.

Ele NAO substitui o `plan.md`: o escopo, o "por que" e as armadilhas
moram na spec. Aqui fica so o que precisa estar VERDE para mergear, e
o que nenhum portao cobre.

Apague as secoes que nao se aplicam. Template que nao se apaga vira
ritual, e ritual e o que se preenche sem ler.
=====================================================================
-->

## O que muda

<!-- Uma frase. Se precisar de mais de tres, o PR provavelmente tem duas
     fatias dentro. -->

**Spec / fatia:**
**Fecha a issue:** <!-- "Closes #N", ou "-" -->

## Arquivos

<!-- Caminho de tudo que nasceu, mudou ou morreu. Arquivo novo marcado
     como NOVO. -->

-

## Portões

<!-- ⚠️ NUMERO, e nao "passou". "Verde" sem numero nao diz se um teste
     sumiu em silencio -- ja custou sessao neste projeto. -->

| portão | esperado | resultado |
|---|---|---|
| `npx tsc --noEmit` (em `web/`) | limpo | |
| `npm test` (em `web/`) | 791 | |
| `npx next build` (em `web/`) | limpo | |
| `pytest` (backend, com `TEST_DATABASE_URL`) | 846 | |

<!-- ⚠️ Os numeros acima sao os de 18/08/2026. Se a sua fatia acrescenta
     teste, TROQUE o esperado e diga quantos entraram. Numero velho que
     ninguem atualiza e pior que numero nenhum. -->

- [ ] CI verde — e "verde" quer dizer que o job `backend` **chegou a executar o passo `pytest`**. X vindo do `Set up job` é o GitHub caindo, não o código, e na lista de runs os dois são indistinguíveis.

## Migration

- [ ] **Não tem migration** — pule esta seção.
- [ ] Tem, e o número é: `____`
  - [ ] O portão de drift do CI passou (`autogenerate` saiu vazio)
  - [ ] Ela **aborta com a lista** quando o dado de produção não serve, em vez de estourar no meio
  - [ ] Consultei o `invariantes.sql` (ou escrevi consulta nova) pra saber ANTES se o dado de produção passa

⚠️ **Migration já em produção deixa de ser editável.** Vale da `0008` em diante.

## O que nenhum portão cobre

<!-- ⚠️ ESTA E A SECAO QUE MAIS IMPORTA. A conferencia manual deste
     projeto achou defeito que a suite verde nao viu, mais de uma vez. -->

- [ ] **Arraste (`onDragEnd`)** — não roda em jsdom, não tem guardião e não vai ter. Se este PR toca em `DndContext`, `useDroppable`, `useSortable` ou id de arraste, **confira na tela** e diga aqui o que conferiu.
- [ ] **CSS / classes** — o `include` do vitest é só `lib/**` e `components/**`. Classe nova não tem teste.
- [ ] **Rota nova** — leva teste **HTTP**, e não só de serviço. Teste de serviço não sabe se a rota existe: verbo errado ou `response_model` trocado passam com a suíte verde e aparecem como **405 na tela**.
- [ ] **Backend mexido** → `docker compose up -d --build api-dev`. O `pytest` sobe container próprio; o `api-dev` que atende o navegador **não recarrega sozinho**.

**Conferi na tela:**
<!-- O que você abriu e o que viu. "Conferido" sozinho nao serve. -->

## Antes de mergear

- [ ] Rodei `git diff` e o diff é **só** o que este PR diz que é
- [ ] O `plan.md` da spec reflete o que foi entregue (fatia marcada, decisão nova escrita)
- [ ] Decisão de arquitetura nova → tem ADR, ou tem uma linha dizendo por que não precisa
- [ ] Não deixei campo/função **sem leitor nem chamador** — e se deixei, está escrito onde, com a data (a doença do `corEhHex`)
