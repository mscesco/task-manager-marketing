# Spec 065 — Página de desenvolvedor: API, chaves e webhooks

**Status:** aprovada por ela em 19/11/2026 (decisões 1 a 7 e os padrões) e entregue no PR #156.

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

1. **Tudo:** guia, chaves de API e webhooks configuráveis.
2. **Todos usam.** Cada pessoa cria as próprias chaves e webhooks, que agem
   com as permissões **dela**.
3. **Chave só leitura ou leitura e escrita**, escolhido ao criar.
4. **Validade escolhida ao criar:** 30, 90 (padrão) ou 365 dias, ou sem
   validade.
5. **Webhook só recebe o que o dono vê:** escolhe um time (e, se quiser, um
   quadro) entre os que enxerga. Eventos: **tarefa criada**, **tarefa
   movida de coluna** (inclui concluir), **solicitação recebida** e
   **solicitação mudou de status**.
6. **Uma tentativa só** por evento; a falha fica no histórico.
7. Mora **dentro do perfil**; a referência das rotas é **gerada da própria
   API** e só aparece para quem entrou.

## O que entrega

### Onde aparece

No `/perfil`, um cartão novo **"Desenvolvedor"** com um texto curto e o botão
**"Abrir"**, que leva a `/perfil/desenvolvedor` **(padrão: página própria,
porque o guia e a referência são longos demais para um cartão)**. A página
tem quatro abas: **Guia**, **Chaves de API**, **Webhooks** e **Referência**.

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
- **(padrão) Chave não mexe em chave nem webhook, nem em senha.** Essas
  rotas exigem o login da tela. Uma chave vazada não consegue criar outra
  para se perpetuar.
- **(padrão) Até 10 chaves ativas por pessoa.**
- Pessoa desativada: as chaves param na hora (já é a regra do login).
  **(padrão) Trocar a senha não mata as chaves**; revogar é explícito.
- O servidor guarda só o *hash* da chave, nunca a chave.

### Webhooks

- **Criar:** URL (`https://`), time (e quadro, opcional) e os eventos. O
  servidor gera um **segredo**, mostrado uma vez, para o destino conferir a
  assinatura.
- **Cada entrega:** `POST` com JSON
  `{ "event": "task.moved", "occurred_at": "…", "data": { … } }` e os
  cabeçalhos `X-TM-Event`, `X-TM-Delivery` e
  `X-TM-Signature: sha256=<HMAC do corpo com o segredo>`.
- **Na hora em que vai sair, confere de novo** se o dono está ativo e ainda
  vê o time. Se não, não envia.
- **Não atrasa a tela:** o envio sai depois de gravar, fora da resposta.
  Espera até 5 s pelo destino.
- **Histórico:** as últimas 50 entregas de cada webhook: quando, evento,
  código de resposta, tempo, erro. Botão **"Enviar teste"** (um `ping`).
- **(padrão) Desliga sozinho depois de 20 falhas seguidas**, e a tela mostra
  "Desligado por falhas — religar".
- **(padrão) Até 10 webhooks por pessoa.**
- **Proteção:** só `https`, sem seguir redirecionamento, e recusa endereço de
  rede interna (localhost, 10.x, 192.168.x, 172.16–31.x, 169.254.x, etc.),
  conferido depois de resolver o nome. Sem isso, qualquer pessoa usaria o
  servidor para chamar o Postgres ou o n8n por dentro da VPS.
- O aviso de status fixo no `.env` **continua como está**.

### Guia

Escrito à mão, curto, com exemplos em `curl` e no nó HTTP Request do n8n:
criar uma chave e autenticar; listar tarefas de um quadro; criar tarefa;
mover de coluna; listar e mudar solicitações; receber um webhook e conferir
a assinatura (exemplo em Node e no n8n); erros comuns (401, 403, 422, 429).

### Referência

Lista de todas as rotas, agrupadas por assunto, com método, caminho, para
que serve e os campos. Vem de uma rota nova, `GET /dev/openapi`, que exige
login e tira as rotas `/system`. Como é gerada da API, não fica
desatualizada.

## Fora desta spec

- Escopos por recurso (tarefas, solicitações...) nas chaves.
- Reenvio automático e reenvio manual de entregas.
- Outros eventos (comentário, projeto, Base).
- Integrações prontas com serviços específicos: é a conversa seguinte.

## Fatias (um PR, um commit por fatia)

- **A. Chaves (servidor):** migration `0038` (`api_key`), rotas
  `/me/api-keys`, chave no `get_tenant_context`, bloqueio do só leitura e
  das rotas de conta, testes (inclusive a linha na matriz de permissões).
- **B. Página e aba Chaves:** o cartão no perfil, `/perfil/desenvolvedor` com
  as abas, e a aba Chaves.
- **C. Webhooks (servidor):** migration `0039` (`webhook`,
  `webhook_delivery`), rotas `/me/webhooks`, emissão nos quatro eventos,
  assinatura, proteção de rede interna, testes.
- **D. Aba Webhooks:** criar, lista, histórico, enviar teste.
- **E. Guia e Referência:** o texto, `GET /dev/openapi` e a lista gerada.

**Deploy:** as duas migrations só criam tabelas; vão antes do código.
