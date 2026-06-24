# ADR 0020 — Gate de troca obrigatória aplicado no servidor

Accepted

## Contexto

Uma senha provisória (ADR 0019) só é segura se a troca for **garantida**. Se o
sistema apenas *sugerir* a troca e confiar no front pra redirecionar, a
provisória nunca expira na prática e vira porta dos fundos permanente. O
enforcement tem que ser server-side. O desafio: bloquear "tudo" sem bloquear o
próprio endpoint de troca (senão o usuário travado nunca destrava).

## Decisão

Aplicar o gate no **`get_tenant_context`** — a dependency central por onde passa
toda rota de negócio. Ao resolver o contexto, lê-se `must_change_password` do
`User`; se `true`, levanta `PasswordChangeRequiredError` → **409**. Isso protege
todas as rotas de negócio **sem mudança rota a rota**.

Exceções, que usam uma dependency leniente nova (`get_user_allowing_pending`,
que valida token + carrega user **sem** o gate):

- `POST /auth/change-password` — onde a pessoa destrava.
- `GET /auth/me` — pro front saber o estado e renderizar a tela de troca.

`POST /auth/login` e `POST /auth/refresh` são públicas e não passam pelo gate.

## Alternativas rejeitadas

- **Gate por rota (`Depends` em cada router).** Ruidoso e fácil de esquecer
  numa rota futura — falha aberta. O ponto único no contexto falha fechado.
- **Token restrito** (JWT que só permite trocar senha). Mais complexo, mexe na
  emissão/validação de token; o flag no contexto entrega o mesmo com menos peça.
- **Confiar no front.** Não é enforcement; rejeitado por definição.

## Consequências

- **Positiva:** uma peça protege tudo; rota nova futura já nasce coberta.
- **Custo:** `get_tenant_context` passa a depender do flag do `User`. Ou faz uma
  leitura barata do `User`, ou estende a query de membership pra trazer o flag
  (decisão de implementação no `plan.md`/stub).
- **Status 409** escolhido (família Conflict/BusinessRule): "o estado atual da
  conta impede a operação". Não é 401 (token é válido) nem 403 (não é falta de
  permissão). O front distingue 409+código pra redirecionar à troca.
- `GET /auth/me` deixa de exigir o caminho estrito e passa pela dependency
  leniente — não enfraquece nada (continua exigindo token válido).
