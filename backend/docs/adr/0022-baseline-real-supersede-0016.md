# 0022 — Baseline real na 0001 (colapso), aposentando o dump como fonte da verdade

## Status

Proposed — supersede a **0016**.

## Contexto

A 0016 decidiu versionar `schema_v5.sql` (gerado por `pg_dump`) como a base
reproduzível do schema, com a `0001` vazia e os deltas 0002→ aplicados por
cima. Ela mesma marcou como *non-goal* a evolução para um baseline DDL
completo — "maior esforço/risco; adiado conscientemente".

Esse adiamento cobrou juros. Na prática o dump virou *load-bearing*: nenhum
ambiente novo aplica 0002–0007 (o `db-test` carrega o dump e dá `stamp`), e
toda entrega que mexe no schema obriga regenerar o dump da produção e
ressincronizar `SCHEMA_BASE_REVISION`. O ritual consumiu ~15 mensagens na E7
e reaparece em toda migration. O `regen_schema.ps1` mitigou o esforço
manual, mas a dívida de fundo é o baseline vazio.

Condição habilitadora: o passo zero (dump fresco da prod × `schema_v5.sql`
do repo) deu **diff vazio**. Não há drift de DDL aplicado na mão. A
reconstrução do baseline é mecânica, não arqueológica.

## Decisão

**Reescrever a `0001` como baseline DDL completo (estado atual) e apagar
0002–0007 (colapso).** O schema passa a ser 100% auto-construível por
`alembic upgrade head` sobre um Postgres vazio. O `schema_v5.sql` é
rebaixado a referência congelada (oráculo do harness de validação) e some
quando a validação estiver estável. O `db-test` passa a se construir das
migrations, não do dump.

- DDL **inline** na migration (`op.execute`), não arquivo externo —
  autocontenção é o ponto.
- A 0001 cria também extensões, função e trigger de imutabilidade, que os
  models ORM não expressam.
- Produção (carimbada em `0007`) exige **um** `alembic stamp
  0001_baseline_v5 --purge`. É metadado: o DDL é idêntico ao que já roda.

## Consequências

**Ganhos:**
- Acaba a dependência do dump por entrega. `regen_schema.ps1` e o ritual da
  0016 se aposentam.
- Schema reprodutível em qualquer máquina por um comando, sem túnel, sem
  pg_dump no host, sem encoding/CRLF/nonce do PowerShell.
- Entregas futuras (a começar pelo SSO) nascem com migration limpa.
- Surge um guardião de regressão de schema permanente (harness do Portão 1).

**Custos / riscos:**
- A lineage da produção quebra até o re-stamp — daí o runbook obrigatório e
  a remoção do `upgrade head` automático do entrypoint.
- A 0001 fica longa e precisa ser fiel ao byte. Mitigado pelo Portão 1
  (diff banco-reconstruído × referência) rodando antes dos testes.
- Perde-se o histórico granular das migrations 0002–0007 como artefatos
  executáveis. Aceito: eles já não rodavam em lugar nenhum; o histórico
  conceitual vive nas specs e ADRs.

## Alternativas consideradas

- **Preservar a história** (0001 = estado pré-0002; manter 0002–0007). Não
  toca a lineage da produção, mas exige reconstruir o schema *antigo* — que
  não existe mais, já que `schema_v5.sql` é o estado atual. Mais trabalho
  por benefício quase nulo no nosso caso. Rejeitada.
- **Manter a 0016** (status quo). Rejeitada: é a fonte do atrito recorrente
  que esta decisão existe para matar.
- **DDL em `.sql` externo lido pela migration.** Mais legível, mas
  reintroduz dependência de arquivo no caminho de migration — exatamente o
  acoplamento que estamos removendo. Rejeitada.
