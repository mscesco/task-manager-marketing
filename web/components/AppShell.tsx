"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getMe,
  clearTokens,
  getToken,
  logout,
  listTeamsAll,
  getWorkspace,
  TIMES_MUDARAM,
  NOME_MUDOU,
  ApiError,
  type CurrentUser,
  type Team,
} from "@/lib/api";
import { podeAbrirOrganizacao } from "@/lib/organization";
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
import {
  lerBarraAberta,
  gravarBarraAberta,
  lerQuadrosAberto,
  gravarQuadrosAberto,
  barraExpandida,
} from "@/lib/sidebar";
import { useFaixaDeTela } from "@/lib/useFaixaDeTela";
import NotificationBell from "@/components/NotificationBell";
import OnirosMark from "@/components/OnirosMark";
import ContextSwitcher from "@/components/ContextSwitcher";
import TeamParamReader from "@/components/TeamParamReader";
import { ActiveTeamProvider } from "@/lib/useActiveTeam";
import { TemaProvider } from "@/lib/useTema";
import {
  ownRootTeams,
  peopleEntryFor,
  rootsForPerson,
} from "@/lib/contextSwitcher";
import {
  activeTeam,
  preferredTeams,
  navHref,
  publishedActiveTeam,
  teamUrlToWrite,
} from "@/lib/activeTeam";
import { rootBoardUrl } from "@/lib/rootTeams";
import {
  FolderKanban,
  ListChecks,
  Users,
  Archive,
  User,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronRight,
  Columns3,
  Inbox,
  ClipboardList,
  Sun,
  Moon,
  Monitor,
  Table2,
  House,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LoadingScreen } from "@/components/Loading";
