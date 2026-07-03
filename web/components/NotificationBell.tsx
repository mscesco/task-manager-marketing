"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/api";

// Sino de notificacoes (Spec 018, Front-B). Polla a contagem de nao-lidas
// a cada 30s (pausando quando a aba esta em background) e, ao abrir, busca
// o feed. Clicar numa notificacao marca lida (otimista) e navega pro
// deep-link E6-safe: /minhas-tarefas?task=<id> (a task sempre esta la,
// porque o destinatario e sempre responsavel dela).

const POLL_MS = 30_000;

function texto(n: AppNotification): string {
  const ator = n.payload?.actor_name || "Alguem";
  const task = n.payload?.task_title || "uma tarefa";
  if (n.type === "TASK_ASSIGNED") return `${ator} designou voce em "${task}"`;
  if (n.type === "TASK_COMMENTED") return `${ator} comentou em "${task}"`;
  if (n.type === "TASK_MENTIONED") return `${ator} mencionou voce em "${task}"`;
  return `Atualizacao em "${task}"`;
}

// created_at vem como ISO COMPLETO com timezone -> new Date() e seguro aqui
// (o bug de UTC so afeta strings date-only "YYYY-MM-DD").
function quando(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [carregando, setCarregando] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Poll do badge (pausa em background).
  useEffect(() => {
    let parado = false;
    async function tick() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const n = await getUnreadCount();
        if (!parado) setUnread(n);
      } catch {
        /* silencioso: o badge nunca deve quebrar a tela */
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parado = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const alternar = useCallback(async () => {
    const abrindo = !open;
    setOpen(abrindo);
    if (abrindo) {
      setCarregando(true);
      try {
        const r = await listNotifications({ page: 1, size: 20 });
        setItems(r.items);
      } catch {
        setItems([]);
      } finally {
        setCarregando(false);
      }
    }
  }, [open]);

  async function clicar(n: AppNotification) {
    setOpen(false);
    if (n.read_at === null) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
        )
      );
      setUnread((u) => Math.max(0, u - 1));
      markNotificationRead(n.id).catch(() => {});
    }
    router.push(n.task_id ? `/minhas-tarefas?task=${n.task_id}` : "/minhas-tarefas");
    // Se ja estamos em /minhas-tarefas, o push acima so troca a query e NAO
    // remonta a pagina -> o deep-link de mount nao roda. Este evento abre o
    // detalhe na hora nesse caso. Vindo de outra rota, ninguem escuta ainda
    // (pagina nao montada) e o mount le a query -- os dois caminhos se cobrem.
    if (n.task_id) {
      window.dispatchEvent(
        new CustomEvent("abrir-tarefa", { detail: { id: n.task_id } })
      );
    }
  }

  async function marcarTodas() {
    setItems((prev) =>
      prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() }))
    );
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch {
      /* otimista; se falhar, o proximo poll corrige o badge */
    }
  }

  const temNaoLida = items.some((x) => x.read_at === null);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={alternar}
        aria-label="Notificacoes"
        title="Notificacoes"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-2"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[16px] text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <strong className="text-sm">Notificacoes</strong>
            {temNaoLida && (
              <button
                type="button"
                onClick={marcarTodas}
                className="text-xs font-semibold text-accent"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {carregando ? (
              <div className="px-3 py-6 text-center text-sm text-ink-faint">
                Carregando…
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-ink-faint">
                Nada por aqui ainda.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => clicar(n)}
                  className={`flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2 ${
                    n.read_at === null ? "bg-accent-soft" : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.read_at === null ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base text-ink">{texto(n)}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {quando(n.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
