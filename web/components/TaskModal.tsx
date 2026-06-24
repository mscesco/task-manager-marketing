"use client";
// components/TaskModal.tsx
// Modal de CRIAR tarefa (Slice 1). O modo EDITAR entra no Slice 3
// reusando este mesmo componente (recebera uma `task` opcional).
//
// Campos: titulo (obrigatorio), descricao (opcional), prioridade, prazo.
// O time NAO aparece aqui de proposito (pin na raiz, ADR 0001 do front):
// quem define o time e o quadro, nao o formulario.

import { useEffect, useState } from "react";
import { createTask, ApiError, type Task } from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/status";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export default function TaskModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Esc fecha o modal (so quando aberto e nao salvando).
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

  function limpar() {
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setDueDate("");
    setErro(null);
  }

  function fechar() {
    if (saving) return;
    limpar();
    onClose();
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      // So o titulo e obrigatorio (descricao e opcional -- decisao de produto).
      setErro("O titulo e obrigatorio.");
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      const task = await createTask({
        title: t,
        description: description.trim(),
        priority,
        due_date: dueDate || null,
      });
      setSaving(false);
      limpar();
      onCreated(task);
    } catch (err) {
      setErro((err as ApiError).message || "Nao foi possivel criar a tarefa.");
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
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Nova tarefa</h2>
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={fechar} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Criando…" : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
