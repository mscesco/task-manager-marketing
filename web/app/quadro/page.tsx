"use client";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import AppShell from "@/components/AppShell";
import TaskCard from "@/components/TaskCard";
import TaskModal from "@/components/TaskModal";
import { STATUSES } from "@/lib/status";
import { listTasks, updateTask, ApiError, type Task } from "@/lib/api";

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Drag so comeca depois de mover ~8px. Assim um clique seco (abrir editar,
  // Slice 3) nao vira arrasto -- e no touch o toque nao "gruda" no card.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    listTasks({ size: 100 })
      .then((r) => setTasks(r.items))
      .catch((e: ApiError) => setErro(e.message));
  }, []);

  // Toast some sozinho.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function aoCriar(nova: Task) {
    setTasks((prev) => [nova, ...(prev ?? [])]);
    setModalAberto(false);
  }

  const activeTask = useMemo(
    () => (activeId ? tasks?.find((t) => t.id === activeId) ?? null : null),
    [activeId, tasks]
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const taskId = String(e.active.id);
    const destino = e.over ? String(e.over.id) : null; // id da coluna = status
    if (!destino) return; // soltou fora de qualquer coluna

    const atual = tasks?.find((t) => t.id === taskId);
    if (!atual || atual.status === destino) return; // sem mudanca real

    const statusAnterior = atual.status;

    // Otimista: o card pula pra coluna nova na hora.
    setTasks((prev) =>
      prev!.map((t) => (t.id === taskId ? { ...t, status: destino } : t))
    );

    try {
      const atualizada = await updateTask(taskId, { status: destino });
      // Sincroniza com o servidor (ex.: completed_at setado/limpo).
      setTasks((prev) => prev!.map((t) => (t.id === taskId ? atualizada : t)));
    } catch (err) {
      // Reverte pra coluna de origem e avisa.
      setTasks((prev) =>
        prev!.map((t) =>
          t.id === taskId ? { ...t, status: statusAnterior } : t
        )
      );
      const e2 = err as ApiError;
      setToast(
        e2.status === 403
          ? "Voce nao pode mover esta tarefa. Voltei pra coluna anterior."
          : "Nao consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!tasks) return <div className="muted">Carregando tarefas…</div>;

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
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
            {STATUSES.map((s) => (
              <Coluna key={s.key} status={s} count={(porStatus[s.key] || []).length}>
                {(porStatus[s.key] || []).map((t) => (
                  <CardArrastavel key={t.id} task={t} />
                ))}
              </Coluna>
            ))}
          </div>

          {/* O card "fantasma" que segue o cursor durante o arrasto.
              Renderiza num portal -> nao e cortado pela rolagem das colunas. */}
          <DragOverlay>
            {activeTask ? (
              <div style={{ width: 256, cursor: "grabbing" }}>
                <TaskCard task={activeTask} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onCreated={aoCriar}
      />

      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "var(--text)", color: "#fff", padding: "10px 16px",
            borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 60,
            boxShadow: "var(--shadow)", maxWidth: 420,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ---- coluna que aceita soltar (droppable) ----
function Coluna({
  status,
  count,
  children,
}: {
  status: (typeof STATUSES)[number];
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key });
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 264, width: 264, flexShrink: 0, borderRadius: 10, padding: 4,
        background: isOver ? "var(--surface-2)" : "transparent",
        transition: "background .12s",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
          paddingBottom: 8, borderBottom: `2px solid ${status.color}`,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: status.color }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{status.label}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{count}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 24 }}>
        {children}
        {count === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>—</div>
        )}
      </div>
    </div>
  );
}

// ---- card arrastavel (draggable) ----
function CardArrastavel({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: "grab",
        touchAction: "none", // necessario pro arrasto funcionar no touch
      }}
    >
      <TaskCard task={task} />
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
