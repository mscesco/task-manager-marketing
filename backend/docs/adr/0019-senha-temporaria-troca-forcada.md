# ADR 0019 — Senha temporária aleatória + troca forçada (em vez de código de convite)

Accepted

## Contexto

A E7 precisa de um 1º acesso onde o provisionador **não conheça a senha final**
do membro. Duas famílias de desenho foram avaliadas:

- **Código de convite de uso único** (entidade `invitation` separada, endpoint
  público de resgate que só *define* senha): `User` nasce no resgate;
  `password_hash` precisaria virar **nullable** enquanto a conta está só
  pré-autorizada.
- **Senha temporária aleatória** (`User` nasce no cadastro com uma senha
  gerada; troca forçada no 1º login): `password_hash` permanece **NOT NULL**;
  reusa o `/auth/login` existente.

A nullabilidade da primeira tem um efeito não-óbvio: `auth/service.login` faz
`verify_password(senha, user.password_hash)`. Com `password_hash` nulo, o
passlib **levanta** — troca um 401 limpo por um 500. Blindar isso é trabalho.

## Decisão

Adotar a **senha temporária aleatória com troca forçada**. O `User` é criado no
`POST /members` com uma senha de alta entropia gerada pelo servidor, marcado com
`must_change_password=true` e `password_expires_at = now + TTL`. A pessoa loga
com a provisória e **troca** no 1º acesso; a senha definitiva (escolhida por
ela) nunca foi conhecida por quem provisionou. `password_hash` continua
**NOT NULL** — não há hash nulo em nenhum momento, e o bug do login não existe.

Reset administrativo = gerar **nova** provisória (mesma mecânica), re-armando
`must_change_password` e a expiração.

## Alternativas rejeitadas

- **Código de convite + endpoint público de resgate.** Mais correto contra
  *interceptação* (o código só define senha, não loga), mas custa: coluna
  nullable + blindagem do login + entidade `invitation` + superfície pública
  nova. Para ferramenta interna de baixo volume, o ROI não fecha agora.
- **Senha padrão fixa** (todos entram com a mesma). Credencial default —
  qualquer um que descubra o padrão entra em toda conta não ativada.
  Rejeitada de saída; se for por senha provisória, é **aleatória por usuário**.

## Consequências

- **Positiva:** `password_hash` NOT NULL preservado; reusa login e refresh
  existentes; sem endpoint público novo.
- **Custo / risco aceito:** a provisória é uma **credencial de login completa**.
  Quem a interceptar na janela antes do 1º login pode logar e trocar a senha,
  trancando o usuário real. Mitigações: expiração curta + entrega por canal
  controlado (ver ADR 0021). Risco considerado aceitável para o contexto
  interno; reavaliar se virar produto multi-empresa externo.
- A expiração resolve a provisória **não usada** (vira lixo), não a provisória
  **usada por quem não devia** — esse é o risco residual explícito acima.
- `reset-password` pode ser aplicado à própria conta do admin (diferente do
  `deactivate`): forçar a si mesmo a trocar não tranca ninguém pra fora.
