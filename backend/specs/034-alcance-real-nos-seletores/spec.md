# Spec 034 — Alcance real nos seletores de responsável e menção

> **Status: pronta para execução. Todas as decisões fechadas em 03/08.**
> D1 = parâmetro em `GET /members`. D2 = regra aplicada uma vez. D3 = **só
> alcance**, sem `can_assign` (ver o motivo — mudou depois da medição de
> projeto pessoal). D4 = unificar as duas cópias. D5 = (a), o front reintroduz.
>
> Fecha a pendência aberta em 31/07 e registrada em `lib/escopoTarefa.ts`:
> *"gestor/admin some do seletor de tarefa interna de subtime… o conserto
> certo é no backend — um parâmetro em `GET /members` que reuse
> `_assert_target_reaches_task`."*
>
> Destino: `backend/specs/034-alcance-real-nos-seletores/spec.md`

## Objetivo

Em tarefa **interna de subtime**, os seletores de responsável e de `@` mostram
hoje apenas quem está naquele subtime. A regra do backend é mais larga: quem
tem papel **MANAGER** ou **ADMIN** num time acima também alcança a tarefa e
pode ser designado.

Resultado prático: gestor e admin somem das listas em tarefa interna. Quem
precisa designar o gestor não consegue pela tela, embora a API aceite.

A causa não é a regra — é **de onde o front tira a informação**. Ele recebe
`team_id` e nunca recebe papel, então reconstrói uma aproximação da regra do
backend com metade dos dados.

---

## O que o código faz hoje (medido no repo, 03/08)

| Fato | Onde |
|---|---|
| `GET /members` devolve `id`, `name`, `email`, `is_active`, `created_at`, `team_id` — **sem papel** | `users/api/schemas.py:16-31` |
| `team_id` é o **subtime** do membro, no máximo um (ADR 0008) | idem, comentário |
| O front reconstrói a regra em `foraDoEscopo(subtimePorMembro, taskTeamId, rootTeamId)` | `web/lib/escopoTarefa.ts` |
| A limitação está **escrita** no próprio arquivo, com o conserto proposto | `escopoTarefa.ts`, cabeçalho |
| Descobrir papel pelo front exige `GET /members/{id}/teams` — **uma chamada por pessoa** | idem |
| `_assert_target_reaches_task` levanta 422 se o alvo não alcança | `collaboration_service.py:310-343` |
| `user_can_view_task` devolve `bool` para a mesma pergunta | `task_guards.py:100-128` |
| `MembershipRepository.get_membership` já devolve `team_roles` — pares `(team_id, role)`, **plural** | usado nos dois acima |

### O achado que desenha a spec

**`_assert_target_reaches_task` e `user_can_view_task` são a mesma regra,
escrita duas vezes.** Corpo idêntico, linha por linha: `get_membership` →
checagem de `is_active` → montar `Membership` a partir de `team_roles` →
`team_scope.visible_team_ids` → carregar projeto → `task_visible(...)`. A única
diferença é o final: uma levanta `ValidationError`, a outra devolve `False`.

Três consequências:

1. **Um endpoint só serve os dois seletores.** Responsável e menção perguntam
   exatamente a mesma coisa. Não são duas features.
2. **A duplicação vira risco no dia em que a regra mudar.** Duas cópias que
   ninguém marcou como cópias. Ver D4.
3. **`team_roles` é plural.** O backend já lida com pessoa em vários times. O
   front não: `escopoTarefa.ts` lê `Map<string, string | null>` — um subtime por
   pessoa. Ver D6.

### A diferença que NÃO pode ser apagada

Designar exige **duas** validações; mencionar exige **uma**:

| | alcance | projeto pessoal mono-usuário |
|---|---|---|
| Designar responsável | sim | **sim** (`_assert_personal_monouser`, 409) |
| Mencionar | sim | não |

Um endpoint que devolvesse "quem pode" misturando as duas quebraria a menção em
tarefa de projeto pessoal. Ver D3.

---

## Decisões

### D1 — Parâmetro em `GET /members`, não endpoint novo

`GET /api/v1/members?reaches_task={task_id}`.

Sem o parâmetro, a rota se comporta exatamente como hoje — nenhum chamador
existente muda. Com ele, a lista já vem filtrada por quem alcança a tarefa.

**Alternativa avaliada e rejeitada: devolver `role` no `MemberResponse` e
deixar o front decidir.** Mais barato de escrever e **errado**: espalharia a
árvore de papéis e a regra de `team_scope` para o TypeScript, onde ela viveria
como segunda implementação de uma regra de domínio. É exatamente o que o
cabeçalho do `escopoTarefa.ts` desaconselha: *"e não espelhar a árvore de papéis
aqui."*

