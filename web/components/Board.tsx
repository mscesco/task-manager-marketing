"use client";
// components/Board.tsx
// Quadro kanban reaproveitavel. Sem projectId => quadro GERAL (panorama de
// tudo, inclusive tasks de projeto). Com projectId => quadro de UM projeto
// (a listagem ja vem filtrada pelo backend; subtarefa compartilha o project_id
// do pai, entao a subarvore inteira vem junta). Extraido do antigo
// quadro/page.tsx na Entrega 11 sem mudar comportamento do geral.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import TaskCard from "@/components/TaskCard";
import {
  escopoDaTask as classificaEscopo,
  pillDoEscopo,
  passaEscopo,
  responsaveisPorRaiz,
  raizesQueCasamBusca,
  passaResponsavel,
  temFiltroNovo,
  contaFiltrosAtivos,
  listaFiltrosAtivos,
  normalizarBusca,
  FILTROS_LIMPOS,
  type FiltroEscopo,
} from "@/lib/filtrosQuadro";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import { explicaRecusa, mensagemDeDivergencia } from "@/lib/edicaoDeColunas";
import { Pencil } from "lucide-react";
import CabecalhoDeColunaEditavel from "@/components/CabecalhoDeColunaEditavel";
import FormNovaColuna from "@/components/FormNovaColuna";
import RevisaoDaEdicao from "@/components/RevisaoDaEdicao";
import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import type { DestinoPossivel } from "@/lib/rascunhoDeColunas";
import {
  destinosDoRascunho,
  totalPrevisto,
  comColunaNova,
  comMarcacao,
  comOrdem,
  comRenome,
  linhasDeEdicao,
  marcadasParaApagar,
  paraLote,
  rascunhoInicial,
  temPendencias,
  type Rascunho,
} from "@/lib/rascunhoDeColunas";
import EmptyStateBox from "@/components/EmptyState";
import { terminal, type Coluna } from "@/lib/coluna";
import { listAllTasks, listAllProjects, updateTask, listMembers, listSubteams, getRootTeamId, listBoards, colunaComContagem, aplicarLoteDeColunas, ApiError, type Task, type Team, type Quadro } from "@/lib/api";
import { sincronizarTaskNaUrl, lerTaskDaUrl } from "@/lib/urlTarefa";
import { ORDENACOES, ordenar, type Ordenacao } from "@/lib/ordenacao";

// Spec 031 (C3): `normalizar` saiu daqui pra lib/filtrosQuadro (agora
// `normalizarBusca`) -- "Minhas tarefas" tambem busca, e duas copias da
// mesma regra sao um bug esperando.

// "Hoje" como YYYY-MM-DD no fuso LOCAL. due_date vem do backend como date
// pura (sem hora), entao a comparacao e string vs string (ISO ordena certo).
// Nada de new Date(due_date): isso interpretaria como UTC e escorregaria 1 dia.
function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

type FiltroPrazo = "todos" | "atrasadas" | "em-dia";

