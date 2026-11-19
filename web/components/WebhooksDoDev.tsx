"use client";
// Aba "Webhooks" da página de desenvolvedor (Spec 065): criar, testar, ver entregas, pausar, apagar.

import { useEffect, useMemo, useState } from "react";
import { Plus, Send, Webhook as IconeWebhook } from "lucide-react";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Loading from "@/components/Loading";
import SegredoUmaVez from "@/components/SegredoUmaVez";
import { useAvisar } from "@/components/Toasts";
import {
  createWebhook,
  deleteWebhook,
  listBoards,
  listTeamsAll,
  listWebhookDeliveries,
  listWebhooks,
  pingWebhook,
  updateWebhook,
  type ApiError,
  type Quadro,
  type Team,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "@/lib/api";
import { dataHoraCurta } from "@/lib/prazo";

export const NOME_DO_EVENTO: Record<WebhookEvent | "ping", string> = {
  "task.created": "Tarefa criada",
  "task.moved": "Tarefa mudou de coluna",
  "solicitation.created": "Solicitação recebida",
  "solicitation.status_changed": "Solicitação mudou de situação",
  ping: "Teste",
};

const EVENTOS: WebhookEvent[] = [
  "task.created",
  "task.moved",
  "solicitation.created",
  "solicitation.status_changed",
];

/** Mesmo número do servidor (`FALHAS_PARA_DESLIGAR`). */
const FALHAS_PARA_DESLIGAR = 20;

export default function WebhooksDoDev() {
  const avisar = useAvisar();
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [quadros, setQuadros] = useState<Quadro[]>([]);
  const [criando, setCriando] = useState(false);
  const [segredo, setSegredo] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listWebhooks(), listTeamsAll(), listBoards()])
      .then(([h, t, q]) => {
        setHooks(h);
        setTimes(t);
        setQuadros(q);
      })
      .catch((e: ApiError) => {
        setHooks([]);
        avisar(e.message || "Não consegui carregar os webhooks.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Os times que a pessoa alcança: os que têm algum quadro visível para ela.
  const timesVisiveis = useMemo(() => {
    const comQuadro = new Set(quadros.map((q) => q.team_id));
    return times.filter((t) => comQuadro.has(t.id));
  }, [times, quadros]);

  const nomeDoTime = (id: string) => times.find((t) => t.id === id)?.name ?? "Time";
  const nomeDoQuadro = (id: string) => quadros.find((q) => q.id === id)?.name ?? "Quadro";

  function trocar(novo: Webhook) {
    setHooks((l) => l && l.map((h) => (h.id === novo.id ? novo : h)));
  }

  async function apagar(h: Webhook) {
    if (!window.confirm(`Apagar o webhook para ${h.url}?\n\nO destino para de receber os avisos.`)) return;
    try {
      await deleteWebhook(h.id);
      setHooks((l) => l && l.filter((x) => x.id !== h.id));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui apagar o webhook.");
    }
  }

  if (!hooks) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="muted m-0 max-w-[620px] flex-1 text-sm">
          Um webhook avisa outro sistema (n8n, Zapier, um script seu) quando algo acontece num time
          que você vê. Cada aviso vai assinado, e é enviado uma vez: se o destino estiver fora do ar,
          a falha fica no histórico.
        </p>
        {!criando && !segredo && (
          <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
            <Plus size={14} aria-hidden />
            Novo webhook
          </button>
        )}
      </div>

      {criando && (
        <FormularioDeWebhook
          times={timesVisiveis}
          quadros={quadros}
          onCancelar={() => setCriando(false)}
          onCriado={(h) => {
            setCriando(false);
            setSegredo(h.secret);
            const { secret: _, ...semSegredo } = h;
            setHooks((l) => [semSegredo, ...(l ?? [])]);
          }}
        />
      )}

      {segredo && (
        <SegredoUmaVez
          titulo="O segredo da assinatura. Guarde agora: depois ele não aparece de novo."
          rotulo="Segredo do webhook"
          valor={segredo}
          onPronto={() => setSegredo(null)}
        />
      )}

      {hooks.length === 0 ? (
        !criando && (
          <EmptyState
            title="Nenhum webhook ainda."
            description="Crie um para avisar outro sistema quando uma tarefa ou solicitação mudar."
          />
        )
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
          {hooks.map((h) => (
            <LinhaDoWebhook
              key={h.id}
              hook={h}
              ondeRecebe={`${nomeDoTime(h.team_id)}${h.board_id ? ` · ${nomeDoQuadro(h.board_id)}` : ""}`}
              onTrocou={trocar}
              onApagar={() => void apagar(h)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioDeWebhook({
  times,
  quadros,
  onCancelar,
  onCriado,
}: {
  times: Team[];
  quadros: Quadro[];
  onCancelar: () => void;
  onCriado: (h: Webhook & { secret: string }) => void;
}) {
  const [url, setUrl] = useState("https://");
  const [time, setTime] = useState(times[0]?.id ?? "");
  const [quadro, setQuadro] = useState("");
  const [eventos, setEventos] = useState<WebhookEvent[]>(["task.created"]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const quadrosDoTime = quadros.filter((q) => q.team_id === time);

  function alternar(e: WebhookEvent) {
    setEventos((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]));
  }

  async function criar() {
    if (!url.trim().startsWith("https://") || url.trim().length < 12) {
      setErro("A URL precisa começar com https://");
      return;
    }
    if (!time) {
      setErro("Escolha um time.");
      return;
    }
    if (eventos.length === 0) {
      setErro("Escolha ao menos um evento.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      onCriado(
        await createWebhook({ url: url.trim(), team_id: time, board_id: quadro || null, events: eventos }),
      );
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui criar o webhook.");
      setEnviando(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface-2 p-4"
      aria-label="Novo webhook"
      onSubmit={(e) => {
        e.preventDefault();
        void criar();
      }}
    >
      <div className="field">
        <label className="label" htmlFor="hook-url">
          URL de destino
        </label>
        <input
          id="hook-url"
          className="input max-w-[520px]"
          type="url"
          inputMode="url"
          value={url}
          maxLength={500}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="field">
          <label className="label" htmlFor="hook-time">
            Time
          </label>
          <select
            id="hook-time"
            className="input w-[220px]"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setQuadro("");
            }}
          >
            {times.map((t) => (
              <option key={t.id} value={t.id}>
                {t.parent_team_id ? `↳ ${t.name}` : t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="hook-quadro">
            Quadro <span className="font-normal text-ink-faint">(opcional)</span>
          </label>
          <select
            id="hook-quadro"
            className="input w-[220px]"
            value={quadro}
            onChange={(e) => setQuadro(e.target.value)}
          >
            <option value="">Todos os quadros</option>
            {quadrosDoTime.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted m-0 text-xs">Recebe o que acontece no time escolhido e nos subtimes dele.</p>
      <fieldset className="field m-0 border-0 p-0">
        <legend className="label mb-1.5">Avisar quando</legend>
        <div className="grid gap-1.5 text-sm min-[600px]:grid-cols-2">
          {EVENTOS.map((e) => (
            <label key={e} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={eventos.includes(e)} onChange={() => alternar(e)} />
              {NOME_DO_EVENTO[e]}
            </label>
          ))}
        </div>
      </fieldset>
      {erro && (
        <div className="error-box text-xs" role="alert">
          {erro}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          Criar webhook
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LinhaDoWebhook({
  hook: h,
  ondeRecebe,
  onTrocou,
  onApagar,
}: {
  hook: Webhook;
  ondeRecebe: string;
  onTrocou: (h: Webhook) => void;
  onApagar: () => void;
}) {
  const avisar = useAvisar();
  const [historico, setHistorico] = useState<WebhookDelivery[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const desligadoPorFalhas = !h.is_active && h.consecutive_failures >= FALHAS_PARA_DESLIGAR;

  async function carregarHistorico() {
    try {
      setHistorico(await listWebhookDeliveries(h.id));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui carregar o histórico.");
    }
  }

  async function testar() {
    setOcupado(true);
    try {
      const r = await pingWebhook(h.id);
      avisar(r.error ? `Teste falhou: ${r.error}` : `Teste entregue (${r.status_code}, ${r.duration_ms} ms).`);
      if (aberto) await carregarHistorico();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui enviar o teste.");
    } finally {
      setOcupado(false);
    }
  }

  async function ligar(ativo: boolean) {
    setOcupado(true);
    try {
      onTrocou(await updateWebhook(h.id, { is_active: ativo }));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui salvar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <IconeWebhook size={15} aria-hidden className="shrink-0 text-ink-faint" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="min-w-0 break-all text-sm">{h.url}</strong>
            {h.is_active ? (
              <Badge tone="soft" size="sm" color="var(--teal)">
                Ativo
              </Badge>
            ) : (
              <span className="text-xs font-semibold text-danger">
                {desligadoPorFalhas ? "Desligado por falhas" : "Pausado"}
              </span>
            )}
          </span>
          <span className="text-xs text-ink-faint">
            {ondeRecebe} · {h.events.map((e) => NOME_DO_EVENTO[e]).join(", ")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => void testar()}>
            <Send size={13} aria-hidden />
            Enviar teste
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={aberto}
            onClick={() => {
              setAberto((v) => !v);
              if (!aberto) void carregarHistorico();
            }}
          >
            Histórico
          </button>
          <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => void ligar(!h.is_active)}>
            {h.is_active ? "Pausar" : "Religar"}
          </button>
          <button
            type="button"
            className="btn btn-ghost text-danger"
            onClick={onApagar}
            aria-label={`Apagar o webhook ${h.url}`}
          >
            Apagar
          </button>
        </div>
      </div>
      {aberto && <Historico entregas={historico} />}
    </li>
  );
}

function Historico({ entregas }: { entregas: WebhookDelivery[] | null }) {
  if (!entregas) return <p className="muted m-0 text-xs">Carregando…</p>;
  if (entregas.length === 0) return <p className="muted m-0 text-xs">Nenhuma entrega ainda.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-2 text-ink-soft">
          <tr>
            <th className="px-3 py-1.5 font-semibold">Quando</th>
            <th className="px-3 py-1.5 font-semibold">Evento</th>
            <th className="px-3 py-1.5 font-semibold">Resultado</th>
            <th className="px-3 py-1.5 text-right font-semibold">Tempo</th>
          </tr>
        </thead>
        <tbody>
          {entregas.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="whitespace-nowrap px-3 py-1.5">{dataHoraCurta(e.delivered_at)}</td>
              <td className="px-3 py-1.5">{NOME_DO_EVENTO[e.event]}</td>
              <td className={`px-3 py-1.5 ${e.error ? "text-danger" : ""}`}>
                {e.error ?? `Entregue (${e.status_code})`}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right">{e.duration_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
