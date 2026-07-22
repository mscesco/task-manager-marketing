# Spec 025 — Solicitações: formulário público, fila agrupada por envio e trava de acesso

## Objetivo
Dar ao time de marketing um canal único de entrada de demandas, substituindo
pedido por WhatsApp/corredor:

- **Formulário público** (sem login) com as 11 categorias do FazAê, multi-seleção
  e rascunho local.
- **Fila de triagem agrupada por ENVIO** — um card por submissão, com os dados de
  quem pediu e a lista do que pediu; abrindo, seção por seção.
- **Aprovação por seção**, independente entre irmãs do mesmo envio.
- **Rastreio de "tarefa criada"**, porque aprovar não cria tarefa.
- **Acesso restrito a ADMIN e MANAGER**, leitura inclusive.

> Esta spec é **retroativa**: o código foi escrito antes dela, ao longo de várias
> iterações, e é justamente por isso que gerou três migrations para uma feature
> só. Nada foi commitado nem subiu pra produção. A spec redesenha o alvo; a
> implementação existente é insumo, não gabarito.

## O que já existe (reuso, não invento)
- **Spec 024 (pré-requisito):** com ADMIN/MANAGER existindo **só no time raiz**,
  `solicitation.review` no mapa estático já significa "admin ou manager do time
  pai". Sem permissão derivada de contexto, sem checagem de raiz espalhada pelo
  módulo.
- **Rate limit:** `SlidingWindowRateLimiter` + `rate_limit()` (usado no login).
  Ganha um balde próprio, não compartilha com auth.
- **Multi-tenant:** `BaseRepository._base_select()` já filtra workspace e
  levanta se não houver contexto.
- **UoW / erros / paginação:** `UnitOfWork`, `_STATUS_MAP` de exceção→HTTP,
  `PageParams.offset/limit` — tudo padrão da casa.
- **Front:** `me.permissions.includes(...)` já é o padrão para esconder ação
  (Membros, Projetos). A aba segue o mesmo caminho, sem inventar mecanismo.

## Decisões cravadas
- **D1 — Uma migration só.** As três anteriores (`0004_solicitations`,
  `0005_solicitation_batch`, `0006_solicitation_task`) são descartadas e
  reescritas como **uma** migration com o schema final. Possível porque nada foi
  para produção. Custo: o downgrade **dropa a tabela** e as solicitações de teste
  do dev são perdidas.
- **D2 — Entrada pública, sem conta.** Quem pede é coordenador de polo,
  professor, RH — gente sem login. É a única rota de escrita sem credencial além
  do auth. Defesas, nesta ordem: rate limit por IP (balde próprio, janela
  longa), honeypot com descarte silencioso, limites de tamanho no schema,
  categoria validada contra o domínio, workspace resolvido por slug com 404
  genérico (não enumera slugs).
- **D3 — Anexo é LINK, não upload.** Não existe infraestrutura de storage no
  projeto. Campo de URL do Drive resolve hoje; upload nativo é spec própria.
- **D4 — Multi-seleção: uma linha por categoria, um POST só.** Cada categoria
  vira solicitação independente (SLA, triagem e tarefa próprios), amarradas por
  `batch_id` que gera o protocolo único do solicitante. **Um único POST** com N
  itens: o rate limit é por IP, então N requests bloqueariam a pessoa no meio do
  próprio pedido. `batch_seq` preserva a ordem de seleção.
- **D5 — Criação é tudo-ou-nada; triagem é uma-a-uma.** Categoria inválida no
  meio aborta o envio inteiro (ninguém fica com meio pedido no ar). Mas aprovar a
  arte e rejeitar a divulgação do mesmo envio é o caso de uso central.
- **D6 — Paginação por ENVIO, não por linha.** Paginar por linha partiria um
  envio ao meio entre páginas. `total` conta submissões. Página de **10 envios**
  (com card agrupado, dez já enchem a tela).
- **D7 — Filtro com lote misto usa `HAVING`, não `WHERE`.** O envio aparece se
  **qualquer** demanda dele casar, e o card mostra **todas** as seções, inclusive
  as que não casam. Esconder o pendente que está junto de dois aprovados seria
  pior que mostrar demais.
- **D8 — Rejeição exige justificativa.** É o único registro do porquê: o
  solicitante não tem conta nem recebe notificação. Guard no service **e**
  `CHECK` no banco.
- **D9 — Aprovar NÃO cria tarefa.** Decisão de produto. Mitigação do buraco que
  isso abre: marcação autodeclarada de "tarefa criada" + filtro **"aprovadas sem
  tarefa"**. O valor está no negativo — a lista do que foi aceito e nunca entrou
  no quadro. `CHECK`: só `APPROVED` pode ter tarefa. Botão "copiar briefing"
  reduz o custo do passo manual.
- **D10 — `answers` em JSONB (par label/valor).** O formulário tem 11
  ramificações e vai mudar. Coluna a coluna geraria migration por ajuste de
  texto. Validação campo a campo fica no front; o backend valida identificação,
  categoria e tamanho.
- **D11 — Acesso restrito a ADMIN e MANAGER, leitura inclusive.** O `GET` da fila
  passa a exigir `solicitation.review` (hoje qualquer autenticado lê). SUPERVISOR
  **perde** o acesso que tem hoje. A aba some do menu para quem não tem a
  permissão. A rota pública continua aberta — ela é a entrada, não a fila.
