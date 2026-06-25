"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  listArchivedTasks,
  reactivateTask,
  ApiError,
  type Task,
} from "@/lib/api";
import { STATUSES } from "@/lib/status";

// Tela de arquivadas (Spec 013, fatia 4). Lista paginada de tarefas
// arquivadas (manuais ou pela varredura) + reativar (volta pra BACKLOG e
// desarquiva). Pagina de verdade: o conjunto cresce sem fim.

const PAGE_SIZE = 30;

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

export default function ArquivadasPage() {
  return (
    <AppShell>
      <Arquivadas />
    </AppShell>
  );
}

function Arquivadas() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(p: number) {
    setErro(null);
    try {
      const r = await listArchivedTasks({ page: p, size: PAGE_SIZE });
      setTasks(r.items);
      setTotal(r.total);
      setPage(r.page);
      // Se a pagina ficou vazia apos reativar a ultima e nao e a 1a, recua.
      if (r.items.length === 0 && r.page > 1) {
        carregar(r.page - 1);
      }
    } catch (e) {
      setErro((e as ApiError).message || "Nao consegui carregar as arquivadas.");
    }
  }

  useEffect(() => {
    carregar(1);
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (erro) return <div className="error-box" style={{ maxWidth: 560 }}>{erro}</div>;
  if (!tasks) return <div className="muted">Carregando arquivadas…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>Arquivadas</h1>
        <span className="muted" style={{ fontSize: 13 }}>{total}</span>
      </div>

      {tasks.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 40, textAlign: "center", maxWidth: 480 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Nenhuma tarefa arquivada</p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Tarefas concluídas ou canceladas antigas aparecem aqui.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {tasks.map((t, i) => (
            <LinhaArquivada
              key={t.id}
              t={t}
              primeira={i === 0}
              onReativou={() => carregar(page)}
            />
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => carregar(page - 1)}
            style={{ padding: "6px 12px" }}
          >
            ← Anterior
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Página {page} de {totalPaginas}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPaginas}
            onClick={() => carregar(page + 1)}
            style={{ padding: "6px 12px" }}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}

function LinhaArquivada({
  t,
  primeira,
  onReativou,
}: {
  t: Task;
  primeira: boolean;
  onReativou: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function reativar() {
    setBusy(true);
    setErro(null);
    try {
      await reactivateTask(t.id);
      onReativou();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Você não tem permissão para reativar esta tarefa."
          : a.message || "Não consegui reativar."
      );
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px",
        borderTop: primeira ? "none" : "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.title}
          </div>
        </div>
        <span style={{
          fontSize: 12, padding: "3px 9px", borderRadius: 999, flexShrink: 0,
          color: STATUS_COLOR[t.status] || "var(--text-soft)",
          border: `1px solid ${STATUS_COLOR[t.status] || "var(--border)"}`,
        }}>
          {STATUS_LABEL[t.status] || t.status}
        </span>

        {!confirmar && (
          <button
            className="btn btn-ghost"
            onClick={() => { setErro(null); setConfirmar(true); }}
            style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
          >
            Reativar
          </button>
        )}
      </div>

      {confirmar && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Reativar <strong>{t.title}</strong>? Volta ao quadro em <strong>Backlog</strong>.
          </span>
          <button className="btn btn-primary" onClick={reativar} disabled={busy} style={{ padding: "4px 12px", fontSize: 12 }}>
            {busy ? "…" : "Reativar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmar(false)} disabled={busy} style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {erro && <div className="error-box">{erro}</div>}
    </div>
  );
}
