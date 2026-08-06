# Spec 037 — Acesso deriva do time, e só do time

> **Status: decisões fechadas (ADR 0038, E1–E9). Escrita em 06/08/2026,
> nenhuma fatia implementada.** Esta spec implementa a ADR 0038: retira as três
> exceções à lente de time, remove o estado (responsável/observador) de quem
> perde alcance, e barra a mudança de vínculo que deixaria tarefa órfã.
>
> Destino: `backend/specs/037-acesso-deriva-do-time/spec.md`
>
> ⚠️ **Precede a continuação da Spec 036.** A 036 está na fatia 2 de 5 e
> pausada por decisão de 06/08: fazer a permissão certa antes de construir mais
> em cima dela. Ver §Fronteira de risco.

---

## Objetivo

Hoje três coisas furam a lente de time: o `created_by` (ADR 0013), o
`/me/assignments` (ADR 0018) e a marca `out_of_scope` (ADR 0017). O efeito
somado é que **sair de um subtime não tira acesso a nada** — só muda a cor de
um selo.

A ADR 0038 decidiu o contrário: a lente de time é a única fonte de
visibilidade, e perder a lente remove o estado, não só a visão. Esta spec é a
implementação disso.

**O que o usuário percebe no fim:** ao ser movida de subtime, a pessoa deixa de
ser responsável pelas tarefas daquele subtime e é avisada. Se ela for a única
responsável por alguma tarefa não-terminal, a movimentação **falha** e diz
exatamente quais são.

---

## O que o código faz hoje (medido no repo e em produção, 06/08)

| Fato | Onde |
|---|---|
| `created_by` concede leitura em **quatro** pontos | `task_guards.py:60`, `task_repository.py:117,126,130`, `project_service.py:215` |
| Três testes afirmam esse furo | `test_visibility_db.py:93`, `test_collaboration.py:100`, `test_comments_db.py:235` |
| `out_of_scope` aparece em **11** lugares nos testes, em 2 arquivos | `factories.py`, `test_me_assignments_db.py` |
| Os quatro gatilhos de vínculo moram no mesmo arquivo | `member_service.py:424, 485, 537, 623` |
| `TERMINAL_SEMANTICS = {DONE, CANCELLED}` já existe, puro e testado | `board_semantics.py:36` |
| `remove_assignee` já recusa remover o último responsável | `collaboration_service.py:219` |
| `team_id` explícito **não é validado** contra a lente — *"quem manda, manda"* | `task_service.py:277` |
| O front **já** implementa a ADR: sem seletor de time no modal; `/quadro/[teamId]` barra por `lens.visibleTeamIds` | `web/lib/api.ts:702`, `web/app/quadro/[teamId]/page.tsx` |
| A doc interativa da API já existe fora de produção | `main.py:63` (`/docs`, `/redoc`) |

### Os números de produção que dimensionam a spec

Tarefas vivas com **um responsável só**, por escopo e semântica:

| time | `OPEN` | `IN_PROGRESS` | `DONE` | `CANCELLED` |
|---|---|---|---|---|
| raiz | 120 | 47 | 165 | 1 |
| **subtime** | **26** | **7** | 17 | 1 |

**Só as 33 em negrito podem barrar uma movimentação.** As 333 da raiz não
contam: ninguém perde a raiz de vista (a lente de SUPERVISOR/OPERATOR é
`{próprio time} + {raiz}`).

Concentração: **beatriz.fontes** (Mídias Sociais) 18 · **gisele.reis** (SEO) 12
· gabriela.silva 1 · gabriel.cascadan 1 · pedro.mendonca 1.

⚠️ **Duas pessoas carregam 30 das 33**, e é isso que justifica a E8 (o erro
carrega a lista estruturada, não uma frase).

⚠️ **E o número foi medido no mundo errado, de propósito.** Hoje quase tudo
vive na raiz porque o quadro de subtime não existe. A Spec 036 existe para
mover trabalho para dentro dos subtimes — **33 é o piso, não o teto.**

---

## Decisões

Todas em `docs/adr/0038-acesso-deriva-do-time.md`, E1–E9. Resumo do que vira
código:

| | |
|---|---|
| **E1** | o ramo `created_by` sai da lente (4 pontos) |
| **E2** | `task.created_by` continua existindo e sendo exibido — é histórico |
| **E3** | perder alcance **remove** responsável e observador |
| **E4** | `move`/`remove`/`change_role` **barram** se deixariam órfã tarefa **não-terminal** |
| **E5** | `out_of_scope` é apagado (backend + front) |
| **E6** | não há exceção por relação |
| **E7** | quatro gatilhos; `deactivate_member` **não barra** |
| **E8** | o `422` devolve a lista estruturada de tarefas que barraram |
| **E9** | uma notificação por movimentação, nunca uma por tarefa |

