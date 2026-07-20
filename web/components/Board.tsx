"use client";
// components/Board.tsx
// Quadro kanban reaproveitavel. Sem projectId => quadro GERAL (panorama de
// tudo, inclusive tasks de projeto). Com projectId => quadro de UM projeto
// (a listagem ja vem filtrada pelo backend; subtarefa compartilha o project_id
// do pai, entao a subarvore inteira vem junta). Extraido do antigo
// quadro/page.tsx na Entrega 11 sem mudar comportamento do geral.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import EmptyStateBox from "@/components/EmptyState";
import { STATUSES } from "@/lib/status";
import { listAllTasks, listAllProjects, updateTask, listMembers, listSubteams, getRootTeamId, ApiError, type Task, type Team } from "@/lib/api";

// Tira acento e caixa pra busca casar "midia" com "Midia Paga" etc.
function normalizar(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

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
type Ordenacao = "criacao" | "prazo" | "prioridade";

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
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Task | null>(null);
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
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
  // P0.2: total real quando o fetch bateu o teto de seguranca (truncou).
  // null = nao truncou. Vira aviso honesto no lugar de perda silenciosa.
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Guarda contra "clique fantasma" logo apos um arrasto.
  const suprimirClique = useRef(false);

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
    const top = el.getBoundingClientRect().top;
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
        setMemberTeam(new Map(ms.map((m) => [m.id, m.team_id])));
      })
      .catch(() => {})
      .finally(() => setMembrosCarregados(true));
    // Spec 022: projectNames alimenta o chip E o seletor de "mudar projeto" no
    // detalhe -> carrega em qualquer quadro (antes so no geral).
    listAllProjects()
      .then((r) => setProjectNames(new Map(r.items.map((p) => [p.id, p.title]))))
      .catch(() => {});
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
          ? "Voce nao pode mover esta tarefa. Voltei pra coluna anterior."
          : "Nao consegui mover o card. Voltei pra coluna anterior."
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
  const buscaNorm = normalizar(busca);
  const hoje = hojeISO();
  const temFiltro = buscaNorm !== "" || prazo !== "todos" || subtime !== "";

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
  const escopoDaTask = (t: Task): "compartilhada" | "interna" | undefined => {
    if (!modoSubtime) return undefined;
    return t.team_id === subteamId ? "interna" : "compartilhada";
  };

  const raizes = visiveis.filter((t) => {
    if (buscaNorm && !normalizar(t.title).includes(buscaNorm)) return false;
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
    return true;
  });
  // Ordenacao escolhida (so na sessao). Reordena as raizes pelo criterio e
  // depois distribui nas colunas -- a distribuicao preserva a ordem. Empate
  // SEMPRE cai pra created_at desc (mais nova primeiro), pra coluna nao "tremer".
  const PRIO_RANK: Record<string, number> = {
    URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
  };
  const porData = (a: Task, b: Task) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  const comparador = (a: Task, b: Task) => {
    if (ordenacao === "prazo") {
      // Sem prazo vai pro FIM; entre os com prazo, vencimento mais proximo no topo.
      const da = a.due_date ?? "";
      const db = b.due_date ?? "";
      if (!da && !db) return porData(a, b);
      if (!da) return 1;
      if (!db) return -1;
      if (da !== db) return da < db ? -1 : 1;
      return porData(a, b);
    }
    if (ordenacao === "prioridade") {
      const pa = PRIO_RANK[a.priority] ?? 0;
      const pb = PRIO_RANK[b.priority] ?? 0;
      if (pa !== pb) return pb - pa; // Urgente primeiro.
      return porData(a, b);
    }
    return porData(a, b); // "criacao" (padrao de hoje).
  };
  const ordenadas = [...raizes].sort(comparador);

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
          placeholder="Buscar por titulo…"
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", minWidth: 170,
          }}
        />
        <select
          value={prazo}
          onChange={(e) => setPrazo(e.target.value as FiltroPrazo)}
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          <option value="todos">Prazo: todos</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="em-dia">Em dia</option>
        </select>
        <select
          value={ordenacao}
          onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          <option value="criacao">Ordenar: criacao</option>
          <option value="prazo">Ordenar: prazo</option>
          <option value="prioridade">Ordenar: prioridade</option>
        </select>
        {!subteamId && subtimes.length > 0 && (
          <select
            value={subtime}
            onChange={(e) => setSubtime(e.target.value)}
            style={{
              fontSize: 13, padding: "6px 10px", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            <option value="">Subtime: todos</option>
            {subtimes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
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
                    escopo={escopoDaTask(t)}
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
                  escopo={escopoDaTask(activeTask)}
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
      />

      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "var(--text)", color: "#fff", padding: "10px 16px",
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
      className="tappable"
      style={{
        opacity: isDragging ? 0.4 : task.is_archived ? 0.55 : 1,
        cursor: "grab",
        touchAction: "none",
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
      description="Nenhuma tarefa bate com o filtro atual. As subtarefas e tarefas de outras paginas nao entram na busca. No filtro de subtime, tarefas sem responsavel (ou so com responsaveis de outro subtime) nao aparecem."
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