**Alternativa avaliada e rejeitada: `GET /tasks/{id}/eligible-assignees`.**
Mais explícita, e obrigaria o front a casar duas listas (todos os membros, para
resolver nomes de quem já está lá; e os elegíveis, para o seletor). O padrão
que a sessão de 31/07 estabeleceu é o contrário: *"o mapa de nomes fica
completo; o que filtra é um conjunto à parte."* Um parâmetro na mesma rota
preserva esse padrão.

### D2 — A regra é aplicada **uma vez**, no domínio

O filtro chama a mesma função que o `POST` de designação chama. Não uma cópia,
não uma versão "de leitura". Se as duas puderem divergir, um dia divergem — e o
sintoma é o seletor oferecer alguém que o salvar recusa, que é o defeito que
esta spec existe para acabar.

### D3 — O filtro considera **só alcance** (fechada, e a razão mudou)

`?reaches_task=` devolve quem **enxerga** a tarefa. Nada mais. Sem campo
`can_assign`.

**A recomendação inicial era outra** — um campo `can_assign` por membro, para
cobrir a validação extra que a designação faz e a menção não faz
(`_assert_personal_monouser`, 409 em projeto pessoal alheio). Ela caiu por uma
medição feita em 03/08, depois de você observar que projeto pessoal não é usado:

| Fato | Onde |
|---|---|
| Projeto pessoal nasce **sob demanda**, em `get_or_create` | `project_service.py:376-392` |
| A única porta é `GET /me/personal-project` | `me_router.py:37-46` |
| **O front nunca chama essa rota** | `web/lib/api.ts` — zero ocorrências |
| O front só declara `is_personal` no tipo e **descarta na tela de pastas** | `api.ts:998` e comentário em `:1013` |

**Consequência:** não existe caminho pela interface que crie um projeto pessoal.
O `can_assign` seria um campo novo de API defendendo um caso sem nenhuma linha
no banco — e que seria removido na revisão que você quer fazer (ver §Fora de
escopo). Campo que nasce para morrer é pior que campo ausente: alguém consome.

⚠️ **Nada é desfeito no front.** A checagem de projeto pessoal que existe hoje
no `TaskDetail` — o achado A1 de 31/07 — **fica onde está, intocada**. Ela não
vive em `foraDoEscopo` e não é tocada por esta spec. O critério 14 existe para
provar isso.

### D4 — Unificar as duas cópias da regra

`_assert_target_reaches_task` passa a ser um invólucro que levanta em cima de
`user_can_view_task`. Um corpo, dois contratos.

Não é faxina: esta spec cria um **terceiro** chamador da mesma regra. Três
cópias de uma regra de visibilidade é como o produto ganha um buraco de
segurança silencioso.

⚠️ **O comportamento não pode mudar.** A suíte atual é a rede: se algum teste
de designação mudar de cor nesta fatia, a unificação está errada.

### D5 — Quem já está escolhido continua na lista (fechada: **o front reintroduz**)

Exceção deliberada de 31/07: no seletor de **responsável**, quem já está
designado permanece, mesmo fora do escopo — senão não haveria como
desdesignar. Em **menção** não há essa exceção.

Com o filtro vindo do backend, isso precisa continuar valendo — e o backend
não sabe quem já está designado a menos que se diga a ele.

- **(a) O front reintroduz.** Ele já tem os responsáveis atuais na mão. Uma
  união de conjuntos, no lugar onde a exceção já existe hoje.
- **(b) O backend inclui os já designados** mesmo fora do escopo.

**Fechada em (a).** É regra de **UI** ("dá para desfazer o que está feito"),
não de domínio. O backend continua respondendo só "quem alcança" — uma frase
verdadeira independente de qual tela pergunta.

### D6 — Isto desamarra a pendência do §7

`escopoTarefa.ts` foi escrito lendo `Map<string, string | null>` — **um** subtime
por pessoa — e o handoff de 31/07 registra isso como o único ponto a mudar
quando a conversa do §7 (pessoa em mais de um subtime) andar.

Com o filtro no backend, esse ponto **deixa de existir**: `team_roles` já é
plural e `visible_team_ids` já soma vários times.

Não resolve o §7 — a decisão de produto continua aberta. Mas retira desta
tela a dívida que a sessão de 31/07 apoiou nela.

### D7 — Custo de consulta, assumido

O filtro roda `get_membership` + `visible_team_ids` **por membro**. Com 24
contas, são 24 iterações numa requisição que hoje faz uma. Aceitável nessa
ordem de grandeza, e o projeto tem tela de 24 pessoas, não de 24 mil.

⚠️ **Registrado para não virar surpresa:** se o workspace passar de algumas
centenas de membros, isto vira o gargalo da tela de tarefa. O conserto seria
carregar os memberships em lote e rodar a regra pura sobre eles, o que é
possível porque `visible_team_ids` e `task_visible` **já são puras**.

---

## Critérios de aceitação

**Backend**

1. `GET /members` **sem** o parâmetro devolve exatamente o que devolve hoje —
   mesma lista, mesmos campos, mesma ordem.
