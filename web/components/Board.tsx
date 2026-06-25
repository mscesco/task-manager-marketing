"use client";
// components/Board.tsx
// Quadro kanban reaproveitavel. Sem projectId => quadro GERAL (panorama de
// tudo, inclusive tasks de projeto). Com projectId => quadro de UM projeto
// (a listagem ja vem filtrada pelo backend; subtarefa compartilha o project_id
// do pai, entao a subarvore inteira vem junta). Extraido do antigo
// quadro/page.tsx na Entrega 11 sem mudar comportamento do geral.
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
import TaskCard from "@/components/TaskCard";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import { STATUSES } from "@/lib/status";
import { listAllTasks, listAllProjects, updateTask, listMembers, listSubteams, ApiError, type Task, type Team } from "@/lib/api";

// Tira acento e caixa pra busca casar "midia" com "Midia Paga" etc.
function normalizar(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// "Hoje" como YYYY-MM-DD no fuso LOCAL. due_date vem do backend como date
// pura (sem hora), entao a comparacao e string vs string (ISO ordena certo).
// Nada de new Date(due_date): isso interpretaria como UTC e escorregaria 1 dia.
function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

type FiltroPrazo = "todos" | "atrasadas" | "em-dia";

export default function Board({
  projectId,
  title,
}: {
  projectId?: string; // ausente => quadro geral
  title: string;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<Map<string, { name: string }>>(
    new Map()
  );
  // Mapa project_id -> titulo, so no quadro geral (pra tag do card).
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Task | null>(null);
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  // Filtros client-side (Entrega 13). NAO entram no useEffect de fetch:
  // filtram em memoria sobre o lote ja carregado, sem bater na API.
  const [busca, setBusca] = useState("");
  const [prazo, setPrazo] = useState<FiltroPrazo>("todos");
  // Fatia 3: filtro por subtime. memberTeam resolve id->subtime (vem do
  // /members, agora com team_id pela Fatia 2). subtimes alimenta o dropdown
  // (so times nao-raiz). "" em `subtime` = sem filtro.
  const [memberTeam, setMemberTeam] = useState<Map<string, string | null>>(
    new Map()
  );
  const [subtimes, setSubtimes] = useState<Team[]>([]);
  const [subtime, setSubtime] = useState<string>("");
  // P0.2: total real quando o fetch bateu o teto de seguranca (truncou).
  // null = nao truncou. Vira aviso honesto no lugar de perda silenciosa.
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Guarda contra "clique fantasma" logo apos um arrasto.
  const suprimirClique = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    listAllTasks({ project_id: projectId, include_archived: mostrarArquivadas })
      .then((r) => {
        setTasks(r.items);
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMemberTeam(new Map(ms.map((m) => [m.id, m.team_id])));
      })
      .catch(() => {});
    // Tag de projeto so faz sentido no quadro geral. No board de projeto a
    // tag e redundante, entao nem busca.
    if (!projectId) {
      listAllProjects()
        .then((r) => setProjectNames(new Map(r.items.map((p) => [p.id, p.title]))))
        .catch(() => {});
    }
  }, [projectId, mostrarArquivadas]);

  // Subtimes sao estaveis no workspace -> busca uma vez (listSubteams e
  // memoizado no api.ts). So times nao-raiz entram no dropdown.
  useEffect(() => {
    listSubteams().then(setSubtimes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function aoSalvar(saved: Task) {
    setTasks((prev) => {
      const lista = prev ?? [];
      const existente = lista.find((t) => t.id === saved.id);
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
    if (suprimirClique.current) return;
    setPilha([]);
    setDetalhe(task);
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

  function aoUpsert(t: Task) {
    setTasks((prev) => {
      if (!prev) return [t];
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) return [t, ...prev];
      const merged = { ...t, assignee_ids: t.assignee_ids ?? existente.assignee_ids };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

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

  const subCount: Record<string, number> = {};
  const subDone: Record<string, number> = {};
  for (const t of tasks) {
    if (!t.parent_task_id) continue;
    subCount[t.parent_task_id] = (subCount[t.parent_task_id] ?? 0) + 1;
    if (t.status === "COMPLETED")
      subDone[t.parent_task_id] = (subDone[t.parent_task_id] ?? 0) + 1;
  }

  // visiveis = raizes apos o toggle de arquivadas (eixo que SOMA). raizes =
  // visiveis apos busca + prazo (eixos que ESTREITAM). Os contadores e o
  // porStatus saem de `raizes` pra nao mentir quando ha filtro ativo.
  const buscaNorm = normalizar(busca);
  const hoje = hojeISO();
  const temFiltro = buscaNorm !== "" || prazo !== "todos" || subtime !== "";

  const visiveis = tasks.filter(
    (t) => t.depth === 0 && (mostrarArquivadas || !t.is_archived)
  );
  const raizes = visiveis.filter((t) => {
    if (buscaNorm && !normalizar(t.title).includes(buscaNorm)) return false;
    // Sem data: aparece em qualquer filtro de prazo (decisao da Camila).
    if (prazo !== "todos" && t.due_date) {
      // Concluida nunca e atrasada (ja foi entregue).
      const atrasada = t.status !== "COMPLETED" && t.due_date < hoje;
      if (prazo === "atrasadas" && !atrasada) return false;
      if (prazo === "em-dia" && atrasada) return false;
    }
    // Subtime: passa se ALGUM responsavel pertence ao subtime escolhido.
    // NAO toca em task.team_id -> o bug E6 continua dormente. Task sem
    // responsavel some ao filtrar por subtime (decisao da Camila).
    if (subtime) {
      const ids = t.assignee_ids ?? [];
      if (!ids.some((id) => memberTeam.get(id) === subtime)) return false;
    }
    return true;
  });
  const porStatus: Record<string, Task[]> = {};
  for (const s of STATUSES) porStatus[s.key] = [];
  for (const t of raizes) (porStatus[t.status] ??= []).push(t);

  const focado = detalhe ? tasks.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? tasks.filter((t) => t.parent_task_id === focado.id) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>{title}</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {temFiltro ? `${raizes.length} de ${visiveis.length}` : raizes.length} tarefas
        </span>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por titulo…"
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", minWidth: 170,
          }}
        />
        <select
          value={prazo}
          onChange={(e) => setPrazo(e.target.value as FiltroPrazo)}
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          <option value="todos">Prazo: todos</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="em-dia">Em dia</option>
        </select>
        {subtimes.length > 0 && (
          <select
            value={subtime}
            onChange={(e) => setSubtime(e.target.value)}
            style={{
              fontSize: 13, padding: "6px 10px", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            <option value="">Subtime: todos</option>
            {subtimes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <label
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
            fontSize: 13, color: "var(--text-soft)", cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={mostrarArquivadas}
            onChange={(e) => setMostrarArquivadas(e.target.checked)}
          />
          Mostrar arquivadas
        </label>
        <button
          className="btn btn-primary"
          onClick={() => setCriando(true)}
          style={{ padding: "8px 14px" }}
        >
          + Nova tarefa
        </button>
      </div>

      {truncadoTotal !== null && (
        <div
          role="alert"
          style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--accent-soft)",
            color: "var(--text)", fontSize: 13,
          }}
        >
          Este quadro tem <strong>{truncadoTotal}</strong> tarefas, acima do
          limite de exibição. Mostrando as mais recentes — algumas podem não
          aparecer no quadro nem na busca. Arquive tarefas concluídas para
          reduzir o volume.
        </div>
      )}

      {raizes.length === 0 ? (
        temFiltro ? (
          <SemResultado
            onLimpar={() => {
              setBusca("");
              setPrazo("todos");
              setSubtime("");
            }}
          />
        ) : (
          <EmptyState onNova={() => setCriando(true)} />
        )
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
                    projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
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
                  projectName={activeTask.project_id ? projectNames.get(activeTask.project_id) : undefined}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskModal
        open={criando || editando !== null}
        task={editando}
        defaultProjectId={projectId ?? null}
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
  projectName,
}: {
  task: Task;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  subtaskCount: number;
  subtaskDone: number;
  projectName?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAbrir(task)}
      style={{
        opacity: isDragging ? 0.4 : task.is_archived ? 0.55 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
    >
      <TaskCard
        task={task}
        members={members}
        subtaskCount={subtaskCount}
        subtaskDone={subtaskDone}
        projectName={projectName}
      />
    </div>
  );
}

function SemResultado({ onLimpar }: { onLimpar: () => void }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)", borderRadius: 12, padding: 40,
        textAlign: "center", maxWidth: 480,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Nada encontrado</p>
      <p className="muted" style={{ margin: "6px 0 14px", fontSize: 13 }}>
        Nenhuma tarefa bate com o filtro atual. As subtarefas e tarefas de
        outras paginas nao entram na busca. No filtro de subtime, tarefas sem
        responsavel (ou so com responsaveis de outro subtime) nao aparecem.
      </p>
      <button className="btn" onClick={onLimpar}>Limpar filtros</button>
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
