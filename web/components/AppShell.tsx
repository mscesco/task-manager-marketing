"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getMe,
  clearTokens,
  getToken,
  logout,
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
import {
  lerBarraAberta,
  gravarBarraAberta,
  lerQuadrosAberto,
  gravarQuadrosAberto,
} from "@/lib/sidebar";
import NotificationBell from "@/components/NotificationBell";
import ContextSwitcher from "@/components/ContextSwitcher";
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
  ClipboardList,
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
  // ⚠️ LIDOS DO localStorage NO INICIALIZADOR, e nao num efeito. A navegacao
  // do app e por `<a href>` (recarga total), entao sem persistir a barra
  // voltaria ao padrao a CADA troca de tela -- foi o que a Camila relatou em
  // 21/08. Ler no inicializador e seguro pelo mesmo motivo ja escrito abaixo
  // para o tema: com `loading` comecando true, a barra so desenha depois do
  // check de auth, ja no cliente.
  const [open, setOpen] = useState(lerBarraAberta);
  const [teams, setTeams] = useState<Team[]>([]);
  const [quadrosOpen, setQuadrosOpen] = useState(lerQuadrosAberto); // accordion
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
        // ⚠️ NAO chamar logout() aqui. Este caminho e "o getMe falhou", ou
        // seja, a sessao JA esta morta -- o servidor recusaria o aviso com
        // 401 e nao ha nada para revogar. logout() so no botao Sair (Spec 030).
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  if (loading) return <div className="center-screen muted">Carregando…</div>;

  // Fatia 2/7b: sub-abas de quadro = subtimes visiveis na lente do usuario.
  const lens = user ? computeLens(user.teams, teams, user.roles) : null;
  const subteams = lens ? lens.boardSubteams : [];

  // Spec 025/D11: a fila de solicitações é do time principal. Só quem
  // tem `solicitation.review` (ADMIN/MANAGER — que, pela invariante da
  // Spec 024, só existem na raiz) enxerga a aba. O backend também barra
  // por 403; esconder aqui evita oferecer uma porta que não abre.
  const podeVerSolicitacoes =
    user?.permissions.includes("solicitation.review") ?? false;

  const podeGerirTimes = user?.permissions.includes("team.manage") ?? false;

  // ⚠️ Spec 047, fatia B: a `/organizacao` e para quem ADMINISTRA A
  // ORGANIZACAO, e nao para quem gere um time. `area.create` e a permissao
  // que separa os dois -- ela existe SO nos papeis de organizacao (Spec 046,
  // §4.1), enquanto `team.manage` um MANAGER tambem tem.
  //
  // ⚠️ Usar `team.manage` aqui poria a porta na frente de todo gerente, e a
  // tela inteira dele seria leitura: ele nao renomeia a organizacao nem cria
  // area. Porta que nao abre e o que este arquivo ja evita em Solicitacoes.
  const podeVerOrganizacao = user?.permissions.includes("area.create") ?? false;

  // Spec 043 (fatia C). ⚠️ PERMISSÃO PRÓPRIA, e não a de triagem: definir o
  // que se pergunta e responder a fila são trabalhos diferentes, e o backend
  // já os separa. Mesmo espírito dos dois gates acima -- quem não tem a
  // permissão não veria botão útil nenhum lá dentro.
  const podeGerirFormularios =
    user?.permissions.includes("solicitation_form.manage") ?? false;

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
    { href: "/membros", label: "Membros", icon: Users },
    // ⚠️⚠️ AQUI ESTAVAM "Organização" e "Times", e as duas SAIRAM em 09/09,
    // por decisão da Camila: *"ela não é para estar no menu junto com
    // projetos, minhas tarefas e afins, é outra seção"*.
    //
    // E ela está certa sobre a natureza da lista: "Projetos", "Minhas
    // tarefas" e "Solicitações" são LUGARES DE TRABALHO -- coisas que se
    // abrem para fazer algo. A organização e a árvore de times são ONDE VOCÊ
    // ESTÁ. Misturar as duas naturezas fazia a lista crescer sem que nenhum
    // item ficasse mais fácil de achar.
    //
    // ⚠️ AS DUAS PORTAS CONTINUAM EXISTINDO, no `ContextSwitcher` acima -- e
    // com os MESMOS gates de antes: a lista de times aparece para quem tem
    // `team.manage`, e "Gerenciar a organização" só com `area.create`.
    // Cortar do menu não pode virar cortar o acesso.
    { href: "/arquivadas", label: "Arquivadas", icon: Archive },
  ];

  function sair() {
    // Spec 030 (D4): avisa o servidor ANTES de limpar o localStorage -- a
    // funcao le o token na primeira linha sincrona. Disparada SEM await de
    // proposito: sair nao pode ficar preso esperando rede. Ela nunca lanca.
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
  const geralActive = pathname === "/quadro";
  const algumQuadroAtivo = pathname.startsWith("/quadro");

  return (
    <div className="flex min-h-screen">
      {/* ⚠️ ALTURA FIXA + COLUNA = MENU QUE SOME COM ZOOM.
          A barra e `h-screen` e nao rola: com zoom do navegador (ou tela
          baixa) a lista de itens passa de 100vh e o que sobra fica CORTADO
          e inalcancavel -- nao ha barra de rolagem porque o `overflow`
          padrao e `visible`, e a rolagem da PAGINA nao ajuda: o `sticky
          top-0` prende a barra no topo. Relatado em 05/08: com zoom
          aumentado nao dava pra chegar nas ultimas paginas do menu.
          O conserto e o `overflow-y-auto` no <nav> junto do `min-h-0` --
          sem `min-h-0` um filho flex NAO encolhe abaixo do proprio
          conteudo, e o `overflow` nunca chega a valer. O `overflow-y-auto`
          do <aside> e o ultimo recurso: se ate os blocos fixos (logo,
          retrair, rodape) nao couberem, a barra inteira rola. */}
      <aside
        className={`sticky top-0 flex h-screen ${w} shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-2 py-2 transition-[width] duration-200`}
      >
        {/* Logo */}
        <div className={`flex shrink-0 items-center gap-3 py-2 ${open ? "px-3" : "justify-center"}`}>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
            <img src="/fecaf-simbolo.png" alt="UniFECAF" className="h-5 w-5 object-contain" />
          </span>
          {open && (
            <strong className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
              Gestor de Tarefas
            </strong>
          )}
        </div>

        {/* ---- O SELETOR DE CONTEXTO --------------------------------------
            ⚠️ NO TOPO, e nao na lista: ele diz ONDE VOCE ESTA, e a lista
            abaixo diz O QUE FAZER. Foi a separacao que a Camila pediu em
            09/09 ao tirar "Organizacao" e "Times" do menu.
            ⚠️ O gate de LISTAR times e `team.manage`, o mesmo que a entrada
            "Times" tinha; "Gerenciar a organizacao" segue com `area.create`,
            o mesmo da entrada "Organizacao". Cortar do menu nao pode virar
            cortar o acesso -- nem abrir porta nova para quem nao tinha. */}
        {podeGerirTimes && (
          <ContextSwitcher
            teams={teams}
            pathname={pathname}
            podeGerirOrganizacao={podeVerOrganizacao}
            expandida={open}
          />
        )}

        {/* Botao de retrair */}
        <button
          type="button"
          // ⚠️ GRAVA NO CLIQUE, e nao num efeito sobre `open`. Efeito
          // gravaria tambem na MONTAGEM, reescrevendo a preferencia com o
          // valor que acabou de ser lido -- inofensivo hoje, e a porta para
          // sobrescrever a escolha da pessoa no dia em que a leitura falhar e
          // cair no padrao. Mesma disciplina do `gravarTema`, que so grava
          // "quando a pessoa AGE".
          onClick={() => {
            setOpen((v) => {
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
            <a href="/quadro" title="Quadros" aria-label="Quadros" className={itemCls(algumQuadroAtivo)}>
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
                // ⚠️ SPEC 039 (F3): COLAPSADO O LINK SO TEM ICONE, e o `title`
                // sozinho nao e nome acessivel confiavel -- ele depende de o
                // leitor de tela usar a reserva. O `web/AGENTS.md` exige
                // `aria-label` em controle so-de-icone, e aqui sao SETE de
                // uma vez. Expandido fica `undefined`: o texto ao lado ja
                // nomeia, e um label duplicado faria o leitor anunciar duas
                // vezes.
                aria-label={!open ? n.label : undefined}
                className={itemCls(active)}
              >
                <Icon size={18} className="shrink-0" />
                {open && <span className="truncate">{n.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Rodape: perfil + sair. `shrink-0` de proposito -- quem cede
            espaco quando falta altura e a lista de navegacao (que rola),
            nunca o rodape (que nao tem como ser alcancado de outro jeito). */}
        <div className="flex shrink-0 flex-col gap-1 border-t border-border pt-2">
          {/* ⚠️⚠️ AQUI FICAVA O "TIME PRINCIPAL" (Spec 039, F3): o nome do
              time raiz em texto simples, com a regra combinada com a Camila em
              19/08 -- *"um time raiz: nome sem chevron; dois ou mais: seletor"*.
              O segundo caso finalmente existe (Spec 046), e o seletor e o
              `ContextSwitcher` no TOPO da barra: ele diz onde voce esta e
              leva para os outros times.
              ⚠️ Manter os dois seria dizer a mesma coisa em duas alturas da
              mesma barra -- e so um deles navega. */}
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
          <button type="button" onClick={sair} title={!open ? "Sair" : undefined}
            aria-label={!open ? "Sair" : undefined} className={itemCls(false)}>
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
