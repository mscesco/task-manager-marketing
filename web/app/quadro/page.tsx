"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import TaskCard from "@/components/TaskCard";
import TaskModal from "@/components/TaskModal";
import { STATUSES } from "@/lib/status";
import { listTasks, ApiError, type Task } from "@/lib/api";

export default function QuadroPage() {
  return (
    <AppShell>
      <Quadro />
    </AppShell>
  );
}

function Quadro() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);

  useEffect(() => {
    listTasks({ size: 100 })
      .then((r) => setTasks(r.items))
      .catch((e: ApiError) => setErro(e.message));
  }, []);

  // Prepend otimista: o POST devolve a Task completa, entao o card aparece
  // na hora (na coluna do status dela, BACKLOG por default) sem refetch.
  function aoCriar(nova: Task) {
    setTasks((prev) => [nova, ...(prev ?? [])]);
    setModalAberto(false);
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!tasks) return <div className="muted">Carregando tarefas…</div>;

  // agrupa por status (as 7 colunas vem de lib/status, na ordem definida la)
  const porStatus: Record<string, Task[]> = {};
  for (const s of STATUSES) porStatus[s.key] = [];
  for (const t of tasks) (porStatus[t.status] ??= []).push(t);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>Quadro geral</h1>
        <span className="muted" style={{ fontSize: 13 }}>{tasks.length} tarefas</span>
        <button
          className="btn btn-primary"
          onClick={() => setModalAberto(true)}
          style={{ marginLeft: "auto", padding: "8px 14px" }}
        >
          + Nova tarefa
        </button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState onNova={() => setModalAberto(true)} />
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {STATUSES.map((s) => {
            const col = porStatus[s.key] || [];
            return (
              <div key={s.key} style={{ minWidth: 264, width: 264, flexShrink: 0 }}>
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                    paddingBottom: 8, borderBottom: `2px solid ${s.color}`,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.label}</span>
                  <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                    {col.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {col.map((t) => <TaskCard key={t.id} task={t} />)}
                  {col.length === 0 && (
                    <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onCreated={aoCriar}
      />
    </div>
  );
}

function EmptyState({ onNova }: { onNova: () => void }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)", borderRadius: 12, padding: 40,
        textAlign: "center", maxWidth: 480,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Nenhuma tarefa ainda</p>
      <p className="muted" style={{ margin: "6px 0 14px", fontSize: 13 }}>
        Crie a primeira — ela aparece aqui, organizada por status.
      </p>
      <button className="btn btn-primary" onClick={onNova}>+ Nova tarefa</button>
    </div>
  );
}
