"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
import TaskDetail from "@/components/TaskDetail";
import { STATUSES } from "@/lib/status";
import { listTasks, updateTask, listMembers, ApiError, type Task } from "@/lib/api";

export default function QuadroPage() {
  return (
    <AppShell>
      <Quadro />
    </AppShell>
  );
}

function Quadro() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<Map<string, { name: string }>>(
    new Map()
  );
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Task | null>(null);
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Guarda contra "clique fantasma" logo apos um arrasto: o dnd dispara
  // onDragEnd, ligamos a trava, e o click que o browser as vezes emite em
  // seguida e ignorado. Um clique de verdade nunca passa por onDragEnd.
  const suprimirClique = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    listTasks({ size: 100 })
      .then((r) => setTasks(r.items))
      .catch((e: ApiError) => setErro(e.message));
    // Mapa id->nome pro selo. Se falhar, o selo cai pra "?" -- nao quebra
    // o quadro (o dado de quem-e-responsavel ja veio no assignee_ids).
    listMembers()
      .then((ms) => setMembers(new Map(ms.map((m) => [m.id, { name: m.name }]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // Create e edit caem aqui: se o id ja existe, substitui in-place;
  // senao, prepend (tarefa nova).
  function aoSalvar(saved: Task) {
    setTasks((prev) => {
      const lista = prev ?? [];
      const existente = lista.find((t) => t.id === saved.id);
      // Mutacao NAO devolve assignee_ids (ADR 0025) -> preserva o que ja
      // tinhamos, senao o selo sumiria ao editar.
      const m = {
        ...saved,
        assignee_ids: saved.assignee_ids ?? existente?.assignee_ids ?? [],
      };
      return existente
        ? lista.map((t) => (t.id === saved.id ? m : t))
        : [m, ...lista];
    });
    setCriando(false);
    setEditando(null);
  }

  function abrirDetalhe(task: Task) {
    if (suprimirClique.current) return; // veio logo apos um arrasto: ignora
    setPilha([]);
    setDetalhe(task);
  }

  // Navegacao dentro do detalhe: clicar numa subtarefa empilha a atual e
  // foca a subtarefa; "voltar" desempilha.
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

  // Upsert generico (subtarefa criada no detalhe entra na lista do quadro ->
  // alimenta a propria sublista e o badge do card pai).
  function aoUpsert(t: Task) {
    setTasks((prev) => {
      if (!prev) return [t];
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) return [t, ...prev];
      // updateTask NAO retorna assignee_ids (ADR 0025) -> preserva o que tinha,
      // senao concluir-rapido zerava os responsaveis da subtarefa.
      const merged = { ...t, assignee_ids: t.assignee_ids ?? existente.assignee_ids };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  // Responsaveis mudaram no detalhe -> reflete no assignee_ids do card (selo)
  // sem recarregar. O detalhe ja gravou no backend (otimista).
  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
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
    // Houve arrasto -> trava o proximo clique por um instante.
    suprimirClique.current = true;
    setTimeout(() => (suprimirClique.current = false), 60);

    const taskId = String(e.active.id);
    const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;

    const atual = tasks?.find((t) => t.id === taskId);
    if (!atual || atual.status === destino) return;

    const statusAnterior = atual.status;

    setTasks((prev) =>
      prev!.map((t) => (t.id === taskId ? { ...t, status: destino } : t))
    );

    try {
      const atualizada = await updateTask(taskId, { status: destino });
      // PATCH nao devolve assignee_ids (ADR 0025) -> preserva, senao o selo
      // some ao mover o card.
      setTasks((prev) =>
        prev!.map((t) =>
          t.id === taskId ? { ...atualizada, assignee_ids: t.assignee_ids } : t
        )
      );
    } catch (err) {
      setTasks((prev) =>
        prev!.map((t) => (t.id === taskId ? { ...t, status: statusAnterior } : t))
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

  // Filhos DIRETOS por pai (badge do card) -- conta antes de filtrar raizes.
  const subCount: Record<string, number> = {};
  const subDone: Record<string, number> = {};
  for (const t of tasks) {
    if (!t.parent_task_id) continue;
    subCount[t.parent_task_id] = (subCount[t.parent_task_id] ?? 0) + 1;
    if (t.status === "COMPLETED")
      subDone[t.parent_task_id] = (subDone[t.parent_task_id] ?? 0) + 1;
  }

  // O quadro mostra SO raizes (subtarefa vive dentro do card pai). depth===0.
  const raizes = tasks.filter((t) => t.depth === 0);
  const porStatus: Record<string, Task[]> = {};
  for (const s of STATUSES) porStatus[s.key] = [];
  for (const t of raizes) (porStatus[t.status] ??= []).push(t);

  // Tarefa focada no detalhe: versao FRESCA da lista (reflete assignees/status
  // atualizados), e os filhos diretos dela pra sublista.
  const focado = detalhe ? tasks.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? tasks.filter((t) => t.parent_task_id === focado.id) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>Quadro geral</h1>
        <span className="muted" style={{ fontSize: 13 }}>{raizes.length} tarefas</span>
        <button
          className="btn btn-primary"
          onClick={() => setCriando(true)}
          style={{ marginLeft: "auto", padding: "8px 14px" }}
        >
          + Nova tarefa
        </button>
      </div>

      {raizes.length === 0 ? (
        <EmptyState onNova={() => setCriando(true)} />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
            {STATUSES.map((s) => (
              <Coluna key={s.key} status={s} count={(porStatus[s.key] || []).length}>
                {(porStatus[s.key] || []).map((t) => (
                  <CardArrastavel
                    key={t.id}
                    task={t}
                    onAbrir={abrirDetalhe}
                    members={members}
                    subtaskCount={subCount[t.id] ?? 0}
                    subtaskDone={subDone[t.id] ?? 0}
                  />
                ))}
              </Coluna>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? (
              <div style={{ width: 256, cursor: "grabbing" }}>
                <TaskCard
                  task={activeTask}
                  members={members}
                  subtaskCount={subCount[activeTask.id] ?? 0}
                  subtaskDone={subDone[activeTask.id] ?? 0}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskModal
        open={criando || editando !== null}
        task={editando}
        onClose={() => {
          setCriando(false);
          setEditando(null);
        }}
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

function CardArrastavel({
  task,
  onAbrir,
  members,
  subtaskCount,
  subtaskDone,
}: {
  task: Task;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  subtaskCount: number;
  subtaskDone: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAbrir(task)}
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
    >
      <TaskCard
        task={task}
        members={members}
        subtaskCount={subtaskCount}
        subtaskDone={subtaskDone}
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
