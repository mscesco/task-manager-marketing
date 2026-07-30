# Spec 030 — Endurecimento de sessão e acesso

> **Status: pronta para execução.** Decisões fechadas em 30/07 (D2 = opção A;
> D4 = versão, não denylist; D6 = mantém 8 caracteres). Medições do §Contexto
> feitas — ver a seção.

## Objetivo

Fechar três buracos de autenticação que existem hoje em produção:

1. **Sessão não morre.** Não há revogação. Trocar a senha não derruba ninguém.
2. **Não há freio por conta.** O rate limit é por IP; a conta é ilimitada.
3. **O transporte não é obrigatoriamente HTTPS** e não há cabeçalho de segurança.

Caso motivador, e ele é o seu: senha provisória entregue **à mão** (ADR 0021),
numa sala de treinamento, num time de 24 pessoas. Uma vaza. Hoje não existe
nenhuma ação — nem trocar a senha, nem clicar em "Sair" — que expulse quem entrou.

---

## O que o código faz hoje (medido no repo, 30/07)

Esta seção existe porque a versão anterior desta análise supôs uma coisa errada
(que a checagem de revogação custaria uma query nova). Tudo abaixo foi lido.

| Fato | Onde |
|---|---|
| Não existe rota de logout no backend | nenhuma ocorrência de `logout` em `backend/app/` |
| `jti` é gerado em todo token e **nunca conferido** | `security.py:100` gera; nada lê |
| `refresh()` só valida `is_active` e o workspace | `auth/application/service.py:117-133` |
| Trocar senha **não** invalida sessão | `change_password` não mexe em nada de token |
| Refresh dura 7 dias e é **rotacionado a cada uso** | `_issue_tokens` emite par novo |
| "Sair" no front é só `clearTokens()` local | `components/AppShell.tsx:101,140` |
| Rate limit é **só por IP** | `rate_limit.py` — chave é `client_ip(request)` |
| Senha nova aceita **8 caracteres**, sem complexidade | `auth/api/schemas.py:41` |
| Não há contador de falha por conta, nem aviso de tentativa | — |
| Nenhum cabeçalho de segurança em lugar nenhum | sem `middleware.ts`; `next.config` sem `headers()`; sem label de header no Traefik |

### O achado que muda o desenho

`get_tenant_context` chama `MembershipRepository.get_membership`, que já executa
`session.get(User, user_id)` — **a linha inteira do usuário já vem do banco em
toda requisição autenticada** (`membership_repository.py:45`). Ela já é usada
para `is_active` e `must_change_password`.

**Consequência:** carregar mais um campo do mesmo objeto custa zero. A revogação
pode ser conferida **em toda requisição**, não só no refresh. A sessão morre no
próximo clique, não em até 15 minutos.

### O que já está certo e não se mexe

Vale registrar para ninguém "consertar" depois:

- Senha provisória: 18 chars sobre alfabeto de 56 (~104 bits), via `secrets`. Sólido.
- `SYSTEM_API_TOKEN` com `secrets.compare_digest` e fail-closed. Correto.
- `X-Forwarded-For` pega o **último** item, não o primeiro. Correto — o primeiro é forjável.
- Formulário público: honeypot + tetos de payload + rate limit próprio. Bem defendido.
- Não existe `dangerouslySetInnerHTML` fora do script de tema. Superfície de XSS mínima.

---

## Decisões

### D1 — Revogação por versão, não por lista de tokens

A alternativa canônica é uma **denylist de `jti`** (o campo já existe no token).
Rejeitada: exige tabela nova ou Redis, uma leitura por requisição, e uma rotina
de limpeza. Infra nova para 24 contas.

Escolhido: **um contador de versão por usuário**. O token carrega a versão do
momento da emissão; a requisição compara com a atual; divergiu, o token morreu.
Incrementar o contador invalida **todos** os tokens daquele usuário de uma vez.

Custo aceito: a revogação é por **usuário**, não por dispositivo. Não existe
"encerrar só a sessão do celular". Não há gestão de dispositivos no produto hoje
e ninguém pediu.

### D2 — Coluna `token_version` (fechada: opção A)

Havia um caminho **sem migration**: derivar a versão de `sha256(password_hash)`.
Zero coluna, zero migration, e invalida ao trocar a senha do mesmo jeito.

Rejeitado porque amarra revogação a troca de senha **para sempre**: some o
"derrubar a sessão de fulano agora" sem obrigar a pessoa a escolher senha nova,
que é exatamente a ação que se quer num incidente. Também colocaria uma derivada
da credencial dentro de um token guardado em `localStorage`.

Escolhido: **coluna `token_version INTEGER NOT NULL DEFAULT 0`** na tabela
`users`. Migration `0007`.

⚠️ **A tabela é `users`, no plural** — a única do schema assim, porque `user` é
palavra reservada no Postgres. Não "padronizar" para o singular depois.

### D3 — O que incrementa a versão

