"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getMe, clearTokens, getToken, ApiError, type CurrentUser } from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";
import {
  LayoutGrid,
  FolderKanban,
  ListChecks,
  Users,
  Archive,
  User,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Navegacao lateral retratil. Todos os itens (nav, botao de retrair, perfil,
// sair) usam a MESMA classe-base `itemCls` -> alinham por construcao, sem
// numero magico. Expandido: icone + rotulo. Retraido: so icone, com tooltip.
// Sem faixa superior: o sino flutua no canto sup. direito, e o conteudo tem
// recuo no topo (pt) pra ele nao cobrir nada.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

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
      .catch((_e: ApiError) => {
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  if (loading) return <div className="center-screen muted">Carregando…</div>;

  const nav: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/quadro", label: "Quadro geral", icon: LayoutGrid },
    { href: "/projetos", label: "Projetos", icon: FolderKanban },
    { href: "/minhas-tarefas", label: "Minhas tarefas", icon: ListChecks },
    { href: "/membros", label: "Membros", icon: Users },
    { href: "/arquivadas", label: "Arquivadas", icon: Archive },
  ];

  function sair() {
    clearTokens();
    router.replace("/login");
  }

  // Classe-base compartilhada por TODOS os itens clicaveis do menu.
  // Retraido (open=false): centraliza o icone. Expandido: icone + texto.
  const itemCls = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${
      active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
    } ${open ? "" : "justify-center"}`;

  const w = open ? "w-56" : "w-16";

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 flex h-screen ${w} shrink-0 flex-col gap-1 border-r border-border bg-surface px-2 py-2 transition-[width] duration-200`}
      >
        {/* Logo -- mesmo padrao do Avatar.tsx: wrapper inline-flex de
            tamanho FIXO (nunca estica em linha flex). O fundo azul mora no
            wrapper travado, nao num container flex. */}
        <div className={`flex items-center gap-3 py-2 ${open ? "px-3" : "justify-center"}`}>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
            <img
              src="/fecaf-simbolo.png"
              alt="UniFECAF"
              className="h-5 w-5 object-contain"
            />
          </span>
          {open && (
            <strong className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
              Gestor de Tarefas
            </strong>
          )}
        </div>

        {/* Botao de retrair -- mesma classe-base dos itens */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={open ? "Retrair menu" : "Expandir menu"}
          aria-label={open ? "Retrair menu" : "Expandir menu"}
          className={itemCls(false)}
        >
          {open ? <PanelLeftClose size={18} className="shrink-0" /> : <PanelLeftOpen size={18} className="shrink-0" />}
          {open && <span className="truncate">Retrair</span>}
        </button>

        {/* Navegacao */}
        <nav className="mt-1 flex flex-1 flex-col gap-1">
          {nav.map((n) => {
            const active = pathname === n.href;
            const Icon = n.icon;
            return (
              <a
                key={n.href}
                href={n.href}
                title={!open ? n.label : undefined}
                className={itemCls(active)}
              >
                <Icon size={18} className="shrink-0" />
                {open && <span className="truncate">{n.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Rodape: perfil + sair */}
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <a
            href="/perfil"
            title={!open ? "Meu perfil" : undefined}
            className={itemCls(pathname === "/perfil")}
          >
            <User size={18} className="shrink-0" />
            {open && <span className="truncate">{user?.name}</span>}
          </a>
          <button
            type="button"
            onClick={sair}
            title={!open ? "Sair" : undefined}
            className={itemCls(false)}
          >
            <LogOut size={18} className="shrink-0" />
            {open && <span className="truncate">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Conteudo -- sino flutua no canto, conteudo recua no topo (pt-16) */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute right-4 top-3 z-20 sm:right-6">
          <div className="pointer-events-auto rounded-lg border border-border bg-surface shadow-card">
            <NotificationBell />
          </div>
        </div>
        <main className="min-w-0 flex-1 px-4 pb-4 pt-16 sm:px-6 sm:pb-6">{children}</main>
      </div>
    </div>
  );
}
