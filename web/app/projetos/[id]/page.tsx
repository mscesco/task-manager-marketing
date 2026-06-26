"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import Card from "@/components/Card";
import {
  getProject,
  updateProject,
  currentUser,
  ApiError,
  type Project,
  type ProjectStatus,
  type ProjectUpdateInput,
} from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/status";

// Status de PROJETO (proprio; difere do status de TASK em lib/status).
// Duplicado de app/projetos/page.tsx de proposito, para manter esta
// entrega em UM arquivo. Divida cosmetica: extrair para lib se desejado.
const PROJECT_STATUS: { key: ProjectStatus; label: string; color: string }[] = [
  { key: "PLANNING", label: "Planejamento", color: "#8b8f9a" },
  { key: "ACTIVE", label: "Ativo", color: "#2e7d32" },
  { key: "BLOCKED", label: "Bloqueado", color: "#c62828" },
  { key: "COMPLETED", label: "Concluido", color: "#1565c0" },
  { key: "CANCELLED", label: "Cancelado", color: "#9e9e9e" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.color])
);
const PRIORITY_KEYS = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// YYYY-MM-DD -> DD/MM/YYYY sem passar por Date (evita o parse UTC que
// erra o dia em UTC-3). String pura, zero timezone.
function dataBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export default function ProjetoPage() {
  return (
    <AppShell>
      <Projeto />
    </AppShell>
  );
}

function Projeto() {
  const params = useParams();
  const id = String(params.id);
  const [project, setProject] = useState<Project | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e: ApiError) =>
        setErro(e.status === 404 ? "Projeto nao encontrado." : e.message)
      );
  }, [id]);

  useEffect(() => {
    currentUser()
      .then((me) => setPodeEditar(me.permissions.includes("project.update")))
      .catch(() => setPodeEditar(false));
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!project) return <div className="muted">Carregando…</div>;

  // Pessoal nunca edita por aqui (backend devolve 409). A lista ja filtra
  // pessoal; guardamos defensivamente tambem na detalhe.
  const editavel = podeEditar && !project.is_personal;

  return (
    <div>
      <div style={{ maxWidth: 860 }}>
        <a
          href="/projetos"
          className="muted"
          style={{ fontSize: 13, display: "inline-block", marginBottom: 10 }}
        >
          ‹ Projetos
        </a>

        <div
          style={{
            display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", gap: 12, marginBottom: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  width: 10, height: 10, borderRadius: 999, flexShrink: 0,
                  background: STATUS_COLOR[project.status] || "#999",
                }}
              />
              <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>
                {project.title}
              </h1>
            </div>
            <div
              className="muted"
              style={{
                fontSize: 13, marginTop: 6, display: "flex",
                gap: 12, flexWrap: "wrap",
              }}
            >
              <span>{STATUS_LABEL[project.status] || project.status}</span>
              <span>
                Prioridade: {PRIORITY_LABEL[project.priority] || project.priority}
              </span>
              {project.start_date && <span>Inicio: {dataBR(project.start_date)}</span>}
              {project.due_date && <span>Prazo: {dataBR(project.due_date)}</span>}
              {project.is_archived && <span>· arquivado</span>}
            </div>
            {project.description && project.description.trim().length > 0 && (
              <p
                className="muted"
                style={{ fontSize: 13, marginTop: 8, lineHeight: 1.45, maxWidth: 680 }}
              >
                {project.description}
              </p>
            )}
          </div>
          {editavel && !editando && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEditando(true)}
              style={{ flexShrink: 0 }}
            >
              Editar
            </button>
          )}
        </div>

        {editavel && editando && (
          <EditPanel
            project={project}
            onCancel={() => setEditando(false)}
            onSaved={(p) => {
              setProject(p);
              setEditando(false);
            }}
          />
        )}
      </div>

      {/* Board fica FORA do maxWidth -- preserva a largura original do quadro. */}
      <Board projectId={id} title={project.title} />
    </div>
  );
}

function EditPanel({
  project,
  onCancel,
  onSaved,
}: {
  project: Project;
  onCancel: () => void;
  onSaved: (p: Project) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [priority, setPriority] = useState<string>(project.priority || "MEDIUM");
  const [startDate, setStartDate] = useState(project.start_date ?? "");
  const [dueDate, setDueDate] = useState(project.due_date ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  async function salvar() {
    const t = title.trim();
    if (!t) {
      setErroForm("Titulo nao pode ser vazio.");
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      // Datas: o PATCH do backend nao LIMPA (None = "nao mexer"). Por isso
      // so enviamos a data quando ha valor; campo esvaziado e OMITIDO e a
      // data atual permanece. Remover data exigiria backend -- fora daqui.
      const patch: ProjectUpdateInput = {
        title: t,
        description,
        status,
        priority,
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      };
      const atualizado = await updateProject(project.id, patch);
      onSaved(atualizado);
    } catch (e) {
      setErroForm((e as ApiError).message || "Nao consegui salvar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="mb-[18px] flex flex-col gap-3">
      <div className="field">
        <span className="label">Titulo</span>
        <input
          className="input"
          value={title}
          maxLength={255}
          disabled={salvando}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="label">Descricao</span>
        <textarea
          className="input"
          value={description}
          rows={3}
          disabled={salvando}
          style={{ resize: "vertical" }}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Status</span>
          <select
            className="input"
            value={status}
            disabled={salvando}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          >
            {PROJECT_STATUS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Prioridade</span>
          <select
            className="input"
            value={priority}
            disabled={salvando}
            onChange={(e) => setPriority(e.target.value)}
          >
            {PRIORITY_KEYS.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p] || p}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Inicio</span>
          <input
            className="input"
            type="date"
            value={startDate}
            disabled={salvando}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Prazo</span>
          <input
            className="input"
            type="date"
            value={dueDate}
            disabled={salvando}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        Datas so podem ser alteradas, nao removidas (limitacao atual do backend).
      </span>
      {erroForm && <div className="error-box">{erroForm}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={salvando}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={salvando || !title.trim()}
          onClick={salvar}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Card>
  );
}
