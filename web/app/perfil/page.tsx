"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { currentUser, ApiError, type CurrentUser } from "@/lib/api";

// Perfil v1: SO leitura (nome, e-mail, papeis) + atalho pra trocar senha.
// Editar nome/avatar nao existe no backend -> fora desta entrega (ADR 0009).
const PAPEL_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

export default function PerfilPage() {
  return (
    <AppShell>
      <Perfil />
    </AppShell>
  );
}

function Perfil() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    currentUser()
      .then(setMe)
      .catch((e: ApiError) => setErro(e.message || "Nao consegui carregar seu perfil."));
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!me) return <div className="muted">Carregando…</div>;

  const papeis =
    me.roles.length > 0
      ? me.roles.map((r) => PAPEL_LABEL[r] ?? r).join(", ")
      : "Sem papel atribuido";

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ margin: "0 0 18px", fontSize: 19, letterSpacing: "-0.02em" }}>
        Meu perfil
      </h1>

      <div
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, padding: 20,
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div className="field">
          <span className="label">Nome</span>
          <div style={{ fontSize: 14 }}>{me.name}</div>
        </div>
        <div className="field">
          <span className="label">E-mail</span>
          <div style={{ fontSize: 14 }}>{me.email}</div>
        </div>
        <div className="field">
          <span className="label">Papeis</span>
          <div style={{ fontSize: 14 }}>{papeis}</div>
        </div>

        <a
          href="/trocar-senha"
          className="btn btn-primary"
          style={{ alignSelf: "flex-start", padding: "8px 14px", textDecoration: "none" }}
        >
          Trocar senha
        </a>
      </div>
    </div>
  );
}
