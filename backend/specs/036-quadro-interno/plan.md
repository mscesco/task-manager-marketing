# Plano — Spec 036 (Quadro interno de subtime)

Cinco fatias. As três primeiras são backend e **nada muda na tela**; a quarta
é o front; a quinta é a feature.

⚠️ **Ordem de deploy no fim do arquivo.** A fatia 1 foi commitada JUNTO com o
código que lê `deleted_at` — a migration NÃO pode ficar para trás; a 4 e a 5
são as que mudam o que as pessoas veem.

⚠️ **Duas fatias por sessão, no máximo** — a sessão de 05/08 emendou três
"pequenas" e custou 58 testes vermelhos. A 2 e a 4 pedem sessão própria pelos
motivos escritos abaixo.

⚠️ **Cada fatia tem sabotagem própria, com string única, dizendo qual teste
deve cair** — e a sabotagem tem de **reverter a correção inteira**, não
mutilar. Mutilar um `WHERE` de forma que a consulta devolva duas linhas e o
`.first()` escolha uma pode passar verde por sorte.

---

## Fatia 1 — `board.deleted_at` (escrita em 06/08)

`0012_board_soft_delete.py`, sobre a head `0011_task_board_not_null`.

**Sobe:**
- `ALTER TABLE board ADD COLUMN deleted_at timestamp with time zone` + o
  `COMMENT`;
- `Board` ganha `SoftDeleteMixin` (`BoardColumn` **não** — E3 da spec);
- `default_board_and_column_for_status` ganha `AND b.deleted_at IS NULL`;
- a regra E2 escrita no cabeçalho do `board_repository`;
- `scripts/invariantes.sql` ganha a consulta 4.

⚠️ **Sem índice.** `board` tem uma linha em produção e poucas dezenas no pior
caso da 0034. Índice parcial aqui é custo de escrita sem ganho de leitura
mensurável — entra em migration própria quando a contagem justificar, com o
número na justificativa.

⚠️ **O texto do `COMMENT` é idêntico ao do `SoftDeleteMixin`, caractere a
caractere.** Drift de comentário é comparado por TEXTO: divergir deixa o
`autogenerate` propondo a diferença para sempre.

**Como testar:** `upgrade head`, `\d+ board` (a coluna e o comentário),
`downgrade -1`, `upgrade head` de novo, `autogenerate` vazio.

**Sabotagem:** apagar `AND b.deleted_at IS NULL` do SQL → cai
`test_quadro_apagado_nao_e_descoberto_como_quadro_geral` com `DID NOT RAISE`.

---

## Fatia 2 — `GET /api/v1/boards` (sessão própria)

Leitura só. Devolve os quadros que o usuário alcança, pela mesma lente
(`visible_team_ids`). Substitui o `/boards/current` que handoffs antigos
previam, porque agora passa a existir mais de um quadro.

**Sobe:**
- rota, schema de resposta (`id`, `name`, `team_id`, `is_default`, colunas);
- `BoardRepository` ganha a consulta de listagem, com
  `deleted_at IS NULL` **e** `workspace_id`.

⚠️ **É a primeira fatia do roteiro com superfície de API e permissão
envolvida** — o primeiro lugar onde um erro vira dado exposto. Não atacar logo
depois de uma rodada de correções.

**Testes que provam a fatia** (são o critério 4 da spec, e vêm antes do
código):
- supervisor do subtime A **não** vê o quadro interno do subtime B;
- ADMIN vê todos;
- quadro de outro workspace nunca aparece (tenant isolation);
- quadro apagado não aparece.

Os quatro precisam de dois quadros no mundo do teste — use `make_board` e
`make_task(board_id=)` do arreio, e **não** monte quadro à mão.

**Sabotagem:** trocar o filtro pela lente por "todos os quadros do workspace"
→ cai o teste do supervisor de outro subtime.

---

## Fatia 3 — Quadro e coluna na resposta de tarefa

A que faltava no roteiro até 06/08. Sem ela a fatia 4 não é construível: o
front recebe a lista de colunas e não sabe em qual colocar cada card.

**Sobe:**
- `board_id`, `column_id` e o nome do quadro em `TaskResponse`,
  `TaskListItem` e `TaskDetailResponse`;
- o selo de "de qual quadro veio" que a ADR 0034 (item 6) promete em
  `/minhas-tarefas`.

⚠️ **Mudança de contrato em três schemas.** O front atual ignora campo novo,
então ela sobe sem quebrar nada — mas é superfície de API, então vale o teste
de que não se expõe `board_id` de quadro fora do alcance de quem pergunta.

**Sabotagem:** devolver o `board_id` sem passar pela lente → cai o teste de
alcance.

---

## Fatia 4 — `Board.tsx` por colunas da API (sessão própria, front)

Uma via de render para geral, projeto, lente e interno.

⚠️ **ANTES DELA, teste de componente em `minhas-tarefas/page.tsx`** — não no
`TaskDetail`. É onde a mudança pesa (9 usos de `STATUSES`, 1195 linhas, zero
teste) e é o arquivo onde descobrir tarde custa mais caro.

