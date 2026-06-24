"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import { getProject, ApiError, type Project } from "@/lib/api";

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

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e: ApiError) =>
        setErro(e.status === 404 ? "Projeto nao encontrado." : e.message)
      );
  }, [id]);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!project) return <div className="muted">Carregando…</div>;

  return (
    <div>
      <a
        href="/projetos"
        className="muted"
        style={{ fontSize: 13, display: "inline-block", marginBottom: 10 }}
      >
        ‹ Projetos
      </a>
      <Board projectId={id} title={project.title} />
    </div>
  );
}
