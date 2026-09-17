"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  ApiError,
  type AppNotification,
} from "@/lib/api";
import { destinoDaNotificacao, textoDaNotificacao } from "@/lib/notificacoes";

import Loading from "@/components/Loading";
// Sino de notificacoes (Spec 018, Front-B). Polla a contagem de nao-lidas
// a cada 30s (pausando quando a aba esta em background) e, ao abrir, busca
// o feed. Clicar numa notificacao marca lida (otimista) e navega pro destino
// resolvido em `lib/notificacoes`.
//
// O destino era `/minhas-tarefas?task=<id>`, sob a premissa de que "a task
// sempre esta la, porque o destinatario e sempre responsavel dela". A
// premissa vale para TASK_ASSIGNED e FALHA para TASK_MENTIONED e
// TASK_COMMENTED -- mencao e comentario alcancam quem nao e responsavel, a
// tarefa nao esta na lista, e o clique nao abria nada. Agora vai para a rota
// canonica `/tarefa/<id>`, que busca por id e nao depende de lista.

const POLL_MS = 30_000;

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
    let id: ReturnType<typeof setInterval> | null = null;
    function parar() {
      parado = true;
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }
    async function tick() {
      // Sessao ja encerrada (401 anterior): nao dispara mais requisicao.
      // Cobre o caminho do visibilitychange, que chama tick() a cada foco de
      // aba independente do intervalo ja ter sido limpo em parar().
      if (parado) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const n = await getUnreadCount();
        if (!parado) setUnread(n);
      } catch (e) {
        // Sessao morta (401): PARA de pollar. Sem isto, um token invalido
        // (ex.: logout em outra aba) fazia o sino martelar /unread-count a
        // cada 30s pra sempre -- o wrapper do api so redireciona pro login
        // quando AINDA ha token, entao o caso "sem token" ficava em loop
        // silencioso. Aqui cortamos o loop. Outros erros: silencioso, o
        // badge nunca derruba a tela.
        if (e instanceof ApiError && e.status === 401) {
          parar();
          return;
        }
      }
    }
    tick();
    id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
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
    // `/tarefa/<id>` e uma rota propria: o push remonta a pagina e o effect
    // dela (dep `[id]`) busca a tarefa. Nao ha mais o caso "ja estou na
    // pagina e a query so mudou", entao o CustomEvent "abrir-tarefa" que
    // existia aqui saiu -- ele so cobria aquele caso. O listener em
    // /minhas-tarefas continua no lugar: ele ainda serve ao deep-link
    // `?task=` de links antigos que ja circularam.
    router.push(destinoDaNotificacao(n));
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
          <span
            className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[16px]"
            style={{ color: "var(--on-danger)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <strong className="text-sm">Notificações</strong>
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
              <div className="px-3 py-6">
                <Loading tamanho="linha" rotulo="Carregando as notificações" />
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
                    <span className="block text-base text-ink">{textoDaNotificacao(n)}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {/* Spec 053 (C): a ultima mudanca, se avisos se juntaram. */}
                      {quando(n.updated_at ?? n.created_at)}
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
