"use client";
// components/TaskDetail.tsx
// Painel de DETALHE da tarefa (padrao Trello): clicar no card abre isto.
// Reusa o objeto da lista (sem GET /tasks/{id} -- dodge do bug E6, ADR 0002).
//
// Responsaveis: bolinhas dos atuais SEMPRE visiveis + botao "Designar" que
//   abre/fecha a lista suspensa (busca + checkbox). Grava na hora (otimista).
// Subtarefas: lista os filhos diretos (do quadro); "+ Subtarefa" cria; o
//   checkbox da linha conclui rapido (desmarcar volta pro status anterior,
//   guardado na sessao); clicar no titulo NAVEGA pra dentro (voltar desempilha).

import { useEffect, useMemo, useState } from "react";
import {
  addAssignee,
  removeAssignee,
  createSubtask,
  updateTask,
  ApiError,
  type Task,
} from "@/lib/api";
import { PRIORITY_LABEL, PRIORITY_COLOR, STATUSES } from "@/lib/status";
import { iniciais, nomeCurto, corAvatar } from "@/lib/people";

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

export default function TaskDetail({
  task,
  members,
  filhos,
  temVoltar,
  onVoltar,
  onClose,
  onEditar,
  onAssigneesChange,
  onAbrirSubtarefa,
  onSubtaskUpsert,
}: {
  task: Task | null; // tarefa focada; null => fechado
  members: Map<string, { name: string }>;
  filhos: Task[]; // filhos DIRETOS da tarefa focada (do quadro)
  temVoltar: boolean;
  onVoltar: () => void;
  onClose: () => void;
  onEditar: (task: Task) => void;
  onAssigneesChange: (taskId: string, userIds: string[]) => void;
  onAbrirSubtarefa: (sub: Task) => void;
  onSubtaskUpsert: (sub: Task) => void; // criar OU concluir rapido
}) {
  const [assignees, setAssignees] = useState<string[]>([]);
  const [abertoResp, setAbertoResp] = useState(false);
  const [busca, setBusca] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const [criandoSub, setCriandoSub] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [salvandoSub, setSalvandoSub] = useState(false);
  const [erroSub, setErroSub] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState<Set<string>>(new Set());
  // Status de antes de concluir, pra desmarcar voltar pra ele (sessao).
  const [statusAnterior, setStatusAnterior] = useState<Record<string, string>>({});

  // Reset sempre que abre / troca / navega de tarefa.
  useEffect(() => {
    setAssignees(task?.assignee_ids ?? []);
    setAbertoResp(false);
    setBusca("");
    setErro(null);
    setSaving(new Set());
    setCriandoSub(false);
    setNovoTitulo("");
    setErroSub(null);
    setSubSaving(new Set());
    setStatusAnterior({});
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name }))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, busca]);

  if (!task) return null;
  const tid = task.id;
  const concluidas = filhos.filter((f) => f.status === "COMPLETED").length;

  async function toggle(userId: string) {
    const jaEra = assignees.includes(userId);
    const anterior = assignees;
    const otimista = jaEra
      ? assignees.filter((x) => x !== userId)
      : [...assignees, userId];

    setErro(null);
    setAssignees(otimista);
    onAssigneesChange(tid, otimista);
    setSaving((s) => new Set(s).add(userId));

    try {
      const ids = jaEra
        ? await removeAssignee(tid, userId)
        : await addAssignee(tid, userId);
      setAssignees(ids);
      onAssigneesChange(tid, ids);
    } catch (e) {
      setAssignees(anterior);
      onAssigneesChange(tid, anterior);
      const err = e as ApiError;
      setErro(
        err.status === 403
          ? "Voce nao pode designar nesta tarefa."
          : err.status === 422
          ? "Essa pessoa nao alcanca esta tarefa (fora do time)."
          : "Nao consegui atualizar o responsavel."
      );
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(userId);
        return n;
      });
    }
  }

  async function criarSub() {
    const t = novoTitulo.trim();
    if (!t) {
      setCriandoSub(false);
      setNovoTitulo("");
      return;
    }
    setSalvandoSub(true);
    setErroSub(null);
    try {
      const nova = await createSubtask(tid, t);
      onSubtaskUpsert(nova);
      setNovoTitulo("");
      setCriandoSub(false);
    } catch (e) {
      setErroSub((e as ApiError).message || "Nao consegui criar a subtarefa.");
    } finally {
      setSalvandoSub(false);
    }
  }

  async function alternarConclusao(f: Task) {
    const concluida = f.status === "COMPLETED";
    const destino = concluida ? statusAnterior[f.id] ?? "BACKLOG" : "COMPLETED";
    if (!concluida) {
      // guarda o status de antes pra um futuro desmarcar
      setStatusAnterior((m) => ({ ...m, [f.id]: f.status }));
    }
    setErroSub(null);
    setSubSaving((s) => new Set(s).add(f.id));
    onSubtaskUpsert({ ...f, status: destino }); // otimista
    try {
      const atualizada = await updateTask(f.id, { status: destino });
      onSubtaskUpsert(atualizada);
    } catch (e) {
      onSubtaskUpsert(f); // revert
      setErroSub("Nao consegui atualizar a subtarefa.");
    } finally {
      setSubSaving((s) => {
        const n = new Set(s);
        n.delete(f.id);
        return n;
      });
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(16,24,40,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "10vh 16px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 14, padding: 24,
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {temVoltar && (
          <button
            type="button" className="btn btn-ghost" onClick={onVoltar}
            style={{ alignSelf: "flex-start", padding: "2px 8px", fontSize: 13 }}
          >
            ‹ Voltar
          </button>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
            {task.title}
          </h2>
          <button
            type="button" className="btn btn-ghost" onClick={onClose}
            style={{ padding: "4px 10px", flexShrink: 0 }} aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
              color: "#fff", background: STATUS_COLOR[task.status] || "#999",
            }}
          >
            {STATUS_LABEL[task.status] || task.status}
          </span>
          <span
            style={{
              fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
              color: PRIORITY_COLOR[task.priority] || "var(--text-soft)",
              background: (PRIORITY_COLOR[task.priority] || "#999") + "1a",
            }}
          >
            {PRIORITY_LABEL[task.priority] || task.priority}
          </span>
          {task.due_date && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              ◷ {new Date(task.due_date).toLocaleDateString("pt-BR")}
            </span>
          )}
          {task.is_archived && (
            <span className="muted" style={{ fontSize: 12.5 }}>arquivada</span>
          )}
        </div>

        <div className="field">
          <span className="label">Descricao</span>
          {task.description && task.description.trim().length > 0 ? (
            <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {task.description}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>Sem descricao.</span>
          )}
        </div>

        {/* ---- Responsaveis: atuais sempre visiveis + dropdown "Designar" ---- */}
        <div className="field">
          <span className="label">Responsaveis</span>

          {assignees.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {assignees.map((id) => {
                const nome = members.get(id)?.name ?? "";
                return (
                  <span
                    key={id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "var(--surface-2)", borderRadius: 999,
                      padding: "2px 10px 2px 2px", fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        width: 20, height: 20, borderRadius: 999,
                        background: corAvatar(id), color: "#fff",
                        fontSize: 9.5, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {nome ? iniciais(nome) : "?"}
                    </span>
                    {nome ? nomeCurto(nome) : "Responsavel"}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>Ninguem designado.</span>
          )}

          <button
            type="button" className="btn btn-ghost"
            onClick={() => setAbertoResp((v) => !v)}
            style={{ alignSelf: "flex-start", padding: "6px 10px", marginTop: 2 }}
          >
            {abertoResp ? "Fechar" : "Designar"}
          </button>

          {abertoResp && (
            <div style={{ marginTop: 2 }}>
              <input
                className="input"
                placeholder="Buscar pessoa…"
                value={busca}
                autoFocus
                onChange={(e) => setBusca(e.target.value)}
              />
              <div
                style={{
                  maxHeight: 220, overflowY: "auto", marginTop: 6,
                  border: "1px solid var(--border)", borderRadius: 8,
                }}
              >
                {filtrados.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: "10px 12px" }}>
                    Ninguem encontrado.
                  </div>
                ) : (
                  filtrados.map((m, i) => {
                    const marcado = assignees.includes(m.id);
                    const ocupado = saving.has(m.id);
                    return (
                      <label
                        key={m.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", cursor: ocupado ? "wait" : "pointer",
                          borderTop: i === 0 ? "none" : "1px solid var(--border)",
                          opacity: ocupado ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={ocupado}
                          onChange={() => toggle(m.id)}
                        />
                        <span
                          style={{
                            width: 20, height: 20, borderRadius: 999,
                            background: corAvatar(m.id), color: "#fff",
                            fontSize: 9.5, fontWeight: 700, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {iniciais(m.name)}
                        </span>
                        <span style={{ fontSize: 13.5 }}>{m.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {erro && (
            <div className="error-box" style={{ marginTop: 8 }}>{erro}</div>
          )}
        </div>

        {/* ---- Subtarefas ---- */}
        <div className="field">
          <span className="label">
            Subtarefas{filhos.length > 0 ? ` (${concluidas}/${filhos.length})` : ""}
          </span>

          {filhos.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {filhos.map((f, i) => {
                const concluida = f.status === "COMPLETED";
                const ocupado = subSaving.has(f.id);
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      opacity: ocupado ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={concluida}
                      disabled={ocupado}
                      title={concluida ? "Reabrir" : "Concluir"}
                      onChange={() => alternarConclusao(f)}
                      style={{ cursor: ocupado ? "wait" : "pointer", flexShrink: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => onAbrirSubtarefa(f)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
                        border: "none", padding: 0, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                    >
                      <span
                        style={{
                          flex: 1, fontSize: 13.5, minWidth: 0,
                          textDecoration: concluida ? "line-through" : "none",
                          color: concluida ? "var(--text-faint)" : "var(--text)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {f.title}
                      </span>
                      <span style={{ display: "flex", alignItems: "center" }}>
                        {(f.assignee_ids ?? []).slice(0, 2).map((id, j) => (
                          <span
                            key={id}
                            title={members.get(id)?.name ?? ""}
                            style={{
                              width: 18, height: 18, borderRadius: 999,
                              background: corAvatar(id), color: "#fff",
                              fontSize: 8.5, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              border: "1.5px solid var(--surface)",
                              marginLeft: j === 0 ? 0 : -5,
                            }}
                          >
                            {members.get(id)?.name ? iniciais(members.get(id)!.name) : "?"}
                          </span>
                        ))}
                      </span>
                      <span className="muted" style={{ fontSize: 14, flexShrink: 0 }}>›</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {criandoSub ? (
            <input
              className="input"
              autoFocus
              placeholder="Titulo da subtarefa… (Enter cria, Esc cancela)"
              value={novoTitulo}
              disabled={salvandoSub}
              maxLength={255}
              onChange={(e) => setNovoTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  criarSub();
                } else if (e.key === "Escape") {
                  setCriandoSub(false);
                  setNovoTitulo("");
                }
              }}
              style={{ marginTop: filhos.length > 0 ? 8 : 0 }}
            />
          ) : (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => setCriandoSub(true)}
              style={{ alignSelf: "flex-start", marginTop: filhos.length > 0 ? 8 : 0, padding: "6px 10px" }}
            >
              + Subtarefa
            </button>
          )}

          {erroSub && (
            <div className="error-box" style={{ marginTop: 8 }}>{erroSub}</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEditar(task)}>
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