**São 8 arquivos, não 6.** Os cinco que usam `STATUSES` quebram de verdade;
os outros três entram porque `@/lib/status` vai ser partido em "puro e
síncrono" e "vindo da API".

⚠️ `STATUSES` deixa de ser `const` síncrona: estado de carregando, de erro, e
um default antes de o dado chegar. O `<select>` do `TaskModal` inicializa em
`"BACKLOG"` cravado, linha 104.

**Carona:** os tokens de cor do status de **projeto** (`projetos/page.tsx` e
`projetos/[id]/page.tsx` têm hex cravado e duplicado, fora do sistema da Spec
031, e não invertem no tema escuro). Sozinho não paga o deploy.

**Sabotagem:** devolver a lista de colunas vazia da API → o quadro tem de
mostrar estado de erro, não um quadro sem colunas.

---

## Fatia 5 — O quadro interno (provavelmente duas sessões)

**Sobe:**
- migration: quadro não-padrão e coluna sem `legacy_status` já são suportados
  pelo schema — conferir antes de escrever migration por reflexo;
- `BoardService` ganha criar/renomear/apagar quadro e CRUD de coluna;
- permissão `board.manage.subteam`, com a trava de escopo no serviço (o mapa
  diz **o quê**, o serviço tem o `team_id` do alvo — precedente literal de
  `member.manage.subteam`, Spec 028);
- ADR 0035: `team_id` do TIME DO QUADRO, e designar para fora recusado no
  serviço;
- ADR 0036: derivação do status pela semântica, num lugar só, com teste
  comparando as duas regras;
- ADR 0034: apagar leva as tarefas, aviso com o número, **e a trava do E4**
  (quadro padrão não se apaga);
- rota e tela, com a troca de quadro **dentro da tela do time**.

**Sabotagem:** reverter a herança de `team_id` (voltar ao `default_team_id`)
→ cai o teste de ADMIN criando tarefa no quadro interno.

---

## Ordem de deploy

1. **Fatia 1 sozinha, e a migration vai ANTES do código — obrigatoriamente.**
   ⚠️ O texto anterior aqui dizia que ela *"pode ficar parada"*. Era verdade
   enquanto nada lia a coluna, e deixou de ser no MESMO commit: o
   `board_repository` roda `AND b.deleted_at IS NULL` em SQL cru, e `Board`
   tem `deleted_at` mapeado (o ORM emite lista explícita de colunas). Subir o
   `main` sem a `0012` quebra o `create` de tarefa de topo
   (`task_service.py:380`) e toda leitura ORM de quadro.
   ⚠️ **Enquanto a `0012` não estiver em produção, NÃO HÁ CAMINHO DE HOTFIX** —
   qualquer deploy, inclusive um de front, arrasta esse código junto. Medido
   em 06/08: produção tem UM quadro (`Quadro geral`, time raiz, 8 colunas,
   0 sem ponte, 696 tarefas).
2. **Fatia 2 sozinha.** É permissão. Depois dela, os critérios 4 e 5 da spec.
3. **Fatia 3** junto ou logo depois da 2 — reusa a mesma lente.
4. **Fatia 4** quando houver sessão limpa para o front.
5. **Fatia 5**, e só depois da 4 estar **no ar**. Criar quadro sem o front ler
   colunas não muda a tela de ninguém.

⚠️ **Não emendar 2 com 4.** Uma é API com permissão, a outra é front. Nada em
comum além do assunto.

⚠️ **Migration já em PRODUÇÃO deixa de ser editável.** Vale da `0008` à
`0012`.

⚠️ **CI verde antes de tocar na VPS** — e "verde" quer dizer que o job
`backend` chegou a executar o passo `pytest`. Um X vindo do `Set up job` é o
GitHub caindo, não o seu código, e na lista de runs os dois são
indistinguíveis.

---

## Conferência visual (obrigatória)

Nenhum portão cobre isto. Nas fatias 1 a 3, o teste é que **nada muda**:

1. O quadro geral continua com as oito colunas, nomes e ordem iguais.
2. Arrastar tarefa entre colunas continua funcionando e persiste.
3. Concluir um pai com subtarefas continua concluindo a checklist inteira.
4. `/minhas-tarefas` e `/arquivadas` continuam listando o mesmo.

Nas fatias 4 e 5:

5. O quadro de **lente** não mostra afordância de editar nem de apagar (ADR
   0034, item 2). Lixeira que não funciona é lixeira em que alguém clica.
6. Os dois objetos "quadro" têm nomes distinguíveis no seletor.
7. O aviso de apagar quadro **diz o número de tarefas**.

---

## O que esta entrega NÃO valida

- **Desempenho com workspace grande.** Herdado: 2 queries por membro, parede
  por volta de 150–200 contas. Nada aqui foi medido e nada tem índice
  dedicado.
- **Responsivo.** Um `@media` no produto todo.
- **E2E.** Não existe.
- **Que apagar quadro apaga as tarefas junto** — isso é a fatia 5. Os testes
  da fatia 1 provam só que a coluna existe e que a descoberta respeita o
  filtro.
- **`semantic` e `is_default_target` continuam sem leitor** até a fatia 5.
- **A migração contra o volume de produção.** `board` tem uma linha; se isso
  mudar antes da fatia 5, medir de novo.
