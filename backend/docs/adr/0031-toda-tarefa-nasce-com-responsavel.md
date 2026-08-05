# 0031 — Toda tarefa nasce com responsável

## Status

Proposed. **Supersede a D14 de 04/08/2026** ("a porta de criar subtarefa
órfã fica aberta, com aviso na tela").

## Contexto

A regra "tarefa precisa de responsável" **existe só no modal**
(`criacaoTarefa.motivoNaoCria`). No backend:

- `TaskService.create` faz `if command.assignee_ids:` — sem responsável,
  aceita e cria;
- `CollaborationService.remove_assignee` não checa quantos sobram — dá
  para esvaziar a lista pela API ou pela tela;
- `_copiar_subarvore` cria as filhas sem responsável quando a caixa
  "Levar os responsáveis" está desmarcada (era a própria D13/D14).

Ou seja: qualquer caminho que não passe pela tela — n8n, Swagger, script,
a duplicação — já cria tarefa órfã hoje. Regra que mora só no front é
decoração.

**O que forçou a revisão.** Com quadros personalizados (ADR 0030, decisão
B) a tarefa vive em **um** quadro, e a busca é **por quadro**. Quem
atravessa quadros é "Minhas tarefas", que filtra por responsável. Uma
tarefa sem responsável, num quadro que ninguém abre, não aparece na tela
de ninguém e só é encontrada por quem já sabe onde ela está. A D14 era
aceitável enquanto havia um quadro só; deixa de ser no momento em que
existe o segundo.

**Passivo medido (05/08/2026): 37 tarefas vivas sem nenhum responsável.**
Não são lixo de teste — são trabalho real de oito pessoas (campanhas,
landing pages, materiais de evento), a maioria já `COMPLETED`, nenhuma
arquivada.

## Decisão

**Invariante: nenhuma tarefa NOVA nasce sem responsável, e nenhuma tarefa
PERDE o último responsável.**

### Onde a regra mora

No **serviço**, nos três pontos de escrita — não no modal:

1. `create` — `assignee_ids` vazio levanta 422;
2. `remove_assignee` — remover o último levanta 422 (a mesma porta, do
   outro lado; travar só a criação não fecha nada);
3. `duplicate` / `_copiar_subarvore` — nenhuma filha nasce sem alguém.

⚠️ **NÃO é validado no PATCH de outros campos.** Editar o título de uma
tarefa legada tem de continuar funcionando. Validar o estado inteiro num
PATCH parcial é a forma exata do defeito do responsável desativado
(04/08): a regra dispara num caminho que não tem nada a ver com ela, e a
pessoa leva 422 tentando corrigir uma vírgula.

### As 37 legadas ficam

Não serão limpas. A maioria está concluída, e atribuir responsável
retroativamente a uma tarefa concluída em julho é **inventar histórico** —
registrar que alguém fez algo que ninguém sabe se essa pessoa fez.

Com a regra ancorada na escrita de responsável, o conjunto legado **só
pode encolher**: nenhuma nova entra, e qualquer uma que ganhe responsável
sai para sempre.

**Contenção sugerida (não é bloqueio):** uma pastilha "sem responsável" no
painel de filtros do quadro, reaproveitando `responsaveisPorRaiz`. As
pessoas resolvem quando esbarram. Mais barato e mais honesto que migration.

### Duplicação: um passo a mais, ANTES do POST

O modal ganha um segundo passo listando as subtarefas **diretas** que
virão, cada uma com seletor de responsável e um "não levar esta". Ao
confirmar, **um único POST** leva tudo e o backend cria na mesma
transação.

⚠️ **A ordem é a decisão, não a tela.** Criar as tarefas e só então pedir
os responsáveis abriria uma janela — segundos, ou para sempre se a pessoa
fechar o navegador — em que tarefas órfãs **existem no banco**, exatamente
o que esta ADR proíbe. A saída seria um estado "rascunho", que é uma
tarefa órfã com outro nome. Também quebraria o critério 10 da Spec 033
(falha no meio → nada persiste).

**O passo só aparece quando falta alguém**: caixa desmarcada, responsável
da origem inativo, ou fora do alcance no destino. Herdando responsáveis
válidos, ele é pulado — clicou, duplicou. É o mesmo mecanismo para os três
casos; o do inativo deixa de ser tratamento especial.

**Netos herdam o responsável da subtarefa-pai correspondente na cópia.** O
modal conhece só as filhas diretas (é o "N diretas" da caixa), e listar 40
tarefas de três níveis num seletor é uma parede. Três níveis é raro; a
herança resolve sem tela.

### Ordem de entrega

A trava do backend é pequena e vale sozinha — fecha a porta do n8n e do
Swagger, hoje escancarada. O passo 2 do modal é maior. **Travar o backend
antes de o modal ter o passo faz a duplicação com a caixa desmarcada dar
422 na cara da pessoa.** Ou os dois vão juntos, ou a caixa sai antes.

## Consequências

**Positivas.** A regra passa a existir de verdade, valendo para todo
cliente da API. Fecha o único buraco conhecido do modelo de quadros do ADR
0030. "Minhas tarefas" vira, por construção, a rede que garante que toda
tarefa aparece para alguém.

**Negativas.** O aviso da D14 sai da tela e a caixa "Levar os
responsáveis" muda de significado — quem usava aquele fluxo passa a ter um
passo a mais. A duplicação fica mais cara em cliques no caso em que o
responsável não pode ser herdado.

⚠️ **Cliente de API antigo quebra.** Se algum fluxo do n8n cria tarefa
sem `assignee_ids`, ele passa a receber 422 **no dia do deploy**. Medir
antes: procurar chamadas a `POST /api/v1/tasks` nos fluxos do n8n e ver
se mandam responsável. Isso não aparece em teste nenhum deste repositório.

## Como medir

- A consulta do passivo, rodada antes e depois, **não pode crescer**:
  ```sql
  SELECT count(*) FROM task t
  WHERE t.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM task_assignment a WHERE a.task_id = t.id);
  ```
  Esperado hoje: 37. Depois do deploy: 37 ou menos, para sempre.
- Teste que cria tarefa sem responsável e espera 422; teste que remove o
  penúltimo (passa) e o último (422); teste que duplica com a caixa
  desmarcada e verifica que **nenhuma** filha nasceu órfã.
- Teste que edita o título de uma tarefa **sem responsável** e espera 200
  — é o que impede a regra de vazar para o PATCH.

## Alternativas consideradas

- **Limpar as 37 e travar sem exceção.** Mais limpo no papel. Rejeitada:
  atribuir responsável a tarefa concluída inventa histórico.
- **Validar a invariante em todo PATCH.** Rejeitada: quebra a edição das
  legadas e repete o defeito de 04/08.
- **Criar as tarefas e pedir os responsáveis depois.** Rejeitada: cria
  órfãs de verdade no intervalo e quebra a atomicidade da duplicação.
- **Exigir pelo menos um responsável ATIVO.** Mais correta e mais cara:
  desativar uma pessoa passaria a violar a regra em N tarefas de uma vez,
  exigindo redistribuição forçada no mesmo instante. Rejeitada por ora; se
  o limbo de "único responsável inativo" incomodar, é este o caminho.
