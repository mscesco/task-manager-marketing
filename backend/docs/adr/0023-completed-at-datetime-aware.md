# 0023 — `completed_at` usa `datetime` aware, não `func.now()`

## Status

Accepted

## Contexto

`task.completed_at` era setado com `func.now()` ao entrar em `COMPLETED`
(no `create` e no `update` do `TaskService`). `func.now()` é uma expressão
SQL: ela é avaliada **no banco**, e o objeto Python só recebe o valor
resolvido se houver uma leitura posterior contra a sessão.

O router devolve a task serializando-a logo após o `flush`
(`TaskResponse.model_validate(task)`). Nesse instante o Pydantic acessa
`.completed_at`, que ainda é a expressão não resolvida; o SQLAlchemy async
tenta materializá-la fora do contexto greenlet e levanta
`MissingGreenlet`, virando **500**. Afeta PATCH para/de `COMPLETED` e
`create` já-`COMPLETED` (e, no front, o drag pra coluna Concluído).

O bug sobreviveu porque a lógica era coberta só por teste **puro** (stub,
sem banco async); a serialização async nunca tinha teste de integração.

Nota: o projeto **já tinha** defesa contra essa classe de erro —
`app/db/base.py` carrega `__mapper_args__ = {"eager_defaults": True}` com
um comentário citando exatamente o `MissingGreenlet` ao serializar a
resposta de um PATCH. Essa defesa cobre *defaults do mapper*; o
`completed_at` escapou porque era uma **atribuição manual** de expressão
SQL (`func.now()`), fora do alcance do `eager_defaults`. Ou seja: não foi
desconhecimento do problema, foi um caminho que furou a proteção existente.

## Decisão

**Usar `datetime.now(timezone.utc)`** para setar `completed_at`, em vez de
`func.now()`.

É um valor **já materializado** em Python: o Pydantic lê direto, sem
nenhuma ida ao banco na serialização. É *aware* e em UTC, casando com o
tipo `timestamp with time zone` do schema. A regra de quando setar/limpar
o campo **não muda** — só a forma de obter o instante.

O import `from sqlalchemy import func` é removido se não houver outro uso
no arquivo.

## Consequências

**Positivas:** elimina o `MissingGreenlet` na raiz; serialização não
depende mais de leitura tardia; sem round-trip extra ao banco; código mais
simples e previsível. Coberto por teste de integração que bate o endpoint
real (`test_completed_at_db.py`), o único caminho onde o erro aparecia.

**Negativas:** o timestamp passa a vir do relógio do **app**, não do
`now()` do **banco**. Para um campo de auditoria de conclusão, a diferença
(milissegundos, e ambos confiáveis via NTP) é irrelevante. Se algum
requisito futuro exigir o tempo do banco como fonte única de verdade, ver
a alternativa rejeitada abaixo.

**Como medir:** concluir/desconcluir via API devolve 200 com `completed_at`
coerente; nenhum 500 com `MissingGreenlet` nos logs.

## Alternativas consideradas

- **Manter `func.now()` + `await session.refresh(task, ["completed_at"])`**
  após o flush. Resolve o erro relendo o valor do banco, mas adiciona um
  round-trip por mutação e acopla a serialização a um passo extra fácil de
  esquecer no próximo endpoint. Rejeitada por custo/benefício; o ganho
  (timestamp do banco) não justifica para auditoria.
- **Manter `func.now()` e serializar via `model_dump` adiado / segunda
  query.** Mais complexo, mesmo problema de acoplamento. Rejeitada.