2. Com `?reaches_task={id}` de uma tarefa da **raiz** → todo mundo ativo do
   workspace aparece.
3. Com `?reaches_task={id}` de tarefa **interna de subtime** → aparecem os
   membros daquele subtime **e** os MANAGER/ADMIN de time acima. **É o critério
   do pedido.**
4. SUPERVISOR e OPERATOR de outro subtime **não** aparecem.
5. Usuário inativo não aparece, com ou sem parâmetro.
6. Tarefa inexistente ou invisível para quem pergunta → 404.
7. A lista devolvida é **idêntica** ao conjunto que o `POST` de designação
   aceitaria. Teste que percorre a lista e designa cada um: nenhum 422.
8. Após a D4, nenhum teste de designação existente muda de cor.

**Front**

10. Em tarefa interna de subtime, o seletor de responsável mostra gestor e
    admin.
11. O `@` na mesma tarefa oferece as mesmas pessoas.
12. Em tarefa da raiz, nada é filtrado (comportamento de hoje).
13. Quem **já está designado** continua na lista mesmo fora do escopo (D5).
14. Em tarefa de **projeto pessoal**, o seletor de responsável não oferece quem
    não é o dono — o achado A1 de 31/07 **continua consertado**.
    ⚠️ Não há como criar projeto pessoal pela interface (D3). Este critério só é
    verificável montando a linha à mão no Adminer, ou chamando
    `GET /me/personal-project` uma vez. **É teste de não-regressão de uma
    checagem que esta spec não deve encostar** — se estiver caro de montar,
    vale mais confirmar por `grep` que o código não mudou.
15. O mapa de nomes continua **completo**: nome de quem já está designado
    resolve, mesmo que ele não apareça no seletor.

---

## Fora de escopo

- **Decidir o §7** (pessoa em mais de um subtime). Esta spec retira a dependência,
  não resolve a questão.
- **Mostrar por que alguém não aparece.** O seletor continua sem explicar.
- **Devolver `role` no `MemberResponse`.** Rejeitado na D1.
- **Aplicar o mesmo filtro na tela de membros** (`/membros`). Ela lista o
  workspace inteiro de propósito.
- **Cache de membros por tarefa.** Ver §Fronteira de risco.
- ⚠️ **Repensar projeto pessoal / espaços.** Levantado por você em 03/08:
  *"projeto pessoal não faz mais sentido do jeito que foi montado."* Medido:
  **29 ocorrências de `is_personal` em 9 arquivos do backend**, 6 arquivos de
  teste, e 10 ocorrências em 9 arquivos do front. Não é uma flag — é um ramo
  dentro de `task_visible` (`task_guards.py:56`) e dentro da regra de edição
  (`:93`), ou seja, **no mesmo núcleo de visibilidade que esta spec unifica na
  D4**.

  Duas consequências para a fila:
  - A D4 desta spec **facilita** essa revisão: sai de duas cópias da regra para
    uma, então o ramo de `is_personal` passa a ter um lugar só onde ser mexido.
  - A revisão **não deve** entrar em paralelo com esta spec. As duas mexem em
    `task_visible`, e um erro ali não degrada uma tela — some com tarefa da
    vista de quem deveria vê-la, sem erro.

  Entrega própria, e a pergunta que ela precisa responder primeiro não é
  técnica: **o que "espaço pessoal" deveria ser**, já que a versão atual nunca
  foi usada por ninguém.

## Fronteira de risco

**Média.** Mexe numa rota que **6 telas** consomem e numa regra de
visibilidade.

Três pontos de atenção desproporcional:

- **O critério 1.** `GET /members` é chamado por `TaskModal`, `Board`,
  `tarefa/[id]`, `membros`, `arquivadas` e `minhas-tarefas`. Se o
  comportamento sem parâmetro mudar em qualquer coisa, quebram seis telas de
  uma vez.
- ⚠️ **`listMembers()` é memoizado em `lib/api.ts`.** A variante por tarefa
  **não pode** compartilhar essa entrada de cache: se compartilhar, a primeira
  tarefa aberta na sessão define a lista de todas as outras — e o sintoma é
  "às vezes o gestor aparece, às vezes não", que é o pior tipo de defeito para
  reproduzir. Chave de cache separada, por `task_id`, ou sem cache.
- **A D4.** Unificar as duas cópias é a coisa certa e é onde um erro é mais
  caro: as duas estão no caminho de designar e de notificar menção. A suíte
  atual é a única rede, e por isso a fatia sobe **sozinha**, sem nada junto.

⚠️ **`vitest` não enxerga componente.** Critérios 10-15 sem cobertura
automática, exceto o que sobreviver em `lib/escopoTarefa.ts` (ver `plan.md`).
Conferência visual obrigatória — e este é justamente o tipo de defeito que
apareceu por captura de tela em 31/07, não por teste.
