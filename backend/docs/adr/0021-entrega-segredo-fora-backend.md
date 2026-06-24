# ADR 0021 — Entrega do segredo fica fora do backend (B agora, A documentada)

Accepted

## Contexto

A senha temporária (ADR 0019) precisa chegar ao usuário. Onde a entrega vive?
Opções avaliadas:

- **B — backend devolve o segredo na resposta, uma vez.** O `POST /members`
  (e o reset) retorna `temporary_password` no corpo. Quem entrega (admin via
  WhatsApp, ou uma automação externa) consome essa resposta. O backend não
  conhece nem chama o canal de entrega.
- **A — backend dispara webhook pós-commit** para uma automação (n8n → Gmail)
  com `{email, name, temporary_password}`.

Restrição de arquitetura que vale pras duas: o disparo de entrega **não pode
viver dentro da transação** do `create_member`. O padrão do projeto é
UnitOfWork que comita no fim; acoplar a criação do membro à saúde de um serviço
externo (Gmail/n8n fora do ar → cadastro falha) é dependência indevida do core.

## Decisão

A E7 implementa **apenas a B**: o segredo é devolvido **uma vez** na resposta da
rota; entrega é responsabilidade externa. Zero código de integração no backend,
zero acoplamento. Adequado ao momento (validação manual, volume baixo).

A **A** fica **documentada como gancho futuro**, não implementada: quando a
entrega manual cansar, adiciona-se um disparo **best-effort após o commit** —
fora da transação, e cuja falha **não desfaz** o cadastro (o membro já existe;
reenvia-se depois). É uma entrega curta e isolada, que não obriga a refazer a E7.

## Alternativas rejeitadas

- **Webhook dentro da transação.** Acopla cadastro à disponibilidade do
  terceiro; estado parcial em falha. Rejeitado terminantemente.
- **Implementar a A já na E7.** Sem ganho real enquanto o volume é manual;
  adia o fechamento da E7 por uma dependência externa (n8n/Gmail).

## Consequências

- **Positiva:** E7 fecha sem nenhuma linha de integração; o segredo trafega só
  na resposta HTTP autenticada (TLS) e some depois.
- **Risco aceito:** o `temporary_password` aparece em claro na resposta — logo,
  em qualquer log de request que capture corpo de resposta. Recomendação
  operacional: **não logar corpo de resposta** do `POST /members` e do
  `reset-password`. (Verificar o middleware de logging na implementação.)
- A A, quando vier, herda o risco de "segredo em e-mail" — mitigado por
  expiração curta (ADR 0019) e caixa de entrega controlada. Reavaliar se o
  alias de e-mail deixar de ser restrito.
