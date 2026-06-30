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
  listMembers,
  ApiError,
  type Task,
  type TaskUpdateInput,
  type Project,
  type Member,
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

  // Spec 021: responsaveis na criacao (so no modo CRIAR). invalidIds = quem o
  // backend recusou no 422 -> fica marcado em vermelho, com a selecao preservada.
  const [membros, setMembros] = useState<Member[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());

  // Prefilla (ou limpa) sempre que abre / troca a task alvo.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(task?.priority ?? "MEDIUM");
    setDueDate(task?.due_date ?? "");
    setStatus(task?.status ?? "BACKLOG");
    setProjetoSel("");
    setAssigneeIds([]);
    setInvalidIds(new Set());
    setErro(null);
  }, [open, task]);

  // Carrega projetos comuns pro seletor (so quando ele aparece).
  useEffect(() => {
    if (!open || !mostrarSeletorProjeto) return;
    listProjects({ size: 100 })
      .then((r) => setProjetos(r.items.filter((p) => !p.is_personal)))
      .catch(() => {});
  }, [open, mostrarSeletorProjeto]);

  // Carrega membros pro seletor de responsaveis (so ao CRIAR).
  useEffect(() => {
    if (!open || editando) return;
    listMembers()
      .then((ms) => setMembros(ms.filter((m) => m.is_active)))
      .catch(() => {});
  }, [open, editando]);

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

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    // Corrigiu: tira a marca vermelha desse id.
    setInvalidIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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
          assignee_ids: assigneeIds,
        });
      }
      setSaving(false);
      onSaved(saved);
    } catch (err) {
      const e = err as ApiError;
      const invalidos: string[] | undefined = e.details?.invalid_ids;
      if (invalidos?.length) {
        // Marca os recusados em vermelho, mantem o resto da selecao.
        setInvalidIds(new Set(invalidos));
        const nomes = invalidos
          .map((id) => membros.find((m) => m.id === id)?.name ?? "alguem")
          .join(", ");
        setErro(
          `Nao foi possivel atribuir: ${nomes}. ` +
            "Essas pessoas nao alcancam o time desta tarefa — remova-as para criar."
        );
      } else {
        setErro(e.message || "Nao foi possivel salvar a tarefa.");
      }
      setSaving(false);
    }
  }

  return (
    <div
      onClick={fechar}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
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

        {/* Spec 021: responsaveis -- so na criacao (na edicao, mexe-se no detalhe).
            Lista todos os membros ativos; o backend valida escopo e recusa os
            invalidos com 422 (que ficam vermelhos aqui, sem perder a selecao). */}
        {!editando && (
          <div className="field">
            <label className="label">
              Responsaveis <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </label>
            {membros.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>Carregando membros…</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {membros.map((m) => {
                  const on = assigneeIds.includes(m.id);
                  const bad = invalidIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleAssignee(m.id)}
                      aria-pressed={on}
                      className="tappable"
                      style={{
                        padding: "5px 10px", borderRadius: 999, fontSize: 12,
                        fontWeight: 600, cursor: "pointer", lineHeight: 1,
                        border: `1px solid ${bad ? "var(--danger)" : "var(--border)"}`,
                        background: bad
                          ? "rgba(220,38,38,0.08)"
                          : on ? "var(--accent-soft)" : "var(--surface-2)",
                        color: bad
                          ? "var(--danger)"
                          : on ? "var(--accent)" : "var(--text-faint)",
                      }}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            )}
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
