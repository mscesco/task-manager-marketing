"use client";
// components/TaskModal.tsx
// Modal de CRIAR e EDITAR tarefa.
//  - sem `task`  -> criar  (POST /tasks, pin do time raiz no api.ts)
//  - com `task`  -> editar (PATCH /tasks/{id} SO com o que mudou)
//
// EDITAR prefilla com o objeto que a listagem ja trouxe -- nao ha
// GET /tasks/{id} (contorna o bug E6, ver web/docs/adr/0002).
// O time NAO aparece de proposito: o quadro define o time (ADR 0001).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import {
  deveBloquearEnter,
  ehAtalhoDeSalvar,
  primeiroSelecionavel,
} from "@/lib/teclasFormulario";
import Avatar from "@/components/Avatar";
import { nomeCurto } from "@/lib/people";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// Gatilho compacto redondo (mesmo padrao do detalhe): troca o despejo de 30
// chips por um "+" que abre a lista com busca. Duplicado de proposito -- se
// virar mais lugares, extrai pra um modulo compartilhado.
const GATILHO_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  flexShrink: 0,
  border: "1px dashed var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

export default function TaskModal({
  open,
  task,
  onClose,
  onSaved,
  defaultProjectId = null,
  defaultTeamId = null,
}: {
  open: boolean;
  task?: Task | null; // presente => modo editar
  onClose: () => void;
  onSaved: (task: Task) => void;
  defaultProjectId?: string | null; // criar dentro deste projeto (Entrega 11)
  // Fatia 5: time da task de topo. So o quadro de SUBTIME passa (o id do
  // subtime) -> task nasce interna. Null nos demais -> pin na raiz.
  defaultTeamId?: string | null;
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
  // No quadro de SUBTIME (defaultTeamId setado) a task de topo nasce INTERNA
  // do subtime por decisao do modelo -> esconder o seletor. Sem isto, dava
  // pra criar uma task com team_id=subtime E project_id=projeto-da-raiz (o
  // backend aceita, pois o subtime e descendente da raiz), e essa task sumia
  // do quadro geral e aparecia so no projeto + como "Interna" no subtime.
  const mostrarSeletorProjeto = !editando && !defaultProjectId && !defaultTeamId;
  const [projetos, setProjetos] = useState<Project[]>([]);
  const [projetoSel, setProjetoSel] = useState(""); // "" => avulsa

  // Spec 021: responsaveis na criacao (so no modo CRIAR). invalidIds = quem o
  // backend recusou no 422 -> fica marcado em vermelho, com a selecao preservada.
  const [membros, setMembros] = useState<Member[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  // Picker com busca (popover): abre/fecha, termo, e ref pra clique-fora.
  const [abertoResp, setAbertoResp] = useState(false);
  const [buscaResp, setBuscaResp] = useState("");
  const respWrapRef = useRef<HTMLDivElement>(null);

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
    setAbertoResp(false);
    setBuscaResp("");
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

  // Fecha o picker de responsaveis ao clicar fora (padrao EmojiPicker/detalhe).
  useEffect(() => {
    if (!abertoResp) return;
    function onDown(e: MouseEvent) {
      if (respWrapRef.current && !respWrapRef.current.contains(e.target as Node)) {
        setAbertoResp(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abertoResp]);

  // Membros filtrados pela busca do picker, ordenados por nome.
  const membrosFiltrados = useMemo(() => {
    const q = buscaResp.trim().toLowerCase();
    return membros
      .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [membros, buscaResp]);

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

  // `e` e opcional: o <form onSubmit> passa o evento; o atalho Ctrl/Cmd+Enter
  // chama sem evento (ja tratou o preventDefault no handler de tecla).
  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
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
          team_id: defaultTeamId,
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
        padding: "6vh 16px 24px",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={salvar}
        // Mata o "submit implicito" do HTML: sem isto, Enter em QUALQUER input
        // deste form criava a tarefa com o que estivesse preenchido no
        // instante -- em geral so o titulo, e sem responsavel. Regras em
        // lib/teclasFormulario (textarea e botao seguem funcionando; o atalho
        // deliberado passa a ser Ctrl/Cmd+Enter).
        onKeyDown={(e) => {
          if (ehAtalhoDeSalvar(e)) {
            e.preventDefault();
            if (!saving) void salvar();
            return;
          }
          if (e.key !== "Enter") return;
          if (deveBloquearEnter((e.target as HTMLElement).tagName)) {
            e.preventDefault();
          }
        }}
        style={{
          width: 700, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto",
          background: "var(--surface)",
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
              <div ref={respWrapRef} style={{ position: "relative" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  {assigneeIds.length === 0 && (
                    <span className="muted" style={{ fontSize: 13 }}>Ninguem designado.</span>
                  )}
                  {assigneeIds.map((id) => {
                    const m = membros.find((x) => x.id === id);
                    const nome = m?.name ?? "";
                    const bad = invalidIds.has(id);
                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          borderRadius: 999, padding: "2px 4px 2px 2px", fontSize: 12.5,
                          background: bad ? "rgba(220,38,38,0.08)" : "var(--surface-2)",
                          border: `1px solid ${bad ? "var(--danger)" : "transparent"}`,
                          color: bad ? "var(--danger)" : "var(--text)",
                        }}
                      >
                        <Avatar id={id} name={nome} size="sm" />
                        {nome ? nomeCurto(nome) : "Responsavel"}
                        <button
                          type="button"
                          aria-label={`Remover ${nome || "responsavel"}`}
                          title="Remover"
                          onClick={() => toggleAssignee(id)}
                          style={{
                            width: 16, height: 16, borderRadius: 999, border: "none",
                            background: "transparent", color: "inherit", cursor: "pointer",
                            fontSize: 13, lineHeight: 1, padding: 0,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setAbertoResp((v) => !v)}
                    aria-label="Designar responsavel"
                    aria-expanded={abertoResp}
                    title="Designar"
                    style={GATILHO_STYLE}
                  >
                    {abertoResp ? "×" : "+"}
                  </button>
                </div>

                {abertoResp && (
                  <div
                    style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                      width: 300, maxWidth: "100%",
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
                    }}
                  >
                    <input
                      className="input"
                      placeholder="Buscar pessoa…"
                      value={buscaResp}
                      autoFocus
                      onChange={(e) => setBuscaResp(e.target.value)}
                      // Enter aqui SELECIONA o primeiro da lista filtrada. Era
                      // o pior caso do submit implicito: a pessoa digitava o
                      // nome, apertava Enter esperando escolher, e a tarefa
                      // nascia sem responsavel nenhum. Deixar o Enter inerte
                      // consertaria pela metade -- o que se espera dele aqui e
                      // escolher. Para o form nao ver a tecla (o handler de
                      // cima ja bloquearia, mas explicito e melhor que sorte).
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        e.stopPropagation();
                        const id = primeiroSelecionavel(membrosFiltrados);
                        if (id === null) return;
                        toggleAssignee(id);
                        setBuscaResp("");
                      }}
                    />
                    <div
                      style={{
                        maxHeight: 240, overflowY: "auto", marginTop: 6,
                        border: "1px solid var(--border)", borderRadius: 8,
                      }}
                    >
                      {membrosFiltrados.length === 0 ? (
                        <div className="muted" style={{ fontSize: 13, padding: "10px 12px" }}>
                          Ninguem encontrado.
                        </div>
                      ) : (
                        membrosFiltrados.map((m, i) => {
                          const on = assigneeIds.includes(m.id);
                          const bad = invalidIds.has(m.id);
                          return (
                            <label
                              key={m.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 10,
                                padding: "8px 12px", cursor: "pointer",
                                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleAssignee(m.id)}
                              />
                              <Avatar id={m.id} name={m.name} size="sm" />
                              <span
                                style={{
                                  fontSize: 13.5,
                                  color: bad ? "var(--danger)" : undefined,
                                }}
                              >
                                {m.name}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
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
