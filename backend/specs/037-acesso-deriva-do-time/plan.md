# Spec 037 — plano de execução

> Seis fatias, **cinco deploys** (a F1 e a F2 sobem juntas). As cinco primeiras
> são backend; a sexta encosta no front. Ordem de deploy no fim do arquivo.
>
> ✅ **As medições da F1 estão RODADAS** (06/08, resultado na `spec.md`).
> Deram zero em tudo: sem fatia de resgate, sem passivo, sem ninguém barrado
> por rebaixamento, sem projeto fora da raiz.
>
> ⚠️ **Duas correções de fato entraram em 06/08 e mudam o que executar:** a
> enumeração dos pontos da **F5** estava errada de um jeito que vaza dado, e o
> escopo e o portão da **F6** estavam menores que a realidade. Ver as seções.

---

## Fatia 1 + 2 — sobem JUNTAS, num deploy só

⚠️ **Os rótulos F1 e F2 ficam**, porque o ADR 0038, a `spec.md` e os handoffs
citam os dois por nome. O que mudou é que **não há deploy separado entre
elas** — e o motivo está medido:

- as **cinco medições da F1 já rodaram** (06/08, resultado na `spec.md`), e
  **nenhuma decidiu nada**: 0, 0, nenhuma pessoa, nenhum projeto fora da raiz.
  O único motivo de isolar a F1 era "os números decidem o resto da spec";
- o que sobra da F1 é uma validação num caminho que **a tela não alcança**
  (`api.ts:702` fixa a raiz) e cujo passivo é **zero** (medição 2);
- a F2 é **leitura pura, não ligada a gatilho nenhum** — código morto até a F3.

Duas fatias sem comportamento observável, dois deploys, com o deploy congelado
e cada janela cara. Sobem juntas.

⚠️ **Isto NÃO contradiz "nunca emende F3 e F4".** Lá são duas mudanças de
comportamento que se confundem no diagnóstico. Aqui não há comportamento
nenhum para confundir: se algo quebrar, o único suspeito é a validação de
`team_id`, e o `git revert` dela não toca no predicado.

---

### Parte 1 — a validação de `team_id` (critério 3)

**O que sobe:** a validação do critério 3 (`team_id` explícito dentro da
lente), em `TaskService.create`.

⚠️ **Morda `command.team_id`, NÃO o `team_id` já resolvido.** A precedência em
`task_service.py:281` é *explícito → herdado do pai (ADR 0024) → default do
criador*. Enquanto a ADR 0013 estiver viva (ela só cai na F5), o pai pode
estar fora da lente de quem cria a subtarefa — validar o valor resolvido
quebra criação de subtarefa e a suíte não avisa, porque o arreio cria
subtarefa com o pai dentro da lente.

**Como testar:** teste HTTP em `POST /tasks` com `team_id` de subtime irmão,
como SUPERVISOR. Espera 422 com `details.field == "team_id"`.

⚠️ **Um teste de que a tela continua funcionando**: o mesmo POST com o
`team_id` da raiz e com o do próprio subtime tem de passar. A validação nova
não pode quebrar o caminho que `web/lib/api.ts:702` já usa (pin na raiz).

**Sabotagem:** apagar o bloco inteiro da validação (não afrouxar o `in`). Cai o
teste do subtime irmão com `DID NOT RAISE`.

---

### Parte 2 — o predicado, sozinho

**O que sobe:** uma função de domínio + a consulta que a alimenta. **Leitura
pura, nada de escrita, nada ligado a nenhum gatilho ainda.**

> `bloqueios_por_perda_de_alcance(user_id, times_depois) -> list[TarefaBloqueio]`
>
> "Dado o conjunto de times que a pessoa teria DEPOIS da mudança, de quais
> tarefas **não-terminais** ela é a **única** responsável e deixaria de
> alcançar?"

⚠️ **É o predicado único das E4/E7.** Escrito uma vez, chamado em três lugares
na F3. Se aparecer uma segunda cópia dele em qualquer fatia, é defeito.

⚠️ **Terminal vem de `board_semantics.TERMINAL_SEMANTICS`**, nunca de uma
lista de status escrita à mão. É o primeiro leitor de verdade de
`column.semantic`, que estava sem leitor desde a Spec 035.

**Como testar (o arreio já sabe montar dois quadros — `make_board` +
`make_task(board_id=)`):**

1. única responsável, tarefa `OPEN` em subtime que ela perde → **bloqueia**;
2. mesma tarefa em coluna `DONE` → **não bloqueia**;
3. dois responsáveis → **não bloqueia** (ela não é a única);
4. tarefa na **raiz** → **não bloqueia** (ninguém perde a raiz);
5. tarefa em subtime que ela **mantém** → não bloqueia;
6. tarefa arquivada ou soft-deletada → não bloqueia.

