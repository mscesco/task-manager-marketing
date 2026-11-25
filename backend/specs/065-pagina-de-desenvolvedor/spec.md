# Spec 065 — Página de desenvolvedor: API e chaves

**Status:** aprovada por ela em 19/11/2026 (decisões 1 a 7 e os padrões) e entregue no PR #156.
**25/11:** os webhooks saíram da entrega, a pedido dela. Fica só a API.

Pedido dela (19/11): "|FEAT| Página de desenvolvedor: instruções de API,
webhooks e integrações externas".

## Como é hoje

- **Entrar pela API** só com o login da tela: `POST /auth/login` devolve um
  token de 15 minutos e um de renovação de 7 dias. Não há chave por pessoa.
- **Token de sistema** (`X-System-Token`, no `.env`): só para os jobs do n8n
  (`/system/...`: arquivar, prazos, limpezas). Não age como pessoa.
- **Um webhook de saída**, fixo no `.env` (`N8N_WEBHOOK_URL`): avisa o n8n
  quando muda o status de uma solicitação. Uma tentativa, sem tela.
- **Documentação:** em produção o `/docs` automático está desligado de
  propósito (não expor o mapa da API a quem não entrou).

## Decisões (19/11, dela)

1. Guia, chaves de API e referência.
2. **Todos usam.** Cada pessoa cria as próprias chaves, que agem com as
   permissões **dela**.
3. **Chave só leitura ou leitura e escrita**, escolhido ao criar.
4. **Validade escolhida ao criar:** 30, 90 (padrão) ou 365 dias, ou sem
   validade.
5. Mora **dentro do perfil**; a referência das rotas é **gerada da própria
   API** e só aparece para quem entrou.

## O que entrega

### Onde aparece

No `/perfil`, um cartão novo **"Desenvolvedor"** com um texto curto e o botão
**"Abrir"**, que leva a `/perfil/desenvolvedor` **(padrão: página própria,
porque o guia e a referência são longos demais para um cartão)**. A página
tem três abas: **Guia**, **Chaves de API** e **Referência**.

### Chaves de API

- **Criar:** nome ("Painel do Looker"), poder (só leitura / leitura e
  escrita) e validade. A chave aparece **uma vez só**, com botão de copiar e
  o aviso "guarde agora; depois não dá para ver de novo".
- **Lista:** nome, começo da chave (`tm_a1b2…`), poder, criada em, expira em,
  usada pela última vez. **Revogar** com confirmação.
- **Usar:** `Authorization: Bearer tm_…`, o mesmo cabeçalho do login. A chave
  entra no mesmo ponto em que o servidor descobre quem é a pessoa, então
  todas as regras de time, lente e permissão valem sem código novo.
- **Só leitura** recusa qualquer coisa que não seja `GET` (403 "Esta chave é
  só de leitura").
- **(padrão) Chave não mexe em chave nem em senha.** Essas
  rotas exigem o login da tela. Uma chave vazada não consegue criar outra
  para se perpetuar.
- **Chave consulta pessoas, mas não altera** (`/members`): criar conta ou
  resetar senha devolve uma senha provisória.
- **Reset de senha por quem administra revoga as chaves da conta.**
- **(padrão) Até 10 chaves ativas por pessoa.**
- Pessoa desativada: as chaves param na hora (já é a regra do login).
  **(padrão) Trocar a senha não mata as chaves**; revogar é explícito.
- O servidor guarda só o *hash* da chave, nunca a chave.

### Guia

Escrito à mão, curto, com exemplos em `curl` e no nó HTTP Request do n8n:
criar uma chave e autenticar; listar tarefas de um quadro; criar tarefa;
mover de coluna; listar e mudar solicitações; erros comuns (401, 403, 422, 429).

### Referência

Lista de todas as rotas, agrupadas por assunto, com método, caminho, para
que serve e os campos. Vem de uma rota nova, `GET /dev/openapi`, que exige
login e tira as rotas `/system`. Como é gerada da API, não fica
desatualizada.

## Fora desta spec

- Escopos por recurso (tarefas, solicitações...) nas chaves.
- Webhooks configuráveis pela pessoa. O aviso de status fixo no `.env`
  continua como está.
- Integrações prontas com serviços específicos: é a conversa seguinte.

## Fatias (um PR, um commit por fatia)

- **A. Chaves (servidor):** migration `0038` (`api_key`), rotas
  `/me/api-keys`, chave no `get_tenant_context`, bloqueio do só leitura e
  das rotas de conta, testes (inclusive a linha na matriz de permissões).
- **B. Página e aba Chaves:** o cartão no perfil, `/perfil/desenvolvedor` com
  as abas, e a aba Chaves.
- **E. Guia e Referência:** o texto, `GET /dev/openapi` e a lista gerada.

**Deploy:** a migration `0038` só cria tabela; vai antes do código.