- **D12 — Travado no marketing, sem generalização especulativa.** Formulário
  genérico é produto (definição em banco, versionamento, fila e revisor por
  formulário), não feature. O desenho atual já tolera um segundo formulário
  barato: `answers` é JSONB e a definição é config TS. Retrofitar `form_slug`
  depois custa uma migration com backfill trivial.

## Riscos residuais
- **R1 — SLAs indefinidos.** Evento, revisão e impressão estão com "XX dias
  úteis" no PDF de origem. O formulário exibe "prazo em definição". Divulgar o
  link assim entrega um formulário que não promete nada — e o pedido de última
  hora continua chegando. **Bloqueia a divulgação, não o código.**
- **R2 — O solicitante nunca é avisado.** Sem conta e sem notificação, ele só
  descobre aprovação/rejeição se alguém contar. D11 **piora** isso: menos gente
  com acesso à fila = menos gente para avisar de boca. É o furo mais antigo e
  segue sem dono.
- **R3 — A marcação de tarefa vai descolar da realidade.** Alguém aprova, cria a
  tarefa e esquece de marcar; o filtro acusa falso positivo e o time aprende a
  ignorá-lo. Só some de verdade se a aprovação criar a tarefa (descartado em D9).
  Aceito consciente.
- **R4 — Payload do card.** D6+D7 trazem `answers` de todas as seções no card.
  Teto teórico: 10 envios × 11 seções × 60 respostas de 5.000 chars. Irreal na
  prática, mas sem trava. Mitigado por `size=10`; se doer, vira carregamento sob
  demanda.
- **R5 — Unidades misturadas na resposta.** `total` conta envios,
  `pending_total` conta demandas. Se a UI escrever os dois como "12" sem rótulo,
  confunde. Rotular sempre.
- **R6 — Rascunho é por navegador.** `localStorage`: começar no celular e
  terminar no desktop não funciona; aba anônima com storage bloqueado não salva
  (degrada em silêncio, não quebra). Preço de não gravar nada no servidor antes
  do envio — que é o que impede rascunho de virar lixo na fila.
- **R7 — Migration no deploy.** `alembic upgrade head`. Ponto de falha canônico.
- **R8 — Divergências do PDF de origem.** "Sessão de Fotos" tinha seção completa
  mas não estava no menu; o menu dizia só "e-mail" e a seção dizia "e-mail ou
  WhatsApp". Ambas corrigidas na config. **Precisa de aval de quem escreveu o
  formulário** — se as omissões eram intencionais, é ajuste de uma linha.

## Fora de escopo
- Upload nativo de arquivo (D3).
- Criação automática de tarefa na aprovação (D9).
- Notificação ao solicitante (R2) — merece spec própria.
- Formulário genérico / múltiplos formulários (D12).
- Reabrir solicitação já triada: o formulário é público e barato, reenvia.

## Critérios de aceite

**Formulário público**
1. Envio de uma categoria → 201 com protocolo; linha `PENDING` no workspace do
   slug; e-mail normalizado em minúsculas.
2. Multi-seleção de 3 categorias → 3 linhas, mesmo `batch_id`, `batch_seq` 1–3 na
   ordem de seleção, um protocolo só, **um POST só**.
3. Categoria inválida no meio de um envio → nada gravado (tudo-ou-nada).
4. Categoria repetida no mesmo envio → 422.
5. Honeypot preenchido → 201 indistinguível do sucesso, **nada persistido**.
6. Slug de workspace desconhecido → 404 genérico.
7. Estouro do rate limit no mesmo IP → 429.
8. Rascunho: recarregar a página oferece continuar; enviar limpa; expira em 7
   dias; storage bloqueado não quebra o formulário.

**Fila de triagem**
9. Envio com 3 categorias → 1 card, 3 tópicos, 3 status independentes.
10. Aprovar a arte e rejeitar a divulgação do mesmo envio → card mostra os dois
    estados.
11. Paginação nunca parte um envio entre páginas; `total` conta envios.
12. Filtro "Pendentes" traz envio com 1 pendente + 2 aprovadas, exibindo as 3
    seções (D7).
13. Rejeição sem justificativa → 422, permanece `PENDING`.
14. Triagem dupla (aprovar já aprovada) → 409.
15. Marcar tarefa em `PENDING`/`REJECTED` → 409 (e `CHECK` no banco recusa).
16. Filtro "aprovadas sem tarefa" lista exatamente `APPROVED` com
    `task_created_at IS NULL`.

**Acesso (D11)**
17. OPERATOR → 403 ao **listar**, ao aprovar, ao rejeitar e ao marcar tarefa.
18. SUPERVISOR → 403 nos mesmos pontos (perde o acesso atual, intencional).
19. ADMIN e MANAGER → 200/2xx em todos.
20. Aba "Solicitações" não aparece no menu para quem não tem
    `solicitation.review`; acesso direto pela URL trata 403 sem tela quebrada.
21. Rota pública continua acessível **sem** token.
22. Isolamento de tenant: envio do workspace A invisível e não-triável no B.
