# [EM ESPERA] Os portões de lint que não são portões

**Status: EM ESPERA — não é para sair consertando por conta própria.**
Gatilho para reabrir: alguém querer que `ruff` ou `mypy` **reprovem o CI**, ou
a chegada de uma pessoa nova no código (para quem 99 erros de tipo no terminal
são ruído que ensina a ignorar terminal).
Registrado em 11/09/2026, medido no `main` desse dia.

## O que existe, e o que não existe

O `pyproject.toml` configura os dois, com seleção séria:

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "ASYNC", "RUF"]

[tool.mypy]
strict = true
disallow_untyped_defs = true
warn_unused_ignores = true
```

⚠️⚠️ **E nenhum dos dois é portão.** O acervo, medido em 11/09:

| ferramenta | erros | arquivos |
|---|---|---|
| `ruff check app tests` | **49** | ~30 |
| `mypy app` | **99** | 36 de 133 |

Os portões que valem, e que o `AGENTS.md` lista, seguem sendo `pytest`,
`vitest`, `tsc --noEmit` e `next build`.

## O acervo, por regra

**`ruff` (49):**

| regra | n | o que é |
|---|---|---|
| `I001` | 21 | bloco de import fora de ordem |
| `F401` | 11 | import sem uso |
| `UP017` | 5 | `datetime.timezone.utc` → `datetime.UTC` |
| `E501` | 2 | linha longa |
| `F841` | 2 | variável sem uso |
| `RUF012` | 2 | default mutável em classe |
| `RUF100` | 2 | `noqa` sem uso |
| `B905`, `UP035`, `UP038`, `RUF022` | 1 cada | — |

**`mypy` (99):** `type-arg` 30 · `attr-defined` 15 · `unused-ignore` 11 ·
`no-untyped-def` 11 · `no-any-return` 10 · `arg-type` 8 · `assignment` 6 ·
`no-untyped-call` 5 · `override` 2 · `import-untyped` 1.

## ⚠️ Por que NÃO é só rodar `--fix`

`ruff check --fix` resolve 41 dos 49. Três razões para não fazer isso de
passagem:

1. ⚠️⚠️ **`I001` (21 dos 49) é reordenação de import em ~20 arquivos.** O diff
   toca o topo de quase todo módulo do backend e **apaga o `git blame` dos
   blocos de import** — justamente onde se olha para saber quando uma
   dependência entrou. Se vale, vale num commit **só disso**, isolado, para o
   `blame` ter uma linha para pular.
2. ⚠️ **`F401` (11) merece leitura, não conserto automático.** Import sem uso
   às vezes é ruído; às vezes é o rastro de **código morto** que ficou. Foi o
   caso em 11/09: o `COLUNAS_PADRAO` de `board_service.py` ficou sem uso porque
   a lista de colunas virou parâmetro — o `F401` era o sintoma, não o defeito.
3. ⚠️ **`mypy` não tem `--fix`.** Os 30 `type-arg` são `dict`/`list` sem
   parâmetro em assinatura de rota, e os 11 `no-untyped-def` são funções sem
   anotação. É trabalho manual, arquivo a arquivo, e `strict = true` no
   `pyproject` é uma promessa que o código não cumpre desde sempre.

## O que fazer quando reabrir

Mecânico, módulo a módulo, **com a suíte como guardião** — o mesmo desenho que
a nota sobre nomes em português (`~/.claude/.../nomes-em-ingles.md`) prescreve
para o acervo de nomes. E em commits separados por classe de regra, nunca um
"lint geral":

1. `F401` + `F841`, lidos um a um (podem apontar código morto);
2. `UP017`/`UP035`/`UP038`/`B905`/`RUF022` — mecânicos, baixo risco;
3. `I001` sozinho, num commit só dele;
4. `mypy`, por módulo, começando pelos routers (`type-arg` é a maioria e é o
   mais raso);
5. só então ligar no CI — e ligar **um** de cada vez, senão o primeiro
   vermelho não diz qual dos dois quebrou.

## A regra provisória, que vale desde já

⚠️ **Não aumentar o número.** É o que dá para fazer sem spec: medir antes e
depois de mexer, e não deixar o contador subir. Foi assim que o `F401` do
`board_service.py` apareceu em 11/09 — o branch estava com 50 contra 49 do
`main`, e o único delta era meu.

```bash
docker compose run --rm api-dev ruff check app tests --statistics
```

⚠️ **E há um resto conhecido:** `AnimatedOutline.tsx` (front) ainda tem
`TAMANHO_DO_TRACO` em português, contra a regra de código novo em inglês. Ele
não entrou no rename de 11/09 porque é citado em prosa em seis lugares do
próprio arquivo, e renomear no meio do smoke da Spec 047 trocaria risco por
estética. Entra junto do acervo de nomes.
