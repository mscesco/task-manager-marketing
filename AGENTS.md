# AGENTS.md — como trabalhar neste repositório

Regras de **processo**. As de interface estão em [`web/AGENTS.md`](web/AGENTS.md).
Cada regra nasceu de um erro que aconteceu; o "por quê" está numa linha ao lado.

---

## 1. Antes do primeiro commit de uma branch

**Conferir se a fatia da qual ela depende já está em `main`** — senão, `git merge`
dela antes de qualquer coisa. Verificação, não lembrança:
`git log origin/main --oneline | grep <fatia>`.

*Por quê:* o Pydantic **descarta campo desconhecido em silêncio** (o `PATCH` volta
200 sem o campo), e os testes do front mockam o `@/lib/api` — afirmam o que a tela
chama, nunca o que viaja no fio. Uma fatia de front sem a de backend passa verde.

## 2. Dizer em qual branch a árvore ficou

Quem desenvolve roda `next dev` e o `api` locais em cima da pasta do projeto.
Trocar de branch e não voltar faz o servidor dela servir outro código — parece
defeito e é processo. **Prefira uma worktree** (`git worktree add`) para mexer em
outra branch; se trocar na pasta principal, volte e diga onde ficou.

## 3. Não afirmar sobre código sem abrir o arquivo

Escopo escrito antes de abrir o arquivo é palpite. Assinatura assumida vira 500
(`EntityNotFoundError` **não aceita `details=`**).

**Rota, schema ou repositório novo: copie o irmão mais parecido**, não escreva do
zero. Exemplo — `DELETE` com 204 precisa de `response_class=Response`; com `-> None`
o FastAPI recusa no **import** e derruba a coleta da suíte inteira:

