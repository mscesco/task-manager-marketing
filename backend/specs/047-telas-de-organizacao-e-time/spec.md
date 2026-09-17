# Spec 047 — As telas de organização e de time

**Status:** escrita em 02/09/2026, desenhada com a Camila em wireframe na mesma
conversa. Decisões tomadas.
**Escopo:** frontend, mais **uma** mudança de backend (§5, fatia A).
**Depende de:** **Spec 044 fatia 3** (a trava de um-subtime, §3) e **Spec 045 fatia
B** (o papel de organização precisa existir para a tela ter o que mostrar).
⚠️ **Não depende da Spec 046** — as telas funcionam com uma raiz só, e passam a
mostrar N quando elas existirem.
**Placar na abertura:** Front **1082** em 60 arquivos, `tsc --noEmit` limpo —
medido em 02/09. Backend não medido (Docker Desktop desligado); última conhecida
**1014**.
**Não faz parte desta spec:** área fechada, RBAC editável. Ver §6.

---

## 1. O que a Camila pediu, e por que não é redesenho

A conversa de 02/09 abriu assim:

> *"Gostaria de começar a reorganizar o gerenciamento do workspace/times e membros
> e afins para poder incluir outros times."*

**Não existe tela de organização hoje.** Renomear o workspace é rota sem tela
([workspaces/api/router.py:65](../../app/modules/workspaces/api/router.py)). E
`/times` existe, mas é uma lista plana que cria e edita time — não é onde se
administra gente.

O que muda de verdade não é o visual: é **onde cada coisa é administrada**. Hoje a
tela de membros é o único lugar onde vínculo e papel aparecem, e ela é uma lista
única de todo mundo. Com N áreas isso não escala.

**A divisão que esta spec estabelece:** a organização administra **áreas**, o time
administra **pessoas**, o painel administra **vínculos**.

---

## 2. O que já existe — medido em 02/09, abrindo os arquivos

⚠️ **A maior parte do que estas telas precisam já existe.** Esta seção está aqui
para impedir que alguém construa de novo.

| peça | onde | estado |
|---|---|---|
| a rota que o painel precisa | `users/api/router.py:102` | ✅ `GET /members/{id}/teams` devolve `(team_id, role)` por vínculo, desde a **Spec 015** |
| a listagem já é plural | `users/api/schemas.py:41` | ✅ `MemberResponse.team_ids: list[uuid.UUID]` — Spec 044 fatias 1+2, em `main` |
| a pílula compartilhada | `components/Badge.tsx` | ✅ eixos `soft` / `outline` / `neutral` — o que distingue "subtime de verdade" do fallback |
| a pílula **clicável que já aplica** | `components/TaskDetail.tsx:1524` | ✅ prioridade, Spec 039/F6. É o padrão que a Camila pediu, e ele é **sem otimismo, de propósito** |
| o popover de seleção com busca | `components/TaskDetail.tsx:416` | ✅ responsáveis, com âncora e clique-fora |
| ⭐ a regra que vale copiar dele | `components/TaskDetail.tsx:726-730` | ✅ inativo ou fora do escopo **some da lista — exceto se já selecionado** |
| os auxiliares de permissão do front | `lib/permissoesMembros.ts` | ✅ `alcanceDe`, `podeCadastrarMembro`, `podeTrocarPapel`, `papeisAtribuiveis`… |
| ⚠️ `temAcaoPossivel` | `lib/permissoesMembros.ts:181` | decide se a linha tem botão — **é permissão, não desenho** (Spec 044 §2.2) |
| ⚠️ `timesParaAdicionar` | `lib/permissoesMembros.ts:148` | **ainda tem a regra de 1-subtime**, espelhando a trava do backend (Spec 044 §5) |
| remover ≠ desativar | `users/api/router.py:252` e `:297` | ✅ duas rotas distintas — e é isso que a §4.2 protege |
| a tela de times de hoje | `app/times/page.tsx:61` | lista plana com criar / editar / remover |

---

## 3. ⚠️⚠️ Dois defeitos que esta spec pode reintroduzir

### 3.1. O cadeado do painel não pode ser deduzido no front

O painel mostra **todos** os vínculos da pessoa e deixa editáveis só os do seu
escopo (§4.3). A tentação é o front olhar o `team_id` e decidir.

**A Spec 034 desfez exatamente isso.** A regra espelhada no front fazia gestor e
admin sumirem dos seletores em tarefa interna de subtime — **reportado duas vezes,
com captura**. Hoje quem responde "quem alcança" é o backend, pela mesma função que
o POST usa.