---

## Critérios de aceitação

1. **Criador não enxerga mais.** Quem criou uma tarefa cujo time saiu da sua
   lente não a lista, não a abre e não comenta nela. Os três testes citados
   acima **invertem** (não somem).
2. **`created_by` continua na resposta.** A tarefa mostra "criada por fulano"
   mesmo depois de fulano perder a lente. A E1 não pode ser implementada
   apagando o campo.
3. **`team_id` explícito é validado.** `POST /tasks` com `team_id` fora da
   lente de quem cria devolve 422. Vale para todo cliente, não só para a tela.
4. **A movimentação barra, com lista.** Mover/remover/rebaixar alguém que é
   única responsável por tarefa **não-terminal** que perderia devolve 422 com
   `id`, `título`, `subtime` e coluna de cada uma.
5. **Coluna terminal não barra.** As mesmas tarefas em coluna `DONE` ou
   `CANCELLED` não impedem nada.
6. **A movimentação permitida remove o estado.** Depois de mover, a pessoa não
   é mais responsável nem observadora das tarefas que perdeu, **no banco**.
   ⚠️ Conferir o banco, não a resposta da API — o precedente é a sabotagem da
   cascata de 05/08, onde a contagem dizia `2` e o produto arquivava ao
   contrário.
7. **Uma notificação por movimentação**, com a contagem e o nome do subtime.
   Nunca uma por tarefa.
8. **Desligar não barra.** `deactivate_member` passa mesmo deixando órfã, e as
   tarefas ficam marcadas de forma que alguém as encontre.
9. **`out_of_scope` não existe mais.** Nem no schema, nem no front, nem nos
   testes. `grep` devolve zero em `app/` e em `web/`.
10. **A invariante volta zero.** A consulta da §Como medir da ADR 0038
    (`responsavel_sem_alcance`) devolve `0` depois do deploy e continua `0`.

---

## Fora de escopo

- **Reatribuição em lote.** Fatia posterior. A E8 existe para que ela consuma
  uma lista que já nasce pronta. Ver §Alternativas da ADR 0038.
- **Permissão por quadro.** Recusada pela 0030, pela 0035 e de novo pela 0038.
  O quadro interno **não é confidencial contra a gestão**.
- **Ligar `/docs` em produção.** É decisão de segurança separada, e hoje está
  desligado de propósito (`main.py:63`).
- **A regra "projeto só nasce em time raiz"**, levantada em 06/08. Não é o
  estado atual (`project_service.py:140` aceita qualquer time da árvore) e não
  é ADR de ninguém. **Spec própria**, e precisa de medição antes: quantos
  projetos existem em subtime e quantas tarefas moram neles.
- **A topologia de múltiplas raízes.** `team_unica_raiz_por_workspace`
  (migration `0004`) permite **uma** raiz por workspace. "Marketing,
  Desenvolvimento, Carreiras" como raízes seriam workspaces distintos, sem
  nada compartilhado. Assunto próprio.

---

## Fronteira de risco

⚠️ **Esta spec escreve no banco por efeito colateral de outra ação.** A E3
remove linhas de `task_assignment` quando alguém é movido. É a primeira vez que
uma mudança de vínculo apaga dado de tarefa. Errar aqui não dá 500 — dá tarefa
sem dono, silenciosa, num quadro que ninguém abre.

⚠️ **Regra de leitura não conserta dado escrito.** No dia do deploy da E1,
tarefas hoje alcançadas só pelo `created_by` somem da tela de alguém. Não é
defeito, é a decisão — mas precisa ser medido antes, não descoberto depois.

⚠️ **As 37 tarefas legadas sem responsável** (ADR 0031) são o único ponto em
que isto pode perder trabalho de verdade: se alguma for alcançada só pelo
criador, ela some e **não sobra relação nenhuma apontando para ela.** A F1 mede
essa interseção antes de qualquer código.

⚠️ **A 036 fica pausada na fatia 2, e as fatias 1 e 2 estão fora de produção.**
A `0012` e o `GET /boards` sobem juntos quando o congelamento acabar. Nada
nesta spec depende deles, e nada deles depende desta spec — mas o
descongelamento tem que levar os dois.