export default function Board({
  projectId,
  subteamId,
  boardId,
  podeEditarColunas = false,
  title,
}: {
  projectId?: string; // presente => quadro de PROJETO
  subteamId?: string; // presente => quadro de SUBTIME (modo hibrido, Fatia 4)
  /**
   * Presente => quadro AVULSO (Spec 036, fatia 5b-6). A tela desenha as
   * colunas DESTE quadro e mostra so as tarefas dele.
   *
   * ⚠️ MANDA MAIS QUE `subteamId`, e a ordem importa. Quadro avulso NAO e
   * lente: a lente e o espelho do Quadro geral filtrado por pessoa (ADR 0034),
   * e o avulso e um registro proprio. Deixar o filtro hibrido rodar aqui
   * traria tarefas da raiz para dentro de um quadro que nao as contem, e elas
   * cairiam em `foraDaColuna` -- contadas e invisiveis.
   *
   * ⚠️ NAO E SEGURANCA. `listAllTasks` ja devolve so o que a pessoa alcanca;
   * este filtro escolhe o que DESENHAR dentro disso.
   */
  boardId?: string;
  /**
   * Se a pessoa pode editar as COLUNAS deste quadro (fatia 5b-6).
   *
   * ⚠️ VEM DECIDIDO DE FORA. Quem calcula e `podeGerirQuadrosDe`, na tela do
   * time, que ja tem o alcance do ator. Recalcular aqui seria uma segunda
   * definicao da mesma regra -- e as duas divergiriam sem nada ficar vermelho.
   *
   * ⚠️ NAO E SEGURANCA. O backend recusa com 403; isto so evita oferecer o
   * botao.
   */
  podeEditarColunas?: boolean;
  title: string;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  // Fatia 5b-6: o modo de EDICAO DE COLUNAS. So existe em quadro avulso.
  const [editandoColunas, setEditandoColunas] = useState(false);
  // Fatia 4c: os quadros que quem olha alcanca. `null` = ainda carregando --
  // a tela NAO desenha coluna nenhuma ate chegarem (mesma decisao de 10/08
  // tomada em `/minhas-tarefas`), porque pintar um kanban com a lista velha e
  // trocar depois e pior do que esperar meio segundo.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  // ⚠️ TERCEIRO ESTADO, E ELE FALTAVA. `quadros` sozinho so distingue
  // "carregando" (`null`) de "carregou" -- e o `catch` gravava `[]`, que e
  // "carregou e nao ha quadro nenhum". As duas situacoes sao diferentes e a
  // tela precisa dizer coisas diferentes. Ver o bloco de render la embaixo.
  const [erroQuadros, setErroQuadros] = useState(false);

  // ---- MODO DE EDIÇÃO DE COLUNAS (Spec 036, fatia 6c) --------------------
  //
  // ⚠️ NADA AQUI VAI AO SERVIDOR ENQUANTO O MODO ESTIVER LIGADO. A pessoa
  // renomeia, arrasta, marca colunas para sumir e cria colunas -- tudo no
  // `rascunho` --, e ao concluir sai UM `PUT`. É o que permite trocar uma
  // coluna por outra num gesto só: a coluna nova pode ser destino de uma
  // apagada antes de existir id nenhum.
  //
  // ⚠️ TODA A REGRA MORA EM `lib/rascunhoDeColunas`, TESTADA. Aqui só há
  // fiação: `onDragEnd` não roda em jsdom, e este arquivo já tem dois assim.
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [criandoColuna, setCriandoColuna] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [contagens, setContagens] = useState<Record<string, number> | null>(null);
  const [erroLote, setErroLote] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [members, setMembers] = useState<Map<string, { name: string }>>(
    new Map()
  );
  // Mapa project_id -> titulo, so no quadro geral (pra tag do card).
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [projetosPessoais, setProjetosPessoais] = useState<Set<string>>(new Set());
  // §8 (03/08): project_id -> team_id do projeto. Alimenta escopoDaTask, que
  // ate entao classificava a pill por `task.team_id` -- fonte DIFERENTE da que
  // o backend usa pra decidir visibilidade (`project.team_id`, task_guards
  // :67-69). O dado ja vinha no payload de listAllProjects; era descartado.
  const [timeDoProjeto, setTimeDoProjeto] = useState<Map<string, string | null>>(
    new Map()
  );
  // Mesma funcao do membrosCarregados: sem esta guarda o quadro de subtime
  // pinta as pills como "indefinido" (mapa vazio) e elas mudam sozinhas
  // quando os projetos chegam. Vira true quando listAllProjects RESPONDE --
  // inclusive no erro, pra nao travar a tela em "Carregando".
  const [projetosCarregados, setProjetosCarregados] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Task | null>(null);
  // Spec 033: tarefa que esta sendo DUPLICADA. Separado de `editando` de
  // proposito -- os dois abrem o mesmo modal em modos diferentes, e um estado
  // so faria "duplicar" e "editar" se sobrescreverem em silencio.
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Trava do deep-link: garante leitura unica do ?task= e libera a escrita
  // da URL so depois dela (ver os efeitos de "URL viva").
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  // Filtros client-side (Entrega 13). NAO entram no useEffect de fetch:
  // filtram em memoria sobre o lote ja carregado, sem bater na API.
  const [busca, setBusca] = useState("");
  const [prazo, setPrazo] = useState<FiltroPrazo>("todos");
  // Ordenacao do quadro -- so na sessao (nao persiste; reseta no reload).
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("criacao");
  // Fatia 3: filtro por subtime. memberTeam resolve id->subtime (vem do
  // /members, agora com team_id pela Fatia 2). subtimes alimenta o dropdown
  // (so times nao-raiz). "" em `subtime` = sem filtro.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [memberTeam, setMemberTeam] = useState<Map<string, string | null>>(
    new Map()
  );
  // Distingue "membros ainda nao carregaram" de "carregaram". No modo
  // SUBTIME as tasks "compartilhadas" dependem de memberTeam (resolve quem
  // pertence ao subtime). Sem esta guarda, o quadro renderiza antes dos
  // membros chegarem e as compartilhadas APARECEM ATRASADAS (mesma classe da
  // piscada do rootId, na direcao oposta). Vira true quando listMembers
  // RESPONDE -- inclusive no erro, pra nao travar a tela em "Carregando".
  const [membrosCarregados, setMembrosCarregados] = useState(false);
  const [subtimes, setSubtimes] = useState<Team[]>([]);
  // Fatia 3: id do time raiz. O quadro GERAL mostra so tasks da raiz
  // (internas de subtime nao vazam pro geral). null = ainda nao carregado
  // OU raiz nao encontrada -> nesse caso NAO filtra (mostra tudo), pra
  // nunca esconder o quadro inteiro por engano.
  const [rootId, setRootId] = useState<string | null>(null);
  // Distingue "ainda nao carregou" de "carregou (id ou null)". Sem isso,
  // o quadro geral renderiza antes do rootId chegar e as tasks internas
  // piscam na tela antes do filtro ligar. Vira true assim que o
  // getRootTeamId RESPONDE -- inclusive se responder null (raiz ausente),
  // pra nao travar a tela em "Carregando".
  const [rootCarregado, setRootCarregado] = useState(false);
  const [subtime, setSubtime] = useState<string>("");
  // Filtros pedidos pela gestao (2026-07-27). Regras em lib/filtrosQuadro.
  //   escopoFiltro -- interna x compartilhada (so faz sentido no modo subtime)
  //   pessoaFiltro -- "o que a fulana esta fazendo", em qualquer quadro
  const [escopoFiltro, setEscopoFiltro] = useState<FiltroEscopo>("todos");
  // Multi-selecao (03/08/2026): UNIAO. Marcar Beatriz e Clara mostra as
  // tarefas de CADA uma, nao so as que as duas dividem. Regra e testes em
  // lib/filtrosQuadro:passaResponsavel.
  const [pessoasFiltro, setPessoasFiltro] = useState<string[]>([]);
  const alternarPessoa = (id: string) =>
    setPessoasFiltro((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]
    );
  // Painel de filtros (29/07): recolhe prazo/subtime/origem/pessoa atras de um
  // botao. Busca e ordenacao ficam FORA -- busca e o controle mais usado, e
  // ordenacao nao esconde tarefa nenhuma (nao e filtro).
  const [painelAberto, setPainelAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);
  // P0.2: total real quando o fetch bateu o teto de seguranca (truncou).
  // null = nao truncou. Vira aviso honesto no lugar de perda silenciosa.
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Guarda contra "clique fantasma" logo apos um arrasto.
  const suprimirClique = useRef(false);

  // Fecha o painel ao clicar fora (mesmo padrao do picker de responsavel).
  useEffect(() => {
    if (!painelAberto) return;
    function onDown(e: MouseEvent) {
      if (painelRef.current && !painelRef.current.contains(e.target as Node)) {
        setPainelAberto(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [painelAberto]);

  // --- Trava o quadro na altura da viewport (scroll por coluna) ---
  // Mede a distancia REAL do topo das colunas ate o rodape e usa como altura
  // fixa do container -> cada coluna rola por dentro, a pagina nao rola inteira.
  // Mede a posicao real (nao um offset fixo) porque cada pagina tem altura
  // diferente acima do quadro (a de projeto, por ex., tem cabecalho).
  const colunasRef = useRef<HTMLDivElement>(null);
  const [alturaColunas, setAlturaColunas] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const el = colunasRef.current;
    if (!el) return; // so existe quando ha colunas (raizes > 0)
    // Clamp em 0: se a medicao cair com a pagina rolada pra baixo, top vem
    // negativo e a altura estourava (innerHeight - top). Nao resolve o caso
    // do mobile (barra de URL mexendo innerHeight) -- so o commit-durante-scroll.
    const top = Math.max(0, el.getBoundingClientRect().top);
    const RODAPE = 24; // respiro pro padding inferior do <main>
    const h = Math.max(240, Math.round(window.innerHeight - top - RODAPE));
    setAlturaColunas((atual) => (atual === h ? atual : h));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", medirAltura);
    return () => window.removeEventListener("resize", medirAltura);
  }, [medirAltura]);
  // Roda apos cada commit (barato): pega banner, filtros quebrando, header de
  // projeto e a transicao vazio->colunas sem precisar listar dependencias.
  // setState so dispara quando a altura muda -> nao ha loop.
  useLayoutEffect(() => {
    medirAltura();
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const recarregarTasks = useCallback(() => {
    listAllTasks({ project_id: projectId, include_archived: mostrarArquivadas })
      .then((r) => {
        setTasks(r.items);
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => setErro(e.message));
  }, [projectId, mostrarArquivadas]);

  useEffect(() => {
    recarregarTasks();
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        // Spec 031 (C14): a parte, pelo mesmo motivo de `projetosPessoais` --
        // o mapa de nomes precisa de TODOS (pra resolver quem ja esta
        // designado), o seletor e que nao deve OFERECER desativado.
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
        setMemberTeam(new Map(ms.map((m) => [m.id, m.team_id])));
      })
      .catch(() => {})
      .finally(() => setMembrosCarregados(true));
    // Spec 022: projectNames alimenta o chip E o seletor de "mudar projeto" no
    // detalhe -> carrega em qualquer quadro (antes so no geral).
    listAllProjects()
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        // Spec 031 (C13): guardado a parte -- o mapa de nomes precisa de TODOS
        // (inclusive pessoal, pra resolver o nome de quem ja mora la), mas o
        // seletor de "mudar projeto" nao deve OFERECER pessoal.
        setProjetosPessoais(new Set(r.items.filter((p) => p.is_personal).map((p) => p.id)));
        setTimeDoProjeto(new Map(r.items.map((p) => [p.id, p.team_id])));
      })
      .catch(() => {})
      .finally(() => setProjetosCarregados(true));
  }, [projectId, mostrarArquivadas, recarregarTasks]);

  // Subtimes sao estaveis no workspace -> busca uma vez (listSubteams e
  // memoizado no api.ts). So times nao-raiz entram no dropdown.
  // Quadros: uma requisicao por montagem, sem cache -- ver o aviso em
  // `listBoards`. Em erro fica `[]` e nao `null`, senao a tela trava no
  // "Carregando" para sempre quando a API de quadros cai mas a de tarefas nao.
  // ⚠️ EXTRAIDO PARA `useCallback` NA FATIA 5b-6: o modo de edicao de colunas
  // precisa recarregar a lista depois de criar, renomear ou apagar. Duas
  // copias da mesma consulta divergiriam no primeiro erro de rede.
  const carregarQuadros = useCallback(() => {
    setErroQuadros(false);
    listBoards()
      .then((lista) => {
        setQuadros(lista);
        setErroQuadros(false);
      })
      .catch(() => {
        // ⚠️ `[]` CONTINUA, e o erro vai SEPARADO. A lista vazia impede que
        // qualquer leitor abaixo estoure; quem decide o que a tela mostra e
        // `erroQuadros`.
        setQuadros([]);
        setErroQuadros(true);
      });
  }, []);

  // ⚠️ `boardId` NAS DEPENDENCIAS (12/08). Sem ele, trocar de quadro no
  // seletor NAO recarrega a lista -- e um quadro recem-criado nao esta nela,
  // porque ela foi buscada antes de ele existir. Ver o bloco de escolha do
  // quadro, abaixo: o sintoma era a tela mostrar as OITO colunas do Quadro
  // geral sob o titulo do quadro avulso.
  useEffect(() => {
    carregarQuadros();
  }, [carregarQuadros, boardId]);

  useEffect(() => {
    listSubteams().then(setSubtimes).catch(() => {});
    getRootTeamId()
      .then((id) => setRootId(id))
      .catch(() => {})
      .finally(() => setRootCarregado(true));
  }, []);

  // ---- URL viva (?task=<id>) ----
  //
  // Leitura: ao chegar na pagina com ?task= (F5, ou link colado), abre a
  // tarefa. Roda UMA vez, quando o lote de tasks fica disponivel. Se a tarefa
  // nao esta neste quadro (link velho, outro projeto, arquivada fora do
  // filtro), ignora em silencio -- a URL nao vale um aviso de erro na cara.
  //
  // Reconstroi a cadeia de pais pela subarvore ja carregada, pra subtarefa
  // abrir no modo "sub" com o botao voltar, igual a navegacao manual.
  useEffect(() => {
    if (deepLinkFeito || tasks === null) return;
    setDeepLinkFeito(true);
    const alvo = lerTaskDaUrl();
    if (!alvo) return;
    const t = tasks.find((x) => x.id === alvo);
    if (!t) return;
    const pilhaPais: Task[] = [];
    const vistos = new Set<string>([t.id]); // guarda anti-ciclo
    let paiId = t.parent_task_id;
    while (paiId && !vistos.has(paiId)) {
      vistos.add(paiId);
      const pai = tasks.find((x) => x.id === paiId);
      if (!pai) break; // pai fora do lote -> para onde deu
      pilhaPais.unshift(pai);
      paiId = pai.parent_task_id;
    }
    setPilha(pilhaPais);
    setDetalhe(t);
  }, [tasks, deepLinkFeito]);

  // Escrita: espelha a tarefa aberta na URL. Cobre abrir, fechar, entrar numa
  // subtarefa e voltar -- todos passam por `detalhe`, entao um efeito so da
  // conta (nao da pra esquecer um caminho).
  //
  // Gated no deepLinkFeito de PROPOSITO: sem isso, na montagem (detalhe=null)
  // este efeito apagaria o ?task= da URL antes do efeito de leitura acima
  // conseguir le-lo -- e o F5 nunca reabriria a tarefa.
  useEffect(() => {
    if (!deepLinkFeito) return;
    sincronizarTaskNaUrl(detalhe?.id ?? null);
  }, [detalhe, deepLinkFeito]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function aoSalvar(saved: Task) {
    setTasks((prev) => {
      const lista = prev ?? [];
      const existente = lista.find((t) => t.id === saved.id);
      const m = {
        ...saved,
        assignee_ids: saved.assignee_ids ?? existente?.assignee_ids ?? [],
      };
      return existente
        ? lista.map((t) => (t.id === saved.id ? m : t))
        : [m, ...lista];
    });
    setCriando(false);
    setEditando(null);
  }

  function abrirDetalhe(task: Task) {
    if (suprimirClique.current) return;
    setPilha([]);
    setDetalhe(task);
  }

  function abrirSubtarefa(sub: Task) {
    setPilha((p) => (detalhe ? [...p, detalhe] : p));
    setDetalhe(sub);
  }
  function voltarDetalhe() {
    setPilha((p) => {
      if (p.length === 0) return p;
      setDetalhe(p[p.length - 1]);
      return p.slice(0, -1);
    });
  }
  function fecharDetalhe() {
    setDetalhe(null);
    setPilha([]);
  }

  // Soft-delete cascateado: remove a task E a subtree (por path) do estado,
  // fecha o detalhe e avisa quantas filhas foram junto.
  function aoExcluir(t: Task, cascadeCount: number) {
    setTasks((prev) =>
      (prev ?? []).filter(
        (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
      )
    );
    // Se a task excluida foi aberta a partir de um pai (pilha nao-vazia),
    // volta pro pai em vez de fechar o detalhe inteiro. Sem pilha -> fecha.
    if (pilha.length > 0) voltarDetalhe();
    else fecharDetalhe();
    const extra = cascadeCount > 0 ? ` e ${cascadeCount} subtarefa(s)` : "";
    setToast(`Tarefa${extra} excluída(s).`);
  }

  function aoUpsert(t: Task) {
    setTasks((prev) => {
      if (!prev) return [t];
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) return [t, ...prev];
      const merged = { ...t, assignee_ids: t.assignee_ids ?? existente.assignee_ids };
      // Transicao PARA concluido -> cascata otimista pros descendentes (espelha
      // o backend: pula ja concluidas, canceladas e arquivadas). Sem transicao
      // (ex.: so editou titulo de uma ja concluida), nao mexe nas subtarefas.
      // Mesma divergencia do drag: so reflete o que esta carregado em `prev`;
      // subarvore fora do limite de exibicao so aparece concluida no reload.
      const virouConcluido =
        t.status === "COMPLETED" && existente.status !== "COMPLETED";
      const prefixo = existente.path + ".";
      return prev.map((x) => {
        if (x.id === t.id) return merged;
        if (
          virouConcluido &&
          x.path.startsWith(prefixo) &&
          x.status !== "COMPLETED" &&
          x.status !== "CANCELLED" &&
          !x.is_archived
        ) {
          // ⚠️ COLUNA JUNTO COM O STATUS (fatia 4c): quem conta a checklist
          // e quem filtra prazo passaram a olhar a COLUNA. Mexer so no
          // `status` aqui deixaria o contador parado ate o F5 -- o mesmo
          // defeito que a conferencia manual pegou no arrastar.
          // A coluna e a do PAI recem-salvo: subtarefa herda o quadro dele,
          // entao a coluna de conclusao e a mesma.
          return { ...x, status: "COMPLETED", column_id: merged.column_id };
        }
        return x;
      });
    });
  }

  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
  }

  const activeTask = useMemo(
    () => (activeId ? tasks?.find((t) => t.id === activeId) ?? null : null),
    [activeId, tasks]
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    suprimirClique.current = true;
    setTimeout(() => (suprimirClique.current = false), 60);

    const taskId = String(e.active.id);
    // ⚠️ AGORA O DESTINO E UM `column_id`, e nao mais uma chave de status. O
    // droppable de cada coluna usa `coluna.id` (ver `ColunaKanban`).
    const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;

    const atual = tasks?.find((t) => t.id === taskId);
    if (!atual || atual.column_id === destino) return;

    // A coluna de destino tem de estar na lista deste quadro. Nao e paranoia:
    // e o que impede um `column_id` de outro quadro de virar um PATCH que o
    // backend vai recusar com 422 (ADR 0041) depois de a tela ja ter mexido o
    // card na frente da pessoa.
    const colunaDestino = colunas.find((c) => c.id === destino);
    if (!colunaDestino) return;

    const colunaAnterior = atual.column_id;

    // Cascata de conclusao: arrastar um PAI pra uma coluna de conclusao conclui
    // a subtree (espelha o backend). Aplica otimista pros cards de subtarefa
    // refletirem na hora. Guarda as colunas antigas pra reverter se o PATCH
    // falhar. Pula as que ja estao em coluna terminal e as arquivadas.
    //
    // ⚠️ `semantic === "DONE"` E NAO O NOME DA COLUNA. Nome e editavel na fatia
    // 5; a semantica e o que o backend usa para decidir a mesma coisa.
    //
    // ⚠️ AS SUBTAREFAS VAO PARA A MESMA COLUNA, e isso e correto e nao um
    // atalho: subtarefa herda o quadro do pai (F2 da Spec 035), entao a coluna
    // de conclusao do pai E a coluna de conclusao delas.
    //
    // ⚠️ MEXE NA COLUNA **E** NO STATUS, e o `status` aqui NAO e derivacao da
    // coluna -- e espelho de um comportamento conhecido do backend.
    //
    // A decisao de 10/08 (opcao A) era deixar o `status` velho na memoria ate
    // a resposta chegar, porque o front nao sabe derivar status de coluna (a
    // ponte nao viaja no `GET /boards`, ADR 0033). **A conferencia manual
    // mostrou que essa janela e visivel**: o contador do card ja lia coluna,
    // mas o do DETALHE (`lib/subtarefas.ts::progresso`) le `status`, e abrir a
    // tarefa logo depois de arrastar mostrava "Subtarefas (0/2)" com o card
    // dizendo 2/2. Dois numeros discordando e pior que um numero velho.
    //
    // ⚠️ POR QUE `"COMPLETED"` E SEGURO AQUI, e so aqui: este bloco so roda
    // com `semantic === "DONE"`, e a cascata do backend
    // (`TaskRepository.complete_descendants`) grava `COMPLETED` fixo, nao
    // derivado. Nao ha coluna `DONE` que produza outro status: a padrao tem
    // ponte `COMPLETED`, e coluna criada por gente cai no mapa da ADR 0041,
    // que manda `DONE -> COMPLETED`. Fora da cascata continua valendo que o
    // front NAO adivinha status -- ver o `updateTask` mais abaixo, que manda
    // so `column_id` e le o status da RESPOSTA.
    //
    // ⚠️ DIVIDA REGISTRADA: enquanto `progresso` ler `status`, os dois campos
    // precisam ser mantidos em sincronia na memoria. Quem migrar a checklist
    // para a coluna (4c-2) apaga a metade `status` daqui.
    //
    // DIVERGENCIA CONHECIDA, herdada: o backend cascateia TODA a subarvore no
    // banco; aqui so mexemos no que esta carregado em `tasks` (que pode vir
    // truncado).
    const concluindo = colunaDestino.semantic === "DONE";
    const prefixo = atual.path + ".";
    // ⚠️ GUARDA OS DOIS CAMPOS, porque a atualizacao otimista mexe nos dois.
    // Guardar so a coluna deixaria a subtarefa revertida para a coluna certa
    // com `status: "COMPLETED"` cravado -- e ai o card diria uma coisa e o
    // detalhe outra, que e exatamente o defeito que este bloco conserta.
    const anteriores = new Map<string, { coluna: string; status: string }>();
    if (concluindo) {
      for (const t of tasks ?? []) {
        const colunaDela = colunaPorId.get(t.column_id);
        if (
          t.path.startsWith(prefixo) &&
          colunaDela &&
          !terminal(colunaDela) &&
          !t.is_archived
        ) {
          anteriores.set(t.id, { coluna: t.column_id, status: t.status });
        }
      }
    }

    setTasks((prev) =>
      prev!.map((t) => {
        if (t.id === taskId) return { ...t, column_id: destino };
        if (anteriores.has(t.id))
          return { ...t, column_id: destino, status: "COMPLETED" };
        return t;
      })
    );

    try {
      // ⚠️ MANDA SO `column_id`. Mandar os dois campos e 422 (ADR 0041, D3), e
      // o status certo vem NA RESPOSTA -- e por isso que a linha abaixo troca
      // a task inteira pela devolvida, em vez de remendar so a coluna.
      const atualizada = await updateTask(taskId, { column_id: destino });
      setTasks((prev) =>
        prev!.map((t) =>
          t.id === taskId ? { ...atualizada, assignee_ids: t.assignee_ids } : t
        )
      );
    } catch (err) {
      setTasks((prev) =>
        prev!.map((t) => {
          if (t.id === taskId) return { ...t, column_id: colunaAnterior };
          const ant = anteriores.get(t.id);
          return ant !== undefined
            ? { ...t, column_id: ant.coluna, status: ant.status }
            : t;
        })
      );
      const e2 = err as ApiError;
      setToast(
        e2.status === 403
          ? "Você não pode mover esta tarefa. Voltei pra coluna anterior."
          : "Não consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!tasks) return <div className="muted">Carregando tarefas…</div>;
  // Quadro geral/subtime dependem do rootId pro filtro. Espera ele
  // carregar pra nao piscar tasks que o filtro vai esconder. Projeto
  // (projectId) nao usa rootId -> nao espera.
  if (!projectId && !rootCarregado)
    return <div className="muted">Carregando tarefas…</div>;
  // Modo SUBTIME depende TAMBEM dos membros: o filtro hibrido usa memberTeam
  // pra decidir as "compartilhadas". Espera os membros pra elas nao aparecerem
  // atrasadas. Geral e projeto nao dependem disso -> nao esperam.
  if (!projectId && subteamId && !membrosCarregados)
    return <div className="muted">Carregando tarefas…</div>;
  // §8: o modo SUBTIME tambem depende dos PROJETOS -- a pill e o filtro de
  // origem classificam pelo time do projeto. Sem esperar, tudo nasce
  // "indefinido" (sem pill) e se corrige sozinho na tela um instante depois.
  if (!projectId && subteamId && !projetosCarregados)
    return <div className="muted">Carregando tarefas…</div>;
  // ⚠️ O ERRO DE `/boards` VEM ANTES DA ESPERA, e ate 13/08 ele nao existia.
  //
  // O `catch` gravava `[]` e seguia. Com `boardId`, `[]` fazia a busca do
  // quadro pedido falhar e a tela ficava em "Carregando tarefas…" PARA SEMPRE
  // -- sem erro, sem botao, sem timeout. Um blip de rede de dois segundos no
  // momento errado deixava a pessoa olhando para uma tela morta, e o unico
  // remedio era um F5 que ela nao tinha como adivinhar.
  //
  // ⚠️ E NO QUADRO GERAL O `[]` ERA PIOR QUE A ESPERA, e nao melhor: sem
  // quadro padrao a lista de colunas sai vazia, TODA tarefa cai em
  // `foraDaColuna` e a tela desenha um kanban sem colunas com o aviso
  // "176 tarefas estao em uma coluna que nao e deste quadro". Ou seja, ela
  // culpava o dado por uma requisicao que falhou.
  //
  // ⚠️ O BOTAO E O PONTO, e nao a mensagem. Sem ele isto continua exigindo F5.
  if (erroQuadros)
    return (
      <div className="error-box" style={{ maxWidth: 480 }}>
        Não consegui carregar os quadros, e as colunas dependem deles.
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" onClick={carregarQuadros}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  // Fatia 4c: sem as colunas nao ha kanban. Espera igual aos outros.
  if (!quadros) return <div className="muted">Carregando tarefas…</div>;

  // ---- As colunas deste quadro (fatia 4c) ----
  //
  // ⚠️ O QUADRO SAI DAS TAREFAS, e nao de `is_default` (decisao de 10/08,
  // opcao C). Toda tarefa carrega `board_id` desde a fatia 3, entao a tela
  // desenha as colunas DO QUADRO EM QUE AS TAREFAS VIVEM -- e continua certa
  // no dia do quadro interno, sem ninguem lembrar de voltar aqui.
  //
  // Os dois casos em que ele nao sai das tarefas, e o que cada um significa:
  //   - lote VAZIO: nao ha `board_id` nenhum para ler. Cai no quadro padrao,
  //     que e o unico palpite honesto -- e e so afordancia, porque um lote
  //     vazio nao desenha card nenhum de qualquer jeito.
  //   - lote com MAIS DE UM quadro: hoje impossivel (producao tem um quadro,
  //     `invariantes.sql` consulta 5) e sem resposta certa depois -- um kanban
  //     nao desenha duas listas de coluna ao mesmo tempo. Cai no padrao e o
  //     contador de `foraDaColuna` abaixo denuncia o resto. **Se isso um dia
  //     acontecer, a decisao e da fatia 5, nao deste arquivo.**
  //   - ⚠️ `boardId` PEDIDO (fatia 5b-6): quando a tela do time seleciona um
  //     quadro avulso, ele MANDA -- e nao o lote. Um quadro recem-criado tem
  //     ZERO tarefas, entao o lote e vazio e a regra acima cairia no padrao:
  //     a tela desenharia as 8 colunas do Quadro geral com o titulo do quadro
  //     avulso, e a primeira tarefa criada ali sumiria da vista. E o caso mais
  //     provavel dos tres, porque todo quadro comeca vazio.
  const quadrosDoLote = new Set(tasks.map((t) => t.board_id));
  const quadroDoLote =
    quadrosDoLote.size === 1
      ? quadros.find((q) => q.id === [...quadrosDoLote][0])
      : undefined;
  const quadroPedido = boardId
    ? quadros.find((q) => q.id === boardId)
    : undefined;
  // ⚠️ COM `boardId`, NAO HA QUEDA PARA O PADRAO -- E ESSE ERA O DEFEITO.
  //
  // A versao anterior fazia `quadroPedido ?? quadroDoLote ?? padrao`. Num
  // quadro avulso recem-criado os tres se alinham para mentir: o lote esta
  // vazio (quadro novo nao tem tarefa), e a lista de quadros ainda nao tem o
  // quadro novo -- entao a tela caia no PADRAO e desenhava as OITO colunas do
  // Quadro geral sob o titulo do quadro avulso. O modo de edicao entao
  // oferecia renomear e apagar as colunas do quadro de 176 tarefas, e o
  // backend recusava com 422 depois do clique.
  //
  // ⚠️ E UMA QUEDA SILENCIOSA E PIOR QUE UMA ESPERA. `undefined` aqui vira
  // "Carregando…" abaixo, e o `useEffect` acima ja rebusca a lista quando o
  // `boardId` muda -- entao a espera dura uma requisicao, e nao para sempre.
  const quadro = boardId
    ? quadroPedido
    : (quadroDoLote ?? quadros.find((q) => q.is_default));
  // ⚠️ QUADRO PEDIDO E NAO ENCONTRADO = ESPERA, e nao um kanban vazio. Sem
  // esta saida a tela desenharia ZERO colunas com o titulo do quadro avulso, e
  // o modo de edicao mostraria uma lista de colunas vazia -- o que parece um
  // quadro corrompido. A lista chega na requisicao que o `useEffect` acima
  // acabou de disparar.
  //
  // ⚠️ A ESPERA E LIMITADA HOJE, E A RAZAO TEM DATA DE VALIDADE. Chegar aqui
  // com a lista JA carregada (e sem erro -- o erro sai acima desde 13/08)
  // significa "este quadro nao esta entre os que voce alcanca". Hoje o unico
  // jeito de isso acontecer e a corrida de quem acabou de criar o quadro, que
  // se resolve na proxima resposta.
  //
  // ⚠️ NO DIA DE `APAGAR QUADRO` (fatia propria) ISTO VIRA ESPERA ETERNA:
  // alguem apaga o quadro que outra pessoa esta olhando, a lista volta sem
  // ele, e a tela dela fica em "Carregando…" para sempre. Quem entregar
  // aquela fatia tem de trocar esta saida por um "este quadro nao existe
  // mais", e o teste que prende isto e o `describe` do quadro recem-criado.
  if (boardId && !quadro) {
    return <div className="muted">Carregando tarefas…</div>;
  }
  const colunas: Coluna[] = quadro
    ? [...quadro.colunas].sort((a, b) => a.position - b.position)
    : [];
  const colunaPorId = new Map(colunas.map((c) => [c.id, c]));

  // ⚠️ EM QUADRO AVULSO O TIME DA TAREFA NOVA SAI DO QUADRO, E NAO DE QUEM
  // CLICA. `subteamId` e `boardId` sao EXCLUDENTES (a escolha e da tela do
  // time -- ver `app/quadro/[teamId]/page.tsx`), entao no modo `boardId` o
  // `subteamId` e sempre `undefined`. A versao anterior mandava
  // `subteamId ?? null` aqui e, com `null`, o backend caia em
  // `team_scope.default_team_id()`: a tarefa nascia com o time de QUEM CRIOU.
  //
  // ⚠️ O ESTRAGO E DIFERIDO E NAO TEM SINTOMA NA HORA -- e por isso ele passou.
  // Um ADMIN (time raiz) criando dentro do quadro de um subtime gerava tarefa
  // com `team_id` da RAIZ morando num quadro do subtime. Ela aparece no lugar
  // certo e ninguem nota. Mas a edicao decide pelo TIME da tarefa (ADR 0013,
  // `_assert_editable`), nao pelo quadro: o supervisor daquele subtime leva
  // 403 ao arrastar aquele card e -- pior -- `apagar_coluna` e ATOMICA, entao
  // aquela coluna passa a falhar inteira, para sempre, com uma mensagem que
  // fala de permissao sobre uma tarefa e nao sobre a coluna que ele clicou.
  //
  // ⚠️ O TIME EXPLICITO PASSA PELO `_assert_team_in_reach` (Spec 037, ADR
  // 0038): o quadro so esta nesta tela porque `list_visible` o devolveu, e
  // aquela lente e a MESMA -- logo o time dele esta no alcance de quem olha.
  // ---- as ações do modo de edição ---------------------------------------
  //
  // ⚠️ SÓ FIAÇÃO. Cada uma delega a uma função pura de `lib/rascunhoDeColunas`
  // e guarda o resultado; nenhuma decide nada.
  // ⚠️ LÊ O `code`, NUNCA A MENSAGEM -- mesmo padrão do `EditorDeColunas`. O
  // backend do lote recusa com `colunas_divergentes`,
  // `referencia_tmp_desconhecida`, `coluna_ponte_obrigatoria` e as duas velhas;
  // amarrar a tela ao português do servidor quebraria na primeira revisão de
  // texto.
  function mensagemDeErro(e: unknown): string {
    const err = e as { code?: string; message?: string };
    return (
      explicaRecusa(err.code) ??
      err.message ??
      "Não consegui aplicar as alterações."
    );
  }

  const modoEdicao = rascunho !== null;
  const linhasEdicao = rascunho ? linhasDeEdicao(rascunho, colunas) : [];

  function abrirEdicao() {
    setRascunho(rascunhoInicial(colunas));
    setErroLote(null);
  }

  function fecharEdicao() {
    // ⚠️ AVISA ANTES DE DESCARTAR. No modelo de lote, sair É o cancelar -- e a
    // coluna criada some sem explicação, porque nunca chegou a existir no
    // servidor.
    if (
      rascunho &&
      temPendencias(rascunho, colunas) &&
      !window.confirm(
        "Você tem alterações que ainda não foram aplicadas. Descartar?",
      )
    ) {
      return;
    }
    setRascunho(null);
    setCriandoColuna(false);
    setRevisando(false);
    setErroLote(null);
  }

  function moverColunaNoRascunho(ref: string, direcao: "esquerda" | "direita") {
    if (!rascunho) return;
    const origem = rascunho.ordem.indexOf(ref);
    const novo = comOrdem(
      rascunho,
      ref,
      direcao === "esquerda" ? origem - 1 : origem + 1,
    );
    // ⚠️ `null` = nada muda. Sem esta saída, a seta na ponta viraria pendência
    // e a pessoa receberia "há alterações não aplicadas" sobre nada.
    if (novo) setRascunho(novo);
  }

  async function concluirEdicao() {
    if (!rascunho) return;
    if (!temPendencias(rascunho, colunas)) {
      setRascunho(null);
      return;
    }
    const marcadas = marcadasParaApagar(rascunho, colunas);
    if (marcadas.length === 0) {
      await aplicarLote({});
      return;
    }
    // ⚠️ AS CONTAGENS SÃO BUSCADAS AGORA, e não quando a pessoa clicou no "×".
    // Entre um e outro alguém pode ter criado tarefa naquela coluna, e o número
    // da revisão tem de ser o do momento da decisão.
    setContagens(null);
    setErroLote(null);
    setRevisando(true);
    try {
      const pares = await Promise.all(
        marcadas.map(async (c) => {
          const det = await colunaComContagem(boardId!, c.id);
          return [c.id, det.task_count] as const;
        }),
      );
      setContagens(Object.fromEntries(pares));
    } catch (e) {
      setContagens({});
      setErroLote(mensagemDeErro(e));
    }
  }

  async function aplicarLote(destinos: Record<string, string>) {
    if (!rascunho || !boardId) return;
    setAplicando(true);
    setErroLote(null);
    try {
      const resposta = await aplicarLoteDeColunas(
        boardId,
        paraLote(rascunho, colunas, destinos),
      );
      // ⚠️ AVISO DE DIVERGENCIA, e ele EXISTIA no painel antigo e se perdeu no
      // redesenho (reposto em 13/08). Se o servidor moveu um numero diferente
      // do que a revisao mostrou, alguem mexeu no quadro entre uma coisa e
      // outra -- e a tela tem dois numeros sobre a mesma coisa, que e pior que
      // um numero velho.
      const divergencia = mensagemDeDivergencia(
        totalPrevisto(rascunho, contagens ?? {}),
        resposta.movidas,
      );
      if (divergencia) setToast(divergencia);
      setRascunho(null);
      setRevisando(false);
      setCriandoColuna(false);
      // ⚠️ RECARREGA OS DOIS. O lote pode ter movido tarefas entre colunas e
      // mudado a lista de colunas -- pintar só um deixaria cards apontando
      // para coluna que não existe mais, contados e invisíveis.
      carregarQuadros();
      recarregarTasks();
    } catch (e) {
      // ⚠️ RECUSA PERDE O LOTE INTEIRO, e o rascunho FICA. É o preço aceito do
      // modelo, e manter o rascunho é o que permite à pessoa corrigir em vez
      // de refazer do zero.
      setErroLote(mensagemDeErro(e));
    } finally {
      setAplicando(false);
    }
  }

  // ⚠️ NO MODO DE EDICAO O KANBAN SEGUE A ORDEM DO RASCUNHO, e nao a do
  // servidor. E o que faz o arraste ter efeito imediato sem nada ir para a
  // rede. Fora do modo, e a lista de sempre.
  //
  // ⚠️ A COLUNA CRIADA NO RASCUNHO NAO APARECE NO KANBAN, e isso e deliberado:
  // ela nao tem id real, entao nao tem tarefa, nao e alvo de arraste de card e
  // nao pode ser consultada. Ela existe na REVISAO como destino possivel.
  // Desenha-la vazia aqui prometeria uma coluna que ainda nao existe.
  const colunasVisiveis: Coluna[] = rascunho
    ? (rascunho.ordem
        .map((ref) => colunas.find((c) => c.id === ref))
        .filter(Boolean) as Coluna[])
    : colunas;
  const ordemVisivel = colunasVisiveis.map((c) => c.id);

  // ⚠️ VEIO PARA `lib/rascunhoDeColunas` EM 13/08. Este bloco nasceu aqui como
  // segunda versao do `destinosPara` -- num arquivo de 2000 linhas, sem
  // guardiao proprio. Agora e `destinosDoRascunho`, com teste.
  const destinosDaRevisao: DestinoPossivel[] = rascunho
    ? destinosDoRascunho(rascunho, colunas)
    : [];

  function onDragEndColuna(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !rascunho) return;
    const destino = rascunho.ordem.indexOf(String(over.id));
    if (destino === -1) return;
    const novo = comOrdem(rascunho, String(active.id), destino);
    // ⚠️ `null` = nada muda. Mesmo contrato das setas -- ver `comOrdem`.
    if (novo) setRascunho(novo);
  }

  const timeDaTarefaNova = boardId
    ? (quadro?.team_id ?? null)
    : (subteamId ?? null);

  const subCount: Record<string, number> = {};
  const subDone: Record<string, number> = {};
  for (const t of tasks) {
    if (!t.parent_task_id) continue;
    subCount[t.parent_task_id] = (subCount[t.parent_task_id] ?? 0) + 1;
    // ⚠️ A CHECKLIST CONTA PELA COLUNA, e nao por `t.status` (fatia 4c).
    //
    // Era o ULTIMO leitor de `status` que a pessoa via na tela, e ele
    // apareceu na conferencia manual de 10/08, nao em teste nenhum:
    // arrastar um pai para "Concluído" concluia a subarvore no banco, mas o
    // contador do card so mudava depois de um F5. A atualizacao otimista mexe
    // na COLUNA das subtarefas -- que e a unica coisa que o front sabe
    // derivar -- e quem lia `status` nao via nada acontecer.
    //
    // ⚠️ `DONE` E NAO `terminal()`: cancelada NAO conta como concluida na
    // proporcao. E a mesma distincao que o enum do backend registra
    // ("DONE e CANCELLED nao sao intercambiaveis"), e trocar por `terminal()`
    // faria uma subtarefa cancelada contar como entregue.
    if (colunaPorId.get(t.column_id)?.semantic === "DONE")
      subDone[t.parent_task_id] = (subDone[t.parent_task_id] ?? 0) + 1;
  }

  // Herança de subtimes pro filtro do dropdown. Uma tarefa-RAIZ "pertence" a um
  // subtime se ELA ou QUALQUER subtarefa dela tem responsavel desse subtime.
  // Sem isto, uma raiz cujo unico responsavel e de um time (ex.: "Aniversario"
  // com so a Monique/CRM) sumia ao filtrar pelos times que tocam as SUBTAREFAS
  // (design, video, midia...). O front ja carrega a subarvore inteira, entao da
  // pra agregar aqui. subtimesPorRaiz: id_da_raiz -> conjunto de subtimes.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const raizDe = (t: Task): string => {
    let atual = t;
    const vistos = new Set<string>();
    while (atual.parent_task_id && !vistos.has(atual.id)) {
      vistos.add(atual.id);
      const pai = byId.get(atual.parent_task_id);
      if (!pai) break; // pai fora do conjunto carregado -> para no topo visivel
      atual = pai;
    }
    return atual.id;
  };
  const subtimesPorRaiz = new Map<string, Set<string>>();
  for (const t of tasks) {
    const ids = t.assignee_ids ?? [];
    if (ids.length === 0) continue;
    const raizId = raizDe(t);
    let set = subtimesPorRaiz.get(raizId);
    if (!set) {
      set = new Set<string>();
      subtimesPorRaiz.set(raizId, set);
    }
    for (const id of ids) {
      const st = memberTeam.get(id);
      if (st) set.add(st);
    }
  }

  // visiveis = raizes apos o toggle de arquivadas (eixo que SOMA). raizes =
  // visiveis apos busca + prazo (eixos que ESTREITAM). Os contadores e o
  // porStatus saem de `raizes` pra nao mentir quando ha filtro ativo.
  const buscaNorm = normalizarBusca(busca);
  const hoje = hojeISO();
  // Estado agregado dos filtros recolhidos -> alimenta o badge e o "Limpar".
  const estadoFiltros = {
    prazo,
    subtime,
    escopo: escopoFiltro,
    pessoas: pessoasFiltro,
    busca,
    arquivadas: mostrarArquivadas,
  };
  const qtdFiltros = contaFiltrosAtivos(estadoFiltros);
  // Spec 031 (C3): um setter por campo, para o ✕ da pastilha saber o que
  // limpar sem a pastilha precisar conhecer o estado do componente.
  const LIMPA: Record<string, () => void> = {
    busca: () => setBusca(FILTROS_LIMPOS.busca),
    prazo: () => setPrazo(FILTROS_LIMPOS.prazo),
    subtime: () => setSubtime(FILTROS_LIMPOS.subtime),
    escopo: () => setEscopoFiltro(FILTROS_LIMPOS.escopo),
    pessoas: () => setPessoasFiltro([...FILTROS_LIMPOS.pessoas]),
    arquivadas: () => setMostrarArquivadas(FILTROS_LIMPOS.arquivadas),
  };
  function limparFiltros() {
    for (const limpar of Object.values(LIMPA)) limpar();
  }

  const temFiltro =
    buscaNorm !== "" ||
    prazo !== "todos" ||
    subtime !== "" ||
    temFiltroNovo(escopoFiltro, pessoasFiltro);

  // Fatia 3/4: lente de exibicao por MODO de quadro.
  //   - PROJETO (projectId): sem filtro de time (tasks sao do projeto).
  //   - SUBTIME (subteamId): modelo hibrido -> mostra a UNIAO de
  //       (A) tasks da RAIZ cujo ALGUM responsavel pertence ao subtime
  //           (as "compartilhadas", vindas do quadro geral); e
  //       (B) tasks INTERNAS do subtime (team_id === subteamId).
  //   - GERAL (nenhum): so tasks da raiz (Fatia 3).
  // Guarda: rootId null (nao carregou) -> nao filtra por raiz, pra nao
  // esconder o quadro. No modo subtime a guarda cai sobre a fonte (A).
  const modoSubtime = !projectId && !!subteamId;
  const soRaiz = !projectId && !subteamId && rootId !== null;
  const pertenceAoSubtime = (t: Task) => {
    const ids = t.assignee_ids ?? [];
    return ids.some((id) => memberTeam.get(id) === subteamId);
  };
  // ⚠️ D1 (decisao de 11/08): A LENTE SO MOSTRA O QUADRO GERAL.
  //
  // A lente e um ESPELHO do Quadro geral filtrado por pessoa (ADR 0034), e ela
  // desenha as colunas do quadro do lote. Sem esta linha, no dia em que
  // existir um quadro EXTRA da raiz (fatia 5c), uma tarefa dele passaria no
  // filtro abaixo (`team_id === rootId` + responsavel do subtime), a tela
  // desenharia as colunas do geral, `porColuna[t.column_id]` nao acharia nada
  // e **o card sumiria sem erro nenhum**.
  //
  // ⚠️ VALE PARA OS DOIS RAMOS, interna e compartilhada. Tarefa INTERNA de um
  // subtime que tenha quadro avulso proprio (fatia 5b-6) tambem nao entra: a
  // lente e o espelho do geral, e o quadro avulso tem tela propria. E o item
  // 12 da conferencia visual do `plan-fatia-5.md`.
  //
  // ⚠️ GUARDA IGUAL A DO `rootId`: sem quadro geral conhecido (`listBoards`
  // falhou e ficou `[]`), NAO filtra. Esconder o quadro inteiro por falha de
  // uma requisicao auxiliar e pior que mostrar demais.
  //
  // ⚠️ FORA DA LENTE ESTA LINHA NAO ENTRA. A vista do Quadro geral e a de
  // projeto continuam como estao; quadro extra da raiz e assunto da 5c, e a
  // escolha do quadro por lote (acima) ja cai no padrao e denuncia o resto no
  // contador de `foraDaColuna`.
  const quadroGeralId = quadros.find((q) => q.is_default)?.id ?? null;
  const noQuadroGeral = (t: Task) =>
    quadroGeralId === null || t.board_id === quadroGeralId;
  const visiveis = tasks.filter((t) => {
    if (t.depth !== 0) return false;
    if (!(mostrarArquivadas || !t.is_archived)) return false;
    // ⚠️ QUADRO AVULSO: SO O QUE MORA NELE, e nada mais (fatia 5b-6). Vem
    // ANTES do modo subtime de proposito -- as duas condicoes seriam
    // verdadeiras ao mesmo tempo na tela do time, e o filtro hibrido traria
    // tarefas da raiz para um quadro que nao as contem.
    if (boardId) return t.board_id === boardId;
    if (modoSubtime) {
      if (!noQuadroGeral(t)) return false;
      // (B) interna do subtime OU (A) da raiz com responsavel do subtime.
      const interna = t.team_id === subteamId;
      const compartilhada =
        (rootId === null || t.team_id === rootId) && pertenceAoSubtime(t);
      return interna || compartilhada;
    }
    return !soRaiz || t.team_id === rootId;
  });
  // Fatia 4b: no modo subtime, classifica cada task pra tag do card.
  //   interna     -> team_id === subteamId (nasceu aqui)
  //   compartilhada-> veio da raiz (as demais que passaram o filtro hibrido)
  // Fora do modo subtime, undefined (sem pill).
  // Delega ao modulo puro: a pill do card e o filtro TEM de usar a mesma
  // regra, senao a tela mostra "interna" e o filtro "interna" a esconde.
  const escopoDaTask = (t: Task) =>
    classificaEscopo(t, modoSubtime ? subteamId : null, timeDoProjeto);
  // A pill nao desenha "indefinido"; o FILTRO precisa dele (esconde em "So
  // internas"). Por isso sao duas leituras da mesma classificacao.
  const pillDaTask = (t: Task) => pillDoEscopo(escopoDaTask(t));

  // Responsaveis agregados por raiz (herda de subtarefa) -- alimenta o filtro
  // por pessoa. Mesmo desenho do subtimesPorRaiz logo acima.
  const respPorRaiz = responsaveisPorRaiz(tasks);

  // Busca por titulo, agora incluindo SUBTAREFA (05/08). O conjunto e de
  // RAIZES: subtarefa nao tem card (o quadro so desenha `depth === 0`), entao
  // achar uma subtarefa significa trazer a raiz dela. Regra e testes em
  // lib/filtrosQuadro:raizesQueCasamBusca -- aqui so se pergunta.
  const raizesDaBusca = raizesQueCasamBusca(tasks, buscaNorm);

  // Quem tem ALGUMA tarefa neste quadro (raiz ou subtarefa). Usado so pra
  // decidir se um desativado ainda merece aparecer no filtro.
  const comTrabalhoAqui = new Set<string>();
  for (const t of tasks) for (const id of t.assignee_ids ?? []) comTrabalhoAqui.add(id);

  // Pessoas do seletor. No quadro de SUBTIME, so quem e daquela equipe
  // (pedido da Camila: "filtrar por pessoa que faz parte daquela equipe").
  // No quadro geral / de projeto, todo mundo. Ordenado por nome pt-BR.
  //
  // Spec 031 (C15): DESATIVADO sai daqui tambem -- este e um seletor de
  // responsavel como qualquer outro, e a lista nao pode encher de gente que
  // nao entra mais no sistema.
  //
  // ⚠️ MENOS quem ainda tem tarefa neste quadro. Quem sai do time deixa
  // trabalho para tras, e "o que a fulana deixou pendente?" e exatamente a
  // pergunta que se faz DEPOIS que ela sai. Tirar da lista quem tem tarefa
  // aqui esconderia esse trabalho em vez de limpar a lista.
  const pessoasDoFiltro = Array.from(members.entries())
    .filter(([id]) => !modoSubtime || memberTeam.get(id) === subteamId)
    .filter(([id]) => !membrosInativos.has(id) || comTrabalhoAqui.has(id))
    .map(([id, m]) => ({
      id,
      name: m.name,
      inativo: membrosInativos.has(id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // Nomes para as pastilhas -- id cru nao vira rotulo na tela.
  const chipsFiltro = listaFiltrosAtivos(estadoFiltros, {
    subtimes: new Map(subtimes.map((t) => [t.id, t.name])),
    pessoas: new Map(pessoasDoFiltro.map((p) => [p.id, p.name])),
  });

  const raizes = visiveis.filter((t) => {
    if (buscaNorm && !raizesDaBusca.has(t.id)) return false;
    // Sem data: aparece em qualquer filtro de prazo (decisao da Camila).
    if (prazo !== "todos" && t.due_date) {
      // Concluida nunca e atrasada (ja foi entregue).
      // ⚠️ Pela COLUNA (fatia 4c), pelo mesmo motivo do contador acima. E
      // `!== "DONE"` e nao `!terminal()`: hoje CANCELADA com prazo vencido
      // CONTA como atrasada, e mudar isso e decisao de produto, nao
      // refatoracao.
      const atrasada =
        colunaPorId.get(t.column_id)?.semantic !== "DONE" && t.due_date < hoje;
      if (prazo === "atrasadas" && !atrasada) return false;
      if (prazo === "em-dia" && atrasada) return false;
    }
    // Subtime: passa se ALGUM responsavel da RAIZ OU DE SUAS SUBTAREFAS
    // pertence ao subtime escolhido (herança -- ver subtimesPorRaiz). NAO toca
    // em task.team_id -> o bug E6 continua dormente. Task (subarvore inteira)
    // sem nenhum responsavel some ao filtrar por subtime (decisao da Camila).
    if (subtime) {
      const times = subtimesPorRaiz.get(t.id);
      if (!times || !times.has(subtime)) return false;
    }
    // Escopo (interna x compartilhada) -- mesma classificacao da pill.
    if (!passaEscopo(escopoFiltro, escopoDaTask(t))) return false;
    // Pessoa: herda da subarvore, entao designacao em subtarefa mantem a raiz.
    if (!passaResponsavel(pessoasFiltro, t.id, respPorRaiz)) return false;
    return true;
  });
  // Ordenacao escolhida (so na sessao). Reordena as raizes pelo criterio e
  // depois distribui nas colunas -- a distribuicao preserva a ordem. Empate
  // SEMPRE cai pra created_at desc (mais nova primeiro), pra coluna nao "tremer".
  // O comparador saiu pra `lib/ordenacao.ts` -- "Minhas tarefas" usa o MESMO.
  const ordenadas = ordenar(raizes, ordenacao);

  // ⚠️ TAREFA CUJA COLUNA NAO ESTA NA LISTA NAO E DESENHADA, e por isso ela e
  // CONTADA. Some da tela, mas nao em silencio -- perda silenciosa e o defeito
  // que este projeto mais pagou. A invariante 2 do `invariantes.sql` diz que
  // isso e zero em producao; o contador existe para o dia em que deixar de
  // ser, e para o lote de mais de um quadro descrito acima.
  const porColuna: Record<string, Task[]> = {};
  for (const c of colunas) porColuna[c.id] = [];
  let foraDaColuna = 0;
  for (const t of ordenadas) {
    const lista = porColuna[t.column_id];
    if (lista) lista.push(t);
    else foraDaColuna++;
  }

  const focado = detalhe ? tasks.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? tasks.filter((t) => t.parent_task_id === focado.id) : [];

  return (
    <div>
      {/* ⚠️ A BARRA TROCA DE CONTEUDO NO MODO DE EDICAO, e nao ganha itens.
          Buscar, filtrar e criar tarefa nao fazem sentido enquanto a pessoa
          reorganiza colunas -- e a largura desta linha ja e o gargalo da tela
          (ver §"O que NAO valida": zero responsivo). */}
      {modoEdicao ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>{title}</h1>
          <span
            style={{
              fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "var(--accent-soft)", color: "var(--accent)",
            }}
          >
            Modo edição
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => setCriandoColuna(true)}
            style={{ marginLeft: "auto" }}
          >
            Adicionar coluna
          </button>
          <button className="btn btn-primary" onClick={concluirEdicao}>
            Concluir edição
          </button>
          {/* ⚠️ SAIR E O CANCELAR deste modelo -- e ele avisa antes de
              descartar. Ver `fecharEdicao`. */}
          <button className="btn btn-ghost" onClick={fecharEdicao}>
            Sair
          </button>
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>{title}</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {temFiltro ? `${raizes.length} de ${visiveis.length}` : raizes.length} tarefas
        </span>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título…"
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", minWidth: 170,
          }}
        />
        {/* Ordenacao fica FORA do painel: ela nao esconde tarefa, so muda a
            ordem. Recolher junto com os filtros faria o badge sugerir que ha
            coisa omitida quando so a ordem mudou. */}
        <select
          value={ordenacao}
          onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          {ORDENACOES.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>

        {/* ---- Painel de filtros ---- */}
        <div ref={painelRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setPainelAberto((v) => !v)}
            aria-expanded={painelAberto}
            aria-label="Filtros"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 13, padding: "6px 10px", borderRadius: 8,
              border: "1px solid var(--border)",
              background: qtdFiltros > 0 ? "var(--accent-soft)" : "var(--surface)",
              color: qtdFiltros > 0 ? "var(--accent)" : "var(--text)",
              fontWeight: qtdFiltros > 0 ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <SlidersHorizontal size={14} />
            Filtros
          </button>

          {painelAberto && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                width: 260, background: "var(--surface)",
                border: "1px solid var(--border)", borderRadius: 12,
                boxShadow: "var(--shadow)", padding: 14,
                display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <div
                style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <strong style={{ fontSize: 13 }}>Filtros</strong>
                <button
                  type="button"
                  onClick={limparFiltros}
                  disabled={qtdFiltros === 0}
                  style={{
                    border: "none", background: "transparent", padding: 0,
                    fontSize: 12, fontWeight: 600,
                    color: qtdFiltros === 0 ? "var(--text-faint)" : "var(--accent)",
                    cursor: qtdFiltros === 0 ? "default" : "pointer",
                  }}
                >
                  Limpar
                </button>
              </div>

              <div className="field">
                <label className="label" htmlFor="f-prazo">Prazo</label>
                <select
                  id="f-prazo"
                  className="input"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value as FiltroPrazo)}
                >
                  <option value="todos">Todos</option>
                  <option value="atrasadas">Atrasadas</option>
                  <option value="em-dia">Em dia</option>
                </select>
              </div>

              {!subteamId && subtimes.length > 0 && (
                <div className="field">
                  <label className="label" htmlFor="f-subtime">Equipe</label>
                  <select
                    id="f-subtime"
                    className="input"
                    value={subtime}
                    onChange={(e) => setSubtime(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {subtimes.map((sub) => (
                      <option key={sub.id} value={sub.id}>{sub.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {modoSubtime && (
                <div className="field">
                  <label className="label" htmlFor="f-escopo">Origem</label>
                  <select
                    id="f-escopo"
                    className="input"
                    value={escopoFiltro}
                    onChange={(e) => setEscopoFiltro(e.target.value as FiltroEscopo)}
                    title="Interna nasceu neste subtime; compartilhada veio do quadro geral"
                  >
                    <option value="todos">Todas</option>
                    <option value="interna">Só internas</option>
                    <option value="compartilhada">Só compartilhadas</option>
                  </select>
                </div>
              )}

              {pessoasDoFiltro.length > 0 && (
                <div className="field">
                  <span className="label" id="f-pessoa-rotulo">
                    Responsável
                    {pessoasFiltro.length > 0 && ` (${pessoasFiltro.length})`}
                  </span>
                  {/* Lista de checkboxes, nao <select multiple>: o nativo
                      exige ctrl+clique pra somar e desfaz a selecao inteira
                      num clique solto -- perder o filtro por engano e o
                      caminho mais curto pra "cade minha tarefa?". */}
                  <div
                    role="group"
                    aria-labelledby="f-pessoa-rotulo"
                    title="Mostra as tarefas em que QUALQUER uma das marcadas está designada, inclusive por subtarefa"
                    style={{
                      maxHeight: 168, overflowY: "auto",
                      border: "1px solid var(--border)", borderRadius: 8,
                      padding: "6px 8px", display: "flex",
                      flexDirection: "column", gap: 2,
                    }}
                  >
                    {pessoasDoFiltro.map((pes) => (
                      <label
                        key={pes.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          fontSize: 13, padding: "3px 2px", cursor: "pointer",
                          color: pes.inativo ? "var(--text-soft)" : undefined,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={pessoasFiltro.includes(pes.id)}
                          onChange={() => alternarPessoa(pes.id)}
                        />
                        {pes.inativo ? `${pes.name} (inativo)` : pes.name}
                      </label>
                    ))}
                  </div>
                  {pessoasFiltro.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setPessoasFiltro([])}
                      style={{ alignSelf: "flex-start", fontSize: 12, marginTop: 4 }}
                    >
                      Limpar responsáveis
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <label
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
            fontSize: 13, color: "var(--text-soft)", cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={mostrarArquivadas}
            onChange={(e) => setMostrarArquivadas(e.target.checked)}
          />
          Mostrar arquivadas
        </label>
        <button
          className="btn btn-primary"
          onClick={() => setCriando(true)}
          style={{ padding: "8px 14px" }}
        >
          + Nova tarefa
        </button>
      </div>
      )}

      {/* --- Pastilhas de filtro ativo (Spec 031, C3) ---------------------
          Substituem o badge numerico do botao. O numero dizia QUANTOS; a
          pastilha diz QUAIS e desfaz em um clique. Fica FORA do painel de
          proposito: filtro recolhido e filtro esquecido. */}
      {chipsFiltro.length > 0 && (
        <div
          style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
            marginTop: -8, marginBottom: 16,
          }}
        >
          {chipsFiltro.map((c) => (
            <button
              key={c.campo}
              type="button"
              onClick={() => LIMPA[c.campo]?.()}
              title={`Remover filtro: ${c.rotulo}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 26, padding: "0 8px 0 10px", borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--accent-soft)", color: "var(--accent)",
                fontSize: 12, fontWeight: 600, cursor: "pointer", lineHeight: 1,
              }}
            >
              {c.rotulo}
              <span aria-hidden="true" style={{ fontSize: 13, opacity: 0.8 }}>×</span>
            </button>
          ))}
          {chipsFiltro.length > 1 && (
            <button
              type="button"
              onClick={limparFiltros}
              style={{
                border: "none", background: "transparent", padding: "0 4px",
                fontSize: 12, fontWeight: 600, color: "var(--text-soft)",
                cursor: "pointer",
              }}
            >
              Limpar tudo
            </button>
          )}
        </div>
      )}

      {truncadoTotal !== null && (
        <div
          role="alert"
          style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--accent-soft)",
            color: "var(--text)", fontSize: 13,
          }}
        >
          O carregamento atingiu o limite de exibição
          (<strong>{truncadoTotal}</strong> tarefas no total). Mostrando as mais
          recentes — algumas podem não aparecer no quadro nem na busca. Arquive
          tarefas concluídas para reduzir o volume.
        </div>
      )}

      {/* ⚠️ QUADRO AVULSO VAZIO DESENHA AS COLUNAS, e nao o estado vazio
          (fatia 5b-6). Todo quadro nasce sem tarefa nenhuma, entao o estado
          vazio seria a PRIMEIRA coisa que a pessoa ve depois de criar -- sem
          uma coluna na tela, sem saber se nasceu certo, e sem lugar para onde
          arrastar. O item 1 da conferencia visual do `plan-fatia-5.md` pede
          exatamente conferir "ele nasce com as 4 colunas, nomes e cores
          certos, na ordem certa", e nao ha o que conferir se elas nao
          aparecem.

          ⚠️ SO NO MODO `boardId`, e a limitacao e deliberada. O Quadro geral
          tem 176 tarefas vivas e nunca cai aqui; o quadro de PROJETO cai, e
          mudar o que ele mostra e decisao de produto que esta fatia nao tomou.
          Se um dia o kanban vazio for o certo para todos, esta condicao some
          -- e o comentario com ela. */}
      {/* ⚠️ O PAINEL `EditorDeColunas` SAIU AQUI (fatia 6c). Ele era uma lista
          vertical ABAIXO do quadro -- uma tradução mental do quadro em vez do
          quadro. O modo de edição agora acontece sobre as próprias colunas, e
          o painel virou arquivo morto e foi APAGADO em 13/08, junto com o
          teste dele (-20 testes).

          ⚠️ `lib/edicaoDeColunas.ts` FICOU: `avisoDeExclusao`,
          `impedimentoDeExclusao`, `explicaRecusa`, `destinoEhTerminal` e
          `mensagemDeDivergencia` seguem em uso pela revisao e pelo rascunho.
          Morreu o DESENHO, nao a regra -- e e a fronteira da Spec 027 pagando
          o que prometia.

          ⚠️ O COMENTARIO ANTIGO DIZIA QUE O QUADRO GERAL NAO SE MEXE. Deixou
          de valer na 6a-bis (13/08): o geral é tão personalizável quanto os
          outros, e quem filtra é `board.manage.root` -- ADMIN e MANAGER, e não
          SUPERVISOR. A única trava que sobrou é apagar coluna COM PONTE.

          ⚠️ E SO PARA QUEM PODE. `podeEditarColunas` vem da tela, que já
          calculou o alcance (`podeGerirQuadrosDe`). Este componente não
          recalcula permissão -- sem isso, o lápis abriria para um operador um
          modo onde toda ação dá 403. */}
      {boardId && podeEditarColunas && !modoEdicao && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn btn-ghost"
            onClick={abrirEdicao}
            aria-label="Editar colunas"
            title="Editar colunas"
          >
            <Pencil size={15} />
          </button>
        </div>
      )}

      {criandoColuna && rascunho && (
        <FormNovaColuna
          onCriar={(nome, semantica) => {
            setRascunho((r) => (r ? comColunaNova(r, nome, semantica) : r));
            setCriandoColuna(false);
          }}
          onCancelar={() => setCriandoColuna(false)}
        />
      )}

      {revisando && rascunho && (
        <RevisaoDaEdicao
          marcadas={marcadasParaApagar(rascunho, colunas)}
          // ⚠️ OS DESTINOS INCLUEM AS COLUNAS `tmp:`, e e a razao de ser do
          // lote: apagar "Aprovacao" mandando as tarefas para a "Entregue" que
          // voce acabou de criar, num gesto so.
          destinos={destinosDaRevisao}
          contagens={contagens}
          resumo={{
            criadas: rascunho.novas.length,
            renomeadas: Object.keys(rascunho.nomes).length,
            ordemMudou: (paraLote(rascunho, colunas).ordem ?? []).length > 0,
          }}
          erro={erroLote}
          ocupado={aplicando}
          onConfirmar={aplicarLote}
          onVoltar={() => setRevisando(false)}
        />
      )}

      {raizes.length === 0 && !boardId ? (
        temFiltro ? (
          <SemResultado
            onLimpar={() => {
              setBusca("");
              setPrazo("todos");
              setSubtime("");
            }}
          />
        ) : (
          <EmptyState onNova={() => setCriando(true)} />
        )
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={modoEdicao ? undefined : onDragStart}
          // ⚠️ UM `DndContext` SO, E O HANDLER TROCA. Dois contextos aninhados
          // brigariam pelo mesmo ponteiro, e o de dentro venceria -- que e
          // exatamente o motivo pelo qual a decisao de 12/08 tinha rejeitado
          // arrastar cabecalho no quadro normal.
          onDragEnd={modoEdicao ? onDragEndColuna : onDragEnd}
        >
          <div
            ref={colunasRef}
            style={{
              display: "flex", gap: 14, overflowX: "auto", overflowY: "hidden",
              paddingBottom: 8, height: alturaColunas ?? undefined,
            }}
          >
            <SortableContext
              items={ordemVisivel}
              strategy={horizontalListSortingStrategy}
              // ⚠️ `disabled` FORA DO MODO: sem isto o `useSortable` de cada
              // cabecalho continuaria registrado e o arraste de CARD passaria a
              // disputar o mesmo gesto no quadro normal.
              disabled={!modoEdicao}
            >
              {colunasVisiveis.map((c) => (
              <ColunaKanban
                key={c.id}
                coluna={c}
                count={(porColuna[c.id] || []).length}
                cabecalho={
                  modoEdicao ? (
                    <CabecalhoSortavel
                      linha={linhasEdicao.find((l) => l.ref === c.id)!}
                      cor={c.color}
                      indice={ordemVisivel.indexOf(c.id)}
                      total={ordemVisivel.length}
                      onRenomear={(nome) =>
                        setRascunho((r) => (r ? comRenome(r, c.id, nome) : r))
                      }
                      onMarcar={() =>
                        setRascunho((r) => (r ? comMarcacao(r, c.id) : r))
                      }
                      onMover={(d) => moverColunaNoRascunho(c.id, d)}
                    />
                  ) : undefined
                }
              >
                {(porColuna[c.id] || []).map((t) => (
                  <CardArrastavel
                    // ⚠️ TRAVADO NO MODO DE EDICAO, e nao escondido. Sumir
                    // esconderia que o "x" esta sobre uma coluna com 40 tarefas
                    // dentro; travado, a pessoa ve o que esta reorganizando.
                    travado={modoEdicao}
                    key={t.id}
                    task={t}
                    coluna={c}
                    onAbrir={abrirDetalhe}
                    members={members}
                    subtaskCount={subCount[t.id] ?? 0}
                    subtaskDone={subDone[t.id] ?? 0}
                    projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
                    escopo={pillDaTask(t)}
                  />
                ))}
              </ColunaKanban>
              ))}
            </SortableContext>
          </div>

          {foraDaColuna > 0 && (
            <div className="muted" role="status" style={{ fontSize: 12, marginTop: 8 }}>
              {foraDaColuna} {foraDaColuna === 1 ? "tarefa está" : "tarefas estão"} em
              uma coluna que não é deste quadro e não {foraDaColuna === 1 ? "aparece" : "aparecem"} acima.
            </div>
          )}

          <DragOverlay>
            {/* ⚠️ `&&` com a coluna, e nao `!`: card cuja coluna nao esta na
                lista simplesmente nao ganha fantasma de arrasto. O `!`
                esconderia o dia em que essa combinacao passar a existir. */}
            {activeTask && colunaPorId.get(activeTask.column_id) ? (
              <div style={{ width: 256, cursor: "grabbing" }}>
                <TaskCard
                  task={activeTask}
                  coluna={colunaPorId.get(activeTask.column_id) as Coluna}
                  members={members}
                  subtaskCount={subCount[activeTask.id] ?? 0}
                  subtaskDone={subDone[activeTask.id] ?? 0}
                  projectName={activeTask.project_id ? projectNames.get(activeTask.project_id) : undefined}
                  escopo={pillDaTask(activeTask)}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskModal
        open={criando || editando !== null || duplicando !== null}
        task={editando}
        duplicarDe={duplicando}
        filhosDaOrigem={
          duplicando ? tasks.filter((t) => t.parent_task_id === duplicando.id) : []
        }
        defaultProjectId={projectId ?? null}
        defaultTeamId={timeDaTarefaNova}
        defaultBoardId={boardId ?? null}
        nomeDoQuadro={boardId ? (quadro?.name ?? null) : null}
        onClose={() => {
          setCriando(false);
          setEditando(null);
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // ⚠️ Abre a CÓPIA, não a origem. Sem isto o detalhe continua na
            // tarefa original e a pessoa fica olhando a tela de onde saiu,
            // sem sinal nenhum de que algo foi criado -- pior ainda quando a
            // cópia é subtarefa, que não vira card no quadro (`depth !== 0`)
            // e só existe dentro da checklist do pai.
            setDuplicando(null);
            aoSalvar(t);
            setPilha([]);
            setDetalhe(t);
            // ⚠️ RECARGA OBRIGATÓRIA. `aoSalvar` insere no estado SÓ a tarefa
            // devolvida pelo POST -- a cópia-pai. As SUBTAREFAS nasceram no
            // backend, na mesma transação, e não estão em `tasks`. Como
            // `filhosFocado` é derivado de `tasks` e o `TaskDetail` não busca
            // os próprios filhos (recebe `filhos` como prop), a checklist da
            // cópia abria VAZIA e a leitura honesta era "duplicou sem as
            // subtarefas". Elas estavam no banco o tempo todo; F5 mostrava.
            // Mesma razão vale para `subCount` do card.
            recarregarTasks();
            return;
          }
          aoSalvar(t);
        }}
      />

      <TaskDetail
        task={focado}
        members={members}
        projects={projectNames}
        filhos={filhosFocado}
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onEditar={(t) => {
          setEditando(t);
        }}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsert}
        onTaskMoved={() => recarregarTasks()}
        onExcluir={aoExcluir}
        mostrarArquivadas={mostrarArquivadas}
        projetosPessoais={projetosPessoais}
        membrosInativos={membrosInativos}
        subtimePorMembro={memberTeam}
        rootTeamId={rootId}
      />

      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            // color usa --surface (e nao "#fff" cravado): o fundo e --text, e
            // os dois invertem juntos no tema escuro. Com branco fixo, o toast
            // ficaria branco sobre fundo claro -- ilegivel.
            background: "var(--text)", color: "var(--surface)", padding: "10px 16px",
            borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 60,
            boxShadow: "var(--shadow)", maxWidth: 420,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Uma coluna do kanban (fatia 4c).
 *
 * ⚠️ RENOMEADO de `Coluna` para `ColunaKanban`: `Coluna` agora e o TIPO que
 * vem da API (`lib/coluna.ts`), e um componente com o mesmo nome do tipo que
 * ele recebe torna todo import deste arquivo uma adivinhacao.
 *
 * ⚠️ O `id` do droppable e o `column_id`, e nao mais a chave do status. E a
 * troca inteira desta fatia: o que o `onDragEnd` recebe em `e.over.id` passa a
 * ser a COLUNA de destino, que e o que o `PATCH` agora aceita (ADR 0041).
 */
/**
 * O cabecalho editavel, ligado ao `useSortable` (Spec 036, fatia 6c-2c).
 *
 * ⚠️ COMPONENTE PROPRIO SO POR CAUSA DO HOOK. `useSortable` e um hook, entao
 * nao pode ser chamado dentro do `.map()` do pai. Toda a aparencia mora em
 * `CabecalhoDeColunaEditavel`, que e testavel sem dnd nenhum.
 *
 * ⚠️ ESTE ARQUIVO E O UNICO PEDACO DA FATIA 6 SEM GUARDIAO, e nao ha como ser
 * diferente: `onDragEnd` nao roda em jsdom. E por isso que as SETAS existem --
 * elas chamam `comOrdem`, a mesma funcao que o arraste usa, e essa esta
 * testada em `lib/__tests__/rascunhoDeColunas.test.ts`.
 */
function CabecalhoSortavel({
  linha,
  cor,
  indice,
  total,
  onRenomear,
  onMarcar,
  onMover,
}: {
  linha: LinhaDeEdicao;
  cor: string;
  indice: number;
  total: number;
  onRenomear: (nome: string) => void;
  onMarcar: () => void;
  onMover: (direcao: "esquerda" | "direita") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: linha.ref });
  return (
    <div
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, 0, 0)`
          : undefined,
        transition,
        // ⚠️ A COLUNA ARRASTADA FICA TRANSLUCIDA, e nao invisivel: some-la
        // faria as vizinhas pularem para o lugar dela e a pessoa perderia a
        // referencia de onde estava.
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <CabecalhoDeColunaEditavel
        linha={linha}
        cor={cor}
        podeIrEsquerda={indice > 0}
        podeIrDireita={indice < total - 1}
        onRenomear={onRenomear}
        onMarcar={onMarcar}
        onMover={onMover}
        arrasteRef={setNodeRef}
        arrasteProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function ColunaKanban({
  coluna,
  count,
  children,
  cabecalho,
}: {
  coluna: Coluna;
  count: number;
  children: React.ReactNode;
  /** Trocado no modo de edicao. Ausente = o cabecalho normal. */
  cabecalho?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1, minWidth: 240, minHeight: 0, borderRadius: 10, padding: 4,
        display: "flex", flexDirection: "column",
        background: isOver ? "var(--surface-2)" : "transparent",
        // O fundo sozinho e quase invisivel (surface-2 x canvas = ~2% de
        // diferenca). O anel na cor da propria coluna diz PARA ONDE o card
        // vai. `outline` (nao `border`) de proposito: nao ocupa espaco, entao
        // as colunas nao pulam de largura quando o alvo muda.
        outline: isOver ? `2px solid ${coluna.color}` : "none",
        outlineOffset: -2,
        transition: "background .12s",
      }}
    >
      {cabecalho ?? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            paddingBottom: 8, borderBottom: `2px solid ${coluna.color}`,
            flexShrink: 0,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: coluna.color }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>{coluna.name}</span>
          <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{count}</span>
        </div>
      )}
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          flex: 1, minHeight: 0, overflowY: "auto",
        }}
      >
        {children}
        {count === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>—</div>
        )}
      </div>
    </div>
  );
}

function CardArrastavel({
  task,
  coluna,
  onAbrir,
  members,
  subtaskCount,
  subtaskDone,
  projectName,
  escopo,
  travado = false,
}: {
  task: Task;
  coluna: Coluna;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  subtaskCount: number;
  subtaskDone: number;
  projectName?: string;
  escopo?: "compartilhada" | "interna";
  /** Modo de edicao de colunas: o card nao arrasta. */
  travado?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    // ⚠️ `disabled` NO HOOK, e nao so deixar de espalhar os `listeners`. O
    // `useDraggable` registra o no no contexto ao montar; sem isto o card
    // continuaria sendo alvo de arraste pelo dnd-kit mesmo sem os handlers, e
    // o gesto competiria com o arraste de CABECALHO -- que e o unico motivo
    // pelo qual o modo de edicao existe como estado explicito.
    disabled: travado,
  });
  return (
    <div
      ref={setNodeRef}
      // ⚠️ TRAVADO NAO E ESCONDIDO. O card continua clicavel para abrir a
      // tarefa: quem esta reorganizando colunas pode precisar conferir o que
      // tem dentro antes de apagar uma.
      {...(travado ? {} : listeners)}
      {...attributes}
      onClick={() => onAbrir(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir(task);
        }
      }}
      tabIndex={0}
      className="card-elev"
      style={{
        opacity: isDragging ? 0.4 : task.is_archived ? 0.55 : 1,
        // ⚠️ `touchAction` VOLTA AO PADRAO QUANDO TRAVADO. `none` existe para o
        // arraste por toque funcionar; mantido no modo de edicao, ele impediria
        // rolar a coluna com o dedo sem dar arraste nenhum em troca.
        touchAction: travado ? undefined : "none",
        cursor: travado ? "pointer" : undefined,
        // Enquanto arrasta, sem elevacao: o card ja esta com o ghost do
        // dnd-kit e a sombra dupla ficava suja por cima dele.
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
        coluna={coluna}
        members={members}
        subtaskCount={subtaskCount}
        subtaskDone={subtaskDone}
        projectName={projectName}
        escopo={escopo}
      />
    </div>
  );
}

function SemResultado({ onLimpar }: { onLimpar: () => void }) {
  return (
    <EmptyStateBox
      title="Nada encontrado"
      description="Nenhuma tarefa bate com o filtro atual. A busca por título já inclui as subtarefas — a tarefa de topo delas é que aparece. Tarefas arquivadas só entram com o filtro ligado. No filtro de subtime, tarefas sem responsável (ou só com responsáveis de outro subtime) não aparecem."
      action={<button className="btn" onClick={onLimpar}>Limpar filtros</button>}
    />
  );
}

function EmptyState({ onNova }: { onNova: () => void }) {
  return (
    <EmptyStateBox
      title="Nenhuma tarefa ainda"
      description="Crie a primeira — ela aparece aqui, organizada por status."
      action={<button className="btn btn-primary" onClick={onNova}>+ Nova tarefa</button>}
    />
  );
}
