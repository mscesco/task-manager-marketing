"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getMe, clearTokens, getToken, ApiError, type CurrentUser } from "@/lib/api";

// Envolve as telas autenticadas: valida o token, trata o gate de troca de
// senha (409) e desenha o cabecalho com navegacao. Se nao ha sessao, manda
// pro login. Se ha pendencia de senha, manda pra troca.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    getMe()
      .then((u) => {
        if (u.must_change_password) {
          router.replace("/trocar-senha");
          return;
        }
        setUser(u);
        setLoading(false);
      })
      .catch((e: ApiError) => {
        // token invalido/expirado -> volta pro login
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  if (loading) return <div className="center-screen muted">Carregando…</div>;

  const nav = [
    { href: "/quadro", label: "Quadro geral" },
    { href: "/projetos", label: "Projetos" },
    { href: "/minhas-tarefas", label: "Minhas tarefas" },
  ];

  function sair() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 24,
          padding: "0 24px", height: 56, background: "var(--surface)",
          borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10,
        }}
      >
        <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>
          Gestor de Tarefas
        </strong>
        <nav style={{ display: "flex", gap: 4 }}>
          {nav.map((n) => {
            const active = pathname === n.href;
            return (
              <a
                key={n.href}
                href={n.href}
                style={{
                  padding: "7px 12px", borderRadius: 8, fontWeight: 600,
                  fontSize: 14,
                  color: active ? "var(--accent)" : "var(--text-soft)",
                  background: active ? "var(--accent-soft)" : "transparent",
                }}
              >
                {n.label}
              </a>
            );
          })}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>{user?.name}</span>
          <button className="btn btn-ghost" onClick={sair} style={{ padding: "6px 12px" }}>
            Sair
          </button>
        </div>
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
