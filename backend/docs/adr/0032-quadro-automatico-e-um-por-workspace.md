# 0032 — O quadro automático é UM por workspace; quadro de subtime é sob demanda

## Status

Accepted — **refina a 0030, não a supersede.** A decisão central da 0030 (um
conjunto de colunas, oito lentes) permanece em vigor.

## Contexto

A 0030 dizia duas coisas incompatíveis, e ninguém percebeu porque elas moram
em seções diferentes do mesmo arquivo:

- Na **§Decisão**: o quadro geral é *"do time raiz. **Um por workspace.**"*, e
  *"o quadro do subtime NÃO é um quadro"* — é o geral com a lente do subtime.
  Motivo escrito: senão existiriam oito cópias das mesmas colunas para manter
  sincronizadas, e elas divergiriam.
- Na **§Migração**, item 1: *"Criar `board` e `board_column`; **um quadro
  padrão por time existente**."*

Oito times no workspace. Pela §Decisão, a migração cria **um** quadro; pelo
item 1 da §Migração, cria **oito**. É quase certo que essa linha é a origem da
decisão registrada no fim da sessão de 05/08 — *"o quadro só nasce dentro do
time e dos subtimes"* — que a fatia 1 da Spec 035 deixou em aberto e que
travava o desenho da fatia 3.

A fatia 1 foi escrita seguindo a §Decisão: a `0008` cria **um** quadro, do time
raiz, e aponta todas as tarefas para ele.

### O que os dados de produção dizem (06/08/2026, 576 tarefas vivas)

| time | tarefas |
|---|---|
| **Marketing (raiz)** | **495** |
| SEO | 42 |
| Mídias Sociais | 28 |
| CRM e Automação | 4 |
| Audiovisual | 3 |
| Eventos | 2 |
| Design | 2 |
| Desenvolvimento | 0 |

**86% do trabalho está na raiz.** Os seis subtimes que aparecem somam 81
tarefas; Desenvolvimento não tem nenhuma.

## Decisão

**Criação automática de quadro acontece UMA vez, para o time raiz do
workspace. `TeamService.create` NÃO cria quadro.**

Isso confirma a §Decisão da 0030 e **cancela o item 1 da §Migração dela**, que
fica registrado aqui como erro de redação, não como decisão revertida.

A frase de 05/08 — *"o quadro só nasce dentro do time e dos subtimes"* — está
resolvida, e não inteiramente descartada: ela continua verdadeira para o
**quadro personalizado**, que a 0030 já prevê e que nasce por ação do
SUPERVISOR do subtime (`board.manage.subteam`). O que fica decidido é que
**subtime não ganha quadro sozinho, por existir.** Quadro de subtime é opt-in,
criado por gente, quando alguém quiser.

### Por que não o contrário

1. **Custo de manutenção desproporcional ao uso.** Criar quadro por subtime
   produziria seis conjuntos de colunas para sincronizar cobrindo 14% do
   trabalho, e um sétimo (Desenvolvimento) que nasceria vazio e ficaria vazio.
2. **As 495 da raiz ficariam sem resposta.** Tarefa da raiz todo mundo
   alcança. Com oito quadros, *"em qual quadro ela aparece"* deixa de ter
   resposta única, e a decisão B da 0030 (uma tarefa vive em UM quadro) obriga
   a escolher uma.
3. **O custo de reverter é assimétrico e já foi pago do lado barato.** Hoje as
   576 tarefas estão no quadro da raiz. Passar para quadro por subtime depois
   exige reatribuir `board_id` **e** `column_id` linha a linha — a FK composta
   `(column_id, board_id)` proíbe apontar para coluna de outro quadro. O
   caminho inverso (subtime cria quadro quando quiser) não custa migração
   nenhuma.

## Consequências

- A fatia 3 da Spec 035 encolhe: garantir quadro para o time **raiz** na
  criação do workspace. `TeamService.create` não é tocado.
- **Workspace criado depois da `0008` nasce sem quadro** — inclusive nos
  testes, que montam o mundo do zero. Continua sendo o que a fatia 3 fecha.
- O quadro personalizado de subtime segue previsto pela 0030 e **não tem
  código nesta spec**. Quando existir, herda tudo o que a 0030 já decidiu:
  pertence ao time, não à pessoa; visibilidade deriva da lente; sem teto de
  quantidade; arquivar em vez de apagar.
- ⚠️ **O gestor da raiz enxerga o quadro "interno" do subtime.** Consequência
  da 0030 que sobrevive intacta, e a que mais surpreende quando aparece.

## ⚠️ Drift de nomenclatura entre a 0030 e o que foi implementado

A 0030 nomeia os campos em português; a `0008` e os models foram escritos em
inglês, seguindo o resto do schema. **O código está certo; o ADR é que ficou
para trás.** Registrado aqui para ninguém "consertar" o código na direção do
ADR:

| 0030 | implementado (`0008`, `app/db/models/boards.py`) |
|---|---|
| `semantica` | `semantic` |
| `ABERTA` / `EM_ANDAMENTO` / `CONCLUIDA` / `CANCELADA` | `OPEN` / `IN_PROGRESS` / `DONE` / `CANCELLED` |
| `avisa_prazo` | `notify_deadline` |
| `is_destino` | `is_default_target` |
| `terminal_desde` | `terminal_since` |

Também: a 0030 fala em **sete** status e sete colunas migradas. São **oito** —
`EXTERNAL_APPROVAL` entrou pela Spec 026, depois que a 0030 foi escrita. A
`0008` migrou as oito.

## Como medir

Já medido em produção, em 06/08/2026, com a `0008` aplicada:

```sql
-- um quadro, do time raiz
SELECT count(*) FROM board;                          -- 1
SELECT count(*) FROM task WHERE board_id IS NULL;    -- 0

-- nenhuma tarefa apontando para coluna de outro quadro (a FK composta
-- promete; medir mesmo assim, porque constraint que ninguem testou e promessa)
SELECT count(*) FROM task t JOIN board_column c ON c.id = t.column_id
WHERE c.board_id <> t.board_id;                      -- 0
```

O sinal de que esta decisão envelheceu mal é um só, e é observável: **um
subtime pedir quadro próprio e o pedido não ser atendível.** Hoje é atendível
— a 0030 já prevê o quadro personalizado. Se o pedido virar recorrente e a
concentração na raiz cair de 86% para algo perto da metade, vale reabrir com
um ADR novo, não com uma exceção no serviço.
