# Plano — Spec 036 (Quadro interno de subtime)

Cinco fatias. As três primeiras são backend e **nada muda na tela**; a quarta
é o front; a quinta é a feature.

> **Estado em 10/08/2026 — fatias 1, 2 e 3 ESCRITAS E TESTADAS.** As 1 e 2
> estão em produção; a 3 está commitada e ainda não subiu.
> Backend: **642 testes**.
>
> ⚠️ **A fatia 4 são TRÊS sessões, não uma** (`sondagem-fatia-4.md`, §6), e a
> sondagem sugere renumerar em 4a/4b/4c. **Este arquivo continua numerando de
> 1 a 5** — quem for executar a 4 lê a sondagem antes e trata a numeração dela
> como detalhamento, não como concorrente. As duas numerações não coincidem
> com o roteiro antigo (F1a/F1b/F2/F3), que está morto.

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

✅ **ESCRITA E TESTADA EM 10/08/2026.** O que este bloco descrevia **não é o
que foi entregue** — leia a §Correção abaixo antes de qualquer coisa.

A que faltava no roteiro até 06/08. Sem ela a fatia 4 não é construível: o
front recebe a lista de colunas e não sabe em qual colocar cada card.

**Subiu:**
- `board_id` e `column_id` em `TaskResponse` (`api/schemas.py`). Duas linhas.
  `TaskListItem`, `TaskDetailResponse`, `TaskDuplicateResponse` e `MyTaskItem`
  herdam e ganham os campos sem uma linha a mais;
- `tests/integration/test_task_board_no_contrato_db.py` — 4 testes;
- `scripts/invariantes.sql` ganha a consulta 7.

Sem migration, sem `JOIN` novo, sem mudança de repositório: os dois campos já
vinham no objeto ORM (`NOT NULL` desde a `0011`) e os routers montam tudo com
`model_validate(task)`.

### ⚠️ Correção de 10/08 — DUAS coisas que este plano pedia e que NÃO entraram

**1. O nome do quadro NÃO entrou, e não é esquecimento.** O plano pedia
*"`board_id`, `column_id` e o nome do quadro"* mais *"o selo de de qual quadro
veio"* da ADR 0034 (item 6). Com o `GET /boards` da fatia 2 em produção, o
front resolve `board_id` → nome no cliente, com o catálogo que ele já busca
para desenhar as colunas. Cravar o nome na task criaria um campo que
desatualiza no dia em que a fatia 5 permitir renomear quadro. **O selo sai de
graça; o campo custaria manutenção.**

**2. `semantic` e `notify_deadline` NÃO entraram, e a §4 da
`sondagem-fatia-4.md` está SUPERADA nesse ponto.** A sondagem (06/08) concluiu
que a fatia 3 estava subespecificada por faltar os dois. **A fatia 2 resolveu
isso depois de a sondagem ser escrita:** `BoardColumnResponse` já os carrega, e
o docstring dela diz explicitamente que os pôs ali por causa dessa sondagem.
O front cruza por `column_id`. Repeti-los na task criaria uma segunda fonte de
verdade para o mesmo dado, e a fatia 5 teria de invalidar as duas.

**3. O teste de alcance que este plano pedia NÃO PODE FALHAR, e por isso não
foi escrito.** O plano pedia *"o teste de que não se expõe `board_id` de
quadro fora do alcance de quem pergunta"*. Esse cenário não é alcançável:
`BoardRepository.default_board_and_column_for_status` resolve o quadro de toda
tarefa nova com `JOIN team ... AND t.parent_team_id IS NULL` (ADR 0032), então
`board.team_id` é **sempre a raiz** — que todo mundo alcança. Quem enxerga a
tarefa enxerga o quadro.

O que substitui esse teste são dois que afirmam **por que** não há vazamento, e
portanto podem falhar quando o porquê deixar de valer:
- `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` — passa pelo `TaskService`
  e lê `board.team_id` do banco;
- `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` —
  cruza `GET /tasks/{id}` com `GET /boards`. É o único teste do repositório que
  liga as duas superfícies.

Mais a **consulta 7** do `invariantes.sql`, que prende a mesma afirmação no
DADO — o teste passaria mesmo que alguém gravasse `board_id` à mão no banco.

⚠️ **A consulta 7 mediu `0` em produção em 10/08, e esse zero é AUSÊNCIA DE
CASO.** Há um quadro só, e ele é da raiz. Ela só vira afirmação quando a
consulta 5 mostrar um quadro de subtime. O aviso está no próprio arquivo.

**Sabotagem — MEDIDA em 10/08, não prevista:** apagar as **duas** linhas
`board_id: uuid.UUID` e `column_id: uuid.UUID` do `TaskResponse` derruba
**três** testes, todos com `KeyError: 'board_id'`: detalhe, listagem **e** o
cruzado. Sobra verde só o `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`,
que lê o banco e nunca toca a resposta HTTP.

⚠️ **A previsão escrita antes de rodar dizia DOIS, e estava errada** — o teste
cruzado lê o `board_id` da resposta da task antes de comparar com o `/boards`.
Mesmo viés (para menos) já registrado no handoff de 10/08, §1(f).

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

### ⚠️ O PORTÃO DO VAZAMENTO DE QUADRO MORA AQUI (acrescentado em 10/08)

A fatia 3 passou a devolver `board_id` na resposta de tarefa. Ele só é seguro
de devolver porque `board.team_id` é **sempre a raiz** hoje, e a raiz todo
mundo alcança. **Esta fatia é a que quebra essa premissa por desenho.**

No dia em que uma tarefa nascer no quadro do próprio subtime, três coisas
ficam vermelhas ou deixam de valer, e **as três são o alarme, não o defeito**:

1. `test_tarefa_de_subtime_nasce_no_quadro_da_raiz` falha
   (`tests/integration/test_task_board_no_contrato_db.py`). **Não apague este
   teste para a fatia passar** — reescreva-o junto com a decisão nova;
2. `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta` passa
   a ser o teste que importa: ele afirma que todo `board_id` devolvido está no
   `GET /boards` de quem perguntou. Se ele ficar vermelho, **há vazamento**;
3. a **consulta 7** do `invariantes.sql` deixa de ser `0`, e aí ela sai de
   "ausência de caso" e vira medição de verdade.

⚠️ **Não existe trava de schema, constraint ou gate de rota protegendo isso.**
O `board_id` sai na resposta sem passar por lente nenhuma — não precisava
passar. A decisão de qual quadro uma tarefa nova recebe é de
`BoardRepository.default_board_and_column_for_status`, e é lá que a pergunta
"quem alcança a tarefa alcança o quadro?" precisa ser respondida de novo, em
vez de continuar valendo por acidente.

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
   ✅ **Em produção.**
3. **Fatia 3** junto ou logo depois da 2 — reusa a mesma lente.
   ✅ **Commitada em 10/08, ainda NÃO em produção.** Sobe sozinha ou de carona
   no próximo deploy: o front atual ignora campo novo, então ela não muda tela
   nenhuma e não tem ordem obrigatória em relação à migration.
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
- ⚠️ **`semantic` JÁ TEM LEITOR desde a Spec 037** — a correção é de 10/08.
  `TaskRepository.bloqueios_por_perda_de_alcance` deriva o que é terminal de
  `TERMINAL_SEMANTICS`, e não de uma lista de status escrita à mão. Ele também
  viaja no `GET /boards` desde a fatia 2. **`is_default_target` continua sem
  leitor** até a fatia 5, e esse é o campo a citar quando o assunto voltar.
- **A migração contra o volume de produção.** `board` tem uma linha; se isso
  mudar antes da fatia 5, medir de novo.
