"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import TaskCard from "@/components/TaskCard";
import {
  STATUSES,
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  deadlineTone,
  deadlineLabel,
  DEADLINE_COLOR,
  statusPadraoMinhasTarefas,
} from "@/lib/status";
import { normalizarBusca } from "@/lib/filtrosQuadro";
import {
  listAllMyAssignments,
  getTask,
  listTasks,
  listMembers,
  listAllProjects,
  updateTask,
  ApiError,
  type Task,
  type MyTaskItem,
} from "@/lib/api";
import { sincronizarTaskNaUrl } from "@/lib/urlTarefa";

const RELATION_LABEL: Record<string, string> = {
  assignee: "Responsável",
  creator: "Criei",
  watcher: "Acompanho",
};
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

// Opcoes do seletor de relacao. "todas" = sem filtro de relacao.
const RELACOES = [
  { key: "todas", label: "Todas" },
  { key: "creator", label: "Que criei" },
  { key: "assignee", label: "Designadas a mim" },
  { key: "watcher", label: "Que acompanho" },
] as const;

const TODOS_STATUS = STATUSES.map((s) => s.key);

// Rotulo legivel do cabecalho de grupo (ex.: "Sexta-feira, 22 de agosto").
function rotuloData(d: string): string {
  const dt = new Date(d + "T00:00:00");
  const s = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function MinhasTarefasPage() {
  return (
    <AppShell>
      <Minhas />
    </AppShell>
  );
}

function Minhas() {
  const [items, setItems] = useState<MyTaskItem[] | null>(null);
  const [members, setMembers] = useState<Map<string, { name: string }>>(new Map());
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  // null = nao truncou. Se a lista passar do teto de busca, vira aviso honesto
  // no lugar de perda silenciosa (mesmo padrao do quadro).
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Filtros (client-side, sobre a lista ja carregada). Comecam "tudo visivel".
  const [relFiltro, setRelFiltro] = useState<string>("todas");
  // Abre sem as concluidas (ver statusPadraoMinhasTarefas). "Todos" religa.
  const [statusOn, setStatusOn] = useState<Set<string>>(
    () => new Set(statusPadraoMinhasTarefas())
  );
  // Arquivadas escondidas por padrao (paridade com o quadro). Sessao-only.
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  // Spec 031 (C3, D4-ter): esta tela nao tinha busca. Uma linha de pastilhas
  // com "Busca:" numa tela e nao na outra e a mesma deriva que a fatia mata.
  const [busca, setBusca] = useState("");

  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Filhos COMPLETOS da tarefa focada (todas as subtarefas, nao so as minhas).
  // minhas-tarefas so carrega minhas atribuicoes, entao o pai mostraria uma
  // lista de subtarefas incompleta (bug: no quadro geral aparecem todas). Busca
  // sob demanda por parent_task_id. null = ainda carregando -> cai no fallback
  // de `items` (evita flash de lista vazia). O fetch keys por detalhe?.id (=
  // id do foco); `focado` so existe depois das guardas, entao uso detalhe.
  const [filhosDoFocado, setFilhosDoFocado] = useState<Task[] | null>(null);
  const [editando, setEditando] = useState<Task | null>(null);
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);
  // Libera a ESCRITA do ?task= na URL. Separado do deepLinkFeito porque a
  // leitura e async: so vira true quando a abertura inicial resolve.
  const [urlLiberada, setUrlLiberada] = useState(false);

  // Vista: lista (agrupada por prazo) x quadro (kanban por status). Sessao-only.
  const [vista, setVista] = useState<"lista" | "quadro">("lista");
  // Drag no modo quadro (mesmo padrao do Board).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const suprimirClique = useRef(false);

  // --- Trava a vista QUADRO na altura da viewport (scroll por coluna) ---
  // Mesma tecnica do componente Board: mede o topo real das colunas e trava a
  // altura ate o rodape, cada coluna rola por dentro. So afeta a vista quadro
  // (a lista segue com scroll normal de pagina). medirAltura sai cedo quando o
  // container nao existe (vista lista) -> nada acontece ali.
  const colunasRef = useRef<HTMLDivElement>(null);
  const [alturaColunas, setAlturaColunas] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const el = colunasRef.current;
    if (!el) return;
    // Clamp em 0: pagina rolada pra baixo -> top negativo estourava a altura
    // (innerHeight - top). Cobre o commit-durante-scroll; nao cobre o mobile.
    const top = Math.max(0, el.getBoundingClientRect().top);
    const RODAPE = 24;
    const h = Math.max(240, Math.round(window.innerHeight - top - RODAPE));
    setAlturaColunas((atual) => (atual === h ? atual : h));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", medirAltura);
    return () => window.removeEventListener("resize", medirAltura);
  }, [medirAltura]);
  useLayoutEffect(() => {
    medirAltura();
  });

  useEffect(() => {
    listAllMyAssignments()
      .then((r) => {
        // Camila (E9): esconder out_of_scope por ora -- essas tarefas dao 404
        // no detalhe (bug conhecido E6). Quando for tratar, troca este filtro.
        setItems(r.items.filter((t) => !t.out_of_scope));
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => setMembers(new Map(ms.map((m) => [m.id, { name: m.name }]))))
      .catch(() => {});
    // Spec 022: alimenta o chip de projeto e o seletor de "mudar projeto" no detalhe.
    listAllProjects()
      .then((r) => setProjectNames(new Map(r.items.map((p) => [p.id, p.title]))))
      .catch(() => {});
  }, []);

  // Abre o detalhe de uma task pelo id, procurando na lista COMPLETA (items),
  // nao na filtrada -- um filtro ativo nao deve furar o link. Se a task nao
  // esta na lista (mencao/comentario em tarefa que nao e sua, ou out_of_scope
  // filtrada), avisa em vez de falhar em silencio.
  const abrirTarefaDaLista = useCallback(
    async (id: string) => {
      if (items === null) return;
      const t = items.find((x) => x.id === id);
      if (!t) {
        setToast("Não foi possível abrir: essa tarefa não está na sua lista.");
        return;
      }
      // Se for SUBTAREFA, abre no modo sub com "voltar" pro(s) pai(s) -- mesma
      // UX de quando navego manualmente de um pai pra um filho. Monta a cadeia
      // de ancestrais: cada pai pode nao estar na minha lista (posso estar so
      // na sub), entao busca por id nesse caso. A pilha fica [raiz..paiDireto];
      // voltarDetalhe tira do fim -> volta um nivel por vez ate a raiz.
      const pilhaPais: Task[] = [];
      const vistos = new Set<string>([t.id]); // guarda anti-ciclo
      let paiId = t.parent_task_id;
      while (paiId && !vistos.has(paiId)) {
        vistos.add(paiId);
        let pai: Task | null = items.find((x) => x.id === paiId) ?? null;
        if (!pai) {
          try {
            pai = await getTask(paiId);
          } catch {
            pai = null;
          }
        }
        if (!pai) break; // pai inacessivel -> para a cadeia (volta ate onde deu)
        pilhaPais.unshift(pai);
        paiId = pai.parent_task_id;
      }
      setPilha(pilhaPais);
      setDetalhe(t);
    },
    [items]
  );

  // Deep-link ao ENTRAR na pagina vindo de outra rota: le ?task=<id> depois
  // que a lista carrega (uma vez). E6-safe: reusa o objeto ja carregado.
  useEffect(() => {
    if (deepLinkFeito || items === null) return;
    setDeepLinkFeito(true);
    const alvo = new URLSearchParams(window.location.search).get("task");
    if (!alvo) {
      setUrlLiberada(true);
      return;
    }
    // So libera a escrita da URL quando a abertura RESOLVER. abrirTarefaDaLista
    // e async (pode esperar getTask pra montar a cadeia de pais); liberar antes
    // deixaria o efeito de escrita rodar com detalhe=null e apagar o ?task=
    // no meio do caminho -- um F5 nessa janela perderia a tarefa.
    // finally e nao then: se a abertura falhar (tarefa fora da lista), a URL
    // tambem precisa voltar a mandar, pra nao ficar travada mentindo.
    abrirTarefaDaLista(alvo).finally(() => setUrlLiberada(true));
  }, [items, deepLinkFeito, abrirTarefaDaLista]);

  // Deep-link com a pagina JA ABERTA: o sino faz router.push da mesma rota
  // (so muda a query), o que NAO remonta a pagina nem re-dispara o efeito de
  // cima -> era o "clico e nao acontece nada". O sino tambem emite este evento,
  // que abre o detalhe na hora, sem depender de remontar.
  useEffect(() => {
    function onAbrir(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) abrirTarefaDaLista(id);
    }
    window.addEventListener("abrir-tarefa", onAbrir);
    return () => window.removeEventListener("abrir-tarefa", onAbrir);
  }, [abrirTarefaDaLista]);

  // Escrita da URL viva (?task=<id>): espelha a tarefa aberta. Cobre abrir,
  // fechar, entrar em subtarefa e voltar -- todos passam por `detalhe`.
  //
  // Gated no urlLiberada (nao no deepLinkFeito): a leitura acima e async, e
  // liberar cedo demais faria este efeito apagar o ?task= antes de a tarefa
  // abrir. Ver o comentario do efeito de leitura.
  //
  // replaceState: o Voltar do navegador segue saindo da pagina, nao virando
  // um "desfazer" de cada abertura de tarefa.
  useEffect(() => {
    if (!urlLiberada) return;
    sincronizarTaskNaUrl(detalhe?.id ?? null);
  }, [detalhe, urlLiberada]);

  // Toast do drag (auto-some).
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // Busca as subtarefas COMPLETAS do foco (todas, nao so as minhas) quando o
  // detalhe muda. Sem include_archived (paridade com o padrao do quadro geral).
  // Erro -> null (cai no fallback de items). Cap de 100 filhos diretos (limite
  // do backend) -- suficiente; se um dia passar disso, so os 100 primeiros.
  useEffect(() => {
    const id = detalhe?.id;
    if (!id) {
      setFilhosDoFocado(null);
      return;
    }
    let vivo = true;
    setFilhosDoFocado(null); // carregando -> fallback de items enquanto isso
    listTasks({ parent_task_id: id, size: 100 })
      .then((r) => {
        if (vivo) setFilhosDoFocado(r.items);
      })
      .catch(() => {
        if (vivo) setFilhosDoFocado(null);
      });
    return () => {
      vivo = false;
    };
  }, [detalhe?.id]);

  // --- abrir / navegar / fechar o detalhe (mesma logica do quadro) ---
  function abrirDetalhe(t: Task) {
    if (suprimirClique.current) return; // acabou de arrastar: nao abre
    // Reusa a construcao de cadeia de pais: se `t` for subtarefa, abre no modo
    // sub com "voltar" pro pai -- igual ao deep-link da notificacao. `t` veio da
    // lista, entao esta em items (nao dispara o toast de "nao esta na lista").
    abrirTarefaDaLista(t.id);
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

  // Upsert preservando os campos que /me/assignments adiciona ao Task
  // (relations, out_of_scope) e o assignee_ids (mutacao nao devolve -- ADR 0025).
  function aoUpsert(t: Task) {
    setItems((prev) => {
      if (!prev) return prev;
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) {
        // subtarefa criada aqui: eu sou o criador, entra como "Criei".
        const nova: MyTaskItem = {
          ...t,
          relations: ["creator"],
          out_of_scope: false,
          assignee_ids: t.assignee_ids ?? [],
          // A resposta de criacao nao traz parent_title (so /me/assignments
          // monta o lote). Como a subtarefa nasceu daqui, a mae e a task que
          // esta aberta -- resolvemos localmente e o selo ja aparece certo,
          // sem esperar recarregar a pagina.
          parent_title:
            t.parent_task_id
              ? prev.find((x) => x.id === t.parent_task_id)?.title ?? null
              : null,
        };
        return [nova, ...prev];
      }
      const merged: MyTaskItem = {
        ...t,
        relations: existente.relations,
        out_of_scope: existente.out_of_scope,
        assignee_ids: t.assignee_ids ?? existente.assignee_ids,
        // Mutacao de task nao devolve parent_title -> preserva o local, mesma
        // regra do assignee_ids (ADR 0025). Sem isto o selo sumiria ao editar.
        parent_title: existente.parent_title,
      };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  // Upsert que TAMBEM reflete na lista de filhos buscada do foco, pra o detalhe
  // atualizar na hora (marcar/desmarcar subtarefa, criar subtarefa) sem esperar
  // refetch. Atualiza in-place se ja existe; adiciona se for filho do foco atual.
  function aoUpsertComFilhos(t: Task) {
    aoUpsert(t);
    setFilhosDoFocado((prev) => {
      if (prev === null) return prev;
      if (prev.some((x) => x.id === t.id)) {
        return prev.map((x) => (x.id === t.id ? { ...x, ...t } : x));
      }
      return t.parent_task_id === detalhe?.id ? [...prev, t] : prev;
    });
  }

  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setItems((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
  }

  // --- Drag no modo quadro: arrastar card muda o status (mesmo padrao do Board) ---
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

    const atual = (items ?? []).find((t) => t.id === taskId);
    if (!atual || atual.status === destino) return;
    const statusAnterior = atual.status;

    // Cascata de conclusao (espelha o backend): arrastar um PAI pro "Concluido"
    // conclui a subtree. Aqui items so tem MINHAS tasks -> cascateia as minhas
    // subtarefas visiveis. Guarda os status antigos pra reverter se falhar.
    // Pula ja concluidas, canceladas e arquivadas.
    // DIVERGENCIA CONHECIDA: o backend conclui a subarvore INTEIRA no banco;
    // este otimista so alcanca as minhas tasks carregadas. As demais (de outros
    // responsaveis, ou fora do limite de exibicao) so aparecem no reload.
    const concluindo = destino === "COMPLETED";
    const prefixo = atual.path + ".";
    const anteriores = new Map<string, string>();
    if (concluindo) {
      for (const t of items ?? []) {
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

    // Otimista (pai + cascata).
    setItems((prev) =>
      prev
        ? prev.map((t) => {
            if (t.id === taskId) return { ...t, status: destino };
            if (anteriores.has(t.id)) return { ...t, status: "COMPLETED" };
            return t;
          })
        : prev
    );

    try {
      const atualizada = await updateTask(taskId, { status: destino });
      aoUpsert(atualizada); // re-merge do servidor, preservando relations/assignees
    } catch (err) {
      setItems((prev) =>
        prev
          ? prev.map((t) => {
              if (t.id === taskId) return { ...t, status: statusAnterior };
              const ant = anteriores.get(t.id);
              return ant !== undefined ? { ...t, status: ant } : t;
            })
          : prev
      );
      const e2 = err as ApiError;
      setToast(
        e2.status === 403
          ? "Você não pode mover esta tarefa. Voltei pra coluna anterior."
          : "Não consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  function aoSalvar(saved: Task) {
    aoUpsert(saved);
    setEditando(null);
  }

  // --- filtros ---
  function toggleStatus(key: string) {
    setStatusOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function todosStatus() {
    setStatusOn(new Set(TODOS_STATUS));
  }
  function limparStatus() {
    setStatusOn(new Set());
  }
  function limparTudo() {
    setRelFiltro("todas");
    // Volta ao PADRAO da tela, nao a "tudo ligado": limpar filtro e voltar ao
    // estado de abertura, e nele as concluidas nao aparecem.
    setStatusOn(new Set(statusPadraoMinhasTarefas()));
  }

  // Arquivadas: escondidas por padrao. O backend de assignments INCLUI
  // arquivadas na resposta, entao o filtro e no cliente -- o toggle liga/desliga
  // sem refetch. `itemsBase` e a FONTE das duas vistas (lista e quadro).
  // Detalhe/subtarefas seguem na lista COMPLETA `items` (mais abaixo): um
  // filtro de view nao pode quebrar abrir uma task fora do filtro.
  const buscaNorm = normalizarBusca(busca);

  const itemsBase = useMemo(
    () => (items ?? []).filter((t) => mostrarArquivadas || !t.is_archived),
    [items, mostrarArquivadas]
  );

  // Aplica relacao + status sobre a lista carregada.
  const filtrados = useMemo(() => {
    return itemsBase.filter((t) => {
      const okStatus = statusOn.has(t.status);
      const okRel = relFiltro === "todas" || t.relations.includes(relFiltro);
      const okBusca =
        buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm);
      return okStatus && okRel && okBusca;
    });
  }, [itemsBase, statusOn, relFiltro, buscaNorm]);

  // Agrupa por data de entrega (D, estilo Runrunit): so aparece o dia que tem
  // tarefa; grupos em ordem cronologica; sem-prazo por ultimo. Agrupa sobre a
  // lista FILTRADA. due_date e "YYYY-MM-DD" -> ordenacao por string ja e cronologica.
  const grupos = useMemo(() => {
    const map = new Map<string, MyTaskItem[]>();
    for (const t of filtrados) {
      const key = t.due_date ?? "";
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    const comData = [...map.entries()]
      .filter(([k]) => k !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const semData = map.get("") ?? [];
    return { comData, semData };
  }, [filtrados]);

  // Modo QUADRO: filtra so por relacao (o status vira coluna, nao filtro) e
  // agrupa por status. As colunas sao sempre as 7 (STATUSES).
  const porRelacao = useMemo(() => {
    return itemsBase.filter(
      (t) =>
        (relFiltro === "todas" || t.relations.includes(relFiltro)) &&
        (buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm))
    );
  }, [itemsBase, relFiltro, buscaNorm]);

  const porStatus = useMemo(() => {
    const map: Record<string, MyTaskItem[]> = {};
    for (const s of STATUSES) map[s.key] = [];
    for (const t of porRelacao) (map[t.status] ??= []).push(t);
    return map;
  }, [porRelacao]);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <div className="muted">Carregando…</div>;

  // Detalhe e subtarefas SEMPRE sobre a lista completa (um filtro ativo nao
  // pode quebrar abrir/navegar uma task que esta fora do filtro atual).
  const focado = detalhe ? items.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? items.filter((t) => t.parent_task_id === focado.id) : [];
  // Filhos exibidos no detalhe: os COMPLETOS (buscados) quando prontos; enquanto
  // carrega/erro, cai nos meus (items) pra nao piscar vazio. So os do foco atual.
  const filhosParaDetalhe: Task[] =
    filhosDoFocado !== null && focado
      ? filhosDoFocado.filter((f) => f.parent_task_id === focado.id)
      : filhosFocado;

  const visiveis = vista === "quadro" ? porRelacao.length : filtrados.length;
  const todosLigados = statusOn.size === TODOS_STATUS.length;
  const contagem =
    visiveis === items.length ? `${items.length} tarefas` : `${visiveis} de ${items.length}`;

  // Uma linha de tarefa. A data saiu daqui — agora vive no cabeçalho do grupo.
  function linhaTarefa(t: MyTaskItem, i: number) {
    // Spec 023: cor de prazo por-card (respeita status/arquivada). null = sem
    // alerta. Barra lateral colorida + chip com o motivo.
    const dueTone = deadlineTone(t.due_date, t.status, t.is_archived);
    return (
      <div
        key={t.id}
        onClick={() => abrirDetalhe(t)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrirDetalhe(t);
          }
        }}
        role="button"
        tabIndex={0}
        className="tappable"
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
          borderTop: i === 0 ? "none" : "1px solid var(--border)",
          // Reserva sempre a borda (transparente) pra nao deslocar o texto.
          borderLeft: `3px solid ${dueTone ? DEADLINE_COLOR[dueTone] : "transparent"}`,
          cursor: "pointer",
        }}
      >
        <span
          title={STATUS_LABEL[t.status]}
          style={{
            width: 9, height: 9, borderRadius: 999, flexShrink: 0,
            background: STATUS_COLOR[t.status] || "#999",
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Spec 031 (C6): titulo em UMA linha, com reticencias.
              Antes ele quebrava em 2-3 linhas e a segunda linha encostava na
              faixa de meta abaixo -- o "aparece por baixo de Responsavel".
              `title` preserva o texto inteiro no hover, e o detalhe esta a um
              clique. Lista com altura de linha uniforme e o ponto de ser lista. */}
          <div
            title={t.title}
            style={{
              fontSize: 14, fontWeight: 600, lineHeight: 1.35,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {t.title}
          </div>
          {/* `minWidth: 0` deixa os filhos ENCOLHEREM. Sem isso o padrao e
              `min-width: auto` = "nao encolho abaixo do meu conteudo", e a
              pastilha longa empurra o resto da faixa pra fora. */}
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
            <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
              {STATUS_LABEL[t.status] || t.status}
            </span>
            {t.parent_task_id && (
              // Nomeia a mae quando o backend a resolveu. Cai no generico se
              // parent_title vier null (mae fora da lente) -- nunca inventa.
              <span
                title={
                  t.parent_title
                    ? `Subtarefa de: ${t.parent_title}`
                    : "Subtarefa"
                }
                style={{ display: "inline-flex", maxWidth: 260, minWidth: 0, flexShrink: 1 }}
              >
                <Badge tone="soft" size="sm" color="var(--accent)">
                  {t.parent_title ? `↳ ${t.parent_title}` : "Subtarefa"}
                </Badge>
              </span>
            )}
            {t.relations.map((r) => (
              <Badge key={r} tone="neutral" size="sm" weight="semibold" className="bg-surface-2 text-ink-soft">
                {RELATION_LABEL[r] || r}
              </Badge>
            ))}
            {dueTone && t.due_date && (
              <span
                style={{
                  fontSize: 11.5, fontWeight: 600, color: DEADLINE_COLOR[dueTone],
                  flexShrink: 0,
                }}
              >
                {deadlineLabel(t.due_date)}
              </span>
            )}
          </div>
        </div>
        <Badge tone="soft" size="sm" color={PRIORITY_COLOR[t.priority]} className="shrink-0">
          {PRIORITY_LABEL[t.priority] || t.priority}
        </Badge>
      </div>
    );
  }

  // Barra de filtros: seletor de relacao + chips de status (liga/desliga).
  function barraFiltros() {
    // Definido UMA vez e posicionado em dois lugares conforme a vista --
    // duplicar o JSX seria duas fontes de verdade pro mesmo controle.
    const arquivadasCheck = (
      <label
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: "var(--text-soft)", cursor: "pointer",
          marginLeft: 4,
        }}
      >
        <input
          type="checkbox"
          checked={mostrarArquivadas}
          onChange={(e) => setMostrarArquivadas(e.target.checked)}
        />
        Mostrar arquivadas
      </label>
    );

    return (
      <div
        style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          marginBottom: 18,
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Mostrar</span>
          <select
            value={relFiltro}
            onChange={(e) => setRelFiltro(e.target.value)}
            style={{
              fontSize: 13, padding: "6px 28px 6px 10px",
              borderRadius: "var(--radius)", border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", cursor: "pointer",
            }}
          >
            {RELACOES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>

        {/* Spec 031 (C3, D4-ter): busca. A tela nao tinha. */}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título…"
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", minWidth: 170,
          }}
        />

        {/* Toggle de vista (sessao-only). No quadro, os status viram colunas. */}
        <div style={{ display: "inline-flex", gap: 4 }}>
          {(["lista", "quadro"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              aria-pressed={vista === v}
              className="tappable"
              style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12,
                fontWeight: 600, cursor: "pointer", lineHeight: 1,
                border: "1px solid var(--border)",
                background: vista === v ? "var(--accent-soft)" : "var(--surface-2)",
                color: vista === v ? "var(--accent)" : "var(--text-faint)",
              }}
            >
              {v === "lista" ? "Lista" : "Quadro"}
            </button>
          ))}
        </div>

        {vista === "lista" && (
          <>
            <span style={{ width: 1, height: 22, background: "var(--border)", flexShrink: 0 }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {STATUSES.map((s) => {
            const on = statusOn.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStatus(s.key)}
                aria-pressed={on}
                className="tappable"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 10px", borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: on ? "var(--surface)" : "var(--surface-2)",
                  color: on ? "var(--text)" : "var(--text-faint)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", lineHeight: 1,
                }}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                    background: on ? s.color : "var(--text-faint)",
                    opacity: on ? 1 : 0.45,
                  }}
                />
                {s.label}
              </button>
            );
          })}

          <span style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />

          <button
            type="button"
            onClick={todosStatus}
            disabled={todosLigados}
            className="tappable"
            style={{
              padding: "5px 8px", borderRadius: "var(--radius)", border: "none",
              background: "transparent", color: todosLigados ? "var(--text-faint)" : "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: todosLigados ? "default" : "pointer",
            }}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={limparStatus}
            disabled={statusOn.size === 0}
            className="tappable"
            style={{
              padding: "5px 8px", borderRadius: "var(--radius)", border: "none",
              background: "transparent",
              color: statusOn.size === 0 ? "var(--text-faint)" : "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: statusOn.size === 0 ? "default" : "pointer",
            }}
          >
            Limpar
          </button>

          {vista === "lista" && arquivadasCheck}
        </div>
          </>
        )}

        {/* Spec 031 (C9): na vista LISTA o checkbox mora ao lado de "Limpar",
            dentro da faixa de chips. Antes ele era irmao da faixa com
            `marginLeft: auto`, e como a faixa e larga ele quebrava sozinho
            numa terceira linha, encostado na direita, longe de tudo.
            Na vista QUADRO nao ha faixa de chips -> ele volta pra esta linha. */}
        {vista === "quadro" && arquivadasCheck}
      </div>
    );
  }

  // ⚠️ NAO ha barra de pastilhas de filtro ativo aqui, e isso e DECISAO
  // (Spec 031, C6 -- revoga o D4/D4-bis). Ela existe no Quadro porque la os
  // filtros moram dentro de um popover FECHADO: a pastilha responde "o que
  // esta ligado que eu nao estou vendo". Nesta tela todo controle esta visivel
  // o tempo todo -- o select "Mostrar", o campo de busca, os 8 chips de status
  // e o checkbox de arquivadas. A pastilha nao acrescentava informacao, so
  // repetia o que estava dois centimetros acima.
  //
  // Se um dia algum controle daqui for recolhido, ela volta -- o
  // `listaFiltrosAtivos` do lib continua servindo o Quadro.

  return (
    <div>
      <PageHeader title="Minhas tarefas" count={contagem} />

      {truncadoTotal !== null && (
        <div
          role="alert"
          style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--accent-soft)",
            color: "var(--text)", fontSize: 13,
          }}
        >
          Você tem <strong>{truncadoTotal}</strong> tarefas relacionadas, acima
          do limite de exibição. Mostrando as mais recentes — algumas podem não
          aparecer aqui nem entrar nos filtros. Arquive tarefas concluidas para
          reduzir o volume.
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Você está em dia"
          description="Tarefas em que você é responsável, criador ou acompanha aparecem aqui."
        />
      ) : (
        <div className={vista === "quadro" ? "" : "max-w-[1100px]"}>
          {barraFiltros()}

          {vista === "lista" ? (
            visiveis === 0 ? (
              <div className="muted" style={{ padding: "20px 2px", fontSize: 14 }}>
                Nenhuma tarefa com esses filtros.{" "}
                <button
                  type="button"
                  onClick={limparTudo}
                  style={{
                    border: "none", background: "transparent", padding: 0,
                    color: "var(--accent)", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            ) : (
              <>
                {grupos.comData.map(([data, tarefas]) => (
                  <section key={data} className="mb-5">
                    <h2 className="mb-2 text-base font-semibold text-ink-soft">{rotuloData(data)}</h2>
                    <div className="overflow-hidden rounded-lg border border-border bg-surface">
                      {tarefas.map((t, i) => linhaTarefa(t, i))}
                    </div>
                  </section>
                ))}
                {grupos.semData.length > 0 && (
                  <section className="mb-5">
                    <h2 className="mb-2 text-base font-semibold text-ink-soft">Sem prazo</h2>
                    <div className="overflow-hidden rounded-lg border border-border bg-surface">
                      {grupos.semData.map((t, i) => linhaTarefa(t, i))}
                    </div>
                  </section>
                )}
              </>
            )
          ) : porRelacao.length === 0 ? (
            <div className="muted" style={{ padding: "20px 2px", fontSize: 14 }}>
              Nenhuma tarefa com esse filtro.{" "}
              <button
                type="button"
                onClick={limparTudo}
                style={{
                  border: "none", background: "transparent", padding: 0,
                  color: "var(--accent)", fontWeight: 600, cursor: "pointer",
                }}
              >
                Limpar filtros
              </button>
            </div>
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
                  <ColunaMinhas key={s.key} status={s} count={porStatus[s.key]?.length ?? 0}>
                    {(porStatus[s.key] ?? []).map((t) => (
                      <CardArrastavelMinhas
                        key={t.id}
                        task={t}
                        onAbrir={abrirDetalhe}
                        members={members}
                        projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
                      />
                    ))}
                  </ColunaMinhas>
                ))}
              </div>
              <DragOverlay>
                {activeId
                  ? (() => {
                      const at = (items ?? []).find((t) => t.id === activeId);
                      return at ? (
                        <div style={{ width: 256, cursor: "grabbing" }}>
                          <TaskCard
                            task={at}
                            members={members}
                            projectName={at.project_id ? projectNames.get(at.project_id) : undefined}
                          />
                        </div>
                      ) : null;
                    })()
                  : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}

      <TaskModal
        open={editando !== null}
        task={editando}
        onClose={() => setEditando(null)}
        onSaved={aoSalvar}
      />

      <TaskDetail
        task={focado}
        members={members}
        projects={projectNames}
        filhos={filhosParaDetalhe}
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onEditar={(t) => {
          setEditando(t);
        }}
        onAssigneesChange={aoMudarResponsaveis}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsertComFilhos}
        onTaskMoved={aoUpsertComFilhos}
        onExcluir={(t) => {
          // Remove a task (e a subtree por path) da lista.
          setItems((prev) =>
            (prev ?? []).filter(
              (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
            )
          );
          // E tambem da lista de filhos buscada do foco (se estiver la).
          setFilhosDoFocado((prev) =>
            prev
              ? prev.filter(
                  (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
                )
              : prev
          );
          // Se veio de um pai (pilha), volta pro pai; senao fecha.
          if (pilha.length > 0) voltarDetalhe();
          else fecharDetalhe();
        }}
      />

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 16px", boxShadow: "var(--shadow)",
            fontSize: 13, zIndex: 80, maxWidth: "90vw",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// --- Kanban do minhas-tarefas (duplicado do Board de proposito: mantem o
// quadro geral intocado). Coluna droppable + card draggable, reusando TaskCard. ---
function ColunaMinhas({
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
        // Espelha o Board.tsx: anel na cor da coluna marca o alvo do drop.
        // `outline` nao ocupa espaco -> as colunas nao pulam de largura.
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

function CardArrastavelMinhas({
  task,
  onAbrir,
  members,
  projectName,
}: {
  task: MyTaskItem;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  projectName?: string;
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
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
        members={members}
        projectName={projectName}
        parentTitle={(task as MyTaskItem).parent_title}
      />
    </div>
  );
}
