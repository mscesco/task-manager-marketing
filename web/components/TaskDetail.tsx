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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAssignee,
  removeAssignee,
  createSubtask,
  updateTask,
  moveTask,
  archiveTask,
  unarchiveTask,
  deleteTask,
  listComments,
  createComment,
  editComment,
  deleteComment,
  currentUser,
  ApiError,
  type Task,
  type Comment,
  type CurrentUser,
} from "@/lib/api";
import { PRIORITY_LABEL, PRIORITY_COLOR, STATUSES } from "@/lib/status";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import CommentText from "@/components/CommentText";
import MentionTextarea from "@/components/MentionTextarea";
import { nomeCurto } from "@/lib/people";

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

// Data/hora curta do comentario (ex.: "24/06 14:30"). created_at vem ISO
// com timezone; o browser converte pro fuso local.
function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskDetail({
  task,
  members,
  projects,
  filhos,
  temVoltar,
  onVoltar,
  onClose,
  onEditar,
  onAssigneesChange,
  onAbrirSubtarefa,
  onSubtaskUpsert,
  onTaskMoved,
  onExcluir,
}: {
  task: Task | null; // tarefa focada; null => fechado
  members: Map<string, { name: string }>;
  projects: Map<string, string>; // id do projeto -> titulo (Spec 022)
  filhos: Task[]; // filhos DIRETOS da tarefa focada (do quadro)
  temVoltar: boolean;
  onVoltar: () => void;
  onClose: () => void;
  onEditar: (task: Task) => void;
  onAssigneesChange: (taskId: string, userIds: string[]) => void;
  onAbrirSubtarefa: (sub: Task) => void;
  onSubtaskUpsert: (sub: Task) => void; // criar OU concluir rapido
  onTaskMoved: (task: Task) => void; // Spec 022: task mudou de projeto/avulsa
  onExcluir: (task: Task, cascadeCount: number) => void; // soft-delete cascateado
}) {
  const [assignees, setAssignees] = useState<string[]>([]);
  const [abertoResp, setAbertoResp] = useState(false);
  const [busca, setBusca] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  // Projeto (Spec 022): eco local do project_id exibido -- atualiza no sucesso
  // do move sem depender do round-trip do pai. abertoProj abre o seletor;
  // movendoProj bloqueia (nao-otimista, aplica so no sucesso).
  const [projetoAtual, setProjetoAtual] = useState<string | null>(null);
  const [abertoProj, setAbertoProj] = useState(false);
  const [movendoProj, setMovendoProj] = useState(false);
  const [erroProj, setErroProj] = useState<string | null>(null);

  const [criandoSub, setCriandoSub] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [salvandoSub, setSalvandoSub] = useState(false);
  const [erroSub, setErroSub] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState<Set<string>>(new Set());
  // Status de antes de concluir, pra desmarcar voltar pra ele (sessao).
  const [statusAnterior, setStatusAnterior] = useState<Record<string, string>>({});
  const [arquivando, setArquivando] = useState(false);
  // Exclusao (soft-delete cascateado). Confirmacao inline mostra o estrago.
  const [confirmandoExcluir, setConfirmandoExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // ---- Comentarios (Entrega 14, Fatia 2) ----
  const [comentarios, setComentarios] = useState<Comment[] | null>(null);
  const [erroCom, setErroCom] = useState<string | null>(null);
  const [novoComent, setNovoComent] = useState("");
  const [enviandoComent, setEnviandoComent] = useState(false);
  const [respondendoId, setRespondendoId] = useState<string | null>(null);
  const [textoResposta, setTextoResposta] = useState("");
  const [enviandoResp, setEnviandoResp] = useState(false);
  const topComentRef = useRef<HTMLTextAreaElement>(null);
  const respostaRef = useRef<HTMLTextAreaElement>(null);

  // Insere um trecho (emoji) na posicao do cursor do textarea e mantem foco.
  function inserirNoCursor(
    ref: { current: HTMLTextAreaElement | null },
    valor: string,
    setValor: (s: string) => void,
    trecho: string
  ) {
    const el = ref.current;
    if (!el) {
      setValor(valor + trecho);
      return;
    }
    const ini = el.selectionStart ?? valor.length;
    const fim = el.selectionEnd ?? valor.length;
    setValor(valor.slice(0, ini) + trecho + valor.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      const pos = ini + trecho.length;
      el.setSelectionRange(pos, pos);
    });
  }
  // Usuario logado: define quem ve lapis (autor) e lixeira (autor ou
  // task.delete). Buscado uma vez (currentUser e memoizado no api.ts).
  const [me, setMe] = useState<CurrentUser | null>(null);

  // Reset sempre que abre / troca / navega de tarefa.
  useEffect(() => {
    setAssignees(task?.assignee_ids ?? []);
    setAbertoResp(false);
    setBusca("");
    setErro(null);
    setSaving(new Set());
    setProjetoAtual(task?.project_id ?? null);
    setAbertoProj(false);
    setMovendoProj(false);
    setErroProj(null);
    setCriandoSub(false);
    setNovoTitulo("");
    setErroSub(null);
    setSubSaving(new Set());
    setStatusAnterior({});
    setArquivando(false);
    setComentarios(null);
    setErroCom(null);
    setNovoComent("");
    setEnviandoComent(false);
    setRespondendoId(null);
    setTextoResposta("");
    setEnviandoResp(false);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  // Usuario logado: uma vez (memoizado). Falha silenciosa -> sem acoes
  // inline, mas o thread ainda renderiza.
  useEffect(() => {
    currentUser()
      .then(setMe)
      .catch(() => {});
  }, []);

  // Carrega o thread ao abrir/trocar de tarefa. size 100 cobre threads do
  // tamanho do time sem UI de paginacao (limite conhecido: acima disso,
  // trunca -- aceitavel em v1).
  useEffect(() => {
    if (!task) return;
    let vivo = true;
    setComentarios(null);
    setErroCom(null);
    listComments(task.id, { size: 100 })
      .then((r) => {
        if (vivo) setComentarios(r.items);
      })
      .catch((e: ApiError) => {
        if (vivo) setErroCom(e.message || "Nao consegui carregar os comentarios.");
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name }))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, busca]);

  if (!task) return null;
  const tid = task.id;
  const tidProjeto = task.project_id ?? null; // pai e subtarefa no mesmo projeto
  // Spec 022: task de topo pode trocar/tirar projeto; subtarefa herda do pai
  // (read-only). Nome do projeto atual resolve do Map (null/ausente => avulsa).
  const ehTopo = !task.parent_task_id;
  const nomeProjetoAtual = projetoAtual ? projects.get(projetoAtual) ?? null : null;
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

  // Spec 022: move a task pra outro projeto (destino) OU tira de projeto
  // (destino === null -> detach). NAO otimista: o move reparenta a subtree e
  // pode ser recusado (visibilidade, 422), entao so aplica no sucesso. So faz
  // sentido em task de topo -- a UI abaixo esconde o controle em subtarefa.
  async function mudarProjeto(destino: string | null) {
    if (movendoProj) return;
    // No-op: ja esta no destino.
    if ((projetoAtual ?? null) === destino) {
      setAbertoProj(false);
      return;
    }
    setErroProj(null);
    setMovendoProj(true);
    try {
      const t = await moveTask(
        tid,
        destino === null ? { detach_project: true } : { project_id: destino }
      );
      setProjetoAtual(t.project_id ?? null); // eco local
      setAbertoProj(false);
      onTaskMoved(t); // pai reagrupa/refetcha (Board) ou faz upsert (minhas)
    } catch (e) {
      const err = e as ApiError;
      setErroProj(
        err.status === 403
          ? "Voce nao pode mover esta tarefa."
          : err.status === 422
          ? "Nao foi possivel mover pra esse projeto."
          : err.status === 404
          ? "Projeto nao encontrado ou sem acesso."
          : "Nao consegui mover a tarefa de projeto."
      );
    } finally {
      setMovendoProj(false);
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
      const nova = await createSubtask(tid, t, tidProjeto);
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

  async function alternarArquivo() {
    setErro(null);
    setArquivando(true);
    try {
      const r = task!.is_archived ? await unarchiveTask(tid) : await archiveTask(tid);
      onSubtaskUpsert(r); // upsert generico: o quadro reflete is_archived
    } catch (e) {
      setErro(
        (e as ApiError).status === 403
          ? "Voce nao pode arquivar esta tarefa."
          : "Nao consegui arquivar a tarefa."
      );
    } finally {
      setArquivando(false);
    }
  }

  async function excluir() {
    setErro(null);
    setExcluindo(true);
    try {
      const r = await deleteTask(tid);
      onExcluir(task!, r.cascade_count); // quadro remove a subtree e fecha
    } catch (e) {
      setErro(
        (e as ApiError).status === 403
          ? "Voce nao pode excluir esta tarefa."
          : "Nao consegui excluir a tarefa."
      );
      setExcluindo(false);
    }
  }

  async function enviarComentario() {
    const txt = novoComent.trim();
    if (!txt) return;
    setEnviandoComent(true);
    setErroCom(null);
    try {
      const novo = await createComment(tid, txt);
      setComentarios((prev) => [...(prev ?? []), novo]);
      setNovoComent("");
    } catch (e) {
      setErroCom((e as ApiError).message || "Nao consegui comentar.");
    } finally {
      setEnviandoComent(false);
    }
  }

  async function enviarResposta(parentId: string) {
    const txt = textoResposta.trim();
    if (!txt) return;
    setEnviandoResp(true);
    setErroCom(null);
    try {
      const novo = await createComment(tid, txt, parentId);
      setComentarios((prev) => [...(prev ?? []), novo]);
      setTextoResposta("");
      setRespondendoId(null);
    } catch (e) {
      setErroCom((e as ApiError).message || "Nao consegui responder.");
    } finally {
      setEnviandoResp(false);
    }
  }

  // Edicao devolve o comentario atualizado -> troca em memoria.
  function aoEditado(atualizado: Comment) {
    setComentarios((prev) =>
      prev ? prev.map((c) => (c.id === atualizado.id ? atualizado : c)) : prev
    );
  }

  // Apagar e 204 (sem corpo) e o resultado depende de ter replica viva
  // (some) ou nao (tombstone). Em vez de reimplementar a regra D5 aqui,
  // recarrego o thread -- o backend decide.
  async function recarregarComentarios() {
    try {
      const r = await listComments(tid, { size: 100 });
      setComentarios(r.items);
    } catch (e) {
      setErroCom((e as ApiError).message || "Nao consegui recarregar os comentarios.");
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
          <Badge tone="solid" size="md" color={STATUS_COLOR[task.status]}>
            {STATUS_LABEL[task.status] || task.status}
          </Badge>
          <Badge tone="soft" size="md" color={PRIORITY_COLOR[task.priority]}>
            {PRIORITY_LABEL[task.priority] || task.priority}
          </Badge>
          {/* Spec 022: chip do projeto (glance). Com projeto resolvido -> nome;
              sem projeto (avulsa) -> "Sem projeto"; com projeto NAO resolvido no
              Map (arquivado/fora da lista) -> nao inventa, nao renderiza. */}
          {projetoAtual ? (
            nomeProjetoAtual ? (
              <Badge tone="soft" size="md" color="var(--text-faint)">
                {nomeProjetoAtual}
              </Badge>
            ) : null
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>Sem projeto</span>
          )}
          {task.due_date && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              ◷ {new Date(task.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
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

        {/* ---- Projeto (Spec 022): chip acima; aqui o controle de trocar/tirar.
             So em task de topo -- subtarefa herda o projeto do pai (read-only). ---- */}
        {ehTopo && (
          <div className="field">
            <span className="label">Projeto</span>

            {projetoAtual ? (
              <span
                style={{
                  display: "inline-flex", alignItems: "center",
                  background: "var(--surface-2)", borderRadius: 999,
                  padding: "3px 12px", fontSize: 12.5, alignSelf: "flex-start",
                }}
              >
                {nomeProjetoAtual ?? "Projeto atual"}
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>
                Sem projeto atrelado.
              </span>
            )}

            <button
              type="button" className="btn btn-ghost"
              onClick={() => setAbertoProj((v) => !v)}
              disabled={movendoProj}
              style={{ alignSelf: "flex-start", padding: "6px 10px", marginTop: 2 }}
            >
              {abertoProj
                ? "Fechar"
                : projetoAtual
                ? "Mudar projeto"
                : "Adicionar a um projeto"}
            </button>

            {abertoProj && (
              <div style={{ marginTop: 2 }}>
                <select
                  className="input"
                  value={projetoAtual ?? ""}
                  disabled={movendoProj}
                  onChange={(e) => mudarProjeto(e.target.value || null)}
                >
                  <option value="">— Sem projeto (tirar) —</option>
                  {Array.from(projects.entries())
                    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
                    .map(([id, titulo]) => (
                      <option key={id} value={id}>{titulo}</option>
                    ))}
                </select>
              </div>
            )}

            {movendoProj && (
              <span className="muted" style={{ fontSize: 13, marginTop: 4 }}>Movendo…</span>
            )}
            {erroProj && (
              <div className="error-box" style={{ marginTop: 8 }}>{erroProj}</div>
            )}
          </div>
        )}

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
                    <Avatar id={id} name={nome} size="sm" />
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
                        <Avatar id={m.id} name={m.name} size="sm" />
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
                          <Avatar
                            key={id}
                            id={id}
                            name={members.get(id)?.name}
                            size="xs"
                            title={members.get(id)?.name ?? ""}
                            className="border-[1.5px] border-surface"
                            style={{ marginLeft: j === 0 ? 0 : -5 }}
                          />
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

        {/* ---- Comentarios (Entrega 14) ---- */}
        <div className="field">
          <span className="label">
            Comentarios
            {comentarios && comentarios.length > 0 ? ` (${comentarios.length})` : ""}
          </span>

          {comentarios === null ? (
            <span className="muted" style={{ fontSize: 13 }}>Carregando…</span>
          ) : comentarios.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              Nenhum comentario ainda.
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {comentarios
                .filter((c) => !c.parent_comment_id)
                .map((c) => (
                  <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <LinhaComentario
                      c={c}
                      members={members}
                      me={me}
                      taskId={tid}
                      onEditado={aoEditado}
                      onApagado={recarregarComentarios}
                    />

                    {comentarios
                      .filter((r) => r.parent_comment_id === c.id)
                      .map((r) => (
                        <div key={r.id} style={{ marginLeft: 30 }}>
                          <LinhaComentario
                            c={r}
                            members={members}
                            me={me}
                            taskId={tid}
                            onEditado={aoEditado}
                            onApagado={recarregarComentarios}
                          />
                        </div>
                      ))}

                    {respondendoId === c.id ? (
                      <div style={{ marginLeft: 30, display: "flex", flexDirection: "column", gap: 6 }}>
                        <MentionTextarea
                          ref={respostaRef}
                          value={textoResposta}
                          onChange={setTextoResposta}
                          members={members}
                          autoFocus
                          rows={2}
                          placeholder="Responder… (@ menciona)"
                          disabled={enviandoResp}
                          maxLength={5000}
                          style={{ resize: "vertical" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <EmojiPicker
                            disabled={enviandoResp}
                            onPick={(e) =>
                              inserirNoCursor(
                                respostaRef,
                                textoResposta,
                                setTextoResposta,
                                e
                              )
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => enviarResposta(c.id)}
                            disabled={enviandoResp || !textoResposta.trim()}
                            style={{ padding: "5px 12px", fontSize: 13 }}
                          >
                            {enviandoResp ? "…" : "Responder"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setRespondendoId(null);
                              setTextoResposta("");
                            }}
                            style={{ padding: "5px 12px", fontSize: 13 }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      !c.is_deleted && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setRespondendoId(c.id);
                            setTextoResposta("");
                          }}
                          style={{
                            marginLeft: 30, alignSelf: "flex-start",
                            padding: "2px 8px", fontSize: 12,
                          }}
                        >
                          Responder
                        </button>
                      )
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* caixa de novo comentario (quem ve a tarefa pode comentar) */}
          <MentionTextarea
            ref={topComentRef}
            value={novoComent}
            onChange={setNovoComent}
            members={members}
            rows={2}
            placeholder="Escreva um comentario… (@ menciona)"
            disabled={enviandoComent}
            maxLength={5000}
            wrapperStyle={{ marginTop: 10 }}
            style={{ resize: "vertical" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <EmojiPicker
              disabled={enviandoComent}
              onPick={(e) =>
                inserirNoCursor(topComentRef, novoComent, setNovoComent, e)
              }
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={enviarComentario}
              disabled={enviandoComent || !novoComent.trim()}
              style={{ padding: "6px 12px" }}
            >
              {enviandoComent ? "Enviando…" : "Comentar"}
            </button>
          </div>

          {erroCom && (
            <div className="error-box" style={{ marginTop: 8 }}>{erroCom}</div>
          )}
        </div>

        {confirmandoExcluir && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              marginTop: 4, padding: "10px 12px", borderRadius: 8,
              border: "1px solid var(--danger, #b42318)",
              background: "color-mix(in srgb, var(--danger, #b42318) 8%, transparent)",
            }}
          >
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 220 }}>
              Excluir <strong>{task.title}</strong>? Isto apaga a tarefa e todos os comentários.
              {filhos.length > 0 && (
                <> Também apaga as <strong>{filhos.length}</strong> subtarefa(s) diretas e as subtarefas delas.</>
              )}{" "}
              <strong>Não dá para desfazer pela tela.</strong>
            </span>
            <button
              type="button" className="btn btn-primary" onClick={excluir} disabled={excluindo}
              style={{ padding: "6px 14px", background: "var(--danger, #b42318)", borderColor: "transparent" }}
            >
              {excluindo ? "…" : "Excluir"}
            </button>
            <button
              type="button" className="btn btn-ghost" onClick={() => setConfirmandoExcluir(false)}
              disabled={excluindo} style={{ padding: "6px 14px" }}
            >
              Cancelar
            </button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button" className="btn btn-ghost" onClick={alternarArquivo}
            disabled={arquivando} style={{ marginRight: "auto" }}
          >
            {arquivando ? "…" : task.is_archived ? "Desarquivar" : "Arquivar"}
          </button>
          {(me?.permissions.includes("task.delete") ?? false) && !confirmandoExcluir && (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => { setErro(null); setConfirmandoExcluir(true); }}
              style={{ color: "var(--danger, #b42318)" }}
            >
              Excluir
            </button>
          )}
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

// Uma linha do thread: avatar + autor + hora + conteudo, com acoes inline.
// Lapis (editar) so pro autor; lixeira (apagar) pro autor OU quem tem
// task.delete (mirror do backend). Tombstone nao tem acao. Apagar e 204:
// quem decide tombstone-vs-some e o backend -> a linha so dispara o reload.
function LinhaComentario({
  c,
  members,
  me,
  taskId,
  onEditado,
  onApagado,
}: {
  c: Comment;
  members: Map<string, { name: string }>;
  me: CurrentUser | null;
  taskId: string;
  onEditado: (atualizado: Comment) => void;
  onApagado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(c.content);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroLinha, setErroLinha] = useState<string | null>(null);

  const nome = members.get(c.user_id)?.name ?? "";
  const souAutor = me != null && me.id === c.user_id;
  const podeModerar = me?.permissions.includes("task.delete") ?? false;
  const temAcao = !c.is_deleted && me != null;
  const podeEditar = temAcao && souAutor;
  const podeApagar = temAcao && (souAutor || podeModerar);

  async function salvarEdicao() {
    const t = texto.trim();
    if (!t) return;
    setSalvando(true);
    setErroLinha(null);
    try {
      const atualizado = await editComment(taskId, c.id, t);
      onEditado(atualizado);
      setEditando(false);
    } catch (e) {
      const err = e as ApiError;
      setErroLinha(
        err.status === 403
          ? "So o autor pode editar."
          : err.message || "Nao consegui editar."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    setApagando(true);
    setErroLinha(null);
    try {
      await deleteComment(taskId, c.id);
      setConfirmando(false);
      onApagado(); // recarrega: backend decide tombstone vs some
    } catch (e) {
      const err = e as ApiError;
      setErroLinha(
        err.status === 403
          ? "Voce nao pode apagar este comentario."
          : err.message || "Nao consegui apagar."
      );
      setApagando(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <Avatar
        id={c.user_id}
        name={nome}
        size="md"
        title={nome}
        color={c.is_deleted ? "var(--color-ink-faint)" : undefined}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {nome ? nomeCurto(nome) : "Alguem"}
          </span>
          <span className="muted" style={{ fontSize: 11.5 }}>{quando(c.created_at)}</span>
          {c.edited_at && !c.is_deleted && (
            <span className="muted" style={{ fontSize: 11.5 }}>(editado)</span>
          )}

          {/* acoes inline (lapis / lixeira) */}
          {!editando && !confirmando && (podeEditar || podeApagar) && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {podeEditar && (
                <button
                  type="button" className="btn btn-ghost"
                  onClick={() => {
                    setTexto(c.content);
                    setErroLinha(null);
                    setEditando(true);
                  }}
                  title="Editar"
                  style={{ padding: "0 6px", fontSize: 12 }}
                >
                  ✎
                </button>
              )}
              {podeApagar && (
                <button
                  type="button" className="btn btn-ghost"
                  onClick={() => {
                    setErroLinha(null);
                    setConfirmando(true);
                  }}
                  title="Apagar"
                  style={{ padding: "0 6px", fontSize: 12 }}
                >
                  🗑
                </button>
              )}
            </span>
          )}

          {/* confirmacao de apagar (inline, sem dialog do browser) */}
          {confirmando && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>Apagar?</span>
              <button
                type="button" className="btn btn-ghost"
                onClick={apagar} disabled={apagando}
                style={{ padding: "0 8px", fontSize: 12, color: "var(--danger, #ef4444)" }}
              >
                {apagando ? "…" : "Sim"}
              </button>
              <button
                type="button" className="btn btn-ghost"
                onClick={() => setConfirmando(false)} disabled={apagando}
                style={{ padding: "0 8px", fontSize: 12 }}
              >
                Nao
              </button>
            </span>
          )}
        </div>

        {editando ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <textarea
              className="input"
              autoFocus
              rows={2}
              value={texto}
              disabled={salvando}
              maxLength={5000}
              onChange={(e) => setTexto(e.target.value)}
              style={{ resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button" className="btn btn-primary"
                onClick={salvarEdicao}
                disabled={salvando || !texto.trim()}
                style={{ padding: "4px 12px", fontSize: 13 }}
              >
                {salvando ? "…" : "Salvar"}
              </button>
              <button
                type="button" className="btn btn-ghost"
                onClick={() => {
                  setEditando(false);
                  setTexto(c.content);
                }}
                disabled={salvando}
                style={{ padding: "4px 12px", fontSize: 13 }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: c.is_deleted ? "var(--text-faint)" : "var(--text)",
              fontStyle: c.is_deleted ? "italic" : "normal",
            }}
          >
            <CommentText content={c.content} deleted={c.is_deleted} />
          </div>
        )}

        {erroLinha && (
          <div className="error-box" style={{ marginTop: 6 }}>{erroLinha}</div>
        )}
      </div>
    </div>
  );
}
