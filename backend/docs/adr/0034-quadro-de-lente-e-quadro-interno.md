# 0034 — "Quadro" nomeia dois objetos diferentes, e só um deles se apaga

## Status

Accepted — **refina a 0030 e REVERTE uma linha dela** (§"Sem teto de quadros",
*"arquivar, nunca apagar"*). Ver §Decisão, item 4. Refina também a 0032, que já
previa o quadro de subtime como opt-in.

Fecha as decisões **D1, D6, D7, D8, D9 e D10** de 06/08/2026, tomadas com a
Camila e registradas até aqui apenas em documento solto.

## Contexto

A Spec 036 vai criar o quadro do subtime que a 0030 prometeu e a 0032 deixou
explicitamente para depois. Ao desenhá-la, apareceu um problema que não é de
schema nem de permissão: **a palavra "quadro" já nomeia duas coisas
incompatíveis no produto, e as duas vão aparecer na mesma tela.**

- `/quadro/[teamId]` existe hoje. É o quadro geral filtrado pela lente do
  time — a "oitava lente" da 0030. **Não tem linha em `board`.** Não se cria,
  não se edita, não se apaga, porque não é um registro: é um `WHERE`.
- O quadro interno da Spec 036 é linha de verdade em `board`, com colunas
  próprias e tarefas próprias (decisão B da 0030).

Os dois vão conviver no mesmo seletor, com a mesma palavra. E o segundo tem
lixeira; o primeiro não pode ter.

A 0030 tratou disso de passagem porque, quando foi escrita, o quadro de lente
ainda não tinha tela. Hoje tem.

## Decisão

**1. Nomes diferentes na tela, decididos ANTES da spec.** Não é acabamento: um
seletor que lista "Quadro do SEO" (lente) ao lado de "Quadro do SEO" (interno)
é ambíguo no primeiro dia. A descrição fixa do quadro de lente é *"espelho do
quadro geral"*.

**2. O quadro de lente NÃO mostra afordância de editar nem de apagar.** Não
desabilitada — ausente. ⚠️ Lixeira que não funciona é lixeira em que alguém
clica, e o produto passa a ter de explicar por que não funcionou.

**3. Tarefa não se move entre quadros. Nasce dentro, morre dentro.** Reafirma
a decisão B da 0030 e fecha a porta que a Spec 036 abriria sozinha: mover para
dentro faz a tarefa sumir do quadro geral para todo mundo; mover para fora
expõe trabalho interno. Se precisar existir, é fatia própria, com aviso na
tela dizendo quem deixa de ver.

**4. ⚠️ Apagar quadro interno APAGA as tarefas junto** (soft delete, ADR 0005).
O aviso **diz o número**: *"isto vai apagar o quadro e as 23 tarefas dentro
dele"*. Quem pode: supervisor do subtime, ADMIN, MANAGER.

**Isto REVERTE a linha da 0030** que dizia *"arquivar, nunca apagar (...)
apagar quadro com tarefa dentro segue a mesma regra da coluna — ou é
bloqueado, ou exige destino"*. A regra da coluna não transporta para o quadro:
mover tarefa para outra COLUNA é organização dentro do mesmo quadro; mover
tarefa para outro QUADRO é justamente o que o item 3 acabou de proibir. Um
"exige destino" para quadro só teria uma saída — o quadro geral — e essa saída
publica trabalho interno para o workspace inteiro, em massa, como efeito
colateral de uma faxina.

`task.board_id` é `NOT NULL` com FK (`0011`): tarefa não fica sem quadro. As
três opções eram bloquear, mover para o geral, ou levar junto. A terceira é a
única que não mente sobre o que aconteceu.

⚠️ **`board` NÃO tem `deleted_at` hoje** — verificado em 06/08: `Board` e
`BoardColumn` usam só `UUIDPrimaryKeyMixin` e `TimestampMixin`; quem tem
`SoftDeleteMixin` é `Task`, `Project` e `Comment`. Ou seja, este item **exige
migration**, e ela não estava contada em lugar nenhum. Ver §Consequências.

**5. Vários quadros internos por subtime.** O schema já comporta — o índice
parcial `board_um_padrao_por_time` protege só o "um PADRÃO por time", e o
quadro interno é não-padrão. A troca de quadro acontece **dentro da tela do
time**, não no menu lateral: o `AppShell` monta as sub-abas pela lente, e um
menu de dois níveis sujaria a navegação de todo mundo por uma feature que
cobre 14% das tarefas (ADR 0032, §dados).

⚠️ Schema e API nascem com N quadros. A **tela** pode entregar "criar um
quadro" primeiro e o seletor depois, sem retrabalho.