⚠️ E a rota do painel **não diz** isso hoje: `GET /members/{id}/teams` exige apenas
estar autenticado (docstring em `router.py:107`). Por isso a fatia A é de backend:
**falta campo na rota**, não lógica na tela. É a prescrição literal do briefing —
*"se aparecer necessidade de filtrar escopo no front, falta parâmetro na rota"*.

### 3.2. O contador que diverge do corpo

A Camila pediu ocultar inativos. ⚠️ **Esconder linha já causou defeito aqui**: em
27/07 o contador do cabeçalho passou a divergir do corpo, e a decisão foi mostrar
todo mundo, sempre — *o que varia é o botão, nunca a presença*.

Filtro pode existir. **Mas o cabeçalho tem de dizer "12 de 15"**, senão é o mesmo
defeito com roupa nova.

---

## 4. As decisões

Desenhadas em wireframe com a Camila em 02/09; o raciocínio está em
[`../045-permissoes-como-produto/decisoes.md` §6](../045-permissoes-como-produto/decisoes.md).

### 4.1. `/organizacao` — administra áreas, e só

Nome da organização (editável — a rota já existe e não tem tela), **os gestores no
cabeçalho** (papel de organização, gente pouca, pertence junto do nome que eles
administram), grade de **cards de área** com contagem (`12 pessoas · 3 subtimes`) e
quem gere, botão de criar área, e **busca por pessoa atravessando as áreas**.

A busca não é enfeite: com N áreas e uma pessoa podendo estar em várias, *"onde
está a Fulana?"* não tem outra resposta nesta tela — a grade é por área.

⚠️ **Card "Pessoas sem área".** Sem ele, quem é cadastrado e nunca alocado **não
aparece em lugar nenhum do produto**, porque cards são áreas. Some sozinho quando a
lista está vazia.

Clicar num card leva para a tela do time. **Sem sidebar de membros** — a primeira
versão do wireframe tinha uma, e ela caiu na §4.3.

### 4.2. `/times/[id]` — uma tela só, que se adapta ao nível

Tabela: nome, e-mail, status (ativo/inativo **na organização**), e as cápsulas de
subtime **com o cargo junto** — `SEO · supervisora`. Sem o cargo, a coluna mostra
*onde* e esconde *o quê*, numa tela cujo assunto é permissão.

- **Uma tela para raiz e subtime.** Gerir uma área e gerir um subtime são públicos
  diferentes, mas duas telas divergem com o tempo; separar depois é mais fácil que
  reunificar.
- **A tabela lista quem tem vínculo na área *ou em qualquer subtime dela*.** Alguém
  pode estar só no SEO, sem vínculo na raiz, e precisa aparecer — senão vira gente
  invisível.
- **A cápsula de contorno** (`outline`) é o fallback "só na área"; as preenchidas
  são subtimes de verdade. O `Badge` já tem esse eixo.
- **`+1 área`** avisa que a pessoa tem vínculo em outra área, sem poluir a coluna.
  O detalhe fica no painel.
- **O lápis abre o seletor de subtimes**, no padrão do popover de responsáveis.
  ⭐ **Copiar dele a regra de `TaskDetail.tsx:726-730`**: quem já está marcado nunca
  some da lista, mesmo inativo ou fora do escopo. Sem isso, salvar o seletor remove
  em silêncio um vínculo que você não via.
- **Subtime novo entra como `OPERATOR`.** Bom default por um motivo estrutural, e
  não por conveniência: operadora é o piso do modelo, então adicionar alguém
  **nunca** viola a regra da Spec 044 §4.1-bis.
- ⚠️ **Desmarcar um subtime apaga o cargo.** Se a pessoa era supervisora ali,
  remarcar a traz de volta como operadora — perda de dado silenciosa por um
  checkbox. **Livre quando o cargo é operadora; confirma quando não é**, nomeando o
  que se perde.
- ⚠️ **`remover da área` ≠ `desativar pessoa`.** São duas rotas (§2). Numa tela com
  o nome de *um time* no topo, "desativar" lê como "tirar deste time" e desliga a
  pessoa da organização inteira. **As duas vão para o menu `⋯`**; na linha ficam só
  cargo e subtime, que é o que se mexe toda semana.

### 4.3. O painel do membro — cargo por vínculo

Lista de vínculos com o cargo ao lado, em cápsula clicável.

