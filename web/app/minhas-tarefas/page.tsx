"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { STATUSES, PRIORITY_LABEL, PRIORITY_COLOR } from "@/lib/status";
import { listMyAssignments, ApiError, type MyTaskItem } from "@/lib/api";

const RELATION_LABEL: Record<string, string> = {
  assignee: "Responsavel",
  creator: "Criei",
  watcher: "Acompanho",
};
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

export default function MinhasTarefasPage() {
  return (
    <AppShell>
      <Minhas />
    </AppShell>
  );
}

function Minhas() {
  const [items, setItems] = useState<MyTaskItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listMyAssignments({ size: 100 })
      .then((r) => {
        // Camila (E9): esconder out_of_scope por ora -- essas tarefas dao 404
        // no detalhe (bug conhecido E6). Quando for tratar, troca este filtro.
        setItems(r.items.filter((t) => !t.out_of_scope));
      })
      .catch((e: ApiError) => setErro(e.message));
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <div className="muted">Carregando…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>Minhas tarefas</h1>
        <span className="muted" style={{ fontSize: 13 }}>{items.length} tarefas</span>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border)", borderRadius: 12, padding: 40,
            textAlign: "center", maxWidth: 480,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Voce esta em dia</p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Tarefas em que voce e responsavel, criador ou acompanha aparecem aqui.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, overflow: "hidden", maxWidth: 860,
          }}
        >
          {items.map((t, i) => (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <span
                title={STATUS_LABEL[t.status]}
                style={{
                  width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                  background: STATUS_COLOR[t.status] || "#999",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{t.title}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  {t.relations.map((r) => (
                    <span
                      key={r}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
                        background: "var(--surface-2)", color: "var(--text-soft)",
                      }}
                    >
                      {RELATION_LABEL[r] || r}
                    </span>
                  ))}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                  flexShrink: 0,
                  color: PRIORITY_COLOR[t.priority] || "var(--text-soft)",
                  background: (PRIORITY_COLOR[t.priority] || "#999") + "1a",
                }}
              >
                {PRIORITY_LABEL[t.priority] || t.priority}
              </span>
              {t.due_date && (
                <span className="muted" style={{ fontSize: 12, flexShrink: 0, width: 84, textAlign: "right" }}>
                  {new Date(t.due_date).toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