**6. `/minhas-tarefas` continua uma tela só**, agrupada por status, com todas
as tarefas da pessoa independentemente de quadro, e **um selo dizendo de qual
quadro cada uma veio**. Não ganha seletor de quadro: a tela responde *"o que eu
tenho pra fazer"*, e essa pergunta não é por quadro. Confirma o que a 0030 já
dizia (*"quem atravessa quadros é Minhas tarefas"*).

**7. Sem `board.description`.** O nome e a ausência de lixeira já distinguem
lente de quadro interno (itens 1 e 2). O quadro tem `name` e só.

⚠️ **O motivo do corte NÃO é risco de migration**, e isso fica registrado para
a decisão futura não ser tomada com o modelo errado: coluna nullable nova é
barata; o custo dela é **ordem de deploy** (migration ANTES do código, senão
todo `SELECT` de quadro pede coluna inexistente e o app cai), e isso já está no
`DEPLOY.md`. O que compromete banco é `SET NOT NULL`, backfill e mudança de
tipo.

## Consequências

- ⚠️ **Não existe tela de restauração de quadro apagado.** Apagou errado, o
  conserto é `UPDATE` no banco, na mão, por quem tem acesso à VPS. É o preço do
  item 4 e está aceito em voz alta. Se virar incidente, a alternativa
  reversível é **só permitir apagar quadro vazio** — decisão que continua
  aberta até a fatia ser escrita, porque não custa migration nenhuma nos dois
  sentidos.
- O item 6 **cria uma dependência de API que ninguém tinha orçado**: o selo
  exige que a tarefa carregue o quadro na resposta, e hoje `board_id`,
  `column_id` e nome de quadro **não aparecem em nenhum schema** de
  `app/modules/tasks/api/schemas.py`. Isso é fatia própria, entre a `GET
  /boards` e a parametrização do `Board.tsx`.
- ⚠️ **O item 4 custa uma migration que ninguém tinha orçado.** `board` (e
  `board_column`) precisam de `deleted_at`, e **toda consulta de quadro passa a
  precisar do filtro `deleted_at IS NULL`**. O `BaseRepository` aplica o filtro
  sozinho para quem herda `SoftDeleteMixin`, mas o `BoardRepository` usa SQL
  textual nos dois métodos — lá o filtro é manual, e esquecê-lo devolve quadro
  apagado como se estivesse vivo.

  Isso **respinga na F3**: `GET /api/v1/boards` nasce antes da F5, e se nascer
  sem o filtro, ele lista quadro apagado a partir do dia em que apagar existir —
  um defeito plantado numa fatia e colhido em outra. Coluna nullable nova é
  barata (ver item 7); o custo é ordem de deploy, e ela deve vir **junto ou
  antes** da F3, não junto da F5.
- O item 4 aumenta o valor do log de auditoria do soft-delete: apagar quadro
  passa a ser a operação de maior alcance do produto por clique.
- O item 3 mantém válida a consequência mais surpreendente da 0030, que
  continua em vigor e **não** é revertida aqui: **o gestor da raiz enxerga o
  quadro "interno" do subtime.** Confidencialidade neste produto é entre times,
  não contra a própria gestão.

## Como medir

Depois da Spec 036, em produção:

```sql
-- quadros existentes, e quantos são não-padrão (os internos)
SELECT is_default, count(*) FROM board GROUP BY is_default;
```

E, **depois de a migration de `deleted_at` existir** (ver §Consequências —
hoje esta consulta não roda, porque a coluna não existe):

```sql
-- nenhuma tarefa viva dentro de um quadro apagado
SELECT count(*) FROM task t
JOIN board b ON b.id = t.board_id
WHERE b.deleted_at IS NOT NULL AND t.deleted_at IS NULL;   -- 0
```

O sinal de que o item 4 envelheceu mal é observável e barato de contar:
**pedido de restauração de quadro.** Um é acidente; o terceiro é a fatia de
lixeira de quadro.

## Alternativas consideradas

- **Criar linha em `board` para o quadro de lente**, para os dois objetos serem
  o mesmo tipo. Rejeitada: reabre a ADR 0032 inteira (um quadro por workspace),
  multiplica conjuntos de colunas a sincronizar por seis subtimes, e volta a
  não ter resposta para "em qual quadro aparecem as 495 tarefas da raiz".
- **Bloquear a exclusão de quadro com tarefa dentro.** Rejeitada: transforma
  quadro abandonado em quadro imortal, que é o problema que a 0030 queria
  resolver.
- **Exigir destino ao apagar** (a regra da coluna). Rejeitada pelo item 4: o
  único destino possível é o quadro geral, e isso publica trabalho interno em
  massa.
- **Menu lateral de dois níveis** para trocar de quadro. Rejeitada: custo de
  navegação para 100% dos usuários por uma feature de 14% das tarefas.
