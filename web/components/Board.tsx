"use client";
// Quadro kanban. Sem projectId => quadro geral; com projectId => quadro de um projeto
// (o backend já filtra; as subtarefas vêm junto pelo project_id da mãe).
import { useFecharAoClicarForaDe } from "@/lib/useCliqueFora";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { agoraNoWorkspace, estaAtrasada } from "@/lib/prazo";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import {
  DndContext,
  DragOverlay,
  closestCenter,
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
import { useSensoresDeArraste } from "@/lib/useSensoresDeArraste";
import { useFaixaDeTela } from "@/lib/useFaixaDeTela";
import CabecalhoDeColunaEditavel from "@/components/CabecalhoDeColunaEditavel";
import FormNovaColuna from "@/components/FormNovaColuna";
import RevisaoDaEdicao from "@/components/RevisaoDaEdicao";
import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import type { DestinoPossivel } from "@/lib/rascunhoDeColunas";
import {
  destinosDoRascunho,
  totalPrevisto,
  comColunaNova,
  comAlvo, semAlvo,
  comAviso,
  refDeColunaDoDrop,
  comMarcacao,
  comOrdem,
  comRenome,
  linhasDeEdicao,
  marcadasParaApagar,
  nomeRepetidoNoRascunho,
  paraLote,
  colunasParaDesenhar,
  idDeArrasteDoCabecalho,
  refDoArrasteDeCabecalho,
  rascunhoInicial,
  temPendencias,
  type Rascunho,
} from "@/lib/rascunhoDeColunas";
import EmptyStateBox from "@/components/EmptyState";
import { quadroGeralDoTime, type Coluna } from "@/lib/coluna";
import { listAllTasks, listAllProjects, listarFilhas, getTask, updateTask, listMembers, listSubteams, getRootTeamId, listBoards, colunaComContagem, aplicarLoteDeColunas, ApiError, type Task, type Team, type Quadro } from "@/lib/api";
import { newTaskTeam } from "@/lib/escopoTarefa";
import { mesclaTarefa } from "@/lib/mesclaTarefa";
import { criarUltimaVez } from "@/lib/ultimaVez";
import { applyDrop, planDrop, revertDrop } from "@/lib/taskDrag";
import { useWarnBeforeUnload } from "@/lib/useWarnBeforeUnload";
import { sincronizarTaskNaUrl, lerTaskDaUrl } from "@/lib/urlTarefa";
import { ORDENACOES, ordenar, type Ordenacao } from "@/lib/ordenacao";

import { motion } from "motion/react";
import { soltarConfete } from "@/lib/confete";
import { Esqueleto } from "@/components/Loading";
import { useEntrada } from "@/components/Entrada";
import PageTitle from "@/components/PageTitle";
import { useAvisar } from "@/components/Toasts";

type FiltroPrazo = "todos" | "atrasadas" | "em-dia";

export default function Board({
  projectId,
  subteamId,
  rootTeamId,
  boardId,
  podeEditarColunas,
  podeApagarColunas,
  title,
  heading,
  acoesDoQuadro,
  acoesDoTitulo,
  abaixoDoCabecalho,
}: {
  projectId?: string; // presente => quadro de PROJETO
  subteamId?: string; // presente => quadro de SUBTIME (modo híbrido)
  /** Time raiz cujo quadro geral é desenhado. Ausente, o Board pergunta `getRootTeamId`, que levanta com mais de uma raiz. */
  rootTeamId?: string;
  /**
   * Presente => quadro avulso: só as colunas e tarefas deste quadro. Vence
   * `subteamId` (avulso não é lente). Não é segurança: só escolhe o que desenhar.
   */
  boardId?: string;
  /** Pode editar as colunas. Decidido fora (`podeGerirQuadrosDe`); obrigatória para o tsc cobrar cada tela. Não é segurança. */
  podeEditarColunas: boolean;
  /** Pode apagar coluna no modo de edição. Separada de `podeEditarColunas`: GESTOR edita e não apaga. */
  podeApagarColunas: boolean;
  /** Título do quadro, dentro do `<h1>`: só texto. Quem precisa de controle junto passa `heading`. */
  title?: ReactNode;
  /** O titulo ja pronto, com o proprio `<h1>` (ver `title`). */
  heading?: ReactNode;
  /** Ações sobre o quadro (renomear, apagar), só no modo de edição. Slot: o Board não fala com a API de quadro. `null` é resposta. */
  acoesDoQuadro: ReactNode;
  /** Controles colados no título (ex.: lápis de editar o projeto), fora do modo de edição. */
  acoesDoTitulo?: ReactNode;
  /** Desenhado abaixo do cabeçalho, antes das colunas (ex.: meta do projeto). */
  abaixoDoCabecalho?: ReactNode;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  // Quadros que quem olha alcança; `null` = carregando, e nenhuma coluna é desenhada até chegar.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  // Para qual `boardId` a lista de quadros foi buscada.
  const [quadrosPara, setQuadrosPara] = useState<string | null>(null);
  // Quantas vezes a lista chegou sem o quadro pedido.
  const [buscasSemOQuadro, setBuscasSemOQuadro] = useState(0);
  // Falha ao buscar quadros: distinto de `[]` (carregou e não há quadro).
  const [erroQuadros, setErroQuadros] = useState(false);

  // ---- Modo de edição de colunas ----
  // Tudo fica no `rascunho` e sai num único PUT ao concluir. A regra mora em `lib/rascunhoDeColunas`.
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  // Pergunta antes de sair durante todo o modo de edição, não só com pendência
  // (as colunas que `temPendencias` precisa só existem depois dos returns antecipados).
  useWarnBeforeUnload(rascunho !== null);
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
  // project_id -> team_id do projeto: a pill de escopo usa o time do projeto, como o backend.
  const [timeDoProjeto, setTimeDoProjeto] = useState<Map<string, string | null>>(
    new Map()
  );
  // Vira true quando listAllProjects responde (inclusive no erro); evita pills piscando como "indefinido".
  const [projetosCarregados, setProjetosCarregados] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  // Tarefa sendo duplicada.
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  // Filhas reais da tarefa duplicada (com `root_only` elas não estão em `tasks`).
  // Falha vira lista vazia: o modal só não oferece levar as subtarefas.
  const [filhasDaOrigem, setFilhasDaOrigem] = useState<Task[]>([]);
  useEffect(() => {
    if (!duplicando) {
      setFilhasDaOrigem([]);
      return;
    }
    let cancelado = false;
    listarFilhas(duplicando.id)
      .then((f) => {
        if (!cancelado) setFilhasDaOrigem(f);
      })
      .catch(() => {
        if (!cancelado) setFilhasDaOrigem([]);
      });
    return () => {
      cancelado = true;
    };
  }, [duplicando]);
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Trava do deep-link: garante leitura unica do ?task= e libera a escrita
  // da URL so depois dela (ver os efeitos de "URL viva").
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const avisar = useAvisar();
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  // Filtros client-side: filtram em memória, sem bater na API.
  const [busca, setBusca] = useState("");
  const [prazo, setPrazo] = useState<FiltroPrazo>("todos");
  // Ordenacao do quadro -- so na sessao (nao persiste; reseta no reload).
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("criacao");
  // Filtro por subtime. memberTeam: id -> subtimes da pessoa; "" em `subtime` = sem filtro.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [memberTeam, setMemberTeam] = useState<Map<string, string[]>>(
    new Map()
  );
  // Membros carregados (inclusive no erro). No modo subtime as compartilhadas dependem
  // de memberTeam; sem esta guarda elas aparecem atrasadas.
  const [membrosCarregados, setMembrosCarregados] = useState(false);
  const [subtimes, setSubtimes] = useState<Team[]>([]);
  // Id do time raiz: o quadro geral só mostra tarefas da raiz. null = carregando ou
  // não encontrada -> não filtra, para nunca esconder o quadro inteiro.
  const [rootId, setRootId] = useState<string | null>(null);
  // Raiz resolvida (id ou null). Evita as internas piscarem antes do filtro ligar.
  const [rootCarregado, setRootCarregado] = useState(false);
  const [subtime, setSubtime] = useState<string>("");
  // Filtros de lib/filtrosQuadro: escopo (interna x compartilhada, só no modo subtime) e pessoa.
  const [escopoFiltro, setEscopoFiltro] = useState<FiltroEscopo>("todos");
  // Multi-seleção de pessoas: UNIÃO (lib/filtrosQuadro:passaResponsavel).
  const [pessoasFiltro, setPessoasFiltro] = useState<string[]>([]);
  const alternarPessoa = (id: string) =>
    setPessoasFiltro((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]
    );
  // Painel de filtros. Busca e ordenação ficam fora: busca é o mais usado e ordenação não esconde tarefa.
  const [painelAberto, setPainelAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);
  // Total real quando o fetch bateu o teto (truncou); null = não truncou.
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Guarda contra "clique fantasma" logo apos um arrasto.
  const suprimirClique = useRef(false);
  // Dois arrastes do mesmo card: so a resposta do ultimo vale (`lib/ultimaVez`).
  const vezDoArraste = useRef(criarUltimaVez()).current;

  // Fecha o painel ao clicar fora (mesmo padrao do picker de responsavel).
  useFecharAoClicarForaDe(painelRef, painelAberto, () => setPainelAberto(false));

  // Trava o quadro na altura da viewport: cada coluna rola por dentro. Mede a posição
  // real porque cada página tem altura diferente acima do quadro.
  const colunasRef = useRef<HTMLDivElement>(null);
  const [alturaColunas, setAlturaColunas] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const el = colunasRef.current;
    if (!el) return; // so existe quando ha colunas (raizes > 0)
    // Clamp em 0: medido com a página rolada, top vem negativo.
    const top = Math.max(0, el.getBoundingClientRect().top);
    const RODAPE = 24; // respiro pro padding inferior do <main>
    const h = Math.max(240, Math.round(window.innerHeight - top - RODAPE));
    setAlturaColunas((atual) => (atual === h ? atual : h));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", medirAltura);
    return () => window.removeEventListener("resize", medirAltura);
  }, [medirAltura]);
  // Roda após cada commit; o setState só dispara quando a altura muda, então não há loop.
  useLayoutEffect(() => {
    medirAltura();
  });

  const sensors = useSensoresDeArraste();
  const faixa = useFaixaDeTela();

  // Só a última recarga grava: alternar "arquivadas" depressa faria a carga mais lenta vencer.
  const geracaoDaCarga = useRef(0);
  const recarregarTasks = useCallback(() => {
    const minha = ++geracaoDaCarga.current;
    // `root_only`: o quadro só desenha raiz, e as subtarefas gastariam o teto de 1000.
    listAllTasks({
      project_id: projectId,
      include_archived: mostrarArquivadas,
      root_only: true,
    })
      .then((r) => {
        if (minha !== geracaoDaCarga.current) return;
        setTasks(r.items);
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => {
        if (minha === geracaoDaCarga.current) setErro(e.message);
      });
  }, [projectId, mostrarArquivadas]);

  // Raízes cuja SUBTAREFA casa a busca vêm do servidor (com `root_only` o cliente só
  // vê títulos de raiz). A busca por título de raiz continua instantânea; isto soma.
  const [raizesDoServidor, setRaizesDoServidor] = useState<Set<string>>(
    new Set()
  );
  useEffect(() => {
    const termo = busca.trim();
    if (termo === "") {
      setRaizesDoServidor(new Set());
      return;
    }
    let cancelado = false;
    const timer = setTimeout(() => {
      listAllTasks({
        project_id: projectId,
        include_archived: mostrarArquivadas,
        root_only: true,
        q: termo,
      })
        .then((r) => {
          if (!cancelado) setRaizesDoServidor(new Set(r.items.map((t) => t.id)));
        })
        .catch(() => {
          // Silencioso: a busca de raiz continua valendo, só faltam os casamentos de subtarefa.
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca, projectId, mostrarArquivadas]);

  useEffect(() => {
    recarregarTasks();
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        // O mapa de nomes precisa de todos; o seletor não oferece desativado.
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
        setMemberTeam(new Map(ms.map((m) => [m.id, m.team_ids])));
      })
      .catch(() => {})
      .finally(() => setMembrosCarregados(true));
    // projectNames alimenta o chip do card e o seletor de projeto do detalhe, em qualquer quadro.
    listAllProjects({
      // Rotular, não escolher: recortar por time apagaria o selo de uma tarefa visível.
      teamId: null,
    })
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        setTimeDoProjeto(new Map(r.items.map((p) => [p.id, p.team_id])));
      })
      .catch(() => {})
      .finally(() => setProjetosCarregados(true));
  }, [projectId, mostrarArquivadas, recarregarTasks]);

  // Subtimes: estáveis, busca uma vez (memoizado no api.ts). Quadros: uma requisição por
  // montagem, sem cache; em erro fica `[]` (e `erroQuadros`), senão a tela trava em "Carregando".
  const carregarQuadros = useCallback(() => {
    setErroQuadros(false);
    listBoards()
      .then((lista) => {
        setQuadros(lista);
        // Para qual `boardId` a lista chegou: separa "carregando" de "o quadro não está nela".
        setQuadrosPara(boardId ?? null);
        // Conta buscas sem o quadro pedido; zera quando ele aparece.
        setBuscasSemOQuadro((n) =>
          boardId && !lista.some((q) => q.id === boardId) ? n + 1 : 0
        );
        setErroQuadros(false);
      })
      .catch(() => {
        // `[]` evita que leitores estourem; quem decide a tela é `erroQuadros`.
        setQuadros([]);
        setErroQuadros(true);
      });
    // `boardId` nas dependências: o closure guardaria o do primeiro render.
  }, [boardId]);

  // `boardId` nas dependências: um quadro recém-criado não estaria na lista antiga.
  useEffect(() => {
    carregarQuadros();
  }, [carregarQuadros, boardId]);

  // Uma segunda tentativa: a primeira busca pode ter saído antes do `POST /boards` gravar.
  // Só uma; voltando igual, o quadro não existe.
  useEffect(() => {
    if (boardId && buscasSemOQuadro === 1) carregarQuadros();
  }, [boardId, buscasSemOQuadro, carregarQuadros]);

  // Trocar de quadro descarta o rascunho em silêncio: os refs seriam do quadro anterior.
  // Confirmar, se um dia for preciso, cabe no seletor, antes da troca.
  useEffect(() => {
    setRascunho(null);
    setRevisando(false);
    setCriandoColuna(false);
  }, [boardId]);

  useEffect(() => {
    listSubteams().then(setSubtimes).catch(() => {});
    // Com o time raiz vindo de fora não há o que perguntar; `getRootTeamId` levanta com várias raízes.
    if (rootTeamId) {
      setRootId(rootTeamId);
      setRootCarregado(true);
      return;
    }
    // O quadro de projeto não usa a raiz (o filtro dele é o projeto).
    if (projectId) {
      setRootCarregado(true);
      return;
    }
    getRootTeamId()
      .then((id) => setRootId(id))
      // Com várias raízes o filtro não liga e o quadro mostra tudo; o erro vai ao console.
      .catch((e) => console.error("Board: time indefinido", e))
      .finally(() => setRootCarregado(true));
  }, [rootTeamId, projectId]);

  // ---- URL viva (?task=<id>) ----
  // Leitura: ao chegar com ?task=, abre a tarefa uma vez, reconstruindo a cadeia de mães
  // para a subtarefa abrir com "voltar". Fora deste quadro, ignora em silêncio.
  useEffect(() => {
    if (deepLinkFeito || tasks === null) return;
    setDeepLinkFeito(true);
    const alvo = lerTaskDaUrl();
    if (!alvo) return;
    const noLote = tasks.find((x) => x.id === alvo);
    if (noLote) {
      const pilhaPais: Task[] = [];
      const vistos = new Set<string>([noLote.id]); // guarda anti-ciclo
      let paiId = noLote.parent_task_id;
      while (paiId && !vistos.has(paiId)) {
        vistos.add(paiId);
        const pai = tasks.find((x) => x.id === paiId);
        if (!pai) break; // pai fora do lote -> para onde deu
        pilhaPais.unshift(pai);
        paiId = pai.parent_task_id;
      }
      setPilha(pilhaPais);
      setDetalhe(noLote);
      return;
    }
    // Subtarefa não está no lote (`root_only`): busca no servidor só neste caso de exceção.
    let cancelado = false;
    void (async () => {
      try {
        const t = await getTask(alvo);
        const pilhaPais: Task[] = [];
        const vistos = new Set<string>([t.id]);
        let paiId = t.parent_task_id;
        // Teto de 20: a profundidade não é limitada, e cada nível é uma requisição em série.
        while (paiId && !vistos.has(paiId) && pilhaPais.length < 20) {
          vistos.add(paiId);
          const pai = tasks.find((x) => x.id === paiId) ?? (await getTask(paiId));
          pilhaPais.unshift(pai);
          paiId = pai.parent_task_id;
        }
        if (cancelado) return;
        setPilha(pilhaPais);
        setDetalhe(t);
      } catch {
        // 404/403: link velho ou fora do alcance; segue em silêncio.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [tasks, deepLinkFeito]);

  // Escrita: espelha a tarefa aberta na URL (abrir, fechar, entrar e voltar passam por `detalhe`).
  // Espera o deepLinkFeito, senão apagaria o ?task= antes da leitura.
  useEffect(() => {
    if (!deepLinkFeito) return;
    sincronizarTaskNaUrl(detalhe?.id ?? null);
  }, [detalhe, deepLinkFeito]);

  function aoSalvar(saved: Task) {
    setTasks((prev) => {
      const lista = prev ?? [];
      const existente = lista.find((t) => t.id === saved.id);
      // `PATCH` não devolve os agregados: `mesclaTarefa` os preserva.
      const m = { ...mesclaTarefa(saved, existente), assignee_ids: saved.assignee_ids ?? existente?.assignee_ids ?? [] };
      return existente
        ? lista.map((t) => (t.id === saved.id ? m : t))
        : [m, ...lista];
    });
    setCriando(false);
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
    avisar(`Tarefa${extra} excluída(s).`);
  }

  function aoUpsert(t: Task) {
    setTasks((prev) => {
      if (!prev) return [t];
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) return [t, ...prev];
      // Virou concluído -> cascata otimista nos descendentes carregados (espelha o backend:
      // pula concluídas, canceladas e arquivadas).
      const virouConcluido =
        t.status === "COMPLETED" && existente.status !== "COMPLETED";
      // `PATCH`, `/move` e `/archive` não devolvem os agregados: `mesclaTarefa` os preserva.
      const base = mesclaTarefa(t, existente);
      // Concluir a mãe conclui a subárvore no backend, então `done = total` sem ter as filhas.
      // O inverso não vale: sair de concluído não desfaz a cascata.
      const merged = virouConcluido
        ? { ...base, subtask_done: base.subtask_total }
        : base;
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
          // Coluna junto com o status: a checklist e o filtro de prazo leem a coluna.
          // A subtarefa herda o quadro da mãe, então a coluna de conclusão é a mesma.
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
    // O filtro por pessoa lê `subtree_assignee_ids`, agregado no servidor: recarrega.
    recarregarTasks();
  }

  const activeTask = useMemo(
    () => (activeId ? tasks?.find((t) => t.id === activeId) ?? null : null),
    [activeId, tasks]
  );

  // Largura do card arrastado, medida na coluna, para o fantasma do `DragOverlay` ter o mesmo tamanho.
  const [larguraDoArraste, setLarguraDoArraste] = useState<number | null>(null);
  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    const el = document.querySelector<HTMLElement>(`[data-card="${e.active.id}"]`);
    setLarguraDoArraste(el?.offsetWidth ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    suprimirClique.current = true;
    setTimeout(() => (suprimirClique.current = false), 60);

    const taskId = String(e.active.id);
    // O destino é um `column_id` (o droppable de cada coluna usa `coluna.id`).
    const plano = planDrop(tasks ?? [], taskId, e.over ? String(e.over.id) : null, {
      columns: colunas,
      columnOf: (id) => colunaPorId.get(id),
      countSubtasks: true,
    });
    if (!plano) return;

    // O confete sai de onde o card foi solto, lido antes do `await`.
    const soltoEm = e.active.rect.current.translated;
    const origemDoConfete =
      plano.celebrate && soltoEm
        ? { x: soltoEm.left + soltoEm.width / 2, y: soltoEm.top + soltoEm.height / 2 }
        : null;
    setTasks((prev) => applyDrop(prev!, plano));

    const aindaEhOUltimo = vezDoArraste.nova(taskId);
    try {
      // Manda só `column_id` (os dois campos dão 422); o status certo vem na resposta.
      const atualizada = await updateTask(taskId, { column_id: plano.to });
      if (!aindaEhOUltimo()) return;
      setTasks((prev) =>
        prev!.map((t) =>
          // `mesclaTarefa`: a resposta não traz os agregados.
          t.id === taskId ? mesclaTarefa(atualizada, t) : t
        )
      );
      soltarConfete(origemDoConfete);
    } catch (err) {
      if (!aindaEhOUltimo()) return;
      setTasks((prev) => revertDrop(prev!, plano));
      const e2 = err as ApiError;
      avisar(
        e2.status === 403
          ? "Você não pode mover esta tarefa. Voltei pra coluna anterior."
          : "Não consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!tasks) return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;
  // Geral e subtime esperam o rootId para não piscar tarefas que o filtro vai esconder.
  if (!projectId && !rootCarregado)
    return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;
  // Subtime espera os membros: as compartilhadas dependem de memberTeam.
  if (!projectId && subteamId && !membrosCarregados)
    return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;
  // Subtime espera os projetos: a pill e o filtro de origem usam o time do projeto.
  if (!projectId && subteamId && !projetosCarregados)
    return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;
  // Erro de `/boards` antes da espera: sem quadros, com `boardId` a tela esperaria para
  // sempre e no geral desenharia tudo como "fora da coluna". O botão evita o F5.
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
  // Sem as colunas não há kanban.
  if (!quadros) return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;

  // ---- As colunas deste quadro ----
  // `boardId` pedido manda (quadro avulso, que nasce sem tarefa). Projeto não tem quadro próprio:
  // usa o quadro do lote, ou o geral. Geral e lente usam o quadro geral do time raiz.
  const quadrosDoLote = new Set(tasks.map((t) => t.board_id));
  const quadroDoLote =
    quadrosDoLote.size === 1
      ? quadros.find((q) => q.id === [...quadrosDoLote][0])
      : undefined;
  const quadroPedido = boardId
    ? quadros.find((q) => q.id === boardId)
    : undefined;
  // Com `boardId` não há queda para o padrão: `undefined` vira espera e a lista é rebuscada.
  // O geral é o DESTE time raiz (com várias raízes há vários gerais); sem `rootId` (rota
  // `/quadro` com uma raiz só) vale o `is_default`.
  const quadroGeral = rootId
    ? quadroGeralDoTime(quadros, rootId)
    : quadros.find((q) => q.is_default);
  const quadro = boardId
    ? quadroPedido
    : projectId
      ? (quadroDoLote ?? quadroGeral)
      : quadroGeral;
  // Quadro pedido e não encontrado: espera (corrida de quem acabou de criar).
  if (boardId && !quadro) {
    // Logo após criar, a lista pode voltar sem o quadro; só depois da segunda busca vazia
    // (`buscasSemOQuadro`) a tela conclui que ele foi apagado. Uma vez só, não um laço.
    if (quadrosPara !== boardId || buscasSemOQuadro < 2) {
      return <Esqueleto forma="colunas" rotulo="Carregando tarefas" />;
    }
    return (
      <div className="error-box" role="alert" style={{ maxWidth: 480 }}>
        Este quadro não existe mais.
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Ele pode ter sido apagado por outra pessoa enquanto você o tinha
          aberto.
        </div>
      </div>
    );
  }
  const colunas: Coluna[] = quadro
    ? [...quadro.colunas].sort((a, b) => a.position - b.position)
    : [];
  const colunaPorId = new Map(colunas.map((c) => [c.id, c]));

  // Em quadro avulso o time da tarefa nova sai do quadro, não de quem clica (`subteamId` e
  // `boardId` são excludentes): o time de quem criou deixaria a tarefa ineditável para o subtime.
  // ---- Ações do modo de edição: só fiação para `lib/rascunhoDeColunas` ----
  // Lê o `code` da recusa, nunca a mensagem do servidor.
  function mensagemDeErro(e: unknown): string {
    const err = e as { code?: string; message?: string };
    return (
      explicaRecusa(err.code) ??
      err.message ??
      "Não consegui aplicar as alterações."
    );
  }

  const modoEdicao = rascunho !== null;
  // Qual quadro esta edição escreve: o avulso ou o geral. Lente e projeto não editam
  // (desenham colunas de outro quadro).
  const quadroEditavel =
    boardId ?? (!subteamId && !projectId ? (quadro?.id ?? null) : null);
  // Necessário para a trava das colunas ponte (`impedimentoDeExclusao`).
  const quadroPadrao = quadro?.is_default ?? false;
  const linhasEdicao = rascunho
    ? linhasDeEdicao(rascunho, colunas, quadroPadrao)
    : [];

  function abrirEdicao() {
    setRascunho(rascunhoInicial(colunas));
    setErroLote(null);
  }

  function fecharEdicao() {
    // Sair é cancelar: avisa antes de descartar pendências.
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
    // `null` = nada muda; não vira pendência.
    if (novo) setRascunho(novo);
  }

  async function concluirEdicao() {
    if (!rascunho) return;
    if (!temPendencias(rascunho, colunas)) {
      setRascunho(null);
      return;
    }
    // Nome repetido é barrado antes do pedido (o backend recusaria o lote inteiro), e só aqui:
    // trocar dois nomes entre si passa por um estado repetido no meio da digitação.
    const repetido = nomeRepetidoNoRascunho(rascunho, colunas);
    if (repetido !== null) {
      setErroLote(
        `Duas colunas ficariam com o nome "${repetido}". ` +
          `Renomeie uma delas antes de concluir.`,
      );
      return;
    }
    const marcadas = marcadasParaApagar(rascunho, colunas);
    if (marcadas.length === 0) {
      await aplicarLote({});
      return;
    }
    // Contagens buscadas agora, para a revisão mostrar o número do momento da decisão.
    setContagens(null);
    setErroLote(null);
    setRevisando(true);
    try {
      const pares = await Promise.all(
        marcadas.map(async (c) => {
          // `quadroEditavel`, não `boardId`: no geral o `boardId` é `undefined`.
          const det = await colunaComContagem(quadroEditavel!, c.id);
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
    // `quadroEditavel` cobre avulso e geral; com `boardId` o geral não aplicaria nada.
    if (!rascunho || !quadroEditavel) return;
    setAplicando(true);
    setErroLote(null);
    try {
      const resposta = await aplicarLoteDeColunas(
        quadroEditavel,
        paraLote(rascunho, colunas, destinos),
      );
    // Avisa se o servidor moveu um número diferente do que a revisão mostrou.
      const divergencia = mensagemDeDivergencia(
        totalPrevisto(rascunho, contagens ?? {}),
        resposta.movidas,
      );
      if (divergencia) avisar(divergencia);
      setRascunho(null);
      setRevisando(false);
      setCriandoColuna(false);
      // Recarrega colunas e tarefas: o lote pode ter mexido nas duas.
      carregarQuadros();
      recarregarTasks();
    } catch (e) {
      // Recusa perde o lote inteiro; o rascunho fica para a pessoa corrigir.
      setErroLote(mensagemDeErro(e));
    } finally {
      setAplicando(false);
    }
  }

  // No modo de edição o kanban segue o rascunho (inclusive colunas criadas, vazias),
  // para o arraste ter efeito imediato. Regra em `colunasParaDesenhar`.
  const colunasVisiveis: Coluna[] = rascunho
    ? colunasParaDesenhar(rascunho, colunas)
    : colunas;
  const ordemVisivel = colunasVisiveis.map((c) => c.id);

  const destinosDaRevisao: DestinoPossivel[] = rascunho
    ? destinosDoRascunho(rascunho, colunas)
    : [];

  function onDragEndColuna(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !rascunho) return;
    // `null` = não é arraste de cabeçalho (ids de card viajam no mesmo contexto).
    const refArrastada = refDoArrasteDeCabecalho(String(active.id));
    // O alvo pode ser o corpo ou o cabeçalho da coluna: `refDeColunaDoDrop` aceita os dois.
    const refSobre = refDeColunaDoDrop(String(over.id), rascunho);
    if (refArrastada === null || refSobre === null) return;
    const destino = rascunho.ordem.indexOf(refSobre);
    if (destino === -1) return;
    const novo = comOrdem(rascunho, refArrastada, destino);
    // `null` = nada muda (mesmo contrato das setas).
    if (novo) setRascunho(novo);
  }

  // Time da tarefa nova (avulso, subtime ou raiz); regra testada em `lib/escopoTarefa`.
  const novaTarefa = newTaskTeam({
    boardId: boardId ?? null,
    boardTeamId: quadro?.team_id ?? null,
    subteamId: subteamId ?? null,
    rootId,
  });

  // Contador de subtarefas vem pronto do backend (regras em `subtask_progress.py`).
  // `?? 0`: resposta de mutação não traz os agregados.
  const subCount: Record<string, number> = {};
  const subDone: Record<string, number> = {};
  for (const t of tasks) {
    subCount[t.id] = t.subtask_total ?? 0;
    subDone[t.id] = t.subtask_done ?? 0;
  }

  // Herança de subtimes para o filtro: uma raiz pertence a um subtime se ela ou alguma
  // subtarefa tem responsável dele. subtimesPorRaiz: id da raiz -> subtimes.
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
    // O subtime sai da pessoa (`memberTeam`), não de `task.team_id`.
    const ids = t.subtree_assignee_ids ?? t.assignee_ids ?? [];
    if (ids.length === 0) continue;
    const raizId = t.subtree_assignee_ids !== undefined ? t.id : raizDe(t);
    let set = subtimesPorRaiz.get(raizId);
    if (!set) {
      set = new Set<string>();
      subtimesPorRaiz.set(raizId, set);
    }
    for (const id of ids) {
      // Todos os subtimes da pessoa entram.
      for (const st of memberTeam.get(id) ?? []) set.add(st);
    }
  }

  // visiveis = após o toggle de arquivadas; raizes = após busca e prazo. Contadores saem de `raizes`.
  const buscaNorm = normalizarBusca(busca);
  // Uma leitura do relógio por render: barato, e todas as tarefas contra o mesmo minuto.
  const agoraWs = agoraNoWorkspace();
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
  // Um setter por campo, para o ✕ da pastilha limpar sem conhecer o estado.
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

  // Filtro por modo:
  //   - PROJETO: sem filtro de time.
  //   - SUBTIME: UNIÃO de (A) tarefas da raiz com algum responsável do subtime
  //     (compartilhadas) e (B) internas do subtime.
  //   - GERAL: só tarefas da raiz.
  // rootId null (não carregou) -> não filtra por raiz, para não esconder o quadro.
  const modoSubtime = !projectId && !!subteamId;
  const soRaiz = !projectId && !subteamId && rootId !== null;
  const pertenceAoSubtime = (t: Task) => {
    const ids = t.assignee_ids ?? [];
    // `includes`: basta a pessoa estar neste subtime, ainda que esteja em outros.
    if (!subteamId) return false;
    return ids.some((id) => (memberTeam.get(id) ?? []).includes(subteamId));
  };
  // A lente e o geral só mostram tarefas do quadro geral do time raiz: tarefa de outro quadro
  // não teria coluna e sumiria sem erro. Sem quadro geral conhecido, não filtra.
  const quadroGeralId = quadroGeral?.id ?? null;
  const noQuadroGeral = (t: Task) =>
    quadroGeralId === null || t.board_id === quadroGeralId;
  const visiveis = tasks.filter((t) => {
    if (t.depth !== 0) return false;
    if (!(mostrarArquivadas || !t.is_archived)) return false;
    // Quadro avulso: só o que mora nele; vem antes do modo subtime.
    if (boardId) return t.board_id === boardId;
    if (modoSubtime) {
      if (!noQuadroGeral(t)) return false;
      // (B) interna do subtime OU (A) da raiz com responsável do subtime.
      const interna = t.team_id === subteamId;
      const compartilhada =
        (rootId === null || t.team_id === rootId) && pertenceAoSubtime(t);
      return interna || compartilhada;
    }
    // Projeto atravessa quadros: não passa pela guarda do quadro geral.
    if (projectId) return true;
    return (!soRaiz || t.team_id === rootId) && noQuadroGeral(t);
  });
  // No modo subtime, classifica cada tarefa (interna/compartilhada) para a pill do card.
  // A pill e o filtro usam a mesma regra pura.
  const escopoDaTask = (t: Task) =>
    classificaEscopo(t, modoSubtime ? subteamId : null, timeDoProjeto);
  // A pill não desenha "indefinido"; o filtro precisa dele.
  const pillDaTask = (t: Task) => pillDoEscopo(escopoDaTask(t));

  // Responsáveis agregados por raiz (herda de subtarefa), para o filtro por pessoa.
  const respPorRaiz = responsaveisPorRaiz(tasks);

  // Busca por título: raízes casadas no lote (na hora) UNIÃO raízes cuja subtarefa casou
  // no servidor (com debounce). Regra em lib/filtrosQuadro:raizesQueCasamBusca.
  const raizesDaBusca = new Set([
    ...raizesQueCasamBusca(tasks, buscaNorm),
    ...raizesDoServidor,
  ]);

  // Quem tem alguma tarefa neste quadro: decide se um desativado ainda aparece no filtro.
  const comTrabalhoAqui = new Set<string>();
  // Subárvore, não só a raiz: quem só tem subtarefa também precisa continuar no filtro.
  for (const t of tasks)
    for (const id of t.subtree_assignee_ids ?? t.assignee_ids ?? [])
      comTrabalhoAqui.add(id);

  // Pessoas do seletor: no subtime, só quem é dele; senão todo mundo. Desativado sai,
  // a não ser que ainda tenha tarefa neste quadro (para achar o que ficou pendente).
  const pessoasDoFiltro = Array.from(members.entries())
    .filter(
      ([id]) =>
        !modoSubtime ||
        (!!subteamId && (memberTeam.get(id) ?? []).includes(subteamId))
    )
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
    // Sem data: aparece em qualquer filtro de prazo.
    if (prazo !== "todos" && t.due_date) {
      // Pela coluna: concluída nunca é atrasada (cancelada com prazo vencido conta).
      // Comparação em `lib/prazo.ts`, que considera a hora.
      const atrasada =
        colunaPorId.get(t.column_id)?.semantic !== "DONE" &&
        estaAtrasada(t.due_date, t.due_time, agoraWs);
      if (prazo === "atrasadas" && !atrasada) return false;
      if (prazo === "em-dia" && atrasada) return false;
    }
    // Subtime: passa se algum responsável da raiz ou das subtarefas é do subtime
    // (subtimesPorRaiz). Raiz sem responsável nenhum some.
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
  // Ordenação da sessão (`lib/ordenacao.ts`); a distribuição nas colunas preserva a ordem.
  const ordenadas = ordenar(raizes, ordenacao);

  // Tarefa cuja coluna não está na lista não é desenhada, mas é contada (aviso abaixo).
  const porColuna: Record<string, Task[]> = {};
  for (const c of colunas) porColuna[c.id] = [];
  let foraDaColuna = 0;
  for (const t of ordenadas) {
    const lista = porColuna[t.column_id];
    if (lista) lista.push(t);
    else foraDaColuna++;
  }

  const focado = detalhe ? tasks.find((t) => t.id === detalhe.id) ?? detalhe : null;

  return (
    <div>
      {/* No modo de edição a barra troca de conteúdo: busca, filtro e criar tarefa saem. */}
      {modoEdicao ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          {heading ?? <PageTitle>{title}</PageTitle>}
          <span
            style={{
              fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "var(--accent-soft)", color: "var(--accent)",
            }}
          >
            Modo edição
          </span>
          {/* Antes do `marginLeft: "auto"`: as ações do quadro ficam junto do selo, separadas das de coluna. */}
          {acoesDoQuadro}
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
          {/* Sair é o cancelar; avisa antes de descartar (`fecharEdicao`). */}
          <button className="btn btn-ghost" onClick={fecharEdicao}>
            Sair
          </button>

          {/* Erro do lote fora da revisão (que só existe com coluna marcada para apagar).
              `role="alert"`: aparece longe do foco, depois do clique. */}
          {erroLote && !revisando && (
            <div
              role="alert"
              className="error-text"
              style={{ flexBasis: "100%", fontSize: 13 }}
            >
              {erroLote}
            </div>
          )}
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="mr-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-3">
            {heading ?? <PageTitle>{title}</PageTitle>}
            {/* Junto do título, antes da busca. */}
            {acoesDoTitulo}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            {temFiltro ? `${raizes.length} de ${visiveis.length}` : raizes.length} tarefas
          </span>
        </div>
        <div className="relative">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título…"
            aria-label="Buscar tarefa"
            style={{
              fontSize: 13, padding: "7px 10px 7px 30px", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", minWidth: 220,
            }}
          />
        </div>
        {/* Ordenar e "mostrar arquivadas" moram no painel, mas não contam no selo do funil:
            não estreitam o quadro (`contaFiltrosAtivos`). */}
        {/* ---- Painel de filtros ---- */}
        <div ref={painelRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setPainelAberto((v) => !v)}
            aria-expanded={painelAberto}
            aria-label="Filtros"
            className="btn"
            // `.btn` vence o Tailwind: fonte e padding inline.
            style={{ fontSize: 13, padding: "7px 12px", fontWeight: 600 }}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Filtros
            {/* `aria-hidden`: o nome do botão continua "Filtros"; as pastilhas dizem quais. */}
            {qtdFiltros > 0 && (
              <span
                aria-hidden
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-bold text-accent"
              >
                {qtdFiltros}
              </span>
            )}
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
                  {/* Checkboxes, não <select multiple>: o nativo desfaz a seleção num clique solto. */}
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

              {/* Seção própria: ordenar e "mostrar arquivadas" moram no painel mas não são filtro. */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 4,
                  paddingTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div className="field">
                  <label className="label" htmlFor="f-ordenar">Ordenar</label>
                  <select
                    id="f-ordenar"
                    className="input"
                    value={ordenacao}
                    onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
                  >
                    {ORDENACOES.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <label
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
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
              </div>
            </div>
          )}
        </div>

        {/* Lápis de editar colunas, antes do botão que vai para a direita. Só para quem pode
            (`podeEditarColunas`, calculado pela tela); este ramo já é fora do modo de edição. */}
        {quadroEditavel && podeEditarColunas && (
          <button
            className="btn btn-ghost"
            // Editar colunas só em tela grande.
            onClick={() =>
              faixa === "celular"
                ? avisar("Editar as colunas precisa de uma tela maior. Abra no computador ou no tablet.")
                : abrirEdicao()
            }
            aria-label="Editar colunas"
            title="Editar colunas"
            style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px" }}
          >
            <Pencil size={15} />
          </button>
        )}

        <button
          className="btn btn-primary"
          onClick={() => setCriando(true)}
          // Sem `marginLeft: auto`: o título já empurra os controles para a direita.
          style={{ padding: "8px 14px" }}
        >
          + Nova tarefa
        </button>
      </div>
      )}

      {/* Antes das pastilhas de filtro: a meta do projeto é permanente, o filtro é temporário. */}
      {abaixoDoCabecalho}

      {/* --- Pastilhas de filtro ativo: dizem quais filtros e desfazem num clique, fora do painel. */}
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
              className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-accent-soft pl-2.5 pr-2 text-sm font-bold leading-none text-accent"
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

      {/* Quadro avulso vazio e o modo de edição desenham as colunas, não o estado vazio:
          todo quadro nasce sem tarefa, e editar colunas exige vê-las. */}

      {criandoColuna && rascunho && (
        <FormNovaColuna
          onCriar={(nome, semantica, cor, avisaPrazo) => {
            setRascunho((r) =>
              // `avisaPrazo` e `cor` são opcionais em `comColunaNova`: esquecer não dá erro de tipo.
              r ? comColunaNova(r, nome, semantica, cor, avisaPrazo) : r,
            );
            setCriandoColuna(false);
          }}
          onCancelar={() => setCriandoColuna(false)}
        />
      )}

      {revisando && rascunho && (
        <RevisaoDaEdicao
          marcadas={marcadasParaApagar(rascunho, colunas)}
          // Os destinos incluem colunas `tmp:` criadas neste mesmo lote.
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

      {raizes.length === 0 && !boardId && !modoEdicao ? (
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
          // Um `DndContext` só, com o handler trocado: contextos aninhados brigariam pelo ponteiro.
          onDragEnd={modoEdicao ? onDragEndColuna : onDragEnd}
          // No modo de edição a colisão é por centro: cada coluna tem dois alvos (cabeçalho dentro
          // do corpo). Para card o padrão continua certo.
          collisionDetection={modoEdicao ? closestCenter : undefined}
        >
          {/* Fundo esmaecido do modo de edição: um fundo próprio, e não `opacity` nos cards
              (opacidade derruba o contraste do texto abaixo de AA no tema escuro).
              O `padding` fica aqui fora: dentro do container de altura fixa cortaria a última coluna. */}
          <div
            style={
              modoEdicao
                ? {
                    background: "var(--edicao-fundo)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 10,
                  }
                : undefined
            }
          >
          <div
            ref={colunasRef}
            style={{
              display: "flex", gap: 8, overflowX: "auto", overflowY: "hidden",
              paddingBottom: 8, height: alturaColunas ?? undefined,
            }}
          >
            <SortableContext
              // Ids prefixados: têm de casar com o `useSortable` do cabeçalho.
              items={ordemVisivel.map(idDeArrasteDoCabecalho)}
              strategy={horizontalListSortingStrategy}
              // `disabled` fora do modo, senão o sortable do cabeçalho disputa o arraste de card.
              disabled={!modoEdicao}
            >
              {colunasVisiveis.map((c, i) => (
              <ColunaKanban
                key={c.id}
                ordem={i}
                coluna={c}
                count={(porColuna[c.id] || []).length}
                // Os "+" da coluna abrem o mesmo modal de criar (a coluna não é pré-escolhida).
                onNova={modoEdicao ? undefined : () => setCriando(true)}
                cabecalho={
                  modoEdicao ? (
                    <CabecalhoSortavel
                      // Sem `!`: sem linha de edição a coluna some em vez de derrubar a página.
                      linha={linhasEdicao.find((l) => l.ref === c.id)}
                      cor={c.color}
                      indice={ordemVisivel.indexOf(c.id)}
                      total={ordemVisivel.length}
                      podeApagar={podeApagarColunas}
                      onRenomear={(nome) =>
                        setRascunho((r) => (r ? comRenome(r, c.id, nome) : r))
                      }
                      onMarcar={() =>
                        setRascunho((r) => (r ? comMarcacao(r, c.id) : r))
                      }
                      onTornarAlvo={() =>
                        setRascunho((r) => (r ? comAlvo(r, c.id) : r))
                      }
                      onDesfazerAlvo={() =>
                        setRascunho((r) => (r ? semAlvo(r, c.id) : r))
                      }
                      // O quarto argumento é o valor do servidor: voltar ao original tira a entrada do rascunho.
                      onAvisar={(valor) =>
                        setRascunho((r) =>
                          r ? comAviso(r, c.id, valor, c.notify_deadline) : r,
                        )
                      }
                      onMover={(d) => moverColunaNoRascunho(c.id, d)}
                    />
                  ) : undefined
                }
              >
                {(porColuna[c.id] || []).map((t) => (
                  <CardArrastavel
                    // Travado, não escondido, no modo de edição.
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
          </div>

          {foraDaColuna > 0 && (
            <div className="muted" role="status" style={{ fontSize: 12, marginTop: 8 }}>
              {foraDaColuna} {foraDaColuna === 1 ? "tarefa está" : "tarefas estão"} em
              uma coluna que não é deste quadro e não {foraDaColuna === 1 ? "aparece" : "aparecem"} acima.
            </div>
          )}

          <DragOverlay>
            {/* Card cuja coluna não está na lista não ganha fantasma de arrasto. */}
            {activeTask && colunaPorId.get(activeTask.column_id) ? (
              <div style={{ width: larguraDoArraste ?? 256, cursor: "grabbing" }}>
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
        open={criando || duplicando !== null}
        duplicarDe={duplicando}
        // Buscadas no servidor: com `root_only` as filhas não estão em `tasks`.
        filhosDaOrigem={filhasDaOrigem}
        defaultProjectId={projectId ?? null}
        newTaskTeam={novaTarefa}
        defaultBoardId={boardId ?? null}
        nomeDoQuadro={boardId ? (quadro?.name ?? null) : null}
        onClose={() => {
          setCriando(false);
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // Abre a cópia, não a origem (subtarefa copiada nem vira card).
            setDuplicando(null);
            aoSalvar(t);
            setPilha([]);
            setDetalhe(t);
            // Recarrega: as subtarefas copiadas nasceram no backend e não estão em `tasks`.
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
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsert}
        onTaskMoved={(t) => {
          // A tarefa pode ter saído do quadro (Mover): sem isto o detalhe usaria as colunas do quadro velho.
          setDetalhe((d) => (d && d.id === t.id ? mesclaTarefa(t, d) : d));
          recarregarTasks();
        }}
        onExcluir={aoExcluir}
        mostrarArquivadas={mostrarArquivadas}
        membrosInativos={membrosInativos}
      />

    </div>
  );
}

/** Uma coluna do kanban; o `id` do droppable é o `column_id`. */
/**
 * Cabeçalho editável ligado ao `useSortable` (componente próprio por causa do hook).
 * O arraste não roda em jsdom; as setas usam o mesmo `comOrdem`, que é testado.
 */
function CabecalhoSortavel({
  linha,
  cor,
  indice,
  total,
  onRenomear,
  onMarcar,
  onTornarAlvo,
  onDesfazerAlvo,
  onAvisar,
  onMover,
  podeApagar,
}: {
  /** Pode faltar por um render ao trocar de quadro. */
  linha: LinhaDeEdicao | undefined;
  cor: string;
  indice: number;
  total: number;
  onRenomear: (nome: string) => void;
  onMarcar: () => void;
  /** Ver `podeApagarColunas` no `Board`. */
  podeApagar: boolean;
  onTornarAlvo: () => void;
  onDesfazerAlvo: () => void;
  onAvisar: (valor: boolean) => void;
  onMover: (direcao: "esquerda" | "direita") => void;
}) {
  // O hook vem antes do `return null`: a quantidade de hooks não pode variar entre renders.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    // Id prefixado, não `linha.ref`: o `ColunaKanban` já registra um droppable com `coluna.id`
    // no mesmo contexto, e o mesmo id sobrescreveria o alvo do card (`PREFIXO_ARRASTE_DE_CABECALHO`).
    useSortable({ id: idDeArrasteDoCabecalho(linha?.ref ?? "") });
  if (!linha) return null;
  return (
    <div
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, 0, 0)`
          : undefined,
        transition,
        // Translúcida, não invisível: as vizinhas não pulam para o lugar dela.
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
        podeApagar={podeApagar}
        onTornarAlvo={onTornarAlvo}
        onDesfazerAlvo={onDesfazerAlvo}
        onAvisar={onAvisar}
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
  ordem = 0,
  onNova,
}: {
  coluna: Coluna;
  count: number;
  children: React.ReactNode;
  /** Trocado no modo de edicao. Ausente = o cabecalho normal. */
  cabecalho?: React.ReactNode;
  /** Posicao na fileira: a entrada escalona POR COLUNA, nunca por card. */
  ordem?: number;
  /** Abre o modal de criar (o "+" do cabecalho e o botao do fim). Ausente = sem os dois. */
  onNova?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });
  const entrada = useEntrada(ordem);
  return (
    <motion.div
      ref={setNodeRef}
      {...entrada}
      style={{
        // 292px de largura (card de 278 por dentro) com rolagem horizontal do quadro, de propósito:
        // coluna estreita faz o card quebrar em muitas linhas.
        flex: 1, minWidth: 292, minHeight: 0, borderRadius: 14, padding: 6,
        display: "flex", flexDirection: "column",
        background: isOver ? "var(--surface-2)" : "var(--lane)",
        border: "1px solid var(--border)",
        // O anel na cor da coluna diz para onde o card vai; `outline` não ocupa espaço.
        outline: isOver ? `2px solid ${coluna.color}` : "none",
        outlineOffset: -2,
        transition: "background var(--dur-1) var(--ease-out)",
      }}
    >
      {cabecalho ?? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            padding: "2px 4px", flexShrink: 0,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: coluna.color, flexShrink: 0 }} />
          {/* `minWidth: 0` é o que faz o truncar funcionar no flex; o `title` mantém o nome
              inteiro alcançável. O limite de 60 caracteres do backend não substitui isto. */}
          <span
            title={coluna.name}
            style={{
              // Cabeçalho de coluna: 13px / 600.
              fontWeight: 600, fontSize: 13,
              minWidth: 0, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {coluna.name}
          </span>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{count}</span>
          {onNova && (
            <button
              type="button"
              onClick={onNova}
              aria-label={`Nova tarefa em ${coluna.name}`}
              title="Nova tarefa"
              className="ml-auto inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-ink-faint hover:bg-surface-2 hover:text-ink"
            >
              <Plus size={14} strokeWidth={2.4} aria-hidden />
            </button>
          )}
        </div>
      )}
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 10,
          flex: 1, minHeight: 0, overflowY: "auto",
        }}
      >
        {children}
        {count === 0 && !onNova && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>—</div>
        )}
        {onNova && (
          // "Nova tarefa" sem o "+": o "+ Nova tarefa" é o botão da barra, e o teste busca pelo texto exato.
          <button
            type="button"
            onClick={onNova}
            className="min-h-9 shrink-0 cursor-pointer rounded-md border border-dashed border-border bg-transparent text-sm font-semibold text-ink-faint hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={13} strokeWidth={2.4} aria-hidden className="mr-1 inline" />
            Nova tarefa
          </button>
        )}
      </div>
    </motion.div>
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
    // `disabled` no hook: sem isto o card continua registrado e disputa o arraste de cabeçalho.
    disabled: travado,
  });
  return (
    <div
      ref={setNodeRef}
      // Travado não é escondido: o card continua clicável para abrir a tarefa.
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
      // Sem a elevação de hover no modo de edição (o quadro está esmaecido).
      className={travado ? undefined : "card-elev"}
      style={{
        opacity: isDragging ? 0.4 : task.is_archived ? 0.55 : 1,
        // Nunca `none`, que impediria rolar a coluna com o dedo; o arraste por toque é o toque longo.
        touchAction: "manipulation",
        cursor: travado ? "pointer" : undefined,
        // Enquanto arrasta, sem elevacao: o card ja esta com o ghost do
        // dnd-kit e a sombra dupla ficava suja por cima dele.
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
        coluna={coluna}
        travado={travado}
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
