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
import {
  lerTema,
  gravarTema,
  aplicarTema,
  observarTemaDoSistema,
  proximoTema,
  ROTULO_TEMA,
  type Tema,
} from "@/lib/tema";
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
  Inbox,
  Sun,
  Moon,
  Monitor,
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
  // Preferencia de tema. Ler localStorage no inicializador e seguro aqui: com
  // `loading` comecando true, a barra so renderiza depois do check de auth, ja
  // no cliente -- entao nao ha divergencia de hidratacao com o SSR.
  const [tema, setTema] = useState<Tema>(lerTema);

  // Pinta o tema quando a preferencia muda. Na montagem apenas confirma o que
  // o script bloqueante do layout ja aplicou (nao ha piscada).
  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  // Com "sistema", acompanhar o SO em tempo real: a pessoa troca o tema do
  // Windows e o app vira junto, sem F5. Nos modos explicitos a escolha manda.
  useEffect(() => {
    if (tema !== "sistema") return;
    return observarTemaDoSistema(() => aplicarTema("sistema"));
  }, [tema]);

  function trocarTema() {
    const prox = proximoTema(tema);
    setTema(prox);
    gravarTema(prox); // grava so quando a pessoa AGE, nao a cada montagem
  }

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

  // Spec 025/D11: a fila de solicitações é do time principal. Só quem
  // tem `solicitation.review` (ADMIN/MANAGER — que, pela invariante da
  // Spec 024, só existem na raiz) enxerga a aba. O backend também barra
  // por 403; esconder aqui evita oferecer uma porta que não abre.
  const podeVerSolicitacoes =
    user?.permissions.includes("solicitation.review") ?? false;

  // Itens simples (fora do grupo Quadros).
  const nav: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/projetos", label: "Projetos", icon: FolderKanban },
    { href: "/minhas-tarefas", label: "Minhas tarefas", icon: ListChecks },
    ...(podeVerSolicitacoes
      ? [{ href: "/solicitacoes", label: "Solicitações", icon: Inbox }]
      : []),
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
          <button
            type="button"
            onClick={trocarTema}
            // Cicla claro -> escuro -> sistema. Um botao so (em vez de tres
            // opcoes lado a lado) porque a barra retrai pra 16px de largura:
            // um controle segmentado nao caberia e viraria um segundo layout
            // pra manter. O rotulo diz o estado atual, entao nao vira adivinha.
            title={ROTULO_TEMA[tema]}
            aria-label={ROTULO_TEMA[tema]}
            className={itemCls(false)}
          >
            {tema === "claro" ? (
              <Sun size={18} className="shrink-0" />
            ) : tema === "escuro" ? (
              <Moon size={18} className="shrink-0" />
            ) : (
              <Monitor size={18} className="shrink-0" />
            )}
            {open && <span className="truncate">{ROTULO_TEMA[tema]}</span>}
          </button>
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