| Evento | Incrementa? | Por quê |
|---|---|---|
| Troca de senha (voluntária ou primeira) | **sim** | é o cenário motivador |
| Reset de senha pelo gestor (`member_service.py:227`) | **sim** | é a ação de resposta a "a conta de fulano vazou" |
| `POST /auth/logout` (rota nova, D4) | **sim** | ver D4 |
| Criação de membro (`member_service.py:175`) | não | usuário novo, não há sessão para matar |
| Desativar usuário | não | `is_active` já é conferido a cada requisição |

### D4 — "Sair" encerra **todas** as sessões da pessoa

Hoje "Sair" não encerra nada no servidor. Passa a existir `POST /auth/logout`,
que incrementa a versão — logo, derruba o desktop e o celular juntos.

A alternativa avaliada foi a **denylist de `jti`**, que daria logout por
dispositivo. Rejeitada, e não por custo:

No contexto de vocês — computador compartilhado, sala de treinamento — o
comportamento por dispositivo é **pior**. Pessoa loga na máquina compartilhada,
esquece de sair, vai embora, e em casa clica em "Sair" no notebook. Com versão,
a sessão esquecida morre. Com denylist por `jti`, ela continua viva: revogou-se o
token do notebook, não o da máquina compartilhada.

O cenário que a denylist resolveria — "sair do celular e continuar no desktop" —
não foi pedido por ninguém, e num time de 24 pessoas com um computador de
trabalho cada, não vai ser.

Somado a isso, adotá-la só para o logout deixaria **duas máquinas de revogação
convivendo** (a versão continua necessária para a D3), uma tabela nova, uma
consulta por requisição que a versão não precisa, e um terceiro job de limpeza no
n8n — com o mesmo modo de falha silenciosa dos outros dois.

**Nada fica fechado:** o claim `jti` já é emitido em todo token e segue sem uso.
No dia em que sessão por dispositivo for pedida, a denylist entra por cima, sem
desfazer nada desta spec.

⚠️ O front chama `clearTokens()` **antes** de saber se a rota respondeu, e
continua assim: se a rede cair no logout, a pessoa sai localmente e a sessão
morre no servidor da próxima vez. Logout não pode ficar preso esperando rede.

### D5 — Freio por conta conta **falha**, não tentativa

O balde por IP permanece exatamente como está (não se mexe no que funciona).
Entra um **segundo** balde, com chave `email + workspace_slug`.

Regras:

- Só **falha** de login registra no balde. Login certo **zera** o balde daquela conta.
- Falha em e-mail **inexistente** também registra, e a mensagem de erro continua
  sendo a mesma de senha errada. Senão o próprio limite vira sonda de enumeração
  de contas.
- **Janela deslizante, sem bloqueio permanente.** Consequência deliberada: alguém
  que saiba o e-mail da Monique consegue trancá-la fora por, no máximo, o tamanho
  da janela. Um bloqueio que só um humano destrava seria pior — viraria negação de
  serviço permanente contra qualquer pessoa cujo e-mail é público.
- Números iniciais: **10 falhas / 15 min por conta**. Ajustáveis por env, como os
  outros. Nunca vi ninguém errar a própria senha 10 vezes em 15 minutos.

### D6 — O mínimo continua em 8 caracteres

Avaliado subir para 12 e **descartado**, pelo motivo certo: com o freio por conta
da D5, o ataque realista não é força bruta de string aleatória — é chute. Chute
acha `Unifecaf2026` na vigésima tentativa, não na milionésima. Contra chute,
comprimento quase não ajuda; quem faz o trabalho é o freio.

Nada muda em `ChangePasswordRequest`. Esta decisão **retira** trabalho da spec.

#### D6-bis — Lista de recusa (OPCIONAL, decisão em aberto)

O freio impede o atacante de chutar muito; não impede a pessoa de **escolher**
`Unifecaf2026`. O que fecha isso não é comprimento, é uma lista curta de recusa:
nome da instituição, "senha", "marketing", sequências óbvias, o e-mail da própria
pessoa.

~15 linhas em `lib`-equivalente do backend, zero irritação para quem escolhe
senha decente, e barra exatamente o que seria tentado primeiro.

**Está fora do escopo até você dizer o contrário.** Se entrar, vira Fatia 3-bis
com dois testes; não mexe em migration nem em nada já decidido.

### D7 — O transporte é infra, não código

HTTPS obrigatório e cabeçalhos de segurança saem inteiramente em labels do
Traefik, no `docker-compose.prod.yml`. Zero linha de Python, zero de TypeScript,
zero teste automatizado — a validação é manual, no browser.

Por isso vira **fatia própria e independente**: sobe sozinha, antes ou depois das
outras, e o rollback é o arquivo antigo.

⚠️ **CSP fica fora desta spec.** O Next injeta script inline (inclusive o script
de tema em `app/layout.tsx`) e uma CSP sem nonce derruba a aplicação em branco,
sem erro visível. CSP é entrega própria, com nonce, testada em dev antes.

---

## Contexto — medido em 30/07

Medido no Adminer, pela Camila:

