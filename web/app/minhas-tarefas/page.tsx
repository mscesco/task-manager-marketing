"use client";
import { useSensoresDeArraste } from "@/lib/useSensoresDeArraste";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import { ChevronRight, CornerDownRight } from "lucide-react";
import Avatar from "@/components/Avatar";
import Badge from "@/components/Badge";
import { nomeCurto } from "@/lib/people";
import { agoraNoWorkspace } from "@/lib/prazo";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import TaskCard from "@/components/TaskCard";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  deadlineLabel,
  DEADLINE_COLOR,
} from "@/lib/status";
import {
  colunaEquivalente,
  colunasPadraoMinhasTarefas,
  deadlineTonePorColuna,
  rotuloDeColuna,
  terminal,
  type Coluna,
  type OrigemDaColuna,
} from "@/lib/coluna";
import { normalizarBusca } from "@/lib/filtrosQuadro";
import { soltarConfete } from "@/lib/confete";
import {
  listAllMyAssignments,
  quadroGeralComIndice,
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
import { ORDENACOES, ordenar, type Ordenacao } from "@/lib/ordenacao";
import { ALL_TEAMS, withTeam } from "@/lib/activeTeam";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { criarUltimaVez } from "@/lib/ultimaVez";

import { motion } from "motion/react";
import { Esqueleto } from "@/components/Loading";
import Entrada, { useEntrada } from "@/components/Entrada";
import { useAvisar } from "@/components/Toasts";
const RELATION_LABEL: Record<string, string> = {
  assignee: "Responsável",
  creator: "Criei",
  watcher: "Sigo",
};

// Opcoes do seletor de relacao. "todas" = sem filtro de relacao.
const RELACOES = [
  { key: "todas", label: "Todas" },
  { key: "creator", label: "Que criei" },
  { key: "assignee", label: "Designadas a mim" },
  // "Todas" também inclui as tarefas que a pessoa segue.
  { key: "watcher", label: "Que sigo" },
] as const;


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
  // `members` fica completo (resolve nomes); este conjunto só tira do seletor e marca a pílula.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  // null = nao truncou. Se a lista passar do teto de busca, vira aviso honesto
  // no lugar de perda silenciosa (mesmo padrao do quadro).
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Colunas do quadro geral, vindas da API.
  // `null` = ainda carregando. `[]` = carregou e nao ha coluna -- estado
  // diferente, e a tela desenha os dois de formas diferentes.
  const [colunas, setColunas] = useState<Coluna[] | null>(null);

  // Filtros (client-side, sobre a lista ja carregada). Comecam "tudo visivel".
  const [relFiltro, setRelFiltro] = useState<string>("todas");
  // Nasce `null` e é preenchido quando as colunas chegam; a tela espera por elas.
  const [colunasOn, setColunasOn] = useState<Set<string> | null>(null);
  // `column_id -> origem` em todos os quadros alcançáveis; `colunas` é só o que a tela desenha.
  const [indice, setIndice] = useState<Map<string, OrigemDaColuna> | null>(null);
  // Arquivadas escondidas por padrao (paridade com o quadro). Sessao-only.
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [busca, setBusca] = useState("");

  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Todos os filhos da tarefa focada (a lista só tem as minhas). `null` = carregando -> cai em `items`.
  const [filhosDoFocado, setFilhosDoFocado] = useState<Task[] | null>(null);
  // Tarefa sendo duplicada (o modal desta tela só duplica).
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);
  // Libera a ESCRITA do ?task= na URL. Separado do deepLinkFeito porque a
  // leitura e async: so vira true quando a abertura inicial resolve.
  const [urlLiberada, setUrlLiberada] = useState(false);

  // Dois recortes independentes: a LISTA aceita "tudo" e vai na URL (`?time=`);
  // o QUADRO exige um time (colunas de um quadro geral) e fica só na sessão.
  const {
    active,
    search,
    teams: timesDisponiveis,
    teamName: nomeDoTime,
  } = useActiveTeam();
  /** `null` = "tudo" (ou nenhum time). O `kind: "all"` cai aqui. */
  const timeDaLista = useActiveTeamId();
  const [timeDoQuadro, setTimeDoQuadro] = useState<string | null>(null);

  // Vista: lista (agrupada por prazo) x quadro (kanban por status). Sessao-only.
  const [vista, setVista] = useState<"lista" | "quadro">("lista");
  // Ordenação (`lib/ordenacao.ts`) só no modo quadro; a lista já agrupa por dia.
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("criacao");
  // Drag no modo quadro (mesmo padrao do Board).
  const [activeId, setActiveId] = useState<string | null>(null);
  const avisar = useAvisar();
  const sensors = useSensoresDeArraste();
  const suprimirClique = useRef(false);
  // Dois arrastes do mesmo card: so a resposta do ultimo vale (`lib/ultimaVez`).
  const vezDoArraste = useRef(criarUltimaVez()).current;

  // Trava a vista quadro na altura da viewport (cada coluna rola por dentro); na lista não faz nada.
  const colunasRef = useRef<HTMLDivElement>(null);
  const [alturaColunas, setAlturaColunas] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const el = colunasRef.current;
    if (!el) return;
    // Clamp em 0: com a página rolada, o top negativo estourava a altura.
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

  // O time do quadro é semeado pelo da lista sem pisar numa escolha feita;
  // sem time na lista, cai no primeiro preferido da pessoa.
  useEffect(() => {
    const reserva = timeDaLista ?? timesDisponiveis[0]?.id ?? null;
    if (reserva) setTimeDoQuadro((atual) => atual ?? reserva);
  }, [timeDaLista, timesDisponiveis]);

  useEffect(() => {
    // Espera a barra: `active === null` = ainda não sei; `timeDaLista === null` = todos os times.
    if (active === null) return;
    // Guarda de corrida: um pedido mais velho não sobrescreve o novo.
    let vivo = true;
    listAllMyAssignments(timeDaLista)
      .then((r) => {
        if (!vivo) return;
        setItems(r.items);
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => {
        if (vivo) setErro(e.message);
      });
    return () => {
      vivo = false;
    };
    // `active === null`, não `active`: o objeto é novo a cada render e refaria o pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDaLista, active === null]);

  useEffect(() => {
    // Guarda de corrida: as colunas do time anterior não podem chegar depois das do novo.
    let vivo = true;
    // Colunas do quadro geral do time do quadro e o índice de todas as alcançáveis.
    // O filtro padrão liga todas menos as DONE (Cancelado continua aparecendo).
    quadroGeralComIndice(timeDoQuadro)
      .then(({ colunas: cs, indice: ix }) => {
        if (!vivo) return;
        setColunas(cs);
        setIndice(ix);
        setColunasOn(new Set(colunasPadraoMinhasTarefas(cs)));
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
      })
      .catch(() => {});
    // Alimenta o chip de projeto e o seletor de "mudar projeto" no detalhe.
    listAllProjects({
      // Só rotula: não recorta por time, senão some o selo de tarefa que a pessoa enxerga.
      teamId: null,
    })
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        // O mapa de nomes tem todos; o seletor de "mudar projeto" não oferece pessoal.
      })
      .catch(() => {});
    // `timeDoQuadro` nas dependências: trocar o time do quadro rebusca as colunas.
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDoQuadro]);

  // Abre o detalhe pelo id na lista completa (não na filtrada); fora da lista, avisa.
  const abrirTarefaDaLista = useCallback(
    async (id: string) => {
      if (items === null) return;
      const t = items.find((x) => x.id === id);
      if (!t) {
        avisar("Não foi possível abrir: essa tarefa não está na sua lista.");
        return;
      }
      // Subtarefa: monta a pilha de ancestrais [raiz..paiDireto], buscando os que não estão na lista.
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

  // Deep-link ao entrar: lê ?task=<id> uma vez, depois que a lista carrega.
  useEffect(() => {
    if (deepLinkFeito || items === null) return;
    setDeepLinkFeito(true);
    const alvo = new URLSearchParams(window.location.search).get("task");
    if (!alvo) {
      setUrlLiberada(true);
      return;
    }
    // Só libera a escrita da URL quando a abertura resolver (antes, apagaria o ?task=);
    // `finally` para liberar também quando falha.
    abrirTarefaDaLista(alvo).finally(() => setUrlLiberada(true));
  }, [items, deepLinkFeito, abrirTarefaDaLista]);

  // Deep-link com a página já aberta: o sino emite este evento (router.push não remonta).
  useEffect(() => {
    function onAbrir(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) abrirTarefaDaLista(id);
    }
    window.addEventListener("abrir-tarefa", onAbrir);
    return () => window.removeEventListener("abrir-tarefa", onAbrir);
  }, [abrirTarefaDaLista]);

  // Espelha a tarefa aberta em ?task=<id>, só depois de `urlLiberada`.
  // `replaceState`: o Voltar continua saindo da página.
  useEffect(() => {
    if (!urlLiberada) return;
    sincronizarTaskNaUrl(detalhe?.id ?? null);
  }, [detalhe, urlLiberada]);

  // Busca todas as subtarefas do foco (até 100, teto do backend); erro -> null (cai em `items`).
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
    // Reusa a montagem da cadeia de pais do deep-link.
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

  // Upsert preservando `relations` e `assignee_ids`, que a mutação não devolve.
  function aoUpsert(t: Task) {
    setItems((prev) => {
      if (!prev) return prev;
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) {
        // subtarefa criada aqui: eu sou o criador, entra como "Criei".
        const nova: MyTaskItem = {
          ...t,
          relations: ["creator"],
          assignee_ids: t.assignee_ids ?? [],
          // A criação não traz `parent_title`; a mãe é a tarefa aberta.
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
        assignee_ids: t.assignee_ids ?? existente.assignee_ids,
        // A mutação não devolve `parent_title`: preserva o local.
        parent_title: existente.parent_title,
      };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  // Upsert que também atualiza os filhos buscados do foco.
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
    // `destino` é um `column_id`.
    if (!atual || atual.column_id === destino) return;

    // Recusa card de outro quadro (o backend daria 422). O `disabled` do dnd-kit não é testável em jsdom.
    const origemAtual = indice?.get(atual.column_id);
    if (!origemAtual || origemAtual.nomeDoQuadro !== null) return;

    // A coluna tem de estar nesta tela: ela junta tarefas de vários quadros e desenha as do geral.
    const colunaDestino = (colunas ?? []).find((c) => c.id === destino);
    if (!colunaDestino) return;

    const colunaAnterior = atual.column_id;

    // Cascata de conclusão otimista: só alcança as minhas subtarefas carregadas (o backend
    // conclui a subárvore inteira). Mexe em `column_id` e `status`, que ainda têm leitores.
    const concluindo = colunaDestino.semantic === "DONE";
    // O confete sai de onde o card foi solto (o mesmo desenho do `Board.tsx`).
    const soltoEm = e.active.rect.current.translated;
    const origemDoConfete =
      concluindo && indice?.get(colunaAnterior)?.coluna.semantic !== "DONE" && soltoEm
        ? { x: soltoEm.left + soltoEm.width / 2, y: soltoEm.top + soltoEm.height / 2 }
        : null;
    const prefixo = atual.path + ".";
    const anteriores = new Map<string, { coluna: string; status: string }>();
    if (concluindo) {
      for (const t of items ?? []) {
        // Coluna real da subtarefa (pode ser de outro quadro), pelo índice.
        const colunaDela = indice?.get(t.column_id)?.coluna;
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

    // Otimista (pai + cascata).
    setItems((prev) =>
      prev
        ? prev.map((t) => {
            if (t.id === taskId) return { ...t, column_id: destino };
            if (anteriores.has(t.id))
              return { ...t, column_id: destino, status: "COMPLETED" };
            return t;
          })
        : prev
    );

    const aindaEhOUltimo = vezDoArraste.nova(taskId);
    try {
      // Só `column_id` (os dois juntos dão 422); o status vem na resposta.
      const atualizada = await updateTask(taskId, { column_id: destino });
      if (!aindaEhOUltimo()) return;
      aoUpsert(atualizada); // re-merge do servidor, preservando relations/assignees
      soltarConfete(origemDoConfete);
    } catch (err) {
      if (!aindaEhOUltimo()) return;
      setItems((prev) =>
        prev
          ? prev.map((t) => {
              if (t.id === taskId) return { ...t, column_id: colunaAnterior };
              const ant = anteriores.get(t.id);
              return ant !== undefined
                ? { ...t, column_id: ant.coluna, status: ant.status }
                : t;
            })
          : prev
      );
      const e2 = err as ApiError;
      avisar(
        e2.status === 403
          ? "Você não pode mover esta tarefa. Voltei pra coluna anterior."
          : "Não consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  function aoSalvar(saved: Task) {
    aoUpsert(saved);
  }

  // --- filtros ---
  function toggleStatus(key: string) {
    setColunasOn((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function todosStatus() {
    setColunasOn(new Set((colunas ?? []).map((c) => c.id)));
  }
  function limparStatus() {
    setColunasOn(new Set());
  }
  function limparTudo() {
    setRelFiltro("todas");
    // Volta ao padrão da tela (concluídas escondidas), não a "tudo ligado".
    setColunasOn(new Set(colunasPadraoMinhasTarefas(colunas ?? [])));
  }

  // Arquivadas escondidas por padrão, filtradas no cliente. `itemsBase` alimenta as duas vistas;
  // detalhe e subtarefas usam `items` completo.
  const buscaNorm = normalizarBusca(busca);

  // ---------------------------------------------------------------------
  // Duas perguntas por card, resolvidas uma vez num mapa:
  //   `origem`       -- a coluna real da tarefa; decide alerta de prazo e o texto da tag.
  //   `colunaDaTela` -- em qual coluna do quadro geral o card é desenhado e filtrado.
  // Trocar uma pela outra dá alerta errado ou card que some.
  // ---------------------------------------------------------------------
  const posicaoDaTarefa = useMemo(() => {
    const m = new Map<
      string,
      { origem: OrigemDaColuna; colunaDaTela: Coluna | undefined }
    >();
    if (!indice || !colunas) return m;
    for (const t of items ?? []) {
      const origem = indice.get(t.column_id);
      // Sem origem: quadro apagado ou fora do alcance.
      if (!origem) continue;
      m.set(t.id, {
        origem,
        colunaDaTela: colunaEquivalente(origem.coluna, colunas),
      });
    }
    return m;
  }, [items, indice, colunas]);

  const itemsBase = useMemo(
    () => (items ?? []).filter((t) => mostrarArquivadas || !t.is_archived),
    [items, mostrarArquivadas]
  );

  // Aplica relacao + coluna sobre a lista carregada.
  const filtrados = useMemo(() => {
    return itemsBase.filter((t) => {
      // Filtra pela coluna da tela, não pelo `column_id` cru; sem coluna da tela, passa.
      const daTela = posicaoDaTarefa.get(t.id)?.colunaDaTela;
      const okStatus =
        colunasOn === null || daTela === undefined || colunasOn.has(daTela.id);
      const okRel = relFiltro === "todas" || t.relations.includes(relFiltro);
      const okBusca =
        buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm);
      return okStatus && okRel && okBusca;
    });
  }, [itemsBase, colunasOn, relFiltro, buscaNorm, posicaoDaTarefa]);

  // Agrupa a lista filtrada por data de entrega (string "YYYY-MM-DD" já ordena);
  // sem prazo por último.
  const grupos = useMemo(() => {
    const hoje = agoraNoWorkspace().data;
    const map = new Map<string, MyTaskItem[]>();
    for (const t of filtrados) {
      const key = t.due_date ?? "";
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    const comData = [...map.entries()]
      .filter(([k]) => k !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([data, tarefas]) => ({
        data,
        tarefas,
        tom: data < hoje ? "danger" : data === hoje ? "amber" : "faint",
      }));
    const semData = map.get("") ?? [];
    return { comData, semData };
  }, [filtrados]);

  // Modo quadro: filtra só por relação (o status vira coluna). Arrastar não é testável em jsdom.
  const porRelacao = useMemo(() => {
    return itemsBase.filter(
      (t) =>
        (relFiltro === "todas" || t.relations.includes(relFiltro)) &&
        (buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm))
    );
  }, [itemsBase, relFiltro, buscaNorm]);

  // Agrupa por coluna; `foraDaColuna` conta o que não coube em nenhuma.
  const { porColuna, foraDaColuna } = useMemo(() => {
    const map: Record<string, MyTaskItem[]> = {};
    for (const c of colunas ?? []) map[c.id] = [];
    // Ordena antes de distribuir: a distribuição preserva a ordem.
    let fora = 0;
    for (const t of ordenar(porRelacao, ordenacao)) {
      // Agrupa pela coluna da tela; a tag do card diz de onde a tarefa veio.
      const daTela = posicaoDaTarefa.get(t.id)?.colunaDaTela;
      const lista = daTela ? map[daTela.id] : undefined;
      if (lista) lista.push(t);
      else fora++;
    }
    return { porColuna: map, foraDaColuna: fora };
  }, [porRelacao, ordenacao, colunas, posicaoDaTarefa]);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  // Espera `items` e `colunas`, para não pintar sem filtro e reordenar depois.
  if (!items || !colunas) return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;

  // Detalhe e subtarefas sempre sobre a lista completa.
  const focado = detalhe ? items.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? items.filter((t) => t.parent_task_id === focado.id) : [];
  // Filhos do detalhe: os buscados quando prontos; senão, os meus (`items`).
  const filhosParaDetalhe: Task[] =
    filhosDoFocado !== null && focado
      ? filhosDoFocado.filter((f) => f.parent_task_id === focado.id)
      : filhosFocado;

  const visiveis = vista === "quadro" ? porRelacao.length : filtrados.length;
  const todosLigados = (colunasOn?.size ?? 0) === colunas.length;
  // Coluna real da tarefa, pelo índice (o `colunaPorId` só tem as colunas do quadro geral).
  const colunaPorId = new Map(colunas.map((c) => [c.id, c]));
  const colunaDe = (t: MyTaskItem): Coluna | undefined =>
    posicaoDaTarefa.get(t.id)?.origem.coluna ?? colunaPorId.get(t.column_id);
  // Tag `Quadro · Coluna` da lista; `null` = cai na reserva por status.
  const rotuloDe = (t: MyTaskItem): string | null =>
    rotuloDeColuna(posicaoDaTarefa.get(t.id)?.origem);
  // Tag do card no kanban: só para tarefa de outro quadro (o cabeçalho já nomeia a coluna).
  const rotuloForaDoQuadro = (t: MyTaskItem): string | undefined => {
    const origem = posicaoDaTarefa.get(t.id)?.origem;
    if (!origem || origem.nomeDoQuadro === null) return undefined;
    return rotuloDeColuna(origem) ?? undefined;
  };
  // Só arrasta card do quadro desta tela (`nomeDoQuadro === null`).
  const arrastavel = (t: MyTaskItem): boolean =>
    posicaoDaTarefa.get(t.id)?.origem.nomeDoQuadro === null;
  const contagem =
    visiveis === items.length ? `${items.length} tarefas` : `${visiveis} de ${items.length}`;

  // Uma linha de tarefa; a data vive no cabeçalho do grupo.
  function linhaTarefa(t: MyTaskItem) {
    // Cor de prazo do card (respeita status/arquivada); `null` = sem alerta.
    const col = colunaDe(t);
    // Quem decide o alerta é a coluna; sem coluna resolvida, sem alerta.
    const dueTone = col ? deadlineTonePorColuna(col, t.due_date, t.is_archived, t.due_time) : null;
    const ids = t.assignee_ids ?? [];
    // Cartão-linha: filete da cor da coluna à esquerda, selos no meio, seta à direita.
    return (
      <FaixaClicavel
        key={t.id}
        onAbrir={() => abrirDetalhe(t)}
        className="card-elev rounded-xl border border-border bg-surface"
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "10px 14px 10px 10px",
        }}
      >
        <span
          aria-hidden
          title={rotuloDe(t) ?? t.status}
          style={{
            width: 4, height: 36, borderRadius: 4, flexShrink: 0,
            background: col?.color ?? "var(--border)",
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Título em uma linha com reticências; `title` mostra o texto inteiro. */}
          <div
            title={t.title}
            style={{
              fontSize: 14, fontWeight: 600, lineHeight: 1.35,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {t.title}
          </div>
          {/* `minWidth: 0`: deixa os filhos encolherem em vez de empurrar a faixa. */}
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
            {/* Tag com quadro e coluna de origem; sem rótulo, cai no status. */}
            <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
              {rotuloDe(t) ?? t.status}
            </span>
            {t.parent_task_id && (
              // Nomeia a mãe quando o backend a resolveu; senão, rótulo genérico.
              <span
                title={
                  t.parent_title
                    ? `Subtarefa de: ${t.parent_title}`
                    : "Subtarefa"
                }
                style={{ display: "inline-flex", maxWidth: 260, minWidth: 0, flexShrink: 1 }}
              >
                <Badge tone="soft" size="sm" color="var(--accent)">
                  {t.parent_title ? (
                    <>
                      <CornerDownRight size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginRight: 4 }} />
                      {t.parent_title}
                    </>
                  ) : (
                    "Subtarefa"
                  )}
                </Badge>
              </span>
            )}
            {t.relations.map((r) => (
              <Badge key={r} tone="neutral" size="sm" weight="semibold" className="bg-surface-2 text-ink-soft">
                {RELATION_LABEL[r] || r}
              </Badge>
            ))}
            {dueTone && t.due_date && (
              // Prazo em pílula.
              <Badge tone="soft" size="sm" color={DEADLINE_COLOR[dueTone]} className="shrink-0">
                {deadlineLabel(t.due_date, t.due_time)}
              </Badge>
            )}
          </div>
        </div>
        <Badge tone="soft" size="sm" color={PRIORITY_COLOR[t.priority]} className="shrink-0">
          {PRIORITY_LABEL[t.priority] || t.priority}
        </Badge>
        {ids.length > 0 && (
          <span className="flex shrink-0 items-center">
            {ids.slice(0, 2).map((id, i) => {
              const nome = members.get(id)?.name ?? "";
              return (
                <Avatar
                  key={id}
                  id={id}
                  name={nome}
                  size="sm"
                  title={nome ? nomeCurto(nome) : "Responsável"}
                  className="border-[1.5px] border-surface"
                  style={{ marginLeft: i === 0 ? 0 : -6 }}
                />
              );
            })}
            {ids.length > 2 && <span className="muted ml-1 text-xs font-bold">+{ids.length - 2}</span>}
          </span>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-faint" />
      </FaixaClicavel>
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
          // Um gap só entre controles: 8px.
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
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

        {/* Busca. */}
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

        {/* Ordenação só no modo quadro, fora dos filtros: não esconde tarefa. */}
        {vista === "quadro" && (
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            aria-label="Ordenar tarefas"
            style={{
              fontSize: 13, padding: "6px 10px", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {ORDENACOES.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        )}

        {/* Um seletor de time por visão: a lista tem "Todos" e vai na URL; o quadro exige um time. */}
        {timesDisponiveis.length > 1 && (
          <select
            className="input"
            aria-label={
              vista === "lista"
                ? "Time das minhas tarefas"
                : "Time do quadro"
            }
            style={{ width: "auto", padding: "5px 10px", fontSize: 12 }}
            value={
              vista === "lista"
                ? (timeDaLista ?? ALL_TEAMS)
                : (timeDoQuadro ?? "")
            }
            onChange={(e) => {
              if (vista === "quadro") {
                setTimeDoQuadro(e.target.value || null);
                return;
              }
              // Recarga total, como toda navegação do app (ver `AppShell`).
              window.location.href = withTeam(
                "/minhas-tarefas",
                search ?? "",
                e.target.value,
              );
            }}
          >
            {vista === "lista" && <option value={ALL_TEAMS}>Todos os times</option>}
            {timesDisponiveis.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {/* Alterna lista/quadro (só na sessão); no quadro, as colunas da API viram o kanban. */}
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {/* `?? []`: o `tsc` perde o narrowing dentro de `barraFiltros()`; `!` esconderia o guard sumir. */}
          {(colunas ?? []).map((s) => {
            const on = colunasOn?.has(s.id) ?? false;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStatus(s.id)}
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
                {s.name}
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
            disabled={(colunasOn?.size ?? 0) === 0}
            className="tappable"
            style={{
              padding: "5px 8px", borderRadius: "var(--radius)", border: "none",
              background: "transparent",
              color: (colunasOn?.size ?? 0) === 0 ? "var(--text-faint)" : "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: (colunasOn?.size ?? 0) === 0 ? "default" : "pointer",
            }}
          >
            Limpar
          </button>

          {vista === "lista" && arquivadasCheck}
        </div>
          </>
        )}

        {/* Na lista o checkbox fica junto de "Limpar"; no quadro (sem chips), nesta linha. */}
        {vista === "quadro" && arquivadasCheck}
      </div>
    );
  }

  // Sem pastilhas de filtro ativo: aqui todo controle já está visível.

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
        // A barra fica mesmo sem tarefa: é nela que mora o seletor de time.
        <div className="max-w-[1100px]">
          {barraFiltros()}
          <EmptyState
            title={
              timeDaLista && nomeDoTime
                ? `Nenhuma tarefa sua em ${nomeDoTime}`
                : "Você está em dia"
            }
            description={
              timeDaLista && nomeDoTime
                ? "Troque o time acima para ver as tarefas de outro, ou escolha “Todos os times”."
                : "Tarefas em que você é responsável ou criador aparecem aqui."
            }
          />
        </div>
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
              // `Entrada` por grupo: a lista chega escalonada também ao voltar do quadro.
              <Entrada>
                {[
                  ...grupos.comData.map((g) => ({ chave: g.data, titulo: rotuloData(g.data), tom: g.tom, tarefas: g.tarefas })),
                  { chave: "sem", titulo: "Sem prazo", tom: "faint", tarefas: grupos.semData },
                ]
                  .filter((g) => g.tarefas.length > 0)
                  .map((g) => (
                    <section key={g.chave} className="mb-5 flex flex-col gap-2">
                      <h2
                        className={`m-0 flex items-center gap-2 text-xs font-bold ${
                          g.tom === "danger" ? "text-danger" : g.tom === "amber" ? "text-amber" : "text-ink-faint"
                        }`}
                      >
                        {g.titulo}
                        <Badge
                          tone="soft"
                          size="sm"
                          color={g.tom === "danger" ? "var(--danger)" : g.tom === "amber" ? "var(--amber)" : "var(--text-soft)"}
                        >
                          {g.tarefas.length}
                        </Badge>
                      </h2>
                      {g.tarefas.map((t) => linhaTarefa(t))}
                    </section>
                  ))}
              </Entrada>
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
                {(colunas ?? []).map((c, i) => (
                  <ColunaMinhas key={c.id} ordem={i} coluna={c} count={porColuna[c.id]?.length ?? 0}>
                    {(porColuna[c.id] ?? []).map((t) => {
                      // `?? []`, não `!`: a coluna vem de um mapa e pode faltar.
                      // Passa a coluna real da tarefa: ela decide prazo e "parada há X dias".
                      const col = colunaDe(t);
                      return col ? (
                        <CardArrastavelMinhas
                          key={t.id}
                          task={t}
                          coluna={col}
                          rotuloDaColuna={rotuloForaDoQuadro(t)}
                          arrastavel={arrastavel(t)}
                          onAbrir={abrirDetalhe}
                          members={members}
                          projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
                        />
                      ) : null;
                    })}
                  </ColunaMinhas>
                ))}
              </div>

              {foraDaColuna > 0 && (
                <div className="muted" role="status" style={{ fontSize: 12, marginTop: 8 }}>
                  {foraDaColuna}{" "}
                  {foraDaColuna === 1 ? "tarefa está" : "tarefas estão"} em uma
                  coluna que não é deste quadro e não{" "}
                  {foraDaColuna === 1 ? "aparece" : "aparecem"} acima.
                </div>
              )}

              <DragOverlay>
                {activeId
                  ? (() => {
                      const at = (items ?? []).find((t) => t.id === activeId);
                      const colAt = at ? colunaDe(at) : undefined;
                      return at && colAt ? (
                        <div style={{ width: 256, cursor: "grabbing" }}>
                          <TaskCard
                            task={at}
                            coluna={colAt}
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
        open={duplicando !== null}
        duplicarDe={duplicando}
        // `filhosParaDetalhe`, não `items`: `items` só tem as minhas e contaria menos.
        filhosDaOrigem={
          duplicando && focado?.id === duplicando.id ? filhosParaDetalhe : []
        }
        // Esta tela nao cria tarefa do zero (`open` exige duplicar).
        newTaskTeam={null}
        onClose={() => {
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // Abre a cópia, para mostrar que algo foi criado (subtarefa nem vira card).
            setDuplicando(null);
            aoSalvar(t);
            setPilha([]);
            setDetalhe(t);
            return;
          }
          aoSalvar(t);
        }}
      />

      <TaskDetail
        task={focado}
        members={members}
        projects={projectNames}
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        mostrarArquivadas={mostrarArquivadas}
        membrosInativos={membrosInativos}
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

    </div>
  );
}

// --- Kanban desta tela (duplicado do Board de propósito): coluna droppable + card draggable. ---
/**
 * Uma faixa clicável da lista — só a casca (o conteúdo vem de `linhaTarefa`).
 * É `role="button"`, então Enter e Espaço abrem.
 */
function FaixaClicavel({
  onAbrir,
  style,
  className,
  children,
}: {
  onAbrir: () => void;
  style: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      style={{ cursor: "pointer", ...style }}
    >
      {children}
    </div>
  );
}

function ColunaMinhas({
  coluna,
  count,
  children,
  ordem = 0,
}: {
  coluna: Coluna;
  count: number;
  children: React.ReactNode;
  /** Posicao na fileira: a entrada escalona por coluna, nunca por card. */
  ordem?: number;
}) {
  // O `id` do droppable é o `column_id` (chega em `e.over.id`).
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });
  const entrada = useEntrada(ordem);
  return (
    <motion.div
      ref={setNodeRef}
      {...entrada}
      // Âncora estável para o teste achar a coluna.
      data-coluna={coluna.id}
      style={{
        flex: 1, minWidth: 240, minHeight: 0, borderRadius: 10, padding: 4,
        display: "flex", flexDirection: "column",
        background: isOver ? "var(--surface-2)" : "transparent",
        // Espelha o Board.tsx: anel na cor da coluna marca o alvo do drop.
        // `outline` nao ocupa espaco -> as colunas nao pulam de largura.
        outline: isOver ? `2px solid ${coluna.color}` : "none",
        outlineOffset: -2,
        transition: "background .12s",
      }}
    >
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
    </motion.div>
  );
}

function CardArrastavelMinhas({
  task,
  coluna,
  rotuloDaColuna,
  arrastavel,
  onAbrir,
  members,
  projectName,
}: {
  task: MyTaskItem;
  // `Quadro · Coluna` só quando a tarefa mora em outro quadro.
  rotuloDaColuna: string | undefined;
  // `false` para tarefa de outro quadro.
  arrastavel: boolean;
  // O card decide prazo e "parada há X dias" pela coluna.
  coluna: Coluna;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  projectName?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !arrastavel,
  });
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
        touchAction: "manipulation",
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
        coluna={coluna}
        rotuloDaColuna={rotuloDaColuna}
        members={members}
        projectName={projectName}
        parentTitle={(task as MyTaskItem).parent_title}
      />
    </div>
  );
}