**Sabotagem:** trocar `TERMINAL_SEMANTICS` pelo conjunto vazio — reverte a
regra inteira da E4, não a mutila. Cai o teste 2, que passa a bloquear uma
tarefa `DONE`.

⚠️ **A fatia fundida entrega DUAS sabotagens, uma por parte.** Fundir o deploy
não funde o portão: se sair uma sabotagem só, a outra parte subiu sem
afirmação nenhuma.

---

## Fatia 3 — os três gatilhos que barram (E4 + E8)

**O que sobe:** `move_member_subteam`, `remove_member_from_team` e
`change_member_role` chamam o predicado e levantam 422 com a **lista
estruturada** (`id`, `título`, `subtime`, coluna) — não uma frase.

⚠️ **`deactivate_member` NÃO entra aqui**, e a ausência é decisão (E7). Ela é
a F5.

**Como testar:** um teste por gatilho, mais o do rebaixamento
(MANAGER → OPERATOR da raiz perde os oito subtimes de uma vez), mais um que
afirma que o corpo do 422 traz a lista com os campos, não só a contagem.

⚠️ **O teste da lista é o que impede a E8 de virar mensagem de texto na
primeira pressa.** Afirme os campos, não o tamanho.

**Sabotagem:** no `change_member_role`, remover a chamada ao predicado inteira.
Cai o teste do rebaixamento com `DID NOT RAISE`. ⚠️ Não basta trocar o `raise`
por outro — o bloco de chamada sai inteiro.

---

## Fatia 4 — a remoção e a notificação (E3 + E9)

**O que sobe:** a movimentação **permitida** remove a pessoa de
`task_assignment` e da lista de observadores das tarefas que ela perdeu, e
dispara **uma** notificação com a contagem e o nome do subtime.

⚠️ **É a primeira escrita em dado de tarefa disparada por mudança de vínculo.**
Errar aqui não dá 500 — dá tarefa sem dono, silenciosa.

**Como testar:**

1. mover alguém com 2 responsáveis numa tarefa → ela sai, a tarefa continua
   com 1, e **confere no banco** (não na resposta);
2. a contagem da notificação bate com o número de tarefas afetadas;
3. **uma** notificação, não N;
4. tarefa da raiz e tarefa do subtime que ela mantém: nada muda.

⚠️ **O critério 6 da spec exige conferir o BANCO.** Precedente literal: a
sabotagem da cascata de 05/08, em que `cascade_count` dizia `2` enquanto o
produto arquivava ao contrário. **Contagem certa com estado errado.**

**Sabotagem:** reverter a remoção (o bloco que deleta as linhas), mantendo a
notificação. Cai o teste 1 na conferência do banco — e **não** cai a contagem,
que é exatamente o que essa sabotagem prova.

---

## Fatia 5 — tirar o `created_by` da lente (E1 + E2), e o desligamento (E7)

**O que sobe:** o ramo `created_by` sai dos **dois** pontos. Os **três** testes
que afirmam o furo invertem. `deactivate_member` passa sempre, marcando as
tarefas órfãs de forma visível.

✅ **O número 1 da F1 deu ZERO.** Não há tarefa legada alcançada só pelo
criador, **não existe fatia de resgate**, e esta fatia não muda o que ninguém
vê em produção. Ela deixou de ser a fatia perigosa da spec — quem herda esse
título é a **F4**, que é a que escreve.

### ⚠️ Os pontos são DOIS, e a versão anterior deste arquivo estava errada

**`task_guards.py:60` e `task_repository.py:126`.** Só.

A versão anterior listava quatro, incluindo `task_repository.py:117` e `:130`
e `project_service.py:215`. **Esses três são o filtro de PESSOAL ALHEIO, não a
ADR 0013:**

| linha | o que é de verdade | apagar faz o quê |
|---|---|---|
| `task_repository.py:117` | bloco `(A)`, *"vale até pra admin"* | expõe projeto pessoal alheio na listagem de tarefas |
| `task_repository.py:130` | *"pessoal próprio: sempre visível"* | esconde o próprio pessoal de quem o criou |
| `project_service.py:215` | *"Privacidade: esconde pessoal alheio"* | ⚠️ **expõe o projeto pessoal de todo mundo no `GET /projects`** |

⚠️ **E o portão não pega.** Não existe teste de integração de listagem de
projeto — `ls tests/integration | grep -i proj` devolve só
`test_task_detach_project_db.py`. A versão errada desta fatia passaria em
`606 passed` e vazaria em produção.

