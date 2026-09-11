"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getMe,
  clearTokens,
  getToken,
  logout,
  listTeamsAll,
  getWorkspace,
  TIMES_MUDARAM,
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
  ownRootTeams,
  peopleEntry,
  rootsForPerson,
} from "@/lib/contextSwitcher";
import { activeTeam, preferredTeams } from "@/lib/activeTeam";
import { urlDoQuadroDeArea } from "@/lib/areas";
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

import Loading, { LoadingScreen } from "@/components/Loading";
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
  // ⚠️ O NOME DA ORGANIZAÇÃO É DA BARRA desde 10/09: o rodapé o mostra em toda
  // tela que não tem área na URL. `getWorkspace` é memoizado em módulo, então
  // isto é uma requisição por sessão, não por navegação.
  const [orgName, setOrgName] = useState("");
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
        // ⚠️ TAMBEM SEM BLOQUEAR, e o `catch` vazio e de proposito: sem o nome
        // o seletor cai no rotulo "Organização" (ver `currentContext`), o que
        // e feio e nao quebra nada. Derrubar a barra inteira por causa dele
        // seria trocar um rotulo generico por uma tela branca.
        getWorkspace()
          .then((ws) => setOrgName(ws.name))
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

  // ⚠️⚠️ A ARVORE PODE MUDAR SEM NAVEGACAO, e ate 10/09 a barra nao ficava
  // sabendo: *"criei uma raiz e nao apareceu direto na barra lateral"*. O
  // `useEffect` de cima roda uma vez; criar area acontece na `/organizacao`,
  // que recarrega o proprio estado e nao o desta barra.
  //
  // ⚠️ QUEM AVISA E `invalidateTeams()`, entao TODA mutacao de time serve --
  // criar, renomear, remover, de qualquer tela. Ouvir o evento da criacao
  // especificamente cobriria um caso e deixaria os outros dois.
  useEffect(() => {
    const reler = () => {
      listTeamsAll()
        .then(setTeams)
        .catch(() => {});
    };
    window.addEventListener(TIMES_MUDARAM, reler);
    return () => window.removeEventListener(TIMES_MUDARAM, reler);
  }, []);

  if (loading) return <LoadingScreen />;

  // ⚠️⚠️ O PAPEL DE ORGANIZACAO SOBE PARA CA (era calculado depois da lente):
  // ele decide quais times a pessoa ALCANCA, e o alcance entra na lente.
  //
  // ⚠️ E NAO E UMA PERMISSAO -- consertado em 10/09, com o defeito na tela: uma
  // pessoa que "nao administra a organizacao" via "Gerenciar a organizacao" no
  // seletor. O gate era `permissions.includes("area.create")`, e parecia certo
  // (§4.1 da Spec 046), mas `_ORG_ROLE_PERMISSIONS[ADMIN]` E LITERALMENTE
  // `_ROLE_PERMISSIONS[UserTeamRole.ADMIN]` -- entao quem tem papel de TIME
  // ADMIN (residuo anterior a Spec 045) carrega `area.create` tambem. E `roles`
  // nao desempata: o `/auth/me` junta os dois niveis ali de proposito.
  const podeVerOrganizacao = (user?.org_role ?? null) !== null;

  // ONDE a pessoa alcanca, e onde ela TRABALHA -- duas perguntas diferentes, e
  // para quem administra a organizacao as respostas divergem muito.
  const alcanca = rootsForPerson(teams, user, podeVerOrganizacao);
  const trabalha = ownRootTeams(teams, user);
  const preferidos = preferredTeams(alcanca, trabalha);

  // ⚠️⚠️ O TIME ATIVO DA BARRA (Spec 048, fatia B). Ate 11/09 a lente pegava a
  // PRIMEIRA RAIZ da lista, e o menu respondia pelo time errado: com dois
  // times, os sub-quadros eram os de todos eles juntos e o "Quadro geral"
  // apontava para o primeiro do alfabeto.
  //
  // ⚠️⚠️ `search` VAI VAZIO NESTA FATIA, E E DE PROPOSITO -- nao e esquecimento.
  // Nenhuma tela escreve `?time=` ainda (isso e a fatia C), entao ler a query
  // aqui nao acrescentaria informacao e obrigaria a decidir AGORA a questao de
  // `useSearchParams` em rota estatica (`AGENTS.md` §6). A fatia C liga a query
  // junto com as telas, que e onde a fronteira de `Suspense` tem de existir.
  // ⚠️ Enquanto isso, a barra resolve pelo CAMINHO (`/times/<id>`,
  // `/quadro/<id>`) e, fora deles, pelo time em que a pessoa trabalha.
  const contexto = activeTeam(pathname, "", teams, alcanca, trabalha);
  const timeAtivo = contexto.kind === "team" ? contexto.teamId : null;

  // Fatia 2/7b: sub-abas de quadro = subtimes DO TIME ATIVO que a lente alcanca.
  const lens = user
    ? computeLens(user.teams, teams, user.roles, timeAtivo)
    : null;
  const subteams = lens ? lens.boardSubteams : [];

  // Spec 025/D11: a fila de solicitações é do time principal. Só quem
  // tem `solicitation.review` (ADMIN/MANAGER — que, pela invariante da
  // Spec 024, só existem na raiz) enxerga a aba. O backend também barra
  // por 403; esconder aqui evita oferecer uma porta que não abre.
  const podeVerSolicitacoes =
    user?.permissions.includes("solicitation.review") ?? false;

  const podeGerirTimes = user?.permissions.includes("team.manage") ?? false;

  // Spec 043 (fatia C). ⚠️ PERMISSÃO PRÓPRIA, e não a de triagem: definir o
  // que se pergunta e responder a fila são trabalhos diferentes, e o backend
  // já os separa. Mesmo espírito dos dois gates acima -- quem não tem a
  // permissão não veria botão útil nenhum lá dentro.
  const podeGerirFormularios =
    user?.permissions.includes("solicitation_form.manage") ?? false;

  // ⚠️⚠️ "TIME" NAO E UMA TELA PROPRIA: ele aponta para `/times/<area>`, a
  // MESMA tela que se abre clicando numa area. A rota `/membros` existia e
  // sumiu em 09/09 -- a Camila viu as duas e resolveu: *"tirar o /membros e
  // deixar 'time', e quando abrir ser o /times/id"*.
  //
  // ⚠️ E O DESTINO E CALCULADO, nao fixo. Com varias areas (Spec 046) nao ha
  // um "/membros" que sirva para todo mundo: a entrada cai na area DA PESSOA,
  // e quem administra a organizacao cai na primeira por nome. A regra mora em
  // `lib/contextSwitcher.ts`, testada -- aqui so se le.
  // ⚠️ `preferidos`, e nao `alcanca`: o item TIME leva ao time em que a pessoa
  // TRABALHA. Com `alcanca`, quem administra a organizacao caia no primeiro do
  // alfabeto -- o mesmo defeito do "Quadro geral", e a Camila o descreveu com
  // estas palavras: *"tudo ta levando em consideracao o quadro do comercial que
  // nao tem nada, mesmo que eu esteja no marketing"*.
  const entradaDoTime = peopleEntry(preferidos);

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
    // ⚠️ SEM AREA, SEM ENTRADA: nao ha destino, e um item que leva a lugar
    // nenhum e pior que um item ausente. Acontece com quem foi cadastrado e
    // nunca alocado -- e a conta de administracao cai no ramo de cima, porque
    // `rootsForPerson` devolve todas as areas para quem administra a
    // organizacao.
    ...(entradaDoTime.kind === "team"
      ? [
          {
            href: `/times/${entradaDoTime.teamId}`,
            label: "Time",
            icon: Users,
          },
        ]
      : []),
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
  // ⚠️⚠️ O "QUADRO GERAL" APONTA PARA O TIME ATIVO, e nao mais para `/quadro`
  // cru -- que redirecionava para a primeira raiz por nome (defeito 3.1).
  // ⚠️ Sem time ativo ele cai em `/quadro`, que ainda sabe decidir sozinho (ou
  // desenhar, com uma raiz so, ou mostrar o vazio). Melhor um endereco que se
  // resolve que um link morto.
  const hrefGeral = timeAtivo ? urlDoQuadroDeArea(timeAtivo) : "/quadro";
  // ⚠️ E o ATIVO passa a casar com os DOIS enderecos: quem chegou por
  // `/quadro` (link antigo, favorito) e quem chegou por `/quadro/<ativo>`.
  const geralActive = pathname === "/quadro" || pathname === hrefGeral;
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
          {/* ---- ONDE VOCE ESTA ----------------------------------------
              ⚠️⚠️ ESTE E O "TIME PRINCIPAL" DA SPEC 039 (F3), com a outra
              metade finalmente feita. A regra combinada com a Camila em 19/08
              e repetida em 09/09:

                  um time raiz, sem poder na organizacao  -> nome, sem chevron
                  dois ou mais, ou administra a org       -> seletor

              A primeira metade ja existia aqui como texto simples; a Spec 046
              (varias areas) criou o caso que exige a segunda.

              ⚠️ E ELE FICA AQUI, acima do nome da pessoa, e nao no topo da
              barra. Eu ja o pus la em cima uma vez e a Camila corrigiu: o
              rodape e o bloco do "quem sou eu e onde estou"; o topo e a
              identidade do produto.

              ⚠️ SO TIMES RAIZ entram na lista -- subtime e navegacao DENTRO
              da area, e o lugar dela e a tela do time. A regra inteira mora em
              `lib/contextSwitcher.ts`, testada. */}
          <ContextSwitcher
            teams={teams}
            me={user}
            pathname={pathname}
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
