"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getMe,
  clearTokens,
  getToken,
  listTeamsAll,
  ApiError,
  type CurrentUser,
  type Team,
} from "@/lib/api";
import { computeLens } from "@/lib/lens";
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
  ChevronDown,
  ChevronRight,
  Columns3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Navegacao lateral retratil. Itens usam a MESMA classe-base `itemCls` ->
// alinham por construcao. Expandido: icone + rotulo. Retraido: so icone.
// Fatia 7b: grupo "Quadros" (accordion, abre com clique) com o Quadro Geral
// + uma sub-aba por subtime da LENTE do usuario (computeLens). Retraido, o
// grupo colapsa pro icone.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [quadrosOpen, setQuadrosOpen] = useState(true); // accordion "Quadros"

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
        // arvore de times para derivar as sub-abas (nao bloqueia a UI)
        listTeamsAll()
          .then(setTeams)
          .catch(() => {});
      })
      .catch((_e: ApiError) => {
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  if (loading) return <div className="center-screen muted">Carregando…</div>;

  // Fatia 2/7b: sub-abas de quadro = subtimes visiveis na lente do usuario.
  const lens = user ? computeLens(user.teams, teams) : null;
  const subteams = lens ? lens.boardSubteams : [];

  // Itens simples (fora do grupo Quadros).
  const nav: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/projetos", label: "Projetos", icon: FolderKanban },
    { href: "/minhas-tarefas", label: "Minhas tarefas", icon: ListChecks },
    { href: "/membros", label: "Membros", icon: Users },
    { href: "/arquivadas", label: "Arquivadas", icon: Archive },
  ];

  function sair() {
    clearTokens();
    router.replace("/login");
  }

  const itemCls = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${
      active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
    } ${open ? "" : "justify-center"}`;

  // Sub-item (indentado sob "Quadros"). So aparece com o menu expandido.
  const subItemCls = (active: boolean) =>
    `flex items-center gap-2 rounded-lg py-1.5 pl-10 pr-3 text-[13px] font-medium ${
      active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
    }`;

  const w = open ? "w-56" : "w-16";
  const geralActive = pathname === "/quadro";
  const algumQuadroAtivo = pathname.startsWith("/quadro");

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 flex h-screen ${w} shrink-0 flex-col gap-1 border-r border-border bg-surface px-2 py-2 transition-[width] duration-200`}
      >
        {/* Logo */}
        <div className={`flex items-center gap-3 py-2 ${open ? "px-3" : "justify-center"}`}>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
            <img src="/fecaf-simbolo.png" alt="UniFECAF" className="h-5 w-5 object-contain" />
          </span>
          {open && (
            <strong className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
              Gestor de Tarefas
            </strong>
          )}
        </div>

        {/* Botao de retrair */}
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
          {/* Grupo QUADROS (accordion). Retraido: vira so o icone, que leva
              ao quadro geral (nao ha espaco pra sub-abas). Expandido:
              cabecalho clicavel que abre/fecha as sub-abas. */}
          {open ? (
            <>
              <button
                type="button"
                onClick={() => setQuadrosOpen((v) => !v)}
                className={itemCls(algumQuadroAtivo && !quadrosOpen)}
                aria-expanded={quadrosOpen}
              >
                <Columns3 size={18} className="shrink-0" />
                <span className="flex-1 truncate text-left">Quadros</span>
                {quadrosOpen ? (
                  <ChevronDown size={16} className="shrink-0 opacity-70" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 opacity-70" />
                )}
              </button>
              {quadrosOpen && (
                <div className="flex flex-col gap-0.5">
                  <a href="/quadro" className={subItemCls(geralActive)}>
                    <span className="truncate">Quadro geral</span>
                  </a>
                  {subteams.map((t) => {
                    const href = `/quadro/${t.id}`;
                    return (
                      <a key={t.id} href={href} className={subItemCls(pathname === href)}>
                        <span className="truncate">{t.name}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <a href="/quadro" title="Quadros" className={itemCls(algumQuadroAtivo)}>
              <Columns3 size={18} className="shrink-0" />
            </a>
          )}

          {/* Demais itens */}
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
          <button type="button" onClick={sair} title={!open ? "Sair" : undefined} className={itemCls(false)}>
            <LogOut size={18} className="shrink-0" />
            {open && <span className="truncate">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Conteudo -- sino flutua no canto, conteudo recua no topo */}
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
