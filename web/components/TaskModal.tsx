"use client";
// components/TaskModal.tsx
// Modal de CRIAR e EDITAR tarefa.
//  - sem `task`  -> criar  (POST /tasks, pin do time raiz no api.ts)
//  - com `task`  -> editar (PATCH /tasks/{id} SO com o que mudou)
//
// EDITAR prefilla com o objeto que a listagem ja trouxe -- nao ha
// GET /tasks/{id} (contorna o bug E6, ver web/docs/adr/0002).
// O time NAO aparece de proposito: o quadro define o time (ADR 0001).

import { useEffect, useState } from "react";
import {
  createTask,
  updateTask,
  listProjects,
  ApiError,
  type Task,
  type TaskUpdateInput,
  type Project,
} from "@/lib/api";
import { PRIORITY_LABEL, STATUSES } from "@/lib/status";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export default function TaskModal({
  open,
  task,
  onClose,
  onSaved,
  defaultProjectId = null,
}: {
  open: boolean;
  task?: Task | null; // presente => modo editar
  onClose: () => void;
  onSaved: (task: Task) => void;
  defaultProjectId?: string | null; // criar dentro deste projeto (Entrega 11)
}) {
  const editando = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>("BACKLOG");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Seletor de projeto: so ao CRIAR fora de um projeto fixo (quadro geral).
  const mostrarSeletorProjeto = !editando && !defaultProjectId;
  const [projetos, setProjetos] = useState<Project[]>([]);
  const [projetoSel, setProjetoSel] = useState(""); // "" => avulsa

  // Prefilla (ou limpa) sempre que abre / troca a task alvo.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(task?.priority ?? "MEDIUM");
    setDueDate(task?.due_date ?? "");
    setStatus(task?.status ?? "BACKLOG");
    setProjetoSel("");
    setErro(null);
  }, [open, task]);

  // Carrega projetos comuns pro seletor (so quando ele aparece).
  useEffect(() => {
    if (!open || !mostrarSeletorProjeto) return;
    listProjects({ size: 100 })
      .then((r) => setProjetos(r.items.filter((p) => !p.is_personal)))
      .catch(() => {});
  }, [open, mostrarSeletorProjeto]);

  // Esc fecha (quando aberto e nao salvando).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) fechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving]);

  if (!open) return null;

  function fechar() {
    if (saving) return;
    onClose();
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setErro("O titulo e obrigatorio.");
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      let saved: Task;
      if (editando && task) {
        // PATCH parcial: monta so o que mudou em relacao ao original.
        const diff: TaskUpdateInput = {};
        if (t !== task.title) diff.title = t;
        const d = description.trim();
        if (d !== (task.description ?? "")) diff.description = d;
        if (priority !== task.priority) diff.priority = priority;
        if (status !== task.status) diff.status = status;
        const due = dueDate || null;
        if (due !== (task.due_date ?? null)) diff.due_date = due;

        if (Object.keys(diff).length === 0) {
          // Nada mudou: nao chama a API, so fecha.
          setSaving(false);
          onClose();
          return;
        }
        saved = await updateTask(task.id, diff);
      } else {
        saved = await createTask({
          title: t,
          description: description.trim(),
          priority,
          due_date: dueDate || null,
          project_id: defaultProjectId ?? (projetoSel || null),
        });
      }
      setSaving(false);
      onSaved(saved);
    } catch (err) {
      setErro((err as ApiError).message || "Nao foi possivel salvar a tarefa.");
      setSaving(false);
    }
  }

  return (
    <div
      onClick={fechar}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(16,24,40,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "10vh 16px 16px",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={salvar}
        style={{
          width: 460, maxWidth: "100%", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 14, padding: 24,
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>
            {editando ? "Editar tarefa" : "Nova tarefa"}
          </h2>
          <button
            type="button" className="btn btn-ghost" onClick={fechar}
            style={{ padding: "4px 10px" }} aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <div className="field">
          <label className="label" htmlFor="t-title">Titulo</label>
          <input
            id="t-title" className="input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que precisa ser feito?" maxLength={255}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="t-desc">
            Descricao <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
          </label>
          <textarea
            id="t-desc" className="input" value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes, contexto, links…" rows={4}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="t-prio">Prioridade</label>
            <select
              id="t-prio" className="input" value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p] || p}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="t-due">
              Prazo <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </label>
            <input
              id="t-due" className="input" type="date" value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {mostrarSeletorProjeto && (
          <div className="field">
            <label className="label" htmlFor="t-proj">
              Projeto <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </label>
            <select
              id="t-proj" className="input" value={projetoSel}
              onChange={(e) => setProjetoSel(e.target.value)}
            >
              <option value="">Nenhum (avulsa)</option>
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Status so no modo editar -- na criacao nasce BACKLOG e arrasta-se depois. */}
        {editando && (
          <div className="field">
            <label className="label" htmlFor="t-status">Status</label>
            <select
              id="t-status" className="input" value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={fechar} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando…" : editando ? "Salvar" : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