**Por que ele existe:** o cargo mora no vínculo, não na pessoa —
`UNIQUE (user_id, team_id)` dá **um cargo por time**
([organization.py:172](../../app/db/models/organization.py)). "Operadora em Mídias,
supervisora em SEO" é o caso normal, e uma linha de tabela com um cargo só não
consegue nem exibir isso.

- **O papel de organização fica no topo, separado dos times** — ele não tem time.
- ⭐ **Mostra TODOS os vínculos; edita só os do seu escopo.** É a primeira aplicação
  concreta de "vê amplo, edita estreito": um MANAGER de Marketing vê que a pessoa é
  operadora em TI e não mexe. Sem isso, saber onde alguém está exige abrir área por
  área — que é a pergunta que a tela existe para responder.
- ⚠️ **Cargo NÃO aplica no clique, ao contrário de prioridade.** Prioridade erra e
  você desfaz; cargo erra e a pessoa ganha alcance no sistema inteiro, em silêncio,
  sem notificar ninguém. Mesma cápsula, com um passo que nomeia a consequência:
  *"Supervisora no SEO: administra os operadores do SEO e monta o quadro do SEO."*
- ⚠️ **Nada de toggle por permissão.** A referência que a Camila trouxe tinha
  `Create cards` / `Add beneficiaries` como chaves individuais — isso é **RBAC
  editável entrando pela porta dos fundos**, e foi recusado com motivo em
  `decisoes.md` §10.1. O que se **escolhe** é o cargo; o que se **mostra** é a
  consequência, em texto.
- ⚠️ **Quando o papel vem de cima, some o select.** Para quem tem comando na raiz,
  a linha do subtime não é cargo, é alocação — e pela invariante de nível ela
  **nunca** conseguirá repetir o papel da raiz. Mostra
  `alocada · autoridade de Marketing`, não `Operador`. Foi este detalhe que fez a
  Camila querer apagar o próprio vínculo, olhando a tela de hoje.

### 4.4. A divisão de trabalho, sem sobreposição

**a tabela** mostra · **o lápis** define em *quais* subtimes · **o painel** define
*com que cargo* em cada um.

---

## 5. As fatias

**Fatia A — a rota de vínculos diz o que é editável (backend).**
`GET /members/{id}/teams` passa a devolver, por vínculo, se o ator pode editá-lo —
decidido **no backend**, pela mesma função que o PATCH usa. É a §3.1, e é a única
fatia de backend desta spec.
⚠️ Vai primeiro: sem ela o painel não tem como desenhar o cadeado sem repetir a
Spec 034.
✅ **ENTREGUE** — `37209b8`.

**Fatia B — `/organizacao` (front).**
A tela nova: cabeçalho com nome e gestores, grade de áreas, card "Pessoas sem
área", busca. Renomear a organização ganha tela pela primeira vez.
⚠️ **Rota nova e estática** — conferir `useSearchParams` antes do `next build`
(`AGENTS.md` §6); o `npm run dev` não reclama.
✅ **ENTREGUE** — `6ae0699`.

**Fatia C — `/times/[id]` (front).**
A tabela e o seletor do lápis. ⚠️ **Depende da Spec 044 fatia 3**: enquanto
`_assert_one_subteam` existir, marcar o segundo subtime devolve 422, e
`timesParaAdicionar` (`permissoesMembros.ts:148`) ainda espelha a trava. **Soltar
os dois na mesma fatia**, ou a tela oferece um destino que o backend recusa.
✅ **ENTREGUE** — `13fc0e8`.

**Fatia D — o painel do membro (front).**
Consome a fatia A. As cápsulas de cargo, o cadeado, a consequência em texto e o
`alocada · autoridade de X`.
✅ **ENTREGUE** — `e522178`.

**Fatia E — a tela de membros de hoje.** ✅ **DECIDIDA em 09/09.**

> *"Membros vira a busca da organização, aquela tela da tabela de membros que
> abre da tela da org."* — Camila

`/membros` deixa de ser uma lista própria e passa a ser **a tabela de pessoas da
organização**, no mesmo formato de `/times/[id]`, alcançada a partir da
`/organizacao`. Uma tabela só, uma regra só.

⚠️ **O aviso que a fatia carregava se cumpre por construção:** *"duas telas
listando pessoas, com regras diferentes, é o começo do próximo defeito de
contador"*. Com as duas dividindo o componente da tabela e as funções de
`lib/telaDoTime.ts`, não há duas regras para divergirem.