```python
@router.delete("/x/{id}", status_code=status.HTTP_204_NO_CONTENT,
               response_class=Response)
async def apagar(...) -> Response:
    ...
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

## 4. Em toda entrega

- O caminho de **todo** arquivo criado ou alterado.
- **Quais portões rodaram de fato e o número** que a suíte mostrou — e o
  **código de saída**, não só a contagem (ver §5).

## 5. Os portões — a lista única

Os outros documentos apontam para cá. O CI roda todos de novo, mas **rode-os
antes de entregar**: o CI julga o que foi empurrado.

### Front (`web/`)

```bash
npx tsc --noEmit && npm test && TZ=UTC npm test && npx next build
```

- `TZ=UTC` porque o CI roda em UTC: defeito de fuso passa verde em BRT e reprova lá.
- ⚠️ **Olhe o código de saída e a linha `Errors`**, não só "Tests N passed": uma
  rejeição não tratada reprova o CI com todos os testes verdes.
- ⚠️ O `next build` usa a mesma pasta `.next` do `npm run dev` — pare o dev antes.

### Backend

```bash
docker compose up -d db-test
docker compose run --rm -e TEST_DATABASE_URL="postgresql+asyncpg://test:test@db-test:5432/taskmanager_test" api-dev pytest
docker compose run --rm api-dev ruff check app tests scripts
```

- ⚠️ **Sem `TEST_DATABASE_URL` a suíte não falha — ela PULA**, com código de saída
  zero e um "N skipped" discreto. A URL está por extenso de propósito.
- ⚠️ **Trocou para um branch com menos migrations?** O `db-test` guarda o estado
  enquanto o container está no ar ("Can't locate revision", todo teste vira
  `ERROR`). `docker compose restart db-test` zera.
- ⚠️ **Pipe engole o código de saída**: `pytest | tail` devolve o do `tail`.
  Redirecione para arquivo e leia o `$?` do próprio pytest.
- O `ruff` **bloqueia no CI**.
- Dependência nova: `docker compose build api-dev` (a imagem instala o grupo
  `dev` do `pyproject.toml`) e `docker compose up -d --build api`. Mudança só de
  código não precisa: o `api` recarrega sozinho.

### Drift de migration — toda entrega que cria ou altera tabela

```bash
docker compose run --rm -e DATABASE_URL="postgresql+asyncpg://test:test@db-test:5432/taskmanager_test" api-dev sh -c "alembic upgrade head && alembic revision --autogenerate -m drift && cat alembic/versions/*drift*.py; rm -f alembic/versions/*drift*.py"
```

Tem de sair **sem nenhuma linha `op.`** — e confira que o arquivo foi **gerado**
(sem banco alcançável o portão não roda, sem erro claro). Ele pega o que nenhum
teste vê: nome de constraint, `index=True` num mixin, `ondelete` esquecido.

### A imagem de produção importa o app? — todo `import` novo de biblioteca

```bash
cd backend && docker build --target runtime -t api:pre . && docker run --rm -e DATABASE_URL="postgresql+asyncpg://x:x@localhost:5432/x" -e JWT_SECRET_KEY="sem-valor-nenhum-0123456789012345" -e APP_ENV=development --entrypoint python api:pre -c "from app.main import create_app; create_app()"
```

*Por quê:* o `api-dev` instala `.[dev]` e a produção `pip install .`. Dependência
só em `dev` usada em `app/` passa por todos os testes e derruba a API no `import`.
Pergunta de bolso: *a biblioteca está em `dependencies` ou em `dev`?*

## 6. O que os portões NÃO pegam — exige olho

- **`onDragEnd`** não roda em jsdom.
- **Classe CSS**, largura de texto, truncagem e corte.
- **`useSearchParams` em rota estática derruba o `next build`** ("missing suspense
  boundary"), e o `npm run dev` não reclama.
- **Aviso no console** (`console.error`): o Next 15 o desenha num painel em
  desenvolvimento. Quase sempre é defeito antigo que estava escondido.

**A conferência na tela ganha dos portões**: já achou defeitos com tudo verde.

## 7. Ferramentas e limites

- **`gh`** está instalado e autenticado (no Bash, pelo caminho completo). Abrir,
  mergear ou mudar configuração no GitHub é **ação para fora**: confirmar antes.
- **`main` local fica para trás**: antes de medir contra `main`, `git fetch` e
  compare com **`origin/main`**.
- **Consulta ao banco de produção:** SQL puro, para rodar no Adminer.
- **Banco de desenvolvimento:** o `db-dev` local (`backend/README.md`); não há
  túnel para a VPS.
- **Deploy:** [`DEPLOY.md`](DEPLOY.md).

## 8. Decisão de produto

Opções **numeradas, com custo**, e uma recomendação. Devolver o custo é mais útil
que obedecer: um pedido de "fuso de quem olha" virou "fuso fixo" quando ficou
claro que o job de prazo não tem espectador.

## 9. Armadilhas do domínio

- **Comparação de string com prefixo mente:** `"2026-08-19" < "2026-08-19 18:00"`
  é `true`; o Postgres devolve `TIME` como `"18:00:00"`.
- **Corpo montado campo a campo precisa de `*Corpo.test.ts`** com `toEqual` sobre o
  objeto inteiro: campo novo é descartado em silêncio (`createTask`,
  `aplicarLoteDeColunas`; `updateTask` manda `body: input`).
- **Índice parcial não é `DEFERRABLE`:** a ordem `tirar → flush() → pôr` é
  obrigatória ao trocar o alvo da semântica.
- **`NOW()` no Postgres é o instante da TRANSAÇÃO.**
- **`@model_validator` devolve 500.**
- **`ColumnSemantic` é `StrEnum`**, e a string compara igual.
- **`str.replace` falha calado.**
- **Dois `useDroppable` com o mesmo id se sobrescrevem**;
  `useDraggable({ disabled })` não desregistra o nó.
- **Teste de serviço não sabe se a rota existe** — rota nova leva teste HTTP.
- **O quadro só desenha `depth === 0`.**

## 10. Texto que promete o que o código não faz

Quando uma capacidade não tem leitor ou não tem escritor, isso vai escrito **no
lugar onde alguém procuraria** — não numa spec que ninguém reabre.
