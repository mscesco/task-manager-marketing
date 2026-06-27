"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getMe, clearTokens, getToken, ApiError, type CurrentUser } from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";

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
    { href: "/membros", label: "Membros" },
    { href: "/arquivadas", label: "Arquivadas" },
  ];

  function sair() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:gap-6 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <img
            src="/fecaf-simbolo.png"
            alt="UniFECAF"
            className="h-7 w-7 rounded-md bg-accent p-1"
          />
          <strong className="text-[15px] font-bold tracking-[-0.01em]">
            Gestor de Tarefas
          </strong>
        </div>
        <nav className="flex min-w-0 gap-1 overflow-x-auto">
          {nav.map((n) => {
            const active = pathname === n.href;
            return (
              <a
                key={n.href}
                href={n.href}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  active ? "bg-accent-soft text-accent" : "text-ink-soft"
                }`}
              >
                {n.label}
              </a>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <NotificationBell />
          <a
            href="/perfil"
            title="Meu perfil"
            className={`max-w-[110px] truncate rounded-lg px-2.5 py-1 text-[13px] font-semibold sm:max-w-none ${
              pathname === "/perfil" ? "bg-accent-soft text-accent" : "text-ink-soft"
            }`}
          >
            {user?.name}
          </a>
          <button className="btn btn-ghost" onClick={sair} style={{ padding: "6px 12px" }}>
            Sair
          </button>
        </div>
      </header>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
