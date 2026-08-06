# 0035 — Tarefa de quadro interno herda o time DO QUADRO; a visibilidade continua saindo da lente

## Status

Accepted — **refina a 0024** (subtarefa herda o time do pai) estendendo a mesma
lógica ao quadro, e **confirma sem alterar** a §"Quem configura e quem enxerga"
da 0030.

Fecha as decisões **D2 e D3** de 06/08/2026.

## Contexto

O quadro interno da Spec 036 pertence a um subtime. A pergunta que sobra é de
onde vem o `team_id` da tarefa criada lá dentro, e a resposta ingênua —
`default_team_id` de quem criou — abre um vazamento cuja forma é o oposto do
esperado.

**Quem pode criar quadro interno é exatamente quem dispara o vazamento.**
Pela 0030, criam quadro o supervisor do subtime, ADMIN e MANAGER. Pela
invariante da Spec 024, **ADMIN e MANAGER só existem no time RAIZ.** Então:

1. um ADMIN entra no quadro interno do SEO e cria uma tarefa;
2. o `default_team_id` dele é a raiz;
3. a tarefa nasce com `team_id` da raiz;
4. **tarefa da raiz todo mundo alcança** — a armadilha mais antiga do
   repositório.

Resultado: uma tarefa dentro do quadro "interno" do SEO, visível para o
workspace inteiro, criada por quem tinha autoridade justamente para fechá-lo.
Sem erro, sem tela, e o quadro continua parecendo interno.

## Decisão

**D2 — Tarefa criada em quadro interno herda `team_id` do TIME DO QUADRO**,
ignorando o `default_team_id` de quem criou. Vale para tarefa de topo e, por
tabela, para subtarefa — consistente com a 0024, que já faz a subtarefa herdar
o time do pai.

**D3 — A visibilidade sai de graça do `team_id`. Nenhum eixo novo, nenhuma
permissão por quadro.** `team_scope.visible_team_ids` já entrega exatamente o
que foi pedido:

- ADMIN vê tudo; MANAGER da raiz vê a raiz e todos os descendentes — portanto
  **vê os quadros internos**;
- SUPERVISOR/OPERATOR de X vê X e a raiz — portanto vê o quadro geral e os
  quadros do próprio subtime, e **não vê os de outro subtime**.

Isto não é decisão nova: é a §"Quem configura e quem enxerga" da 0030,
confirmada. O que é novo é que **ela só funciona depois da D2** — com
`team_id` da raiz, a lente devolve "todo mundo" e o eixo inteiro vira decorativo.

**Designar para fora do subtime fica PROIBIDO no quadro interno.** A trava mora
no SERVIÇO, com mensagem, não só no seletor. O seletor da Spec 034 já filtra
por alcance e passa a filtrar certo assim que a D2 valer — mas seletor é
conveniência, não trava: a API aceita o `user_id` que mandarem.

## Consequências

- ⚠️ **Os três furos conhecidos do "só o subtime vê" continuam abertos, POR
  DESENHO, e nenhum é fechado por este ADR:**
  1. **criador sempre vê** (ADR 0013) — um ADMIN que criou tarefa no quadro
     interno continua vendo aquela tarefa mesmo depois de sair da lente;
  2. **relações furam a lente** (ADR 0018) — vínculo entre uma tarefa interna e
     uma da raiz expõe título e status através da consulta de relações;
  3. **designação alcança quem foi designado** — e é por isso que designar para
     fora do subtime precisa da trava acima, e não de um aviso.

  Registrados aqui juntos porque cada sessão redescobre um deles e propõe
  fechá-lo com uma permissão nova. **A resposta é não**: fechar qualquer um dos
  três exige permissão por quadro, que colide com a lente inteira (0030).
- O quadro interno **não é confidencial contra a gestão**, e a tela não deve
  sugerir que seja. "Interno" aqui significa *"não polui o quadro de todo
  mundo"*, não *"secreto"*. O rótulo escolhido na D1 (ADR 0034) precisa
  sobreviver a essa leitura.
- A D2 é **regra de escrita**, e regra de escrita não protege o que já foi
  escrito. Se alguma tarefa nascer com o `team_id` errado antes da trava
  existir, ela não se conserta sozinha — vira `UPDATE`.

## Como medir

Depois da Spec 036, em produção:

```sql
-- nenhuma tarefa de quadro interno com o time ERRADO
SELECT count(*) FROM task t
JOIN board b ON b.id = t.board_id
WHERE b.is_default = false
  AND t.team_id IS DISTINCT FROM b.team_id;    -- 0

-- nenhuma designação para fora do time do quadro interno
SELECT count(*) FROM task_assignment a
JOIN task t ON t.id = a.task_id
JOIN board b ON b.id = t.board_id
WHERE b.is_default = false
  AND NOT EXISTS (
        SELECT 1 FROM user_team ut
         WHERE ut.user_id = a.user_id
           AND ut.team_id = b.team_id
      );                                        -- 0 (fora ADMIN/MANAGER da raiz)
```

A primeira é a que importa: ela é a prova de que a D2 está valendo em todos os
caminhos de escrita, e não só no que a spec lembrou de cobrir.

## Alternativas consideradas

- **Eixo de visibilidade próprio do quadro** (`board.visibility`, ou permissão
  por quadro). Rejeitada: duplica a lente, cria um segundo lugar onde "quem vê
  o quê" é decidido, e os dois divergem no primeiro caso de canto. A 0030 já
  tinha rejeitado pelo mesmo motivo.
- **Manter `default_team_id` e avisar na tela.** Rejeitada: aviso não é trava, e
  o caso que vaza é justamente o de quem tem autoridade e não lê avisos.
- **Proibir ADMIN/MANAGER de criar tarefa em quadro interno.** Rejeitada:
  resolve o vazamento tirando o uso legítimo — gestor entra no quadro do
  subtime justamente para colocar trabalho lá.
