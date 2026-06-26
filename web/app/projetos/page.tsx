"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import {
  listProjects,
  createProject,
  ApiError,
  type Project,
  type ProjectStatus,
} from "@/lib/api";

// Projeto e "pasta" -- tudo no time raiz, todos veem. Designar e so nas tasks.
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

export default function ProjetosPage() {
  return (
    <AppShell>
      <Projetos />
    </AppShell>
  );
}

function Projetos() {
  const [items, setItems] = useState<Project[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  useEffect(() => {
    listProjects({ size: 100 })
      // pasta = projeto comum; o pessoal do proprio usuario nao entra aqui.
      .then((r) => setItems(r.items.filter((p) => !p.is_personal)))
      .catch((e: ApiError) => setErro(e.message));
  }, []);

  async function criar() {
    const t = titulo.trim();
    if (!t) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createProject({ title: t, status });
      setItems((prev) => [novo, ...(prev ?? [])]);
      setTitulo("");
      setStatus("PLANNING");
      setCriando(false);
    } catch (e) {
      setErroForm((e as ApiError).message || "Nao consegui criar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <div className="muted">Carregando…</div>;

  return (
    <div>
      <PageHeader
        title="Projetos"
        count={`${items.length} projetos`}
        className="max-w-[860px]"
        actions={
          !criando && (
            <button type="button" className="btn btn-primary ml-auto" onClick={() => setCriando(true)}>
              + Novo projeto
            </button>
          )
        }
      />

      {criando && (
        <Card className="mb-[18px] flex max-w-[860px] flex-col gap-3">
          <div className="field">
            <span className="label">Titulo do projeto</span>
            <input
              className="input"
              autoFocus
              placeholder="Ex.: Campanha Q3"
              value={titulo}
              maxLength={255}
              disabled={salvando}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  criar();
                } else if (e.key === "Escape") {
                  setCriando(false);
                  setTitulo("");
                }
              }}
            />
          </div>
          <div className="field">
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
          {erroForm && <div className="error-box">{erroForm}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost" disabled={salvando}
              onClick={() => { setCriando(false); setTitulo(""); setErroForm(null); }}
            >
              Cancelar
            </button>
            <button
              type="button" className="btn btn-primary" disabled={salvando || !titulo.trim()}
              onClick={criar}
            >
              {salvando ? "Criando…" : "Criar projeto"}
            </button>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nenhum projeto ainda"
          description="Crie um projeto para agrupar tarefas de um trabalho maior."
        />
      ) : (
        <div
          style={{
            display: "grid", gap: 12, maxWidth: 860,
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}
        >
          {items.map((p) => (
            <a
              key={p.id}
              href={`/projetos/${p.id}`}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 16, textDecoration: "none", color: "inherit",
                display: "flex", flexDirection: "column", gap: 8,
                opacity: p.is_archived ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                    background: STATUS_COLOR[p.status] || "#999",
                  }}
                />
                <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{p.title}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {STATUS_LABEL[p.status] || p.status}
                </span>
                {p.is_archived && (
                  <span className="muted" style={{ fontSize: 12 }}>· arquivado</span>
                )}
              </div>
              {p.description && p.description.trim().length > 0 && (
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                  {p.description}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