**Antes de apagar qualquer linha nesta fatia, abra o bloco e leia o
comentário.** Se ele fala em *pessoal*, não é a E1.

**Como testar:** os três testes invertidos (o criador **não** vê), mais um que
afirma que `created_by` **continua na resposta** (critério 2 — a E1 não pode
ser implementada apagando o campo), mais um de desligamento que passa deixando
órfã.

⚠️ **Mais um teste que esta fatia deve deixar para trás:** `GET /projects` como
usuário B **não** traz o projeto pessoal de A. Ele não existe hoje, e é a rede
que faltava embaixo do erro descrito acima. Custa cinco linhas no arreio que já
existe.

**Sabotagem:** devolver o ramo `created_by` em **um** dos dois pontos (o do
`task_guards`). Deve cair o teste de visibilidade que inverteu, e **não** deve
cair o do repositório — se cair, os dois pontos não são independentes e vale
saber disso antes da F6.

---

## Fatia 6 — apagar o `out_of_scope` (E5)

**O que sobe:** o campo, a marca visual e o ramo da 0018 que omite a camada de
lente saem. `/me/assignments` volta a aplicar a lente como todo o resto.

⚠️ **É uma DELEÇÃO.** Se esta fatia acrescentar código, foi mal entendida.

### Onde ele está de verdade (contado em 06/08, não estimado)

| onde | ocorrências | arquivos |
|---|---|---|
| backend, código | 10 | `task_repository.py`, `api/schemas.py`, `me_router.py`, `me_service.py` |
| testes | 11 | `factories.py` (1), `test_me_assignments_db.py` (10) |
| **front, código** | **9** | `minhas-tarefas/page.tsx` (6), `lib/api.ts`, `lib/notificacoes.ts`, `tarefa/[id]/page.tsx` |
| specs e ADRs | 9 | registro histórico — **fica** |

⚠️ **Não é só `/minhas-tarefas`.** `lib/notificacoes.ts` e
`tarefa/[id]/page.tsx` não estavam na versão anterior deste arquivo. Três
arquivos de front a mais do que o plano previa.

**Como testar:**

```
grep -rn "out_of_scope" backend/app backend/tests web/app web/lib
```

devolve **zero**. Mais o portão do front inteiro (`tsc`, `npm test`,
`next build`) — é a única fatia da spec que o toca.

⚠️ **O portão NÃO é `grep` em `web/` inteiro.** `web/specs` e `web/docs`
guardam o nome em registro histórico e devem continuar guardando. Um portão
que nunca pode passar não afirma nada — mesma família do teste que não pode
falhar.

**Sabotagem:** não se aplica de forma útil a uma deleção. O portão aqui é o
`grep` a zero mais a suíte verde. ⚠️ **Diga isso na entrega em vez de inventar
uma sabotagem fraca** — sabotagem que não pode falhar não afirma nada.

---

## Ordem de deploy

1. **F1 + F2 juntas.** Nenhuma das duas muda comportamento observável: uma
   aperta um caminho que a tela não usa e cujo passivo é zero, a outra é código
   morto até a F3. **Duas sabotagens, uma por parte.**
2. **F3.** Primeira mudança que uma pessoa percebe (a movimentação passa a
   falhar). Sobe sozinha.
3. **F4.** Primeira escrita, e **a fatia perigosa desta spec** — com a E1
   medida como inofensiva, é o único ponto que pode estragar dado de produção.
   ⚠️ **Nunca junto da F3** — se a movimentação barrar errado e remover errado
   no mesmo deploy, não dá para saber qual dos dois é o defeito.
4. **F5.** ✅ Medida: não muda o que ninguém vê. Sobe quando der.
5. **F6.** Deleção, e a única com front.

⚠️ **A `0012` e o `GET /boards` da Spec 036 continuam fora de produção.** Nada
desta spec depende deles, mas o descongelamento tem que levar os dois, e
**migration antes do código** (ver `DEPLOY.md` §80).

## O que eu NÃO recomendo

- **Emendar F3 e F4.** Ver acima. ⚠️ A fusão da F1 com a F2 **não é
  precedente**: aquelas duas não têm comportamento observável; estas duas têm,
  e são o mesmo comportamento visto de dois ângulos.
- **Desfundir a F1 e a F2** porque "o plano original dizia deploys separados".
  O motivo de separar eram os números, e os números saíram. Reabrir só com
  motivo novo.
- **Começar pela F5** porque "é a que dá o resultado". Ela é a que mexe no que
  as pessoas veem, e sem a F4 a pessoa perde a visão e continua responsável
  nominal — o pior dos dois mundos.
- **Escrever a reatribuição em lote dentro desta spec.** Está fora de escopo
  por decisão. A E8 existe para que ela saia barata depois.