✅ **ENTREGUE em 09/09.** `components/TabelaDeMembros.tsx` é usada pelas duas
telas; a coluna do meio é parâmetro ("Cargo aqui" na tela de time, "Áreas" na de
pessoas). `/membros` ganhou a busca e virou a tabela da organização, e a busca da
`/organizacao` aponta para lá.

> **Nota de 17/09/2026:** no mesmo 09/09, `lib/telaDoTime.ts` virou
> `lib/teamScreen.ts` e `components/TabelaDeMembros.tsx` virou
> `components/MembersTable.tsx` (commit `a53e060`, nomes em inglês). E a rota
> `/membros` saiu (commit `3490a47`): a entrada do menu virou "Time" e aponta
> para `/times/<id>`.

⚠️ **Eu tinha dimensionado isto como "reescrever uma tela de 948 linhas", e a
Camila corrigiu: *"não é refazer a tela, só tornar o /membros nessa tela da
org"*.** Ela estava certa, e o número engana — 580 daquelas linhas eram
`LinhaMembro`, com os controles de vínculo INLINE que a fatia C e a D já tinham
substituído. Era **deleção de duplicação**, não cirurgia: a tela caiu para 386
linhas e a de time, de 529 para 190.

⚠️ **O que NÃO saiu, e é o que importa preservar:** cadastrar membro, resetar
senha e o bloco de senha provisória revelada uma vez (ADR 0021). São capacidades
que só existem nesta tela.

> ⚠️⚠️ **ESTADO EM 14/09 — AS CINCO FATIAS ESTÃO NO CÓDIGO; ESTE DOCUMENTO NÃO
> DIZIA.** Só a E estava marcada. Em cima delas vieram uns 25 consertos, quase
> todos achados pela Camila no smoke dos blocos 1 e 2 (contorno, carregamento,
> barra lateral, trava do último admin, contagem de inativos).
>
> **O que falta para fechar a spec não é código:**
>
> - **o smoke dos blocos 3 a 5** — adiado por ela até a 048 destravar o quadro
>   geral, que abria o time errado. Em andamento desde 14/09. É o que a §7 diz
>   que os portões não pegam;
> - **o PR.** A branch `spec-047/telas-de-organizacao-e-time` acumulou também a
>   remoção do projeto pessoal e quase toda a Spec 048. A regra é um PR por
>   spec, então a 047 sai num PR próprio, cortado no último commit dela, e a 048
>   vem num segundo, empilhado — ela depende desta.

---

## 6. O que esta spec deliberadamente NÃO faz

- **Área fechada** — raiz cujo trabalho não é legível pela liderança. Não há caso
  hoje; se aparecer, é propriedade do **time** (como quadro privado no Trello), e
  não mudança no papel do gestor. ⚠️ E "gestor vê só a estrutura" seria ficção
  enquanto ele puder se dar vínculo em qualquer área.
- **RBAC editável em tabela** — §4.3 e `decisoes.md` §10.1.
- **Mudar quem enxerga o quê.** Esta spec desenha telas sobre o alcance que a
  Spec 045 estabelece. ⚠️ Se uma tela precisar de um recorte que não existe,
  **falta parâmetro na rota** — não é para reconstruir escopo no front (§3.1).
- **O quadro geral com N áreas** — é a Spec 046 §4.3, e está em aberto lá.

---

## 7. O que os portões não vão pegar

- ⚠️ **`temAcaoPossivel` mora em `lib/`, então tem guardião. O resto da tela não.**
  O `include` do vitest é `lib/**` e `components/**`; `app/` fica **de fora**. Os
  testes das telas novas precisam morar em `components/__tests__/`, como o de
  `FilaDeSolicitacoes` (Spec 044 §7).
- **Classe CSS não tem guardião**, e largura de texto e truncagem também não — a
  coluna de cápsulas com `SEO · supervisora` mais `+1 área` é exatamente o tipo de
  linha que estoura sem ninguém ver.
- ⚠️ **`useSearchParams` em rota estática derruba o `next build`**, e o
  `npm run dev` não reclama (`AGENTS.md` §6). Duas rotas novas nesta spec.
- **A perda de cargo ao desmarcar** (§4.2). O seletor devolve uma lista de ids; o
  cargo que se perde não está nela, e nenhum teste de corpo vai notar a ausência de
  algo que nunca esteve no payload.
- ⚠️ **`TZ=UTC npm test` também** — o CI roda em UTC e um defeito de fuso já passou
  verde na máquina da equipe (`AGENTS.md` §5).
