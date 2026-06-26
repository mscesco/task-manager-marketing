"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import { STATUSES, PRIORITY_LABEL, PRIORITY_COLOR } from "@/lib/status";
import {
  listMyAssignments,
  listMembers,
  ApiError,
  type Task,
  type MyTaskItem,
} from "@/lib/api";

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
  const [members, setMembers] = useState<Map<string, { name: string }>>(new Map());
  const [erro, setErro] = useState<string | null>(null);

  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  const [editando, setEditando] = useState<Task | null>(null);

  useEffect(() => {
    listMyAssignments({ size: 100 })
      .then((r) => {
        // Camila (E9): esconder out_of_scope por ora -- essas tarefas dao 404
        // no detalhe (bug conhecido E6). Quando for tratar, troca este filtro.
        setItems(r.items.filter((t) => !t.out_of_scope));
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => setMembers(new Map(ms.map((m) => [m.id, { name: m.name }]))))
      .catch(() => {});
  }, []);

  // --- abrir / navegar / fechar o detalhe (mesma logica do quadro) ---
  function abrirDetalhe(t: Task) {
    setPilha([]);
    setDetalhe(t);
  }
  function abrirSubtarefa(sub: Task) {
    setPilha((p) => (detalhe ? [...p, detalhe] : p));
    setDetalhe(sub);
  }
  function voltarDetalhe() {
    setPilha((p) => {
      if (p.length === 0) return p;
      setDetalhe(p[p.length - 1]);
      return p.slice(0, -1);
    });
  }
  function fecharDetalhe() {
    setDetalhe(null);
    setPilha([]);
  }

  // Upsert preservando os campos que /me/assignments adiciona ao Task
  // (relations, out_of_scope) e o assignee_ids (mutacao nao devolve -- ADR 0025).
  function aoUpsert(t: Task) {
    setItems((prev) => {
      if (!prev) return prev;
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) {
        // subtarefa criada aqui: eu sou o criador, entra como "Criei".
        const nova: MyTaskItem = {
          ...t,
          relations: ["creator"],
          out_of_scope: false,
          assignee_ids: t.assignee_ids ?? [],
        };
        return [nova, ...prev];
      }
      const merged: MyTaskItem = {
        ...t,
        relations: existente.relations,
        out_of_scope: existente.out_of_scope,
        assignee_ids: t.assignee_ids ?? existente.assignee_ids,
      };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setItems((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
  }

  function aoSalvar(saved: Task) {
    aoUpsert(saved);
    setEditando(null);
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <div className="muted">Carregando…</div>;

  const focado = detalhe ? items.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? items.filter((t) => t.parent_task_id === focado.id) : [];

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
              onClick={() => abrirDetalhe(t)}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                cursor: "pointer",
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
                  {new Date(t.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <TaskModal
        open={editando !== null}
        task={editando}
        onClose={() => setEditando(null)}
        onSaved={aoSalvar}
      />

      <TaskDetail
        task={focado}
        members={members}
        filhos={filhosFocado}
        temVoltar={pilha.length > 0}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onEditar={(t) => {
          fecharDetalhe();
          setEditando(t);
        }}
        onAssigneesChange={aoMudarResponsaveis}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsert}
        onExcluir={(t) => {
          // Remove a task (e a subtree por path) da lista e fecha.
          setItems((prev) =>
            (prev ?? []).filter(
              (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
            )
          );
          fecharDetalhe();
        }}
      />
    </div>
  );
}
