"use client";
// Aba "Guia" da página de desenvolvedor (Spec 065): o essencial para começar, com exemplos.
// A lista completa das rotas é a aba Referência, gerada da própria API.

import { useEffect, useState, type ReactNode } from "react";
import { urlBaseDaApi } from "@/lib/api";

function Codigo({ children }: { children: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 text-md font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

export default function GuiaDaApi({ irPara }: { irPara: (aba: "chaves" | "webhooks" | "referencia") => void }) {
  // Só no navegador: o endereço da API pode ser o próprio site.
  const [base, setBase] = useState("https://seu-endereco");
  useEffect(() => setBase(urlBaseDaApi()), []);

  const link = (aba: "chaves" | "webhooks" | "referencia", texto: string) => (
    <button type="button" className="font-semibold text-accent underline" onClick={() => irPara(aba)}>
      {texto}
    </button>
  );

  return (
    <div className="flex max-w-[760px] flex-col gap-7 text-sm leading-relaxed">
      <Secao titulo="1. Crie uma chave">
        <p className="m-0">
          Na aba {link("chaves", "Chaves de API")}, crie uma chave. Ela age como você: vê e altera só o
          que você vê e altera na tela. Para relatório e painel, escolha <strong>Só ler</strong>.
        </p>
        <p className="m-0">Mande a chave no cabeçalho de toda chamada e teste se ela funciona:</p>
        <Codigo>{`curl ${base}/api/v1/me/assignments \\
  -H "Authorization: Bearer tm_SUA_CHAVE"`}</Codigo>
        <p className="muted m-0 text-xs">
          A resposta é a lista das suas tarefas. Se vier 401, a chave está errada, revogada ou vencida.
        </p>
      </Secao>

      <Secao titulo="2. Leia tarefas">
        <p className="m-0">
          As tarefas de um time e dos subtimes dele (o id do time está no endereço do quadro,
          <code> /quadro/ID_DO_TIME</code>):
        </p>
        <Codigo>{`curl "${base}/api/v1/tasks?under_team_id=ID_DO_TIME&size=100" \\
  -H "Authorization: Bearer tm_SUA_CHAVE"`}</Codigo>
        <p className="m-0">
          Os quadros que você vê, com as colunas de cada um (o <code>id</code> da coluna serve para
          mover):
        </p>
        <Codigo>{`curl ${base}/api/v1/boards -H "Authorization: Bearer tm_SUA_CHAVE"`}</Codigo>
      </Secao>

      <Secao titulo="3. Crie e mova tarefas">
        <p className="m-0">Precisa de uma chave de <strong>Ler e alterar</strong>. Criar:</p>
        <Codigo>{`curl -X POST ${base}/api/v1/tasks \\
  -H "Authorization: Bearer tm_SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Post do vestibular", "team_id": "ID_DO_TIME", "assignee_ids": ["ID_DA_PESSOA"]}'`}</Codigo>
        <p className="m-0">Mover para outra coluna do mesmo quadro:</p>
        <Codigo>{`curl -X PATCH ${base}/api/v1/tasks/ID_DA_TAREFA \\
  -H "Authorization: Bearer tm_SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"column_id": "ID_DA_COLUNA"}'`}</Codigo>
      </Secao>

      <Secao titulo="4. Solicitações">
        <p className="m-0">A fila de quem tria (o filtro aceita PENDING, APPROVED, IN_PROGRESS, DONE e REJECTED):</p>
        <Codigo>{`curl "${base}/api/v1/solicitacoes?status=PENDING" \\
  -H "Authorization: Bearer tm_SUA_CHAVE"`}</Codigo>
        <p className="m-0">
          Aprovar é <code>POST /api/v1/solicitacoes/ID/aprovar</code>; rejeitar é{" "}
          <code>POST /api/v1/solicitacoes/ID/rejeitar</code> com <code>{`{"note": "motivo"}`}</code>.
        </p>
      </Secao>

      <Secao titulo="5. No n8n">
        <p className="m-0">
          No nó <strong>HTTP Request</strong>, em <em>Authentication</em> escolha{" "}
          <em>Generic Credential Type → Header Auth</em>, com o nome <code>Authorization</code> e o valor{" "}
          <code>Bearer tm_SUA_CHAVE</code>. A URL e o corpo são os mesmos dos exemplos acima.
        </p>
      </Secao>

      <Secao titulo="6. Receba avisos (webhooks)">
        <p className="m-0">
          Na aba {link("webhooks", "Webhooks")}, cadastre a URL que vai receber os avisos e escolha os
          eventos. Cada aviso é um <code>POST</code> com JSON assim:
        </p>
        <Codigo>{`{
  "event": "task.moved",
  "delivery_id": "…",
  "occurred_at": "2026-11-19T18:30:00+00:00",
  "data": {
    "id": "…", "title": "Post do vestibular", "status": "IN_PROGRESS",
    "column": { "id": "…", "name": "Em andamento" },
    "previous_column": { "id": "…", "name": "A fazer" },
    "board_id": "…", "team_id": "…", "path": "/tarefa/…"
  }
}`}</Codigo>
        <p className="m-0">
          Para conferir que o aviso veio daqui, compare o cabeçalho <code>X-TM-Signature</code> com o
          HMAC-SHA256 do corpo, usando o segredo que apareceu ao criar o webhook:
        </p>
        <Codigo>{`// Node.js
const crypto = require("crypto");
const esperado = "sha256=" + crypto
  .createHmac("sha256", process.env.SEGREDO_DO_WEBHOOK)
  .update(corpoCru)            // o corpo como chegou, antes de virar objeto
  .digest("hex");
const confere = crypto.timingSafeEqual(
  Buffer.from(esperado), Buffer.from(req.headers["x-tm-signature"]));`}</Codigo>
        <p className="muted m-0 text-xs">
          O aviso é enviado uma vez. Se o destino estiver fora do ar ou demorar mais de 5 segundos, a
          falha fica no histórico do webhook. Depois de 20 falhas seguidas ele desliga sozinho.
        </p>
      </Secao>

      <Secao titulo="7. Quando dá erro">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>401</strong>: chave errada, revogada, vencida, ou a sua conta foi desativada.
          </li>
          <li>
            <strong>403</strong>: a chave é só de leitura, ou você não tem essa permissão naquele time.
            Chave também não cria chave nem webhook: isso é só pela tela.
          </li>
          <li>
            <strong>404</strong>: não existe, ou você não vê (a API não diz qual dos dois).
          </li>
          <li>
            <strong>409 e 422</strong>: o pedido veio errado; a mensagem diz o campo.
          </li>
          <li>
            <strong>429</strong>: chamadas demais em pouco tempo; espere um pouco.
          </li>
        </ul>
        <p className="m-0">
          Todas as rotas, com os campos de cada uma, estão na {link("referencia", "Referência")}.
        </p>
      </Secao>
    </div>
  );
}