import { AvisosProvider } from "@/components/Toasts";
// Casca do app: barra lateral (retrátil; gaveta no celular, sobreposta no
// tablet), time ativo da barra e conteúdo. Grupo "Quadros" = quadro geral +
// subtimes da lente (`computeLens`) no time ativo.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Lidos do localStorage no inicializador: a navegação é recarga total, e com
  // `loading` começando true a barra só desenha no cliente.
  const [preferenciaAberta, setPreferenciaAberta] = useState(lerBarraAberta);
  // Celular e tablet: o menu abre por cima do conteúdo, sem gravar a preferência.
  const faixa = useFaixaDeTela();
  const [gaveta, setGaveta] = useState(false);
  const sobreposta = faixa !== "computador" && gaveta;
  const open = barraExpandida(faixa, preferenciaAberta, gaveta);
  const gatilhoDaGavetaRef = useRef<HTMLButtonElement | null>(null);
  const retrairRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!sobreposta) return;
    retrairRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGaveta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      // Devolve o foco por qualquer caminho de fechar. Aqui, e nao no clique:
      // antes do commit o botao ainda esta `inert` e recusaria o foco. O
      // tablet nao tem o botao da barra: o foco volta ao "Retrair".
      (gatilhoDaGavetaRef.current ?? retrairRef.current)?.focus();
    };
  }, [sobreposta]);
  // Trocar de tela ou girar o aparelho fecha a gaveta.
  useEffect(() => setGaveta(false), [pathname, faixa]);
  const [teams, setTeams] = useState<Team[]>([]);
  // Nome da organização, mostrado no rodapé quando a tela não tem time na URL.
  const [orgName, setOrgName] = useState("");
  // Query da URL, entregue pelo `TeamParamReader`. `null` = ainda não lida
  // (`teamUrlToWrite` não reescreve por cima de um `?time=`), `""` = vazia.
  const [search, setSearch] = useState<string | null>(null);
  // A árvore de times já foi perguntada (com sucesso ou não); ver `publishedActiveTeam`.
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [quadrosOpen, setQuadrosOpen] = useState(lerQuadrosAberto); // accordion
  // Ler localStorage no inicializador é seguro: a barra só renderiza no cliente.
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

  function mudarTema(prox: Tema) {
    setTema(prox);
    gravarTema(prox); // grava so quando a pessoa AGE, nao a cada montagem
  }
  function trocarTema() {
    mudarTema(proximoTema(tema));
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
          .catch(() => {})
          // `finally`: se a árvore falhar, as telas precisam saber que a pergunta foi respondida.
          .finally(() => setTeamsLoaded(true));
        // Sem bloquear; sem o nome o seletor cai no rótulo "Organização".
        getWorkspace()
          .then((ws) => setOrgName(ws.name))
          .catch(() => {});
      })
      .catch((_e: ApiError) => {
        // Sem `logout()`: a sessão já está morta, não há o que revogar.
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  // Toda mutação de time dispara `TIMES_MUDARAM` (via `invalidateTeams()`), e a barra relê.
  useEffect(() => {
    const reler = () => {
      listTeamsAll()
        .then(setTeams)
        .catch(() => {});
    };
    window.addEventListener(TIMES_MUDARAM, reler);
    return () => window.removeEventListener(TIMES_MUDARAM, reler);
  }, []);

  // O próprio nome muda no `/perfil`; o novo vem no `detail`.
  useEffect(() => {
    const trocar = (e: Event) => {
      const novo = (e as CustomEvent<string>).detail;
      setUser((u) => (u ? { ...u, name: novo } : u));
    };
    window.addEventListener(NOME_MUDOU, trocar);
    return () => window.removeEventListener(NOME_MUDOU, trocar);
  }, []);

  // Papel de organização, não permissão: papel de time ADMIN também carrega as
  // permissões de organização. Entra no alcance da lente.
  const podeVerOrganizacao = podeAbrirOrganizacao(user);

  // Onde a pessoa alcança e onde trabalha divergem para quem administra a organização.
  const alcanca = rootsForPerson(teams, user, podeVerOrganizacao);
  const trabalha = ownRootTeams(teams, user);
  const preferidos = preferredTeams(alcanca, trabalha);

  // Time ativo da barra: caminho, depois `?time=`, depois onde a pessoa trabalha.
  const contexto = activeTeam(pathname, search ?? "", teams, alcanca, trabalha);
  // O que a barra publica, calculado uma vez para as telas e para os links do menu.
  const publicado = publishedActiveTeam(contexto, teamsLoaded, search);
  const timeAtivo = contexto.kind === "team" ? contexto.teamId : null;

  // A barra reescreve a URL com o time inferido (`replace`); `teamUrlToWrite`
  // devolve `null` depois disso, então não há laço.
  const urlComTime = teamUrlToWrite(pathname, contexto, search);
  useEffect(() => {
    if (urlComTime) router.replace(urlComTime);
  }, [urlComTime, router]);

  if (loading) return <LoadingScreen />;



  // Sub-abas de quadro = subtimes do time ativo que a lente alcança.
  const lens = user
    ? computeLens(user.teams, teams, user.roles, timeAtivo)
    : null;
  const subteams = lens ? lens.boardSubteams : [];

  // A fila de solicitações; o backend também barra.
  const podeVerSolicitacoes =
    user?.permissions.includes("solicitation.read") ?? false;

  // Permissão própria, separada da triagem de solicitações.
  const podeGerirFormularios =
    user?.permissions.includes("form.read") ?? false;

  // Quais bases, decide o servidor (`GET /bases`); aqui é só se o item aparece.
  const podeVerBases = user?.permissions.includes("base.read") ?? false;

  // "Time" aponta para `/times/<id>`: o time ativo, senão o primeiro preferido.
  const entradaDoTime = peopleEntryFor(publicado, preferidos);

  // Itens simples (fora do grupo Quadros).
  const nav: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/projetos", label: "Projetos", icon: FolderKanban },
    { href: "/minhas-tarefas", label: "Minhas tarefas", icon: ListChecks },
    ...(podeVerSolicitacoes
      ? [{ href: "/solicitacoes", label: "Solicitações", icon: Inbox }]
      : []),
    ...(podeGerirFormularios
      ? [{ href: "/formularios", label: "Formulários", icon: ClipboardList }]
      : []),
    ...(podeVerBases ? [{ href: "/bases", label: "Bases", icon: Table2 }] : []),
    // Sem time, sem entrada: um item que não leva a lugar nenhum é pior que nenhum.
    ...(entradaDoTime.kind === "team"
      ? [
          {
            href: `/times/${entradaDoTime.teamId}`,
            label: "Time",
            icon: Users,
          },
        ]
      : []),
    // Organização e lista de times não ficam no menu: estão no `ContextSwitcher`.
    { href: "/arquivadas", label: "Arquivadas", icon: Archive },
  ];

  function sair() {
    // Avisa o servidor antes de limpar o localStorage (a função lê o token
    // na primeira linha síncrona). Sem await: sair não espera rede; ela nunca lança.
    void logout();
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
  // Quadro geral do time ativo; sem time ativo, `/quadro` decide sozinho.
  const hrefGeral = timeAtivo ? rootBoardUrl(timeAtivo) : "/quadro";
  // Ativo casa com `/quadro` (link antigo) e com `/quadro/<ativo>`.
  const geralActive = pathname === "/quadro" || pathname === hrefGeral;
  const algumQuadroAtivo = pathname.startsWith("/quadro");

  return (
    <AvisosProvider>
    <div className="flex min-h-dvh">
      {/* Fronteira de `Suspense` do `?time=`, irmã (não ancestral) para as telas
          não remontarem. Ver `TeamParamReader.tsx`. */}
      <Suspense fallback={null}>
        <TeamParamReader onSearch={setSearch} />
      </Suspense>
      {/* `min-h-0` + `overflow-y-auto` no <nav>: sem eles, com zoom o menu
          passa de 100vh e o fim fica inalcançável. O `overflow-y-auto` do
          <aside> é o último recurso. */}
      {/* Tablet: reserva a largura dos ícones e o menu aberto passa por cima. */}
      {faixa === "tablet" && <div className="w-16 shrink-0 print:hidden" aria-hidden="true" />}
      {sobreposta && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(16,24,40,0.45)] print:hidden"
          aria-hidden="true"
          onClick={() => setGaveta(false)}
        />
      )}
      <aside
        // `print:hidden`: exportar em PDF imprime só o conteúdo.
        className={`flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-2 py-2 duration-200 print:hidden ${
          faixa === "computador"
            ? `sticky top-0 h-dvh transition-[width] ${w}`
            : faixa === "tablet"
              ? `fixed inset-y-0 left-0 transition-[width] ${w} ${gaveta ? "z-50" : "z-30"}`
              : // `invisible` tira os links do Tab enquanto a gaveta esta fechada.
                // Aberta, sem `translate`: ele recortaria o `AnchoredPanel` (`fixed`).
                // A visibilidade só anima ao fechar: invisível, a gaveta recusaria o foco.
                `fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] ${
                  gaveta
                    ? "transition-[translate]"
                    : "invisible -translate-x-full transition-[translate,visibility]"
                }`
        }`}
      >
        {/* Logo */}
        <div className={`flex shrink-0 items-center gap-3 py-2 ${open ? "px-3" : "justify-center"}`}>
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center logo-marca rounded-md"
            aria-hidden="true"
          >
            <OnirosMark className="h-6 w-6" />
          </span>
          {open ? (
            <strong className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
              Oniros
            </strong>
          ) : (
            <span className="sr-only">Oniros</span>
          )}
        </div>

        {/* Botao de retrair */}
        <button
          type="button"
          // Grava no clique, não num efeito: efeito gravaria também na montagem.
          ref={retrairRef}
          onClick={() => {
            if (faixa !== "computador") {
              setGaveta((v) => !v);
              return;
            }
            setPreferenciaAberta((v) => {
              gravarBarraAberta(!v);
              return !v;
            });
          }}
          title={open ? "Retrair menu" : "Expandir menu"}
          aria-label={open ? "Retrair menu" : "Expandir menu"}
          className={`${itemCls(false)} shrink-0`}
        >
          {open ? <PanelLeftClose size={18} className="shrink-0" /> : <PanelLeftOpen size={18} className="shrink-0" />}
          {open && <span className="truncate">Retrair</span>}
        </button>

        {/* Navegacao */}
        <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {/* Início: primeiro item, leva o `?time=` da barra (`navHref`). */}
          <a
            href={navHref("/inicio", publicado)}
            title={!open ? "Início" : undefined}
            aria-label={!open ? "Início" : undefined}
            className={itemCls(pathname === "/inicio")}
          >
            <House size={18} className="shrink-0" />
            {open && <span className="truncate">Início</span>}
          </a>
          {/* Grupo QUADROS (accordion). Retraido: vira so o icone, que leva
              ao quadro geral (nao ha espaco pra sub-abas). Expandido:
              cabecalho clicavel que abre/fecha as sub-abas. */}
          {open ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setQuadrosOpen((v) => {
                    gravarQuadrosAberto(!v);
                    return !v;
                  });
                }}
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
                  <a href={hrefGeral} className={subItemCls(geralActive)}>
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
            <a href={hrefGeral} title="Quadros" aria-label="Quadros" className={itemCls(algumQuadroAtivo)}>
              <Columns3 size={18} className="shrink-0" />
            </a>
          )}

          {/* Demais itens */}
          {nav.map((n) => {
            // `/bases/<id>` acende "Bases"; o `/` impede `/basesX` de acender.
            const active =
              pathname === n.href || pathname.startsWith(`${n.href}/`);
            const Icon = n.icon;
            return (
              <a
                key={n.href}
                // Leva o time junto; `key` e o ativo usam o caminho puro.
                href={navHref(n.href, publicado)}
                title={!open ? n.label : undefined}
                // Colapsado o link só tem ícone: `aria-label` (expandido o texto já nomeia).
                aria-label={!open ? n.label : undefined}
                className={itemCls(active)}
              >
                <Icon size={18} className="shrink-0" />
                {open && <span className="truncate">{n.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Rodapé: `shrink-0` -- quem cede altura é a navegação, que rola. */}
        <div className="flex shrink-0 flex-col gap-1 border-t border-border pt-2">
          {/* Onde você está: rótulo ou seletor de time raiz (`lib/contextSwitcher.ts`). */}
          <ContextSwitcher
            teams={teams}
            me={user}
            pathname={pathname}
            // `?? ""`: para o seletor, "não lida" e "vazia" dão o mesmo link.
            search={search ?? ""}
            canManageOrg={podeVerOrganizacao}
            expanded={open}
            orgName={orgName}
          />
          <a
            href="/perfil"
            title={!open ? "Meu perfil" : undefined}
            aria-label={!open ? "Meu perfil" : undefined}
            className={itemCls(pathname === "/perfil")}
          >
            <User size={18} className="shrink-0" />
            {open && <span className="truncate">{user?.name}</span>}
          </a>
          <button
            type="button"
            onClick={trocarTema}
            // Cicla claro -> escuro -> sistema: um botão só cabe na barra retraída.
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
          <button type="button" onClick={sair} title={!open ? "Sair" : undefined}
            aria-label={!open ? "Sair" : undefined} className={itemCls(false)}>
            <LogOut size={18} className="shrink-0" />
            {open && <span className="truncate">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Conteudo -- sino flutua no canto, conteudo recua no topo */}
      {/* `inert`: com a gaveta aberta, o foco e o toque ficam so nela. */}
      <div className="relative flex min-w-0 flex-1 flex-col" inert={sobreposta}>
        {faixa === "celular" ? (
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 print:hidden">
            <button
              ref={gatilhoDaGavetaRef}
              type="button"
              aria-label="Abrir menu"
              aria-expanded={gaveta}
              onClick={() => setGaveta(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-2"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center logo-marca rounded-md" aria-hidden="true">
              <OnirosMark className="h-5 w-5" />
            </span>
            <strong className="text-[15px] font-bold tracking-[-0.01em]">Oniros</strong>
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>
        ) : (
          <div className="pointer-events-none absolute right-4 top-3 z-20 sm:right-6 print:hidden">
            <div className="pointer-events-auto rounded-lg border border-border bg-surface shadow-card">
              <NotificationBell />
            </div>
          </div>
        )}
        {/* O time ativo desce para as telas por contexto (`useActiveTeam()`). */}
        <main className={`min-w-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-6 print:p-0 ${faixa === "celular" ? "pt-4" : "pt-16"}`}>
          <ActiveTeamProvider
            value={{
              // Publicado, não `contexto` cru: este diz respostas provisórias antes da carga.
              active: publicado,
              search,
              teamName:
                teams.find((t) => t.id === timeAtivo)?.name ?? null,
              // Preferidos, não `teams`: só raízes, onde a pessoa trabalha primeiro.
              teams: preferidos,
            }}
          >
            {/* O Perfil lê e troca o tema por aqui. */}
            <TemaProvider value={{ tema, mudarTema }}>{children}</TemaProvider>
          </ActiveTeamProvider>
        </main>
      </div>
    </div>
    </AvisosProvider>
  );
}