| | |
|---|---|
| Pendentes de troca de senha | **0** |
| Pendentes **e** ativos | **0** |
| Contas ativas | **24** |
| Total de contas | **24** |

**Três consequências:**

1. **Não há onda de "me deslogou" no deploy.** Ninguém vai trocar senha por
   obrigação logo depois de subir. A Fatia 1 pode ir em qualquer dia útil.
2. **O critério 6 fica mais importante, não menos.** As 24 contas estão com
   sessão viva agora. Se o token sem o claim `tv` for tratado como inválido, o
   deploy desloga o workspace inteiro de uma vez.
3. **O treinamento acabou.** O handoff registra `AUTH_RATE_LIMIT_MAX=60` como
   afrouxamento *temporário* para o treinamento, "reverter para 10 depois". Zero
   pendentes de troca é o sinal de que passou. Se o 60 chegou a ser aplicado,
   **voltar para 10** junto de qualquer uma destas fatias. Se nunca foi aplicado,
   já está em 10 e não há nada a fazer.

⚠️ **A tabela de usuários chama `users`**, não `user` — descoberto ao rodar esta
query. É a única tabela do schema no plural, porque `user` é palavra reservada no
Postgres. A migration da Fatia 1 usa o nome correto.

### Ainda não confirmado

- **A migration head em produção é `0006`?** A `0007` assume isso.
- **O `.env.prod` tem `TEMPORARY_PASSWORD_TTL_HOURS`?** Com 0 pendentes de troca,
  deixou de ser urgente — não há senha provisória em circulação para expirar.
  Continua valendo conferir antes do próximo lote de cadastros.

---

## Critérios de aceitação

**Revogação (D1–D4)**

1. Pessoa logada em dois browsers troca a senha num deles → o outro cai no
   próximo clique, não em 15 minutos.
2. O **refresh token** guardado antes da troca de senha é rejeitado.
3. Gestor reseta a senha de alguém → as sessões daquela pessoa caem; as das
   outras **não**.
4. `POST /auth/logout` → o refresh token daquela sessão para de funcionar.
5. Logout de uma pessoa **não** afeta sessão de ninguém mais.
6. Token emitido antes do deploy da migration continua valendo (versão 0 = 0).
   ⚠️ Este é o critério que evita deslogar as 24 contas no dia do deploy.
7. A checagem de versão **não** acrescenta query: contagem de queries por
   requisição autenticada igual antes e depois.

**Freio por conta (D5)**

8. 10 senhas erradas na mesma conta, de **IPs diferentes** → a 11ª é barrada.
   (Hoje passa.)
9. Login certo no meio da sequência zera o contador.
10. E-mail inexistente devolve **a mesma** mensagem e o **mesmo** status que
    senha errada, em todos os casos, inclusive quando o balde está cheio.
11. Conta bloqueada destrava sozinha ao fim da janela, sem intervenção.
12. O balde por IP continua funcionando como hoje.

**Transporte (D7)**

13. `http://task.srv1186064.hstgr.cloud` responde 301 para `https://`.
14. A resposta em https traz `strict-transport-security`, `x-frame-options` e
    `x-content-type-options`.
15. `/api` continua roteando para o backend (a prioridade 100 sobrevive à divisão
    em dois routers).
16. A aplicação carrega normalmente — nenhuma tela em branco.

## Fora de escopo

- **CSP** (D7): entrega própria, precisa de nonce.
- **MFA**: outro porte, e depende de canal externo que ainda não existe.
- Gestão de dispositivos / lista de sessões ativas (D1).
- Tirar o token do `localStorage` e pôr em cookie `HttpOnly`. É a correção de
  raiz do risco de XSS, e é reescrita do fluxo de auth inteiro nas duas pontas.
  Fica registrada aqui como a próxima da fila, não como parte desta.
- Trocar `--workers 2` ou o store do rate limit (decisão já aberta no handoff).
  ⚠️ Ela **atinge** o balde novo do mesmo jeito: com dois processos, o limite
  efetivo por conta também é até 2x o configurado. Números da D5 já contam com isso.
- Forçar troca de senha para quem já tem senha curta.
- Lista de recusa de senha óbvia (D6-bis) — **até você decidir**.

## Fronteira de risco

**Médio.** É a única spec desta série que mexe no caminho por onde passa **toda**
requisição autenticada. Um erro aqui não degrada uma tela: tranca as 24 pessoas
para fora.

Três pontos merecem atenção desproporcional:

- **O critério 6.** Se o token antigo (sem o claim de versão) for tratado como
  inválido em vez de versão 0, o deploy desloga todo mundo de uma vez — na semana
  do lançamento.
- **O critério 10.** Uma diferença de status, de mensagem ou de tempo de resposta
  entre "e-mail não existe" e "senha errada" transforma o freio novo numa lista
  de quem tem conta.
- **O HSTS do critério 14 é irreversível pelo servidor.** Uma vez que o browser
  recebeu o cabeçalho, ele recusa http naquele host pelo prazo do `max-age`, e
  isso não volta por deploy. Único passo desta spec sem rollback.
