"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import {
  listProjects,
  createProject,
  currentUser,
  ApiError,
  type Project,
  type ProjectStatus,
} from "@/lib/api";

// Projeto e "pasta" -- tudo no time raiz, todos veem. Designar e so nas tasks.
const PROJECT_STATUS: { key: ProjectStatus; label: string; color: string }[] = [
  { key: "PLANNING", label: "Planejamento", color: "#8b8f9a" },
  { key: "ACTIVE", label: "Ativo", color: "#2e7d32" },
  { key: "BLOCKED", label: "Bloqueado", color: "#c62828" },
  { key: "COMPLETED", label: "Concluído", color: "#1565c0" },
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
  const [podeCriar, setPodeCriar] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  useEffect(() => {
    listProjects({ size: 100 })
      // pasta = projeto comum; o pessoal do proprio usuario nao entra aqui.
      .then((r) => setItems(r.items.filter((p) => !p.is_personal)))
      .catch((e: ApiError) => setErro(e.message));
    currentUser()
      .then((me) => setPodeCriar(me.permissions.includes("project.create")))
      .catch(() => {});
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
      setErroForm((e as ApiError).message || "Não consegui criar o projeto.");
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
        actions={
          podeCriar && !criando && (
            <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
              + Novo projeto
            </button>
          )
        }
      />

      {criando && (
        <Card className="mb-[18px] flex max-w-[860px] flex-col gap-3">
          <div className="field">
            <span className="label">Título do projeto</span>
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
          action={
            podeCriar && (
              <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
                + Novo projeto
              </button>
            )
          }
        />
      ) : (
        /* ⚠️ LINHAS DE LARGURA CHEIA, e não grade de cartões (22/08). O
           `Projetos.png` desenha faixas empilhadas, e a Camila confirmou o que
           elas carregam: "essas faixas é pra ter o nome do projeto e o status".
           O conteúdo já era esse -- o que mudou foi a forma.

           ⚠️ E A FORMA IMPORTA AQUI: em grade, o nome de um projeto longo
           quebrava em duas linhas dentro de 260px, e o olho comparava cartões
           de alturas diferentes. Em linha, os nomes ficam alinhados na mesma
           coluna e a lista se lê de cima para baixo, que é como se procura um
           projeto pelo nome. */
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 0, maxWidth: 860,
            border: "1px solid var(--border)", borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {items.map((p, i) => (
            <a
              key={p.id}
              href={`/projetos/${p.id}`}
              className="tappable"
              style={{
                background: "var(--surface)", textDecoration: "none", color: "inherit",
                // A borda de cima faz a divisória entre linhas; a primeira não
                // tem, senão dobraria com a borda do container.
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 10,
                opacity: p.is_archived ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                  background: STATUS_COLOR[p.status] || "#999",
                }}
              />
              {/* ⚠️ `minWidth: 0` no que encolhe: sem ele, um nome longo
                  empurra o status para fora da linha em vez de truncar. Mesma
                  armadilha do título do card, registrada no `web/AGENTS.md`. */}
              <span
                style={{
                  fontSize: 14, fontWeight: 600, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {p.title}
              </span>
              {p.description && p.description.trim().length > 0 && (
                <span
                  className="muted"
                  title={p.description}
                  style={{
                    fontSize: 12.5, minWidth: 0, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {p.description}
                </span>
              )}
              {/* O status vai para a DIREITA e é o que a Camila nomeou junto do
                  título como o conteúdo da faixa. `marginLeft: auto` só quando
                  não há descrição ocupando o meio. */}
              <span
                className="muted"
                style={{
                  fontSize: 12, flexShrink: 0,
                  marginLeft: p.description?.trim() ? undefined : "auto",
                }}
              >
                {STATUS_LABEL[p.status] || p.status}
                {p.is_archived && " · arquivado"}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
