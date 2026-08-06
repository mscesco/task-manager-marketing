# 0037 — A varredura de arquivamento arrasta a subárvore inteira

## Status

Accepted — em produção desde 06/08/2026 (fatia F1b). Fecha a decisão **D11** e
**corrige uma afirmação errada** que circulou no documento de decisão daquele
dia (ver §Correção).

## Contexto

Existiam duas portas de arquivamento fazendo coisas diferentes, e ninguém tinha
decidido isso — foi como ficou:

- **"Arquivar" manual** cascateia a subárvore desde 05/08.
- **A varredura da madrugada** (`archive_stale`) arquivava só a tarefa
  elegível.

O resultado da segunda é uma **filha ATIVA debaixo de um pai arquivado**. Esse
estado não aparece em lugar nenhum: o quadro só desenha `depth === 0`
(`Board.tsx:580`), e a filha só existe na checklist de uma tarefa que ninguém
vai abrir, porque ela está arquivada. Pendência aberta desde 04/08.

O caso não é raro. Quando um pai é concluído, `complete_descendants` marca a
subárvore inteira como `COMPLETED` **no mesmo instante** — pai e filhas ficam
elegíveis na mesma rodada. É o caso comum, não a exceção.

## Decisão

**A varredura cascateia a subárvore inteira, igual ao arquivamento manual —
inclusive filha ATIVA, mexida ontem.** Decisão da Camila, 06/08/2026.

Duas coisas vão junto, e nenhuma é opcional:

**1. Raiz antes de folha, com lista de processados.** Sem a ordem e o filtro, a
filha é arquivada pela cascata do pai **e** processada de novo pelo laço,
ganhando uma linha de `task_history` que o arquivamento manual nunca gera. Não
é otimização — é correção.

**2. Uma linha de log por PAI que arrastou alguém**
(`task.archive_stale.cascata`, com `task_path` e `cascade_count`), e o resumo
da rodada passa a trazer `raizes` e `cascateadas`. O `path` do pai é o que
localiza as arrastadas depois:

```sql
WHERE path <@ CAST('<path>' AS ltree)
```

Uma linha por cascata basta para reconstruir quem sumiu do quadro, sem uma
query a mais por tarefa dentro do job.

## ⚠️ Correção — "a volta é COM perda" está errado

O documento de decisão de 06/08 registrou que uma subtarefa `IN_PROGRESS`
arrastada pela cascata voltaria como `BACKLOG`, e que o status antigo só se
recuperaria por SQL em `task_history`. **Isso não é o que o código faz.**
Verificado no repositório:

- `set_archived_subtree` **não toca em `status`**;
- o `unarchive` do pai cascateia para baixo desde 05/08;
- portanto **a filha volta com o status que tinha**.

O que se perde ao desarquivar é o status do **PAI**, que a Spec 013
(**decisão C**) zera para `BACKLOG` de propósito, por ele ser terminal. Isso é
comportamento deliberado e antigo, não efeito colateral desta decisão.

A correção fica registrada aqui, e não só no docstring de
`TaskService.archive_stale`, porque a versão errada é a que estava no documento
que a próxima sessão ia ler.

## Consequências

- ⚠️ **Trabalho ativo pode sair do quadro de alguém durante a noite**, sem que a
  pessoa tenha tocado nele. É o custo aceito, e é a razão de o log por pai
  existir.
- **Impacto medido antes de subir:** com `stale_archive_days = 20`, a query de
  impacto em 06/08 deu **0** filhas ativas a serem arrastadas. Ou seja: a fatia
  subiu sem mudar nada em produção naquele dia. `cascateadas > 0` numa madrugada
  seguinte é informação nova, não regressão — mas é o número a observar.
- O retorno do job conta **todas** as arquivadas (raízes + cascateadas), que é o
  que o `archived=` do log sempre significou. Filha cascateada **não** ganha
  linha própria de history (ADR 0005, mesma forma do soft-delete).
- Herdado do `unarchive` e não resolvido aqui: a subárvore volta **inteira**,
  inclusive filha que tinha sido arquivada de propósito **antes** do pai. O
  banco não guarda quem foi arquivado pela cascata. Distinguir exigiria coluna
  nova, e a migration entra junto no dia em que incomodar.

## Como medir

```
docker compose -f docker-compose.prod.yml logs api | grep -E "task.archive_stale"
```

`cascateadas=0` é o esperado enquanto o número de 06/08 valer. Qualquer valor
maior: as linhas `task.archive_stale.cascata` trazem o `task_path` do pai, e a
query de `ltree` acima localiza as arrastadas.

## Alternativas consideradas

- **Manter a varredura sem cascata.** Rejeitada: preserva o estado "filha ativa
  sob pai arquivado", que é invisível em todas as telas.
- **Cascatear só filha já terminal, deixando a ativa para trás.** Rejeitada
  pela Camila: produz o mesmo estado invisível, só que menos vezes — e "menos
  vezes" é pior de diagnosticar do que "sempre".
- **Coluna nova marcando quem foi arquivado pela cascata**, para o desarquivar
  ser seletivo. Adiada, não rejeitada: é a opção 3 de 05/08 e continua sendo o
  caminho se ressuscitar subtarefa encerrada incomodar na prática.
