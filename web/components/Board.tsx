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
import EmptyStateBox from "@/components/EmptyState";
import { STATUSES } from "@/lib/status";
import { listAllTasks, listAllProjects, updateTask, listMembers, listSubteams, getRootTeamId, ApiError, type Task, type Team } from "@/lib/api";
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
  title,
}: {
  projectId?: string; // presente => quadro de PROJETO
  subteamId?: string; // presente => quadro de SUBTIME (modo hibrido, Fatia 4)
  title: string;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
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
  const [pessoaFiltro, setPessoaFiltro] = useState<string>("");
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
          return { ...x, status: "COMPLETED" };
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
    const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;

    const atual = tasks?.find((t) => t.id === taskId);
    if (!atual || atual.status === destino) return;

    const statusAnterior = atual.status;

    // Cascata de conclusao: arrastar um PAI pro "Concluido" conclui a subtree
    // (espelha o backend). Aplica otimista pros cards de subtarefa refletirem na
    // hora (quadros de projeto/subtime). Guarda os status antigos pra reverter
    // se o PATCH falhar. Pula ja concluidas, canceladas e arquivadas.
    // DIVERGENCIA CONHECIDA: o backend cascateia TODA a subarvore no banco; aqui
    // so mexemos no que esta carregado em `tasks` (que pode vir truncado). Se a
    // subarvore ultrapassa o limite de exibicao, os descendentes fora da janela
    // nao refletem na hora -- aparecem concluidos no proximo reload.
    const concluindo = destino === "COMPLETED";
    const prefixo = atual.path + ".";
    const anteriores = new Map<string, string>();
    if (concluindo) {
      for (const t of tasks ?? []) {
        if (
          t.path.startsWith(prefixo) &&
          t.status !== "COMPLETED" &&
          t.status !== "CANCELLED" &&
          !t.is_archived
        ) {
          anteriores.set(t.id, t.status);
        }
      }
    }

    setTasks((prev) =>
      prev!.map((t) => {
        if (t.id === taskId) return { ...t, status: destino };
        if (anteriores.has(t.id)) return { ...t, status: "COMPLETED" };
        return t;
      })
    );

    try {
      const atualizada = await updateTask(taskId, { status: destino });
      setTasks((prev) =>
        prev!.map((t) =>
          t.id === taskId ? { ...atualizada, assignee_ids: t.assignee_ids } : t
        )
      );
    } catch (err) {
      setTasks((prev) =>
        prev!.map((t) => {
          if (t.id === taskId) return { ...t, status: statusAnterior };
          const ant = anteriores.get(t.id);
          return ant !== undefined ? { ...t, status: ant } : t;
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

  const subCount: Record<string, number> = {};
  const subDone: Record<string, number> = {};
  for (const t of tasks) {
    if (!t.parent_task_id) continue;
    subCount[t.parent_task_id] = (subCount[t.parent_task_id] ?? 0) + 1;
    if (t.status === "COMPLETED")
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
    pessoa: pessoaFiltro,
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
    pessoa: () => setPessoaFiltro(FILTROS_LIMPOS.pessoa),
    arquivadas: () => setMostrarArquivadas(FILTROS_LIMPOS.arquivadas),
  };
  function limparFiltros() {
    for (const limpar of Object.values(LIMPA)) limpar();
  }

  const temFiltro =
    buscaNorm !== "" ||
    prazo !== "todos" ||
    subtime !== "" ||
    temFiltroNovo(escopoFiltro, pessoaFiltro);

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
  const visiveis = tasks.filter((t) => {
    if (t.depth !== 0) return false;
    if (!(mostrarArquivadas || !t.is_archived)) return false;
    if (modoSubtime) {
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
    if (buscaNorm && !normalizarBusca(t.title).includes(buscaNorm)) return false;
    // Sem data: aparece em qualquer filtro de prazo (decisao da Camila).
    if (prazo !== "todos" && t.due_date) {
      // Concluida nunca e atrasada (ja foi entregue).
      const atrasada = t.status !== "COMPLETED" && t.due_date < hoje;
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
    if (!passaResponsavel(pessoaFiltro, t.id, respPorRaiz)) return false;
    return true;
  });
  // Ordenacao escolhida (so na sessao). Reordena as raizes pelo criterio e
  // depois distribui nas colunas -- a distribuicao preserva a ordem. Empate
  // SEMPRE cai pra created_at desc (mais nova primeiro), pra coluna nao "tremer".
  // O comparador saiu pra `lib/ordenacao.ts` -- "Minhas tarefas" usa o MESMO.
  const ordenadas = ordenar(raizes, ordenacao);

  const porStatus: Record<string, Task[]> = {};
  for (const s of STATUSES) porStatus[s.key] = [];
  for (const t of ordenadas) (porStatus[t.status] ??= []).push(t);

  const focado = detalhe ? tasks.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? tasks.filter((t) => t.parent_task_id === focado.id) : [];

  return (
    <div>
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
                  <label className="label" htmlFor="f-pessoa">Responsável</label>
                  <select
                    id="f-pessoa"
                    className="input"
                    value={pessoaFiltro}
                    onChange={(e) => setPessoaFiltro(e.target.value)}
                    title="Mostra as tarefas em que a pessoa está designada, inclusive por subtarefa"
                  >
                    <option value="">Todos</option>
                    {pessoasDoFiltro.map((pes) => (
                      <option key={pes.id} value={pes.id}>
                        {pes.inativo ? `${pes.name} (inativo)` : pes.name}
                      </option>
                    ))}
                  </select>
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

      {raizes.length === 0 ? (
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
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div
            ref={colunasRef}
            style={{
              display: "flex", gap: 14, overflowX: "auto", overflowY: "hidden",
              paddingBottom: 8, height: alturaColunas ?? undefined,
            }}
          >
            {STATUSES.map((s) => (
              <Coluna key={s.key} status={s} count={(porStatus[s.key] || []).length}>
                {(porStatus[s.key] || []).map((t) => (
                  <CardArrastavel
                    key={t.id}
                    task={t}
                    onAbrir={abrirDetalhe}
                    members={members}
                    subtaskCount={subCount[t.id] ?? 0}
                    subtaskDone={subDone[t.id] ?? 0}
                    projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
                    escopo={pillDaTask(t)}
                  />
                ))}
              </Coluna>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? (
              <div style={{ width: 256, cursor: "grabbing" }}>
                <TaskCard
                  task={activeTask}
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
        open={criando || editando !== null}
        task={editando}
        defaultProjectId={projectId ?? null}
        defaultTeamId={subteamId ?? null}
        onClose={() => {
          setCriando(false);
          setEditando(null);
        }}
        onSaved={aoSalvar}
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

function Coluna({
  status,
  count,
  children,
}: {
  status: (typeof STATUSES)[number];
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key });
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
        outline: isOver ? `2px solid ${status.color}` : "none",
        outlineOffset: -2,
        transition: "background .12s",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
          paddingBottom: 8, borderBottom: `2px solid ${status.color}`,
          flexShrink: 0,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: status.color }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{status.label}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{count}</span>
      </div>
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
  onAbrir,
  members,
  subtaskCount,
  subtaskDone,
  projectName,
  escopo,
}: {
  task: Task;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  subtaskCount: number;
  subtaskDone: number;
  projectName?: string;
  escopo?: "compartilhada" | "interna";
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
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
        touchAction: "none",
        // Enquanto arrasta, sem elevacao: o card ja esta com o ghost do
        // dnd-kit e a sombra dupla ficava suja por cima dele.
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
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
      description="Nenhuma tarefa bate com o filtro atual. As subtarefas e tarefas de outras páginas não entram na busca. No filtro de subtime, tarefas sem responsável (ou só com responsáveis de outro subtime) não aparecem."
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
