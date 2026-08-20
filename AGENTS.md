# AGENTS.md — como trabalhar neste repositório

Regras de **processo**. As de design de interface estão em
[`web/AGENTS.md`](web/AGENTS.md).

Cada regra aqui nasceu de um erro que aconteceu. A referência entre parênteses
é onde ele está registrado.

---

## 1. ⚠️ Antes do primeiro commit de uma branch

**Conferir se a fatia da qual ela depende já está em `main`.** Se não estiver,
`git merge` daquela branch para dentro antes de qualquer coisa.

Aconteceu duas vezes, e a segunda foi uma fatia depois de a regra ter sido
escrita num `plan.md`:

- **Spec 038:** a `fatia-b2` (front) saiu de `main`, que não tinha a `fatia-b1`
  (backend). Front mandando `due_time`, backend sem conhecer o campo.
  ⚠️ **O Pydantic descarta campo desconhecido em silêncio** — o `PATCH` volta
  **200**, sem o campo. A hora "não salvava" sem erro nenhum.
- **Spec 036:** a `fatia-12b` saiu de `main` sem a `12a`.

⚠️ **E os testes do front passaram nas duas vezes**, porque mockam o
`@/lib/api`: eles afirmam o que a tela **chama**, nunca o que viaja no fio.

**Isto é verificação, não lembrança.** `git log main --oneline | grep <fatia>`
antes de commitar.

## 2. ⚠️ Dizer em qual branch a árvore ficou

A Camila roda `next dev` e `api-dev` locais. Trocar de branch para mexer em
documento e não voltar fez o servidor dela servir código sem a funcionalidade —
ela relatou "não achei a cápsula", que parecia defeito e era processo.

**Ao trocar de branch para mexer em documento, voltar para a de código antes de
devolver a palavra.** E dizer, sempre, em qual branch a árvore ficou.

## 3. ⚠️ Não afirmar sobre código sem abrir o arquivo

Escopo escrito antes de abrir o arquivo é palpite com formatação de documento.
Três escopos foram desmentidos pelo próprio código na sessão de 19/08, e um
`TypeError` virou 500 porque uma assinatura foi assumida
(`EntityNotFoundError` **não aceita `details=`** — é
`(entity, *, identifier, message)`).

## 4. Dizer quais arquivos foram mexidos

O caminho de **todo** arquivo criado ou alterado, em cada entrega.

## 5. Os portões

### Front (`web/`) — ~12 s

```bash
npx tsc --noEmit && npm test && npx next build
```

⚠️ **E `TZ=UTC npm test` também.** O CI roda em UTC e um defeito de fuso passou
verde na máquina da equipe (todo mundo em BRT) e reprovou no CI, só entre 00:00
e 03:00.

### Backend — ~1,5 min

```bash
docker compose run --rm -e TEST_DATABASE_URL=... api-dev pytest
```

⚠️ **Depois de mexer no backend: `docker compose up -d --build api-dev`.** O
`api-dev` **não recarrega sozinho**.

⚠️ **O backend não roda na máquina de quem assiste** — não há Postgres. Isso
obriga a dividir fatia de backend em duas entregas (12a/12b, B1/B2). Funcionou
bem: os erros que sobraram foram de assinatura, não de lógica.

### Sempre informar o número esperado

Quais portões rodaram de fato, e o número que a suíte deve mostrar.

## 6. O que os portões NÃO pegam

Não é lista de desculpa — é o que exige olho:

- **`onDragEnd`** não roda em jsdom, não tem guardião e não vai ter.
- **Classe CSS não tem guardião** — o `include` do vitest é `lib/**` e
  `components/**`.
- **Largura de texto**, truncagem e corte.
- ⚠️ **`useSearchParams` em rota estática derruba o `next build`** com "missing
  suspense boundary" — e o `npm run dev` não reclama. `/quadro` é estática;
  `/quadro/[teamId]` é dinâmica e passa sem `Suspense`.

## 7. Ferramentas e limites

- ⚠️ **`gh` não está instalado.** Dá para empurrar branch; **o PR é da Camila**.
  Não dizer "o PR está lá" — dizer "empurrei, o PR é seu" e mandar o link de
  compare.
- ⚠️ **Query de banco em SQL puro.** Ela roda no **Adminer**, não no
  `docker exec`. A exceção é o `invariantes.sql`, que é arquivo do repo.
- **Deploy:** roteiro no `DEPLOY.md`. `git status --porcelain` na VPS (esperado
  vazio) → `git pull` → `invariantes.sql` antes → **taguear as imagens (passo
  0.b)** → `build` → `up -d` → `invariantes.sql` depois.

## 8. Decisão de produto

Opções **numeradas, com custo**, e uma recomendação. Devolver o custo é mais
útil que obedecer: um pedido de "fuso de quem olha" virou "fuso fixo de
Brasília" quando ficou claro que **o job de prazo não tem espectador**.

⚠️ **Ela confere na tela, e a tela ganha.** Numa sessão em que os três portões
passaram, ela achou quatro defeitos olhando.

## 9. Armadilhas do domínio

- ⚠️ **Comparação de string com prefixo mente:** `"2026-08-19" < "2026-08-19
  18:00"` é `true`. E o Postgres devolve `TIME` como `"18:00:00"`, que
  comparado com `"18:00"` inverte de novo.
- ⚠️ **Corpo montado campo a campo precisa de `*Corpo.test.ts`.** `createTask` e
  `aplicarLoteDeColunas` montam campo a campo; `updateTask` manda `body: input`.
  **Campo novo no primeiro tipo é descartado em silêncio** — foi assim que o
  `board_id` ficou fora por um mês. Os testes de corpo usam `toEqual` sobre o
  objeto **inteiro** de propósito: eles caem quando um campo entra, e é assim
  que lembram alguém de pôr a linha.
- ⚠️ **Índice parcial não é `DEFERRABLE`.** Trocar o alvo da semântica passa por
  um estado com dois alvos; a ordem `tirar → flush() → pôr` é obrigatória.
- ⚠️ **`NOW()` no Postgres é o instante da TRANSAÇÃO.**
- ⚠️ **`@model_validator` devolve 500.**
- ⚠️ **`ColumnSemantic` é `StrEnum`** e a string compara igual.
- ⚠️ **`str.replace` falha calado.**
- **Dois `useDroppable` com o mesmo id se sobrescrevem.**
- **`useDraggable({ disabled })` não desregistra o nó.**
- **Teste de serviço não sabe se a rota existe** — rota nova leva teste HTTP.
- **O quadro só desenha `depth === 0`.**

## 10. Texto que promete o que o código não faz

`notify_deadline` foi lido e exposto sem escritor por semanas, e **três textos
prometiam o contrário**. Regra: quando uma capacidade não tem leitor ou não tem
escritor, isso vai escrito no lugar onde alguém procuraria — não numa spec que
ninguém reabre.
