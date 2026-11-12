"use client";
// Painel de detalhe da tarefa: clicar no card abre isto. Reusa o objeto da
// lista, sem GET /tasks/{id}.

import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  UserPlus,
  X,
  Pencil,
  Plus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Trash2,
  Share2,
  Check,
} from "lucide-react";
import MenuDaTarefa from "@/components/MenuDaTarefa";

import { mesclaTarefa } from "@/lib/mesclaTarefa";
import { todasAsPaginas } from "@/lib/todasAsPaginas";
import { useSaidaAnimada } from "@/lib/useSaidaAnimada";
import { useFecharAoClicarFora } from "@/lib/useCliqueFora";
import {
  addAssignee,
  removeAssignee,
  createSubtask,
  listarFilhas,
  updateTask,
  moveTask,
  archiveTask,
  unarchiveTask,
  deleteTask,
  listComments,
  listTaskHistory,
  colunasDoQuadro,
  listMembers,
  createComment,
  editComment,
  deleteComment,
  setCommentReaction,
  deleteCommentReaction,
  currentUser,
  getTaskLinks,
  putTaskLinks,
  LINKS_MUDARAM,
  ApiError,
  type LinkItem,
  type Task,
  type Comment,
  type CurrentUser,
} from "@/lib/api";
import TituloEditavel from "@/components/TituloEditavel";
import { bloqueioAoTirar, mensagemDeFalhaDoResponsavel } from "@/lib/responsaveis";
import {
  BotaoSeguir,
  LinhaDeSeguidores,
  useSeguidores,
} from "@/components/SeguidoresDaTarefa";
import DescricaoEditavel from "@/components/DescricaoEditavel";
import LinksEditaveis from "@/components/LinksEditaveis";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  STATUSES,
  STATUS_TEXT,
  deadlineTone,
  DEADLINE_COLOR,
  dataHoraBR,
} from "@/lib/status";
import { dataHoraCurta } from "@/lib/prazo";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/GifPicker";
import FileiraDeReacoes from "@/components/FileiraDeReacoes";
import SeletorDeReacao from "@/components/SeletorDeReacao";
import CapsulaDeAcoes, { BOTAO_DA_CAPSULA } from "@/components/CapsulaDeAcoes";
import { acaoDaPilula } from "@/lib/reacoes";
import { isGiphyUrl } from "@/lib/giphy";
import AtividadeDaTarefa from "@/components/AtividadeDaTarefa";
import CommentText from "@/components/CommentText";
import Tabs from "@/components/Tabs";
import MentionTextarea from "@/components/MentionTextarea";
import { nomeCurto } from "@/lib/people";
import { checklist } from "@/lib/subtarefas";
import { deadlineTonePorColuna, type Coluna } from "@/lib/coluna";
import { soltarConfete } from "@/lib/confete";
import type { TaskHistoryEvent } from "@/lib/api";
import {
  acaoDoEnterNoTitulo,
  alternaResponsavel,
  motivoNaoCria,
  podeCriar,
  resumoResponsaveis,
  proximoDaSequencia,
} from "@/lib/criacaoTarefa";

import Loading from "@/components/Loading";
import MoverTarefa from "@/components/MoverTarefa";
import { useAvisar } from "@/components/Toasts";
import { useLadoALado } from "@/lib/useLadoALado";
/** Eventos por pagina na aba de atividade. */
const ATIVIDADE_POR_PAGINA = 20;

// Ordem natural (menor -> maior), explicita para nao depender da ordem do objeto.
const PRIORIDADES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// Rotulo de reserva do badge quando a coluna da tarefa nao esta carregada.
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
// Cor do badge vem de STATUS_TEXT: STATUSES[].color e token de traco e reprova
// AA como texto.
const STATUS_COLOR: Record<string, string> = STATUS_TEXT;

// Gatilho compacto redondo, reusado em responsaveis, projeto e subtarefa.
const GATILHO_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  flexShrink: 0,
  border: "1px dashed var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const quando = dataHoraCurta;

export default function TaskDetail({
  task,
  members,
  projects,
  pai,
  temVoltar,
  onVoltar,
  onClose,
  onDuplicar,
  onAssigneesChange,
  onAbrirSubtarefa,
  onSubtaskUpsert,
  onTaskMoved,
  onExcluir,
  mostrarArquivadas,
  membrosInativos,
  modo = "modal",
  comentarioEmFoco = null,
}: {
  task: Task | null; // tarefa focada; null => fechado
  members: Map<string, { name: string }>;
  projects: Map<string, string>; // id do projeto -> titulo
  pai?: Task | null; // pai DIRETO (topo da pilha), pra rotular "Subtarefa de X"
  temVoltar: boolean;
  onVoltar: () => void;
  onClose: () => void;
  onDuplicar: (task: Task) => void;
  onAssigneesChange: (taskId: string, userIds: string[]) => void;
  onAbrirSubtarefa: (sub: Task) => void;
  onSubtaskUpsert: (sub: Task) => void; // criar OU concluir rapido
  onTaskMoved: (task: Task) => void; // task mudou de projeto/avulsa
  onExcluir: (task: Task, cascadeCount: number) => void; // soft-delete cascateado
  // Espelha "Mostrar arquivadas" da tela de fora: com ela, a subtarefa
  // arquivada aparece apagada na checklist; sem ela, some.
  mostrarArquivadas: boolean;
  // Ids de membro desativado: saem do seletor, mas quem ja esta designado fica
  // (senao nao haveria como tira-lo).
  membrosInativos: Set<string>;
  // "modal" (padrao): overlay com scrim; clique fora e Esc fecham.
  // "pagina": card no fluxo normal, sem scrim nem Esc (rota /tarefa/[id]).
  modo?: "modal" | "pagina";
  // Comentário apontado pela notificação (`?comentario=<id>`): a aba abre nele
  // e o destaca.
  comentarioEmFoco?: string | null;
}) {
  // As filhas sao buscadas aqui. Limpa antes de buscar (senao mostra as da
  // tarefa anterior); falha vira `erroFilhos`, e nao lista vazia.
  const [filhos, setFilhos] = useState<Task[]>([]);
  const [carregandoFilhos, setCarregandoFilhos] = useState(false);
  const [erroFilhos, setErroFilhos] = useState(false);
  const idFocado = task?.id ?? null;

  async function recarregarFilhos() {
    if (!idFocado) return;
    try {
      setErroFilhos(false);
      setFilhos(await listarFilhas(idFocado));
    } catch {
      setErroFilhos(true);
    }
  }

  // Atualiza a checklist local. Nao serve para a propria tarefa focada: a
  // inseriria na lista das filhas dela.
  function upsertFilhaLocal(sub: Task) {
    setFilhos((atual) => {
      const i = atual.findIndex((f) => f.id === sub.id);
      if (i === -1) return [...atual, sub];
      const copia = [...atual];
      // Preserva o que a mutacao nao devolve (ver lib/mesclaTarefa).
      copia[i] = mesclaTarefa(sub, atual[i]);
      return copia;
    });
  }

  useEffect(() => {
    if (!idFocado) {
      setFilhos([]);
      setErroFilhos(false);
      return;
    }
    let cancelado = false;
    setFilhos([]);
    setErroFilhos(false);
    setCarregandoFilhos(true);
    listarFilhas(idFocado)
      .then((f) => {
        if (!cancelado) setFilhos(f);
      })
      .catch(() => {
        if (!cancelado) setErroFilhos(true);
      })
      .finally(() => {
        if (!cancelado) setCarregandoFilhos(false);
      });
    return () => {
      cancelado = true;
    };
  }, [idFocado]);

  const [assignees, setAssignees] = useState<string[]>([]);
  const [abertoResp, setAbertoResp] = useState(false);
  const [busca, setBusca] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const avisar = useAvisar();
  // Onde moram as acoes do topo (`acoes`, logo antes do `return`).
  const ladoALado = useLadoALado();

  // Projeto: eco local do project_id, aplicado so no sucesso do move.
  const [projetoAtual, setProjetoAtual] = useState<string | null>(null);
  const [abertoProj, setAbertoProj] = useState(false);
  const [movendoProj, setMovendoProj] = useState(false);
  const [erroProj, setErroProj] = useState<string | null>(null);

  // Datas: eco local, para a linha mostrar o valor novo sem esperar o pai.
  const [inicioAtual, setInicioAtual] = useState<string | null>(null);
  const [prazoAtual, setPrazoAtual] = useState<string | null>(null);
  // `null` = vence no dia. Apagar a hora nao apaga a data.
  const [horaAtual, setHoraAtual] = useState<string | null>(null);
  const [abertoDatas, setAbertoDatas] = useState(false);
  const [abertoPrio, setAbertoPrio] = useState(false);
  const [salvandoPrio, setSalvandoPrio] = useState(false);
  const [abertoCol, setAbertoCol] = useState(false);
  const [salvandoCol, setSalvandoCol] = useState(false);
  const [salvandoDatas, setSalvandoDatas] = useState(false);
  const [erroDatas, setErroDatas] = useState<string | null>(null);
  // Rascunho do painel de datas: so vira eco no sucesso (o backend pode
  // recusar com 422).
  const [rascunhoInicio, setRascunhoInicio] = useState("");
  const [rascunhoPrazo, setRascunhoPrazo] = useState("");
  const [rascunhoHora, setRascunhoHora] = useState("");

  const [criandoSub, setCriandoSub] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  // Criacao rapida de subtarefa: responsavel obrigatorio, prazo opcional.
  const [subAssignees, setSubAssignees] = useState<string[]>([]);
  const [subPrazo, setSubPrazo] = useState("");
  const [subPickerAberto, setSubPickerAberto] = useState(false);
  const [subBusca, setSubBusca] = useState("");
  const subTituloRef = useRef<HTMLInputElement>(null);
  const [salvandoSub, setSalvandoSub] = useState(false);
  const [erroSub, setErroSub] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState<Set<string>>(new Set());
  // Colunas do quadro da tarefa (a checklist decide pela coluna). `null` =
  // ainda chegando.
  const [colunas, setColunas] = useState<Coluna[] | null>(null);
  const [arquivando, setArquivando] = useState(false);
  // Feedback do botao "Copiar link" (volta pro texto normal sozinho).
  const [copiado, setCopiado] = useState(false);
  // Estado proprio para a mensagem aparecer junto do botao, no rodape.
  const [copiaErro, setCopiaErro] = useState<string | null>(null);
  // Exclusao (soft-delete cascateado). Confirmacao inline mostra o estrago.
  const [confirmandoExcluir, setConfirmandoExcluir] = useState(false);
  // Modal "Mover…".
  const [movendoTarefa, setMovendoTarefa] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // ---- Comentarios ----
  const [comentarios, setComentarios] = useState<Comment[] | null>(null);
  const [erroCom, setErroCom] = useState<string | null>(null);
  const [novoComent, setNovoComent] = useState("");
  const [enviandoComent, setEnviandoComent] = useState(false);
  const [respondendoId, setRespondendoId] = useState<string | null>(null);
  const [textoResposta, setTextoResposta] = useState("");
  // Threads com as respostas recolhidas (padrao: abertas).
  const [respostasRecolhidas, setRespostasRecolhidas] = useState<Set<string>>(new Set());
  const [comentarioDestacado, setComentarioDestacado] = useState<string | null>(null);
  const focoConsumido = useRef<string | null>(null);
  // A aba escolhida dura a sessao; nao volta ao padrao a cada tarefa.
  const [abaLateral, setAbaLateral] = useState<"comentarios" | "atividade">(
    "comentarios",
  );

  // ---- Atividade ----
  // A primeira pagina vem ao abrir: o contador da aba precisa do `total`.
  const [atividade, setAtividade] = useState<TaskHistoryEvent[]>([]);
  const [totalAtividade, setTotalAtividade] = useState(0);
  const [paginaAtividade, setPaginaAtividade] = useState(1);
  const [carregandoAtividade, setCarregandoAtividade] = useState(false);
  const [erroAtividade, setErroAtividade] = useState<string | null>(null);
  const [erroMaisAtividade, setErroMaisAtividade] = useState<string | null>(null);

  // Links da tarefa. `null` = ainda não sei (e não "sem links"): sem a lista
  // salva não há edição, senão salvar apagaria os existentes.
  const [links, setLinks] = useState<LinkItem[] | null>(null);
  const [falhouLinks, setFalhouLinks] = useState(false);
  const [tentativaLinks, setTentativaLinks] = useState(0);
  const idDaTarefa = task?.id ?? null;
  // A tarefa na tela agora: `salvarLinks` confere depois do `await`.
  const idNaTela = useRef<string | null>(idDaTarefa);
  idNaTela.current = idDaTarefa;
  useEffect(() => {
    setLinks(null);
    setFalhouLinks(false);
    if (!idDaTarefa) return;
    let vivo = true;
    const buscar = () =>
      getTaskLinks(idDaTarefa)
        .then((l) => {
          if (!vivo) return;
          setLinks(l);
          setFalhouLinks(false);
        })
        .catch(() => vivo && setFalhouLinks(true));
    void buscar();
    // Salvar links no MODAL não muda a tarefa (nem o `updated_at`): quem avisa
    // é o evento, e só para ESTA tarefa.
    const aoMudar = (e: Event) => {
      const d = (e as CustomEvent<{ dono: string; id: string }>).detail;
      if (d?.dono === "task" && d.id === idDaTarefa) void buscar();
    };
    window.addEventListener(LINKS_MUDARAM, aoMudar);
    return () => {
      vivo = false;
      window.removeEventListener(LINKS_MUDARAM, aoMudar);
    };
  }, [idDaTarefa, tentativaLinks]);

  // Título e descrição salvos no lugar: guardados aqui porque nem todo
  // chamador aplica `onSubtaskUpsert` no `task`. Zera quando a `task` muda.
  const [salvoNoLugar, setSalvoNoLugar] = useState<{
    id: string;
    title?: string;
    description?: string;
  } | null>(null);
  useEffect(() => {
    setSalvoNoLugar(null);
  }, [task]);

  // GIFs escolhidos no rascunho (viram token [gif:URL] so no envio). Ficam como
  // chip de preview abaixo do campo -- o textarea nao mostra o link.
  const [gifsNovo, setGifsNovo] = useState<string[]>([]);
  const [gifsResp, setGifsResp] = useState<string[]>([]);
  const [enviandoResp, setEnviandoResp] = useState(false);
  const topComentRef = useRef<HTMLTextAreaElement>(null);
  const respostaRef = useRef<HTMLTextAreaElement>(null);

  // Insere um trecho (emoji) na posicao do cursor do textarea e mantem foco.
  function inserirNoCursor(
    ref: { current: HTMLTextAreaElement | null },
    valor: string,
    setValor: (s: string) => void,
    trecho: string
  ) {
    const el = ref.current;
    if (!el) {
      setValor(valor + trecho);
      return;
    }
    const ini = el.selectionStart ?? valor.length;
    const fim = el.selectionEnd ?? valor.length;
    setValor(valor.slice(0, ini) + trecho + valor.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      const pos = ini + trecho.length;
      el.setSelectionRange(pos, pos);
    });
  }
  // Usuario logado: define quem ve lapis (autor) e lixeira (autor ou
  // task.delete). Buscado uma vez (currentUser e memoizado no api.ts).
  const [me, setMe] = useState<CurrentUser | null>(null);

  // Reset sempre que abre / troca / navega de tarefa.
  useEffect(() => {
    setAssignees(task?.assignee_ids ?? []);
    setAbertoResp(false);
    setBusca("");
    setSaving(new Set());
    setProjetoAtual(task?.project_id ?? null);
    setAbertoProj(false);
    setMovendoProj(false);
    setErroProj(null);
    setInicioAtual(task?.start_date ?? null);
    setPrazoAtual(task?.due_date ?? null);
    setHoraAtual(task?.due_time ?? null);
    setAbertoDatas(false);
    setSalvandoDatas(false);
    setErroDatas(null);
    setCriandoSub(false);
    setNovoTitulo("");
    setErroSub(null);
    setSubSaving(new Set());
    setArquivando(false);
    setConfirmandoExcluir(false);
    setExcluindo(false);
    setComentarios(null);
    setErroCom(null);
    setNovoComent("");
    setEnviandoComent(false);
    setRespondendoId(null);
    setTextoResposta("");
    setEnviandoResp(false);
    setGifsNovo([]);
    setGifsResp([]);
    setRespostasRecolhidas(new Set());
    setComentarioDestacado(null);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao trocar/fechar a resposta, zera os GIFs de rascunho da resposta.
  useEffect(() => {
    setGifsResp([]);
  }, [respondendoId]);

  // Saida animada: a maquina de estados vive em `lib/useSaidaAnimada.ts`.
  const { saindo, fecharSuave } = useSaidaAnimada({
    idAtual: task?.id ?? null,
    animar: modo === "modal", // modo pagina nao tem scrim nem animacao
    onFechar: onClose,
  });

  // Clicar no scrim fecha; ARRASTAR de dentro pra fora nao (ver o modulo).
  const scrimProps = useFecharAoClicarFora(fecharSuave);

  useEffect(() => {
    // Esc so fecha no modo modal.
    if (!task || modo !== "modal") return;
    function onKey(e: KeyboardEvent) {
      // `defaultPrevented`: um elemento de dentro (lista de @menção, menu,
      // campo de subtarefa) já usou este Esc.
      if (e.key === "Escape" && !e.defaultPrevented) fecharSuave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, fecharSuave, modo]);

  // Paineis ancorados: fecham ao clicar fora.
  const painelResp = useAnchoredPanel<HTMLButtonElement>(abertoResp, () => setAbertoResp(false), {
    larguraPainel: 300,
  });

  const painelProj = useAnchoredPanel<HTMLButtonElement>(abertoProj, () => setAbertoProj(false), {
    larguraPainel: 280,
  });

  // Fechar o painel de datas descarta o rascunho: clicar fora e o cancelar.
  const painelDatas = useAnchoredPanel<HTMLButtonElement>(abertoDatas, () => setAbertoDatas(false), {
    larguraPainel: 240,
  });

  const painelPrio = useAnchoredPanel<HTMLButtonElement>(abertoPrio, () => setAbertoPrio(false), {
    larguraPainel: 150,
  });

  const painelCol = useAnchoredPanel<HTMLButtonElement>(abertoCol, () => setAbertoCol(false), {
    larguraPainel: 190,
  });

  // Usuario logado: uma vez (memoizado). Falha silenciosa -> sem acoes
  // inline, mas o thread ainda renderiza.
  useEffect(() => {
    currentUser()
      .then(setMe)
      .catch(() => {});
  }, []);

  // Carrega o thread ao abrir/trocar de tarefa -- inteiro, sem UI de
  // paginacao (ver `todasAsPaginas`).
  useEffect(() => {
    if (!task) return;
    let vivo = true;
    setComentarios(null);
    setErroCom(null);
    todasAsPaginas((page, size) => listComments(task.id, { page, size }))
      .then((itens) => {
        if (vivo) setComentarios(itens);
      })
      .catch((e: ApiError) => {
        if (vivo) setErroCom(e.message || "Não consegui carregar os comentários.");
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Veio de notificação: abre a aba, desdobra a thread e destaca o comentário.
  // Uma vez por (tarefa, comentário): sem a marca, todo comentário novo
  // roubaria a rolagem de volta para o antigo.
  useEffect(() => {
    if (!task || !comentarioEmFoco || !comentarios) return;
    const chave = `${task.id}:${comentarioEmFoco}`;
    if (focoConsumido.current === chave) return;
    const alvo = comentarios.find((c) => c.id === comentarioEmFoco);
    if (!alvo) return; // apagado de vez, ou além dos 100 carregados
    focoConsumido.current = chave;
    setAbaLateral("comentarios");
    const raiz = alvo.parent_comment_id ?? alvo.id;
    setRespostasRecolhidas((s) => {
      if (!s.has(raiz)) return s;
      const n = new Set(s);
      n.delete(raiz);
      return n;
    });
    setComentarioDestacado(alvo.id);
  }, [task?.id, comentarioEmFoco, comentarios]); // eslint-disable-line react-hooks/exhaustive-deps

  // Depois do render que pôs a marca: rola até ela e a tira em 2,5 s. A
  // animação mora no `globals.css` (`.comentario-destaque`).
  useEffect(() => {
    if (!comentarioDestacado) return;
    const el = document.querySelector(`[data-comment-id="${comentarioDestacado}"]`);
    const semMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // `?.`: o jsdom nao implementa scrollIntoView.
    el?.scrollIntoView?.({ block: "center", behavior: semMovimento ? "auto" : "smooth" });
    const t = window.setTimeout(() => setComentarioDestacado(null), 2500);
    return () => window.clearTimeout(t);
  }, [comentarioDestacado]);

  function alternarRespostas(id: string) {
    setRespostasRecolhidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Atividade, primeira pagina. Toda resposta confere `atividadeDe` (pode ter
  // trocado de tarefa no meio).
  const atividadeDe = useRef<string | null>(null);
  const recarregarAtividade = useCallback(
    async (limpar: boolean) => {
      if (!task) return;
      const id = task.id;
      atividadeDe.current = id;
      if (limpar) {
        setAtividade([]);
        setTotalAtividade(0);
        setErroAtividade(null);
        setCarregandoAtividade(true);
      }
      setErroMaisAtividade(null);
      try {
        const r = await listTaskHistory(id, { page: 1, size: ATIVIDADE_POR_PAGINA });
        if (atividadeDe.current !== id) return;
        setAtividade(r.items);
        setTotalAtividade(r.total);
        setPaginaAtividade(1);
        setErroAtividade(null);
      } catch {
        // Falha aqui nao derruba o detalhe.
        if (atividadeDe.current === id && limpar) {
          setErroAtividade("Não consegui carregar a atividade.");
        }
      } finally {
        if (atividadeDe.current === id && limpar) setCarregandoAtividade(false);
      }
    },
    [task?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    void recarregarAtividade(true);
    return () => {
      atividadeDe.current = null;
    };
  }, [recarregarAtividade]);
  // So a MESMA tarefa: a troca de tarefa ja recarrega (e limpa) acima.
  const ultimaDaAba = useRef<string | null>(null);
  useEffect(() => {
    const mesma = ultimaDaAba.current === task?.id;
    ultimaDaAba.current = task?.id ?? null;
    if (mesma && abaLateral === "atividade") void recarregarAtividade(false);
  }, [abaLateral, task?.id, task?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  async function carregarMaisAtividade() {
    if (!task || carregandoAtividade) return;
    const id = task.id;
    const proxima = paginaAtividade + 1;
    setCarregandoAtividade(true);
    setErroMaisAtividade(null);
    try {
      const r = await listTaskHistory(id, {
        page: proxima,
        size: ATIVIDADE_POR_PAGINA,
      });
      if (atividadeDe.current !== id) return;
      // `total` regravado a cada pagina; eventos repetidos (a lista anda) saem
      // pelo id.
      setAtividade((atual) => {
        const ja = new Set(atual.map((e) => e.id));
        return [...atual, ...r.items.filter((e) => !ja.has(e.id))];
      });
      setTotalAtividade(r.total);
      setPaginaAtividade(proxima);
    } catch {
      if (atividadeDe.current === id) {
        setErroMaisAtividade("Não consegui carregar o resto da atividade.");
      }
    } finally {
      if (atividadeDe.current === id) setCarregandoAtividade(false);
    }
  }

  // Colunas do quadro da tarefa focada. Em erro fica `[]` e nao `null`, senao
  // o contador da checklist nunca aparece quando a API de quadros cai.
  useEffect(() => {
    if (!task) return;
    let vivo = true;
    setColunas(null);
    colunasDoQuadro(task.board_id)
      .then((c) => {
        if (vivo) setColunas(c);
      })
      .catch(() => {
        if (vivo) setColunas([]);
      });
    return () => {
      vivo = false;
    };
  }, [task?.board_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fecha o picker de responsavel da subtarefa ao clicar fora.
  const painelSub = useAnchoredPanel<HTMLButtonElement>(subPickerAberto, () => setSubPickerAberto(false), {
    larguraPainel: 260,
  });

  // Quem alcanca esta tarefa vem do backend (mesma regra do POST de
  // designacao). `null` = ainda carregando (ou a chamada falhou).
  const [alcancamAqui, setAlcancamAqui] = useState<Set<string> | null>(null);

  useEffect(() => {
    const id = task?.id;
    if (!id) {
      setAlcancamAqui(null);
      return;
    }
    let vivo = true;
    setAlcancamAqui(null);
    listMembers(id)
      .then((ms) => {
        // Guarda contra resposta da tarefa anterior.
        if (vivo) setAlcancamAqui(new Set(ms.map((m) => m.id)));
      })
      .catch(() => {
        // Falha: segue `null` e nao esconde ninguem (o backend ainda recusa).
        if (vivo) setAlcancamAqui(null);
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]);

  // Quem segue: um estado para o botao do topo e a linha "Seguidores".
  const seguidores = useSeguidores(task?.id ?? null, avisar);

  // Quem NAO alcanca. Vazio enquanto a lista nao chegou (ver acima).
  const foraDoEscopoAqui = useMemo(() => {
    const fora = new Set<string>();
    if (alcancamAqui === null) return fora;
    for (const id of members.keys()) {
      if (!alcancamAqui.has(id)) fora.add(id);
    }
    return fora;
  }, [alcancamAqui, members]);

  // Fora do autocompletar de @: desativados e quem nao alcanca a tarefa (sem
  // a excecao do "ja designado").
  const foraDoAutocompletar = useMemo(
    () => new Set<string>([...membrosInativos, ...foraDoEscopoAqui]),
    [membrosInativos, foraDoEscopoAqui]
  );

  // Picker da subtarefa: busca separada da do picker da tarefa mae.
  const membrosParaSub = useMemo(() => {
    const q = subBusca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name }))
      // Subtarefa nasce sem ninguem -> inativo nunca e opcao aqui. Fora do
      // escopo tambem nao: a subtarefa herda o time da mae.
      .filter((e) => !membrosInativos.has(e.id) && !foraDoEscopoAqui.has(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, subBusca, membrosInativos, foraDoEscopoAqui]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name, inativo: membrosInativos.has(id) }))
      // Inativo sai, MENOS quem ja esta designado -- ver `membrosInativos`.
      .filter((e) => !e.inativo || assignees.includes(e.id))
      // Fora do escopo sai pela mesma excecao.
      .filter((e) => !foraDoEscopoAqui.has(e.id) || assignees.includes(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, busca, membrosInativos, assignees, foraDoEscopoAqui]);

  if (!task) return null;
  const tid = task.id;
  const tidProjeto = task.project_id ?? null; // pai e subtarefa no mesmo projeto
  // Subtarefa herda o projeto do pai (read-only).
  const ehTopo = !task.parent_task_id;

  // Ids do historico viram nome com o que a tela ja tem; sem nome, frase
  // generica, nunca uuid.
  const nomesDoHistorico = {
    pessoa: (id: string) => members.get(id)?.name ?? null,
    coluna: (id: string) => colunas?.find((c) => c.id === id)?.name ?? null,
  };
  const nomeProjetoAtual = projetoAtual ? projects.get(projetoAtual) ?? null : null;
  // Sobre o eco, e nao `task.due_date`, que fica velho por um instante apos
  // salvar.
  const dueTone = deadlineTone(prazoAtual, task.status, task.is_archived, horaAtual);
  // Arquivada nao conta na checklist (aparece apagada so com
  // `mostrarArquivadas`). Linhas e conta saem da mesma chamada, senao divergem.
  // Sem colunas a conta da 0; o render espera `colunas`.
  const colunaPorId = new Map((colunas ?? []).map((c) => [c.id, c]));
  const {
    linhas: linhasSub,
    concluidas,
    total: totalSub,
    pct: pctSub,
  } = checklist(filhos, mostrarArquivadas, colunaPorId);
  // Criacao: created_at e ISO com fuso (nao date-only) -> new Date direto ja
  // resolve pro fuso local. Nome do criador via members; se nao resolver
  // (ex.: usuario desativado / fora da lista), mostra so a data (nunca o UUID).
  const criadoEm = new Date(task.created_at).toLocaleDateString("pt-BR");
  const criador = members.get(task.created_by)?.name ?? null;

  async function toggle(userId: string) {
    const jaEra = assignees.includes(userId);
    // Tirar o ultimo responsavel o servidor recusaria: avisa antes.
    const bloqueio = jaEra ? bloqueioAoTirar(assignees, userId) : null;
    if (bloqueio) {
      avisar(bloqueio);
      return;
    }
    const anterior = assignees;
    const otimista = jaEra
      ? assignees.filter((x) => x !== userId)
      : [...assignees, userId];

    setAssignees(otimista);
    onAssigneesChange(tid, otimista);
    setSaving((s) => new Set(s).add(userId));

    try {
      const ids = jaEra
        ? await removeAssignee(tid, userId)
        : await addAssignee(tid, userId);
      setAssignees(ids);
      onAssigneesChange(tid, ids);
    } catch (e) {
      setAssignees(anterior);
      onAssigneesChange(tid, anterior);
      avisar(mensagemDeFalhaDoResponsavel(e as ApiError));
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(userId);
        return n;
      });
    }
  }

  function abrirDatas() {
    // O rascunho nasce do eco: o `task` do pai pode ainda ser o antigo.
    setRascunhoInicio(inicioAtual ?? "");
    setRascunhoPrazo(prazoAtual ?? "");
    // `<input type="time">` com `HH:MM:SS` fica vazio; o backend devolve segundos.
    setRascunhoHora((horaAtual ?? "").slice(0, 5));
    setErroDatas(null);
    setAbertoDatas(true);
  }

  async function salvarDatas() {
    if (salvandoDatas) return;
    // `""` vira `null`: `null` apaga a data, `""` volta 422.
    const inicio = rascunhoInicio || null;
    const prazo = rascunhoPrazo || null;
    // Hora sem data o backend recusa (422): limpar a data limpa a hora.
    const hora = prazo ? rascunhoHora || null : null;
    // Nada mudou: nao grava historico a toa.
    if (
      inicio === (inicioAtual ?? null) &&
      prazo === (prazoAtual ?? null) &&
      hora === ((horaAtual ?? null) && (horaAtual as string).slice(0, 5))
    ) {
      setAbertoDatas(false);
      return;
    }
    setErroDatas(null);
    setSalvandoDatas(true);
    try {
      // Manda os dois sempre: o backend valida `start_date <= due_date` sobre o
      // estado final da tarefa.
      const t = await updateTask(tid, {
        start_date: inicio,
        due_date: prazo,
        due_time: hora,
      });
      setInicioAtual(t.start_date ?? null);
      setPrazoAtual(t.due_date ?? null);
      setHoraAtual(t.due_time ?? null);
      setAbertoDatas(false);
      // O pai precisa saber: prazo muda a cor do card e o filtro "Atrasadas".
      onTaskMoved(t);
    } catch (e) {
      const err = e as ApiError;
      // No 422 a mensagem do backend diz o que consertar.
      setErroDatas(
        err.status === 422
          ? err.message || "Datas inválidas."
          : err.status === 403
          ? "Você não pode editar esta tarefa."
          : "Não consegui salvar as datas. Tente de novo."
      );
    } finally {
      setSalvandoDatas(false);
    }
  }

  /**
   * Grava título ou descrição editados no lugar. Lança com a mensagem pronta:
   * o campo reabre com o texto da pessoa e a mostra embaixo.
   */
  async function salvarNoLugar(campo: { title: string } | { description: string }) {
    if (!task) return;
    const alvo = task.id;
    try {
      const t = await updateTask(alvo, campo);
      setSalvoNoLugar((prev) => ({
        ...(prev?.id === alvo ? prev : {}),
        id: alvo,
        title: t.title,
        description: t.description ?? "",
      }));
      onSubtaskUpsert(t);
    } catch (e) {
      const err = e as ApiError;
      throw new Error(
        err.status === 403
          ? "Você não pode editar esta tarefa."
          : err.status === 422
          ? err.message || "O servidor recusou o texto."
          : "Não consegui salvar. Tente de novo."
      );
    }
  }

  async function salvarLinks(novos: { title: string; url: string }[]) {
    if (!task) return;
    const alvo = task.id;
    try {
      const salvos = await putTaskLinks(alvo, novos);
      if (idNaTela.current === alvo) setLinks(salvos);
    } catch (e) {
      const err = e as ApiError;
      throw new Error(
        err.status === 403
          ? "Você não pode editar esta tarefa."
          : err.status === 422
          ? err.message || "Confira os links."
          : "Não consegui salvar os links. Tente de novo."
      );
    }
  }

  /**
   * Troca a prioridade pela pilula, sem otimismo. `onSubtaskUpsert` (e nao
   * `onTaskMoved`, que recarrega o quadro): prioridade so muda o que o card mostra.
   */
  async function mudarPrioridade(destino: string) {
    if (!task || salvandoPrio) return;
    if (task.priority === destino) {
      setAbertoPrio(false);
      return;
    }
    setSalvandoPrio(true);
    try {
      const t = await updateTask(tid, { priority: destino });
      setAbertoPrio(false);
      onSubtaskUpsert(t);
    } catch (e) {
      const err = e as ApiError;
      avisar(
        err.status === 403
          ? "Você não pode editar esta tarefa."
          : "Não consegui mudar a prioridade."
      );
    } finally {
      setSalvandoPrio(false);
    }
  }

  /**
   * Troca a coluna pela pilula. Manda so `column_id` (com `status` junto e
   * 422); o status certo vem na resposta. Ir para coluna `DONE` conclui a
   * subarvore no backend, entao as filhas desta checklist sao relidas.
   */
  async function mudarColuna(destino: string) {
    if (!task || salvandoCol) return;
    if (task.column_id === destino) {
      setAbertoCol(false);
      return;
    }
    setSalvandoCol(true);
    const viraConcluida =
      colunaPorId.get(destino)?.semantic === "DONE" &&
      colunaPorId.get(task.column_id)?.semantic !== "DONE";
    try {
      const t = await updateTask(tid, { column_id: destino });
      setAbertoCol(false);
      onSubtaskUpsert(t);
      if (viraConcluida) soltarConfete(painelCol.anchorRef.current);
      if (viraConcluida && filhos.length > 0) void recarregarFilhos();
    } catch (e) {
      const err = e as ApiError;
      avisar(
        err.status === 403
          ? "Você não pode editar esta tarefa."
          : err.status === 422
          ? "Não foi possível mover pra essa coluna."
          : "Não consegui mudar a coluna."
      );
    } finally {
      setSalvandoCol(false);
    }
  }

  // Move para outro projeto (ou tira, com `null`). Nao otimista: o move pode
  // ser recusado, entao so aplica no sucesso.
  async function mudarProjeto(destino: string | null) {
    if (movendoProj) return;
    // No-op: ja esta no destino.
    if ((projetoAtual ?? null) === destino) {
      setAbertoProj(false);
      return;
    }
    setErroProj(null);
    setMovendoProj(true);
    try {
      const t = await moveTask(
        tid,
        destino === null ? { detach_project: true } : { project_id: destino }
      );
      setProjetoAtual(t.project_id ?? null); // eco local
      setAbertoProj(false);
      onTaskMoved(t); // pai reagrupa/refetcha (Board) ou faz upsert (minhas)
    } catch (e) {
      const err = e as ApiError;
      setErroProj(
        err.status === 403
          ? "Você não pode mover esta tarefa."
          : err.status === 422
          ? "Não foi possível mover pra esse projeto."
          : err.status === 404
          ? "Projeto não encontrado ou sem acesso."
          : "Não consegui mover a tarefa de projeto."
      );
    } finally {
      setMovendoProj(false);
    }
  }

  function fecharCriacaoSub() {
    setCriandoSub(false);
    setNovoTitulo("");
    setSubAssignees([]);
    setSubPrazo("");
    setSubPickerAberto(false);
    setSubBusca("");
    setErroSub(null);
  }

  async function criarSub() {
    const rascunho = { titulo: novoTitulo, assigneeIds: subAssignees, dueDate: subPrazo };
    const impedimento = motivoNaoCria(rascunho);
    if (impedimento) {
      // Trava de UI: o backend aceita subtarefa sem responsavel (n8n, triagem).
      setErroSub(impedimento);
      return;
    }
    setSalvandoSub(true);
    setErroSub(null);
    try {
      const nova = await createSubtask(tid, novoTitulo.trim(), tidProjeto, {
        assigneeIds: subAssignees,
        dueDate: subPrazo || null,
      });
      upsertFilhaLocal(nova);
      onSubtaskUpsert(nova);
      // Fica aberto para a proxima: responsavel e prazo ficam, o titulo limpa.
      const proximo = proximoDaSequencia({
        titulo: novoTitulo,
        assigneeIds: subAssignees,
        dueDate: subPrazo,
      });
      setNovoTitulo(proximo.titulo);
      setSubAssignees(proximo.assigneeIds);
      setSubPrazo(proximo.dueDate);
      setSubBusca("");
      subTituloRef.current?.focus();
    } catch (e) {
      setErroSub((e as ApiError).message || "Não consegui criar a subtarefa.");
    } finally {
      setSalvandoSub(false);
    }
  }

  /**
   * A caixinha da subtarefa: marcar move para a coluna de conclusao; desmarcar
   * sempre manda para a coluna aberta padrao. O status vem da resposta.
   */
  async function alternarConclusao(f: Task, caixa?: HTMLElement | null) {
    if (!colunas) return; // colunas ainda chegando: a caixa nem esta desenhada
    const concluida = colunaPorId.get(f.column_id)?.semantic === "DONE";

    // `is_default_target` primeiro: com duas colunas da mesma semantica, a
    // primeira da lista seria arbitraria.
    const alvo = (semantic: Coluna["semantic"]) =>
      colunas.find((c) => c.semantic === semantic && c.is_default_target) ??
      colunas.find((c) => c.semantic === semantic);

    const destino = concluida ? alvo("OPEN")?.id : alvo("DONE")?.id;

    // Quadro sem coluna de conclusao: erro visivel em vez de caixa que nao faz nada.
    if (!destino) {
      setErroSub(
        concluida
          ? "Este quadro não tem coluna aberta para onde devolver a subtarefa."
          : "Este quadro não tem coluna de conclusão."
      );
      return;
    }

    setErroSub(null);
    setSubSaving((s) => new Set(s).add(f.id));
    // Otimista na coluna e no status, para os dois nao discordarem. A coluna
    // aberta padrao devolve `BACKLOG`.
    const otimista = {
      ...f,
      column_id: destino,
      status: concluida ? ("BACKLOG" as const) : ("COMPLETED" as const),
    };
    upsertFilhaLocal(otimista);
    onSubtaskUpsert(otimista);
    try {
      const atualizada = await updateTask(f.id, { column_id: destino });
      upsertFilhaLocal(atualizada);
      onSubtaskUpsert(atualizada);
      // Reabrir não solta confete.
      if (!concluida) soltarConfete(caixa);
    } catch (e) {
      upsertFilhaLocal(f); // revert
      onSubtaskUpsert(f); // revert
      setErroSub("Não consegui atualizar a subtarefa.");
    } finally {
      setSubSaving((s) => {
        const n = new Set(s);
        n.delete(f.id);
        return n;
      });
    }
  }

  // Copia o link canonico (/tarefa/<id>). Fora de contexto seguro (IP na rede
  // local) cai no execCommand; se os dois falharem, mostra a URL para copiar.
  async function copiarLink() {
    if (!task) return;
    const url = `${window.location.origin}/tarefa/${task.id}`;
    let ok = false;
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiaErro(null);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } else {
      setCopiaErro(url);
    }
  }

  async function alternarArquivo() {
    setArquivando(true);
    try {
      const desarquivando = task!.is_archived;
      const r = desarquivando ? await unarchiveTask(tid) : await archiveTask(tid);
      onSubtaskUpsert(r); // upsert generico: o quadro reflete is_archived
      // Cascata: as filhas mudaram no banco e nenhuma veio na resposta, entao o
      // chamador e a checklist local precisam reler.
      if (r.cascade_count > 0) {
        onTaskMoved(r);
        void recarregarFilhos();
        // Avisa: a operacao mexeu em tarefas que a pessoa nao citou.
        const n = r.cascade_count;
        const plural = n === 1 ? "subtarefa foi" : "subtarefas foram";
        avisar(
          desarquivando
            ? `${n} ${plural} desarquivada${n === 1 ? "" : "s"} junto.`
            : `${n} ${plural} arquivada${n === 1 ? "" : "s"} junto.`
        );
      }
    } catch (e) {
      const a = e as ApiError;
      avisar(
        a.status === 403
          ? "Você não pode arquivar esta tarefa."
          : // No 422 a mensagem nomeia o pai arquivado.
            a.message || "Não consegui arquivar a tarefa."
      );
    } finally {
      setArquivando(false);
    }
  }

  async function excluir() {
    setExcluindo(true);
    try {
      const r = await deleteTask(tid);
      onExcluir(task!, r.cascade_count); // quadro remove a subtree e fecha
    } catch (e) {
      avisar(
        (e as ApiError).status === 403
          ? "Você não pode excluir esta tarefa."
          : "Não consegui excluir a tarefa."
      );
      setExcluindo(false);
    }
  }

  // Junta o texto digitado com os GIFs do rascunho: cada GIF vira um token
  // [gif:URL] no fim. So aceita URL de dominio GIPHY (defesa a mais).
  function montarConteudo(texto: string, gifs: string[]): string {
    const t = texto.trim();
    const tokens = gifs
      .filter(isGiphyUrl)
      .map((u) => `[gif:${u}]`)
      .join(" ");
    return [t, tokens].filter(Boolean).join("\n");
  }

  async function enviarComentario() {
    const conteudo = montarConteudo(novoComent, gifsNovo);
    if (!conteudo) return;
    setEnviandoComent(true);
    setErroCom(null);
    try {
      const novo = await createComment(tid, conteudo);
      setComentarios((prev) => [...(prev ?? []), novo]);
      setNovoComent("");
      setGifsNovo([]);
    } catch (e) {
      setErroCom((e as ApiError).message || "Não consegui comentar.");
    } finally {
      setEnviandoComent(false);
    }
  }

  async function enviarResposta(parentId: string) {
    const conteudo = montarConteudo(textoResposta, gifsResp);
    if (!conteudo) return;
    setEnviandoResp(true);
    setErroCom(null);
    try {
      const novo = await createComment(tid, conteudo, parentId);
      setComentarios((prev) => [...(prev ?? []), novo]);
      setTextoResposta("");
      setGifsResp([]);
      setRespondendoId(null);
    } catch (e) {
      setErroCom((e as ApiError).message || "Não consegui responder.");
    } finally {
      setEnviandoResp(false);
    }
  }

  // Edicao devolve o comentario atualizado -> troca em memoria.
  function aoEditado(atualizado: Comment) {
    setComentarios((prev) =>
      prev ? prev.map((c) => (c.id === atualizado.id ? atualizado : c)) : prev
    );
  }

  // Apagar decide entre sumir e tombstone no backend: so recarrega o thread.
  async function recarregarComentarios() {
    try {
      setComentarios(await todasAsPaginas((page, size) => listComments(tid, { page, size })));
    } catch (e) {
      setErroCom((e as ApiError).message || "Não consegui recarregar os comentários.");
    }
  }

  // Acoes do topo (Seguir, compartilhar, "⋯", fechar). Lado a lado ficam no
  // topo da lateral; empilhado, no cabecalho. Uma copia so no DOM.
  const acoes = (
    <span className="flex shrink-0 items-center gap-1 max-[899px]:ml-auto">
      <BotaoSeguir
        estado={seguidores}
        meuId={me?.id ?? null}
        arquivada={task.is_archived}
      />
      <button
        type="button" className="btn btn-ghost" onClick={() => void copiarLink()}
        style={{ padding: "4px 8px", flexShrink: 0 }}
        aria-label={copiado ? "Link copiado" : "Copiar link da tarefa"}
        title={copiado ? "Link copiado!" : "Copiar link da tarefa"}
      >
        {copiado ? (
          <Check size={15} strokeWidth={2} aria-hidden />
        ) : (
          <Share2 size={15} strokeWidth={2} aria-hidden />
        )}
      </button>
      <MenuDaTarefa
        arquivada={task.is_archived}
        arquivando={arquivando}
        onAlternarArquivo={() => void alternarArquivo()}
        // Arquivada nao se move.
        onMover={
          (me?.permissions.includes("task.update") ?? false) && !task.is_archived
            ? () => setMovendoTarefa(true)
            : undefined
        }
        onDuplicar={
          (me?.permissions.includes("task.create") ?? false)
            ? () => onDuplicar(task)
            : undefined
        }
        // A permissao vem da tarefa (`task.delete` no time dela).
        onExcluir={task.can_delete ? () => setConfirmandoExcluir(true) : undefined}
      />
      <button
        type="button" className="btn btn-ghost" onClick={fecharSuave}
        style={{ padding: "4px 10px", flexShrink: 0 }} aria-label="Fechar"
      >
        <X size={15} strokeWidth={2} aria-hidden />
      </button>
    </span>
  );

  return (
    <div
      // Modo modal: o scrim fecha no clique, nao no arraste (`lib/useCliqueFora.ts`).
      {...(modo === "modal" ? scrimProps : {})}
      className={modo === "modal" ? "modal-scrim" : undefined}
      data-saindo={saindo ? "true" : undefined}
      style={
        modo === "modal"
          ? {
              position: "fixed", inset: 0, zIndex: 50,
              background: "rgba(16,24,40,0.45)",
              display: "flex", alignItems: "flex-start", justifyContent: "center",
              padding: "6vh 16px 24px",
            }
          : { display: "block" }
      }
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          modo === "modal" ? "modal-card" : "",
          // A partir de 900px as colunas rolam sozinhas e o cartao nao; empilhado,
          // rola o cartao (sem rolagem aninhada).
          modo === "modal" ? "overflow-y-auto min-[900px]:overflow-hidden" : "",
        ].filter(Boolean).join(" ") || undefined}
        data-saindo={saindo ? "true" : undefined}
        style={{
          width: 1160, maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 16,
          padding: 0, overflow: "hidden",
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column",
          // Modal: altura travada e rolagem por dentro; pagina: quem rola e a
          // propria pagina. O `overflowY` mora na `className` (muda com a largura).
          ...(modo === "modal" ? { maxHeight: "88dvh" } : { margin: "0 auto" }),
        }}
      >
        {/* Duas colunas: a esquerda e a tarefa, a direita (comentarios e
            atividade) o que aconteceu com ela. Empilham abaixo de 900px. */}
        <div
          className={
            modo === "modal"
              ? "flex min-h-0 flex-col min-[900px]:grid min-[900px]:flex-1 min-[900px]:grid-cols-[minmax(0,1fr)_420px]"
              : "flex flex-col min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_420px]"
          }
        >
          {/* Coluna principal: o conteudo rola por dentro e o rodape de acoes
              fica fixo embaixo. */}
          <div className="flex min-w-0 min-h-0 flex-col">
        {/* Cabecalho: voltar, titulo e selos. Fica na coluna da esquerda para o
            titulo de duas linhas nao empurrar a lateral. */}
        <div className="flex shrink-0 flex-col items-start gap-1 border-b border-border px-5 py-3">
          {/* O "Voltar" numa linha so dele, para nao disputar largura com o titulo. */}
          {temVoltar && (
            <button
              type="button" className="btn btn-ghost" onClick={onVoltar}
              style={{
                padding: "2px 8px", fontSize: 13,
                // Teto de largura; o nome inteiro continua no `title`.
                maxWidth: "min(360px, 100%)", overflow: "hidden", whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 4,
                // `overflow: hidden` zera o min-height automatico deste flex item:
                // sem flexShrink 0 o botao encolhe na vertical e o texto sai cortado.
                flexShrink: 0,
                lineHeight: 1.6,
              }}
              title={pai ? `Voltar para ${pai.title}` : "Voltar"}
            >
              <ChevronLeft size={13} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                Voltar{pai ? ` para ${pai.title}` : ""}
              </span>
            </button>
          )}
          <div className="flex w-full flex-wrap items-center gap-2">
          {/* Clicar edita; Enter ou clicar fora salva, Esc desiste. `key` pelo
              id: trocar de tarefa com o campo aberto nao leva o rascunho junto. */}
          <div className="flex min-w-0 flex-1 flex-col max-md:basis-full">
            <TituloEditavel
              key={task.id}
              // `h1` só na rota `/tarefa/[id]`; nas outras telas o `<h1>` é da tela.
              level={modo === "pagina" ? "h1" : "h2"}
              compacto
              valor={salvoNoLugar?.id === task.id && salvoNoLugar.title !== undefined ? salvoNoLugar.title : task.title}
              onSalvar={(novo) => salvarNoLugar({ title: novo })}
            />
          </div>
          {task.parent_task_id && (
            <Badge tone="soft" size="md" color="var(--accent)" className="shrink-0">
              Subtarefa
            </Badge>
          )}
          {task.is_archived && (
            <span className="muted shrink-0" style={{ fontSize: 12.5 }}>arquivada</span>
          )}
          {!ladoALado && acoes}
          </div>
        </div>
          <div
            className={
              modo === "modal"
                ? "flex min-w-0 min-h-0 flex-1 flex-col gap-4 px-7 pb-5 pt-4 min-[900px]:overflow-y-auto"
                : "flex min-w-0 flex-col gap-4 px-7 pb-5 pt-4 min-[900px]:max-h-[70vh] min-[900px]:overflow-y-auto"
            }
          >

        {/* ---- Propriedades: lista rotulo/valor ---- */}
        <section aria-label="Propriedades" className="prop-list">
          <div className="prop">
          <span className="prop-lbl">Coluna</span>
          {/* Rotulo pela coluna, cor pelo status: `coluna.color` e token de traco
              e reprova AA como fundo sob texto. Desabilitada ate as colunas
              chegarem. */}
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              ref={painelCol.anchorRef}
              onClick={() => setAbertoCol((v) => !v)}
              disabled={salvandoCol || !colunas}
              aria-haspopup="listbox"
              aria-expanded={abertoCol}
              title={colunas ? "Mudar de coluna" : "Carregando colunas…"}
              style={{
                border: "none", background: "none", padding: 0,
                cursor: salvandoCol || !colunas ? "default" : "pointer",
                opacity: salvandoCol ? 0.5 : 1,
              }}
            >
              <Badge tone="solid" size="md" color={STATUS_COLOR[task.status]}>
                {colunaPorId.get(task.column_id)?.name ??
                  STATUS_LABEL[task.status] ??
                  task.status}
              </Badge>
            </button>
            {abertoCol && colunas && painelCol.box && (
              <AnchoredPanel box={painelCol.box} panelRef={painelCol.panelRef} role="listbox" aria-label="Coluna" minWidth={190}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* Mesma ordem do quadro (`position`). */}
                {[...colunas]
                  .sort((a, b) => a.position - b.position)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={task.column_id === c.id}
                      onClick={() => void mudarColuna(c.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        border: "none", borderRadius: 8, padding: "6px 10px",
                        fontSize: 13, textAlign: "left", cursor: "pointer",
                        background:
                          task.column_id === c.id ? "var(--accent-soft)" : "transparent",
                        color: task.column_id === c.id ? "var(--accent)" : "var(--text)",
                        fontWeight: task.column_id === c.id ? 600 : 400,
                      }}
                    >
                      {/* `c.color` e token de traco: serve para a bolinha, nao para fundo sob texto. */}
                      <span
                        aria-hidden
                        style={{
                          width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                          background: c.color,
                        }}
                      />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </span>
                    </button>
                  ))}
                </div>
              </AnchoredPanel>
            )}
          </div>
          </div>
          <div className="prop">
          <span className="prop-lbl">Prioridade</span>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              ref={painelPrio.anchorRef}
              onClick={() => setAbertoPrio((v) => !v)}
              disabled={salvandoPrio}
              aria-haspopup="listbox"
              aria-expanded={abertoPrio}
              title="Mudar prioridade"
              style={{
                border: "none", background: "none", padding: 0,
                cursor: salvandoPrio ? "default" : "pointer",
                opacity: salvandoPrio ? 0.5 : 1,
              }}
            >
              <Badge tone="soft" size="md" color={PRIORITY_COLOR[task.priority]}>
                {PRIORITY_LABEL[task.priority] || task.priority}
              </Badge>
            </button>
            {abertoPrio && painelPrio.box && (
              <AnchoredPanel box={painelPrio.box} panelRef={painelPrio.panelRef} role="listbox" aria-label="Prioridade" minWidth={150}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {PRIORIDADES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="option"
                    aria-selected={task.priority === p}
                    onClick={() => void mudarPrioridade(p)}
                    className={task.priority === p ? "" : "btn-ghost"}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      border: "none", borderRadius: 8, padding: "6px 10px",
                      fontSize: 13, textAlign: "left", cursor: "pointer",
                      background: task.priority === p ? "var(--accent-soft)" : "transparent",
                      color: task.priority === p ? "var(--accent)" : "var(--text)",
                      fontWeight: task.priority === p ? 600 : 400,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                        background: PRIORITY_COLOR[p],
                      }}
                    />
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
                </div>
              </AnchoredPanel>
            )}
          </div>
          </div>
          <div className="prop">
          <span className="prop-lbl">Prazo</span>
          {/* A pilula e o controle, e aparece mesmo sem data (senao nao haveria
              onde clicar). `T00:00:00` na leitura: `new Date("2026-08-19")` e UTC
              e escorrega um dia em fuso negativo. */}
          <div
            style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
          >
            {/* inline-flex + flexShrink 0 + nowrap: o pai e flex com wrap, e sem
                isso a pilula quebra entre o icone e a data. A cor de atraso e o
                unico sinal de que a tarefa venceu. */}
            <button
              type="button"
              ref={painelDatas.anchorRef}
              onClick={() => (abertoDatas ? setAbertoDatas(false) : abrirDatas())}
              disabled={salvandoDatas}
              aria-label={
                prazoAtual || inicioAtual ? "Mudar datas" : "Definir datas"
              }
              aria-expanded={abertoDatas}
              title={prazoAtual || inicioAtual ? "Mudar datas" : "Definir datas"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                flexShrink: 0, whiteSpace: "nowrap",
                height: 24, borderRadius: 999, padding: "0 10px",
                // Sem `font: "inherit"` aqui: o atalho sobrescreveria o `fontSize`.
                fontSize: 12, cursor: "pointer",
                fontWeight: dueTone ? 600 : 400,
                // Cheia e vazia usam a mesma caixa; o vazio tem borda tracejada.
                background: prazoAtual || inicioAtual ? "var(--surface-2)" : "transparent",
                border:
                  prazoAtual || inicioAtual
                    ? "1px solid transparent"
                    : "1px dashed var(--border)",
                color: dueTone
                  ? DEADLINE_COLOR[dueTone]
                  : prazoAtual || inicioAtual
                  ? "var(--text)"
                  : "var(--text-faint)",
                opacity: salvandoDatas ? 0.5 : 1,
              }}
            >
              <Calendar size={13} strokeWidth={2} aria-hidden />
              {prazoAtual ? dataHoraBR(prazoAtual, horaAtual) : "Sem datas"}
              {inicioAtual && (
                <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  · início {new Date(inicioAtual + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
              )}
              {/* Sem `ehTopo`: subtarefa herda o projeto, mas tem prazo proprio. */}
              {abertoDatas ? (
                <X size={11} strokeWidth={2.2} aria-hidden />
              ) : (
                <Pencil size={11} strokeWidth={2.2} aria-hidden style={{ opacity: 0.65 }} />
              )}
            </button>

            {abertoDatas && painelDatas.box && (
              <AnchoredPanel box={painelDatas.box} panelRef={painelDatas.panelRef} role="dialog" aria-label="Datas" minWidth={240}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 4 }}>
                <strong style={{ fontSize: 13 }}>Datas</strong>
                <label style={{ fontSize: 12, color: "var(--text-soft)" }}>
                  Data de início
                  <input
                    type="date"
                    className="input"
                    style={{ width: "100%", marginTop: 3 }}
                    value={rascunhoInicio}
                    autoFocus
                    disabled={salvandoDatas}
                    onChange={(e) => setRascunhoInicio(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: 12, color: "var(--text-soft)" }}>
                  Data de entrega
                  <input
                    type="date"
                    className="input"
                    style={{ width: "100%", marginTop: 3 }}
                    value={rascunhoPrazo}
                    disabled={salvandoDatas}
                    onChange={(e) => setRascunhoPrazo(e.target.value)}
                  />
                </label>
                {/* A hora so aparece com data: hora sem data o backend recusa (422). */}
                {rascunhoPrazo && (
                  <label style={{ fontSize: 12, color: "var(--text-soft)" }}>
                    Hora{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      (opcional)
                    </span>
                    <input
                      type="time"
                      className="input"
                      style={{ width: "100%", marginTop: 3 }}
                      value={rascunhoHora}
                      disabled={salvandoDatas}
                      onChange={(e) => setRascunhoHora(e.target.value)}
                    />
                    <span
                      style={{
                        display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: 6, marginTop: 3,
                      }}
                    >
                      <span className="muted" style={{ fontSize: 11 }}>
                        Sem hora, vence no fim do dia.
                      </span>
                      {/* Botao proprio: o "x" nativo do `<input type="time">`
                          nao existe em todo navegador. */}
                      {rascunhoHora && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setRascunhoHora("")}
                          disabled={salvandoDatas}
                          style={{ fontSize: 11, padding: "1px 6px" }}
                        >
                          Limpar hora
                        </button>
                      )}
                    </span>
                  </label>
                )}
                {erroDatas && (
                  <span role="alert" className="error-text" style={{ fontSize: 12 }}>
                    {erroDatas}
                  </span>
                )}
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setAbertoDatas(false)}
                    disabled={salvandoDatas}
                    style={{ fontSize: 12 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={salvarDatas}
                    disabled={salvandoDatas}
                    style={{ fontSize: 12 }}
                  >
                    {salvandoDatas ? "Salvando…" : "Salvar"}
                  </button>
                </div>
                </div>
              </AnchoredPanel>
            )}
          </div>
          </div>

          {/* -- Responsaveis -- */}
          <div className="prop">
          <span className="prop-lbl">Responsáveis</span>
          <div
            style={{
              position: "relative", display: "flex", flexWrap: "wrap",
              alignItems: "center", gap: 6, minWidth: 0,
            }}
          >
            {assignees.length > 0 ? (
              assignees.map((id) => {
                const nome = members.get(id)?.name ?? "";
                const inativo = membrosInativos.has(id);
                return (
                  <span
                    key={id}
                    // Responsavel desativado aparece como tal.
                    title={inativo ? `${nome} (desativado)` : nome}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "var(--surface-2)", borderRadius: 999,
                      padding: "2px 10px 2px 2px", fontSize: 12.5, maxWidth: 180,
                      overflow: "hidden", whiteSpace: "nowrap",
                      color: inativo ? "var(--text-faint)" : undefined,
                      textDecoration: inativo ? "line-through" : undefined,
                    }}
                  >
                    <Avatar id={id} name={nome} size="sm" />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {nome ? nomeCurto(nome) : "Responsável"}
                    </span>
                  </span>
                );
              })
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>ninguém</span>
            )}

            <button
              type="button"
              ref={painelResp.anchorRef}
              onClick={() => setAbertoResp((v) => !v)}
              aria-label="Designar responsável"
              aria-expanded={abertoResp}
              title="Designar"
              style={GATILHO_STYLE}
            >
              {abertoResp ? (
                <X size={13} strokeWidth={2.2} aria-hidden />
              ) : (
                <Plus size={13} strokeWidth={2.2} aria-hidden />
              )}
            </button>

            {abertoResp && painelResp.box && (
              <AnchoredPanel box={painelResp.box} panelRef={painelResp.panelRef} role="dialog" aria-label="Responsáveis" minWidth={300}>
                <input
                  className="input"
                  placeholder="Buscar pessoa…"
                  value={busca}
                  autoFocus
                  onChange={(e) => setBusca(e.target.value)}
                />
                <div
                  style={{
                    maxHeight: 240, overflowY: "auto", marginTop: 6,
                    border: "1px solid var(--border)", borderRadius: 8,
                  }}
                >
                  {filtrados.length === 0 ? (
                    <div className="muted" style={{ fontSize: 13, padding: "10px 12px" }}>
                      Ninguém encontrado.
                    </div>
                  ) : (
                    filtrados.map((m, i) => {
                      const marcado = assignees.includes(m.id);
                      const ocupado = saving.has(m.id);
                      return (
                        <label
                          key={m.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 12px", cursor: ocupado ? "wait" : "pointer",
                            borderTop: i === 0 ? "none" : "1px solid var(--border)",
                            opacity: ocupado ? 0.6 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={ocupado}
                            onChange={() => toggle(m.id)}
                          />
                          <Avatar id={m.id} name={m.name} size="sm" />
                          <span style={{ fontSize: 13.5 }}>{m.name}</span>
                          {/* So aparece porque JA esta designado. O selo diz
                              por que ela esta aqui e nao na busca. */}
                          {m.inativo && (
                            <span
                              className="muted"
                              style={{ fontSize: 11, marginLeft: "auto" }}
                            >
                              inativo
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              </AnchoredPanel>
            )}
          </div>
          </div>

          <div className="prop">
          <span className="prop-lbl">Projeto</span>
          {/* Subtarefa herda o projeto do pai: vira selo sem gatilho. */}
          <div
            style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
          >
            {(() => {
              const rotulo = projetoAtual
                ? nomeProjetoAtual ?? "Projeto atual"
                : "Sem Projeto";
              const conteudo = (
                <>
                  <FolderOpen size={13} strokeWidth={2} aria-hidden />
                  <span
                    style={{
                      maxWidth: 180, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {rotulo}
                  </span>
                </>
              );
              // Cheia e vazia usam a mesma caixa; o vazio tem borda tracejada.
              const caixa = {
                display: "inline-flex" as const,
                alignItems: "center" as const,
                gap: 5,
                flexShrink: 0,
                whiteSpace: "nowrap" as const,
                height: 24,
                borderRadius: 999,
                padding: "0 10px",
                fontSize: 12,
                background: projetoAtual ? "var(--surface-2)" : "transparent",
                border: projetoAtual
                  ? "1px solid transparent"
                  : "1px dashed var(--border)",
                color: projetoAtual ? "var(--text)" : "var(--text-faint)",
              };
              if (!ehTopo) {
                // Selo morto: sem cursor nem `title` de acao.
                return <span style={caixa}>{conteudo}</span>;
              }
              return (
                <button
                  type="button"
                  ref={painelProj.anchorRef}
                  onClick={() => setAbertoProj((v) => !v)}
                  disabled={movendoProj}
                  aria-label={
                    projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"
                  }
                  aria-expanded={abertoProj}
                  title={projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"}
                  style={{
                    ...caixa,
                    cursor: "pointer",
                    opacity: movendoProj ? 0.5 : 1,
                  }}
                >
                  {conteudo}
                  {abertoProj ? (
                    <X size={11} strokeWidth={2.2} aria-hidden />
                  ) : projetoAtual ? (
                    <Pencil
                      size={11}
                      strokeWidth={2.2}
                      aria-hidden
                      style={{ opacity: 0.65 }}
                    />
                  ) : (
                    <Plus
                      size={11}
                      strokeWidth={2.2}
                      aria-hidden
                      style={{ opacity: 0.65 }}
                    />
                  )}
                </button>
              );
            })()}

            {movendoProj && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                movendo…
              </span>
            )}

            {/* Painel flutuante, para nao deslocar a linha a cada abertura. */}
            {abertoProj && painelProj.box && (
              <AnchoredPanel box={painelProj.box} panelRef={painelProj.panelRef} role="dialog" aria-label="Projeto" minWidth={280}>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={projetoAtual ?? ""}
                  disabled={movendoProj}
                  autoFocus
                  onChange={(e) => mudarProjeto(e.target.value || null)}
                >
                  <option value="">— Sem projeto (tirar) —</option>
                  {Array.from(projects.entries())
                    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
                    .map(([id, titulo]) => (
                      <option key={id} value={id}>
                        {titulo}
                      </option>
                    ))}
                </select>
              </AnchoredPanel>
            )}
          </div>
          </div>

          {/* -- Seguidores: o `+` so aparece para quem pode por outra pessoa
              (`can_manage_watchers`); arquivada e so leitura. -- */}
          <div className="prop">
          <span className="prop-lbl">Seguidores</span>
          <LinhaDeSeguidores
            estado={seguidores}
            meuId={me?.id ?? null}
            arquivada={task.is_archived}
            podeGerenciar={task.can_manage_watchers}
            nomes={members}
            inativos={membrosInativos}
            foraDoEscopo={foraDoEscopoAqui}
          />
          </div>

          {/* Criacao: data + quem criou (sem nome -> so a data). */}
          <div className="muted pt-1" style={{ fontSize: 12 }}>
            Criada em {criadoEm}
            {criador ? ` por ${criador}` : ""}
          </div>
        </section>

        {/* Erro do move fica fora da lista: dentro ela some junto com o painel. */}
        {erroProj && <div className="error-box">{erroProj}</div>}

        {/* Descrição e links se editam aqui. `key` pelo id pelo mesmo motivo do título. */}
        <DescricaoEditavel
          key={`desc-${task.id}`}
          valor={salvoNoLugar?.id === task.id && salvoNoLugar.description !== undefined ? salvoNoLugar.description : task.description}
          onSalvar={(nova) => salvarNoLugar({ description: nova })}
        />
        <LinksEditaveis
          key={`links-${task.id}`}
          links={links}
          falhou={falhouLinks}
          onTentarDeNovo={() => setTentativaLinks((n) => n + 1)}
          onSalvar={salvarLinks}
        />

        {/* ---- Subtarefas ---- */}
        <div className="field">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="label">
              {/* `colunas &&`: com o mapa vazio a conta daria "(0/2)". */}
              Subtarefas
              {colunas && totalSub > 0 ? ` (${concluidas}/${totalSub})` : ""}
            </span>
            {/* "Carregando" e "falhou" precisam se distinguir de "nao tem subtarefa". */}
            {carregandoFilhos && (
              <span className="muted" style={{ fontSize: 12 }}>
                carregando…
              </span>
            )}
            {erroFilhos && (
              <button
                type="button"
                className="error-text"
                style={{
                  fontSize: 12,
                  background: "none",
                  border: "none",
                  padding: 0,
                  textDecoration: "underline",
                }}
                onClick={() => void recarregarFilhos()}
              >
                Não consegui carregar as subtarefas. Tentar de novo
              </button>
            )}
            {!criandoSub && (
              <button
                type="button"
                onClick={() => setCriandoSub(true)}
                aria-label="Adicionar subtarefa"
                title="Adicionar subtarefa"
                style={GATILHO_STYLE}
              >
                <Plus size={13} strokeWidth={2.2} aria-hidden />
              </button>
            )}
          </div>

          {/* Barra de progresso: acompanha o upsert otimista da caixinha.
              Proporcao = concluidas / filhas ativas. */}
          {colunas && totalSub > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                role="progressbar"
                aria-valuenow={concluidas}
                aria-valuemin={0}
                aria-valuemax={totalSub}
                aria-label={`${concluidas} de ${totalSub} subtarefas concluídas (${pctSub}%)`}
                style={{
                  flex: 1, height: 8, borderRadius: 999,
                  background: "var(--surface-2)", overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pctSub}%`,
                    background: "var(--accent)",
                    borderRadius: 999,
                    transition: "width .25s ease",
                  }}
                />
              </div>
              <span
                className="muted"
                style={{
                  fontSize: 12, fontWeight: 600, flexShrink: 0,
                  minWidth: 34, textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pctSub}%
              </span>
            </div>
          )}

          {linhasSub.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {linhasSub.map((f, i) => {
                // A marca sai da coluna, como a conta acima.
                const colunaDela = colunaPorId.get(f.column_id);
                const concluida = colunaDela?.semantic === "DONE";
                // Sem colunas a caixa fica desabilitada: nao haveria destino.
                const ocupado = subSaving.has(f.id) || !colunas;
                // Mesmo 0.55 do card arquivado no quadro.
                const apagada = f.is_archived;
                // Mesma regra do card do quadro: concluida/arquivada nao alerta.
                // Coluna desconhecida = sem alerta (`null`, como `DeadlineTone` espera).
                const tone = colunaDela
                  ? deadlineTonePorColuna(colunaDela, f.due_date, f.is_archived, f.due_time)
                  : null;
                // Rotulo da prioridade; mesmo fallback do card do quadro.
                const rotuloPrio = PRIORITY_LABEL[f.priority] || f.priority;
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      opacity: ocupado ? 0.6 : apagada ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={concluida}
                      disabled={ocupado}
                      title={concluida ? "Reabrir" : "Concluir"}
                      onChange={(e) => alternarConclusao(f, e.currentTarget)}
                      style={{ cursor: ocupado ? "wait" : "pointer", flexShrink: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => onAbrirSubtarefa(f)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
                        border: "none", padding: 0, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                    >
                      <span
                        style={{
                          flex: 1, minWidth: 0,
                          display: "flex", flexDirection: "column",
                          alignItems: "flex-start", gap: 3,
                        }}
                      >
                        <span
                          style={{
                            width: "100%", fontSize: 13.5,
                            textDecoration: concluida ? "line-through" : "none",
                            color: concluida ? "var(--text-faint)" : "var(--text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {f.title}
                        </span>
                        {/* Prazo, prioridade e coluna da subtarefa, com a mesma
                            regra de cor do card do quadro. */}
                        {(f.due_date || rotuloPrio || apagada) && (
                          <span
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              flexWrap: "wrap", fontSize: 11,
                            }}
                          >
                            {apagada && (
                              <span className="muted" style={{ fontSize: 11 }}>
                                arquivada
                              </span>
                            )}
                            {rotuloPrio && (
                              <Badge
                                tone="soft"
                                size="sm"
                                color={PRIORITY_COLOR[f.priority]}
                              >
                                {rotuloPrio}
                              </Badge>
                            )}
                            {/* A coluna distingue cancelada de backlog (as duas
                                ficam desmarcadas). Cor pelo status, como a pilula
                                de Coluna: `coluna.color` reprova AA como fundo.
                                O `title` fica no wrapper porque o `Badge` nao o
                                aceita. Coluna desconhecida nao desenha nada. */}
                            {colunaDela && (
                              <span
                                title={`Coluna: ${colunaDela.name}`}
                                style={{ display: "inline-flex", flexShrink: 0 }}
                              >
                                <Badge
                                  tone="soft"
                                  size="sm"
                                  color={STATUS_COLOR[f.status]}
                                >
                                  {colunaDela.name}
                                </Badge>
                              </span>
                            )}
                            {f.due_date && (
                              <span
                                className={tone ? undefined : "muted"}
                                /* A hora vai no `title`: o texto e so dd/mm, mas o tom le `f.due_time`. */
                                title={dataHoraBR(f.due_date, f.due_time)}
                                style={{
                                  display: "inline-flex", alignItems: "center",
                                  gap: 3, flexShrink: 0, whiteSpace: "nowrap",
                                  color: tone ? DEADLINE_COLOR[tone] : undefined,
                                  fontWeight: tone ? 600 : undefined,
                                }}
                              >
                                <Calendar size={12} strokeWidth={2} aria-hidden />
                                {new Date(
                                  f.due_date + "T00:00:00"
                                ).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                })}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <span style={{ display: "flex", alignItems: "center" }}>
                        {(f.assignee_ids ?? []).slice(0, 2).map((id, j) => (
                          <Avatar
                            key={id}
                            id={id}
                            name={members.get(id)?.name}
                            size="xs"
                            title={members.get(id)?.name ?? ""}
                            className="border-[1.5px] border-surface"
                            style={{ marginLeft: j === 0 ? 0 : -5 }}
                          />
                        ))}
                      </span>
                      <span className="muted" style={{ fontSize: 14, flexShrink: 0 }}>›</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {criandoSub && (
            <div
              style={{
                marginTop: linhasSub.length > 0 ? 8 : 0,
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <input
                ref={subTituloRef}
                className="input"
                autoFocus
                placeholder="Título da subtarefa…"
                value={novoTitulo}
                disabled={salvandoSub}
                maxLength={255}
                onChange={(e) => setNovoTitulo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault(); // so fecha o campo, nao o detalhe
                    fecharCriacaoSub();
                    return;
                  }
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  // Enter com titulo e sem responsavel abre o seletor em vez de criar.
                  const acao = acaoDoEnterNoTitulo({
                    titulo: novoTitulo,
                    assigneeIds: subAssignees,
                    dueDate: subPrazo,
                  });
                  if (acao === "criar") criarSub();
                  else if (acao === "escolher") setSubPickerAberto(true);
                }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {/* Responsavel: obrigatorio; o rotulo do botao mostra o estado. */}
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    ref={painelSub.anchorRef}
                    onClick={() => setSubPickerAberto((v) => !v)}
                    disabled={salvandoSub}
                    aria-expanded={subPickerAberto}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12.5, padding: "5px 9px", borderRadius: 8,
                      border: `1px ${subAssignees.length ? "solid" : "dashed"} var(--border)`,
                      background: "var(--surface)",
                      color: subAssignees.length ? "var(--text)" : "var(--text-soft)",
                      cursor: "pointer",
                    }}
                  >
                    <UserPlus size={13} />
                    {resumoResponsaveis(
                      subAssignees,
                      (id) => members.get(id)?.name
                    )}
                  </button>

                  {subPickerAberto && painelSub.box && (
                    <AnchoredPanel box={painelSub.box} panelRef={painelSub.panelRef} role="dialog" aria-label="Responsável da subtarefa" minWidth={260}>
                      <input
                        className="input"
                        placeholder="Buscar pessoa…"
                        value={subBusca}
                        autoFocus
                        onChange={(e) => setSubBusca(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          e.stopPropagation();
                          const primeiro = membrosParaSub[0];
                          if (!primeiro) return;
                          setSubAssignees((prev) =>
                            alternaResponsavel(prev, primeiro.id)
                          );
                          setSubBusca("");
                        }}
                      />
                      <div
                        style={{
                          maxHeight: 200, overflowY: "auto", marginTop: 6,
                          border: "1px solid var(--border)", borderRadius: 8,
                        }}
                      >
                        {membrosParaSub.length === 0 ? (
                          <div className="muted" style={{ fontSize: 12.5, padding: "8px 10px" }}>
                            Ninguem encontrado.
                          </div>
                        ) : (
                          membrosParaSub.map((m, i) => (
                            <label
                              key={m.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "7px 10px", cursor: "pointer",
                                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={subAssignees.includes(m.id)}
                                onChange={() =>
                                  setSubAssignees((prev) =>
                                    alternaResponsavel(prev, m.id)
                                  )
                                }
                              />
                              <Avatar id={m.id} name={m.name} size="xs" />
                              <span style={{ fontSize: 13 }}>{m.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </AnchoredPanel>
                  )}
                </div>

                {/* Prazo: opcional. */}
                <input
                  type="date"
                  className="input"
                  value={subPrazo}
                  disabled={salvandoSub}
                  onChange={(e) => setSubPrazo(e.target.value)}
                  style={{ fontSize: 12.5, padding: "5px 9px", width: "auto" }}
                  aria-label="Data de entrega (opcional)"
                />

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={fecharCriacaoSub}
                    disabled={salvandoSub}
                    style={{ padding: "5px 10px", fontSize: 12.5 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={criarSub}
                    disabled={
                      salvandoSub ||
                      !podeCriar({
                        titulo: novoTitulo,
                        assigneeIds: subAssignees,
                        dueDate: subPrazo,
                      })
                    }
                    title={
                      motivoNaoCria({
                        titulo: novoTitulo,
                        assigneeIds: subAssignees,
                        dueDate: subPrazo,
                      }) ?? "Adicionar subtarefa"
                    }
                    style={{ padding: "5px 12px", fontSize: 12.5 }}
                  >
                    {salvandoSub ? "…" : "Adicionar"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {erroSub && (
            <div className="error-box" style={{ marginTop: 8 }}>{erroSub}</div>
          )}
        </div>
          </div>

          {/* O rodape so aparece para confirmar a exclusao ou mostrar o link que
              a copia nao conseguiu pôr na area de transferencia. */}
          {(confirmandoExcluir || copiaErro) && (
            <RodapeDaTarefa
              task={task}
              filhos={filhos}
              confirmandoExcluir={confirmandoExcluir}
              setConfirmandoExcluir={setConfirmandoExcluir}
              excluindo={excluindo}
              excluir={() => void excluir()}
              copiaErro={copiaErro}
            />
          )}
          {movendoTarefa && (
            <MoverTarefa
              task={task}
              onFechar={() => setMovendoTarefa(false)}
              onMovida={(t) => {
                // A tarefa pode ter saido do quadro, com as subtarefas.
                onTaskMoved(t);
                avisar("Tarefa movida.");
              }}
            />
          )}
          </div>

          {/* Coluna lateral. A divisoria fica a esquerda lado a lado e em cima
              quando empilha. */}
          <aside
            aria-label="Comentários e atividade"
            className="flex w-full min-h-0 shrink-0 flex-col border-t border-border bg-canvas min-[900px]:border-l min-[900px]:border-t-0"
          >
            {ladoALado && (
              <div className="flex shrink-0 justify-end px-3 pt-3">{acoes}</div>
            )}
            <div className="shrink-0 px-4 pt-3">
              <Tabs
                group="lateral"
                tabs={[
                  {
                    id: "comentarios" as const,
                    label: "Comentários",
                    count: comentarios?.length,
                  },
                  {
                    id: "atividade" as const,
                    label: "Atividade",
                    count: totalAtividade,
                  },
                ]}
                active={abaLateral}
                onSelect={setAbaLateral}
                aria-label="Comentários ou atividade"
              />
            </div>

            {/* A partir de 900px a lateral rola por dentro, para trocar de aba
                nao mudar o tamanho do cartao. Empilhado, nao (rolagem aninhada). */}
            <div
              // Marca para o teste: a classe arbitraria do Tailwind nao e seletor CSS valido.
              data-rolagem="lateral"
              className={
                modo === "modal"
                  ? "min-h-0 p-4 min-[900px]:flex-1 min-[900px]:overflow-y-auto"
                  : "p-4 min-[900px]:max-h-[70vh] min-[900px]:overflow-y-auto"
              }
            >
            {abaLateral === "atividade" ? (
              <AtividadeDaTarefa
                itens={atividade}
                total={totalAtividade}
                nomes={nomesDoHistorico}
                carregando={carregandoAtividade}
                erro={erroAtividade}
                erroAoCarregarMais={erroMaisAtividade}
                onCarregarMais={() => void carregarMaisAtividade()}
              />
            ) : (
              /* ---- Comentarios ---- */
              <div className="field">
              {comentarios === null ? (
                <Loading tamanho="linha" rotulo="Carregando os comentários" />
              ) : comentarios.length === 0 ? (
                <span className="muted" style={{ fontSize: 13 }}>
                  Nenhum comentário ainda.
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* O mais novo primeiro (a API manda em ordem crescente), e as
                      respostas tambem. */}
                  {comentarios
                    .filter((c) => !c.parent_comment_id)
                    .reverse()
                    .map((c) => {
                      const respostas = comentarios
                        .filter((r) => r.parent_comment_id === c.id)
                        .reverse();
                      const aberto = !respostasRecolhidas.has(c.id);
                      const respondendo = respondendoId === c.id;
                      const idThread = `respostas-${c.id}`;
                      return (
                      <div key={c.id} className="flex flex-col gap-1.5">
                        <div
                          data-comment-id={c.id}
                          className={comentarioDestacado === c.id ? "comentario-destaque" : undefined}
                        >
                          <LinhaComentario
                            c={c}
                            members={members}
                            excluidos={foraDoAutocompletar}
                            me={me}
                            taskId={tid}
                            podeModerar={task.can_delete}
                            onEditado={aoEditado}
                            onApagado={recarregarComentarios}
                          />
                        </div>

                        {(respostas.length > 0 || (!c.is_deleted && !respondendo)) && (
                          <div className="ml-[30px] flex items-center gap-1">
                            {respostas.length > 0 && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                aria-expanded={aberto}
                                aria-controls={aberto ? idThread : undefined}
                                onClick={() => alternarRespostas(c.id)}
                                style={{ padding: "4px 8px", fontSize: 12, gap: 4 }}
                              >
                                <ChevronRight
                                  size={13}
                                  strokeWidth={2}
                                  aria-hidden
                                  className={`transition-transform ${aberto ? "rotate-90" : ""}`}
                                />
                                {respostas.length === 1 ? "1 resposta" : `${respostas.length} respostas`}
                              </button>
                            )}
                            {!c.is_deleted && !respondendo && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  setRespondendoId(c.id);
                                  setTextoResposta("");
                                  // responder numa thread recolhida a abre
                                  setRespostasRecolhidas((s) => {
                                    if (!s.has(c.id)) return s;
                                    const n = new Set(s);
                                    n.delete(c.id);
                                    return n;
                                  });
                                }}
                                style={{ padding: "4px 8px", fontSize: 12 }}
                              >
                                Responder
                              </button>
                            )}
                          </div>
                        )}

                        {/* A linha a esquerda separa resposta de comentario novo. */}
                        {aberto && (respostas.length > 0 || respondendo) && (
                          <div
                            id={idThread}
                            className="ml-[14px] flex flex-col gap-1.5 border-l-2 border-border pl-3"
                          >
                        {/* O campo fica no topo porque a resposta nova entra em cima. */}
                        {respondendo && (
                          <div className="flex flex-col gap-1.5">
                            <MentionTextarea
                              ref={respostaRef}
                              value={textoResposta}
                              onChange={setTextoResposta}
                              members={members}
                excluidos={foraDoAutocompletar}
                              autoFocus
                              rows={2}
                              placeholder="Responder… (@ menciona)"
                              disabled={enviandoResp}
                              maxLength={5000}
                              style={{ resize: "vertical" }}
                            />
                            <GifDraftStrip
                              gifs={gifsResp}
                              onRemove={(i) =>
                                setGifsResp((g) => g.filter((_, j) => j !== i))
                              }
                            />
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <EmojiPicker
                                disabled={enviandoResp}
                                onPick={(e) =>
                                  inserirNoCursor(
                                    respostaRef,
                                    textoResposta,
                                    setTextoResposta,
                                    e
                                  )
                                }
                              />
                              <GifPicker
                                disabled={enviandoResp}
                                onPick={(url) => setGifsResp((g) => [...g, url])}
                              />
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => enviarResposta(c.id)}
                                disabled={
                                  enviandoResp ||
                                  (!textoResposta.trim() && gifsResp.length === 0)
                                }
                                style={{ padding: "5px 12px", fontSize: 13 }}
                              >
                                {enviandoResp ? "…" : "Responder"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  setRespondendoId(null);
                                  setTextoResposta("");
                                }}
                                style={{ padding: "5px 12px", fontSize: 13 }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                        {respostas.map((r) => (
                            <div
                              key={r.id}
                              data-comment-id={r.id}
                              className={comentarioDestacado === r.id ? "comentario-destaque" : undefined}
                            >
                              <LinhaComentario
                                c={r}
                                members={members}
                                excluidos={foraDoAutocompletar}
                                me={me}
                                taskId={tid}
                                podeModerar={task.can_delete}
                                onEditado={aoEditado}
                                onApagado={recarregarComentarios}
                              />
                            </div>
                          ))}
                          </div>
                        )}
                      </div>
                      );
                    })}
                </div>
              )}

            </div>
            )}
            </div>

            {/* O campo de escrever fica fora da area que rola: a caixa fica onde a
                mao ja esta. */}
            {abaLateral === "comentarios" && (
              <div className="shrink-0 border-t border-border bg-surface px-4 pb-4 pt-3">
                {/* caixa de novo comentario (quem ve a tarefa pode comentar) */}
                <MentionTextarea
                  ref={topComentRef}
                  value={novoComent}
                  onChange={setNovoComent}
                  members={members}
                  excluidos={foraDoAutocompletar}
                  rows={2}
                  placeholder="Escreva um comentário… (@ menciona)"
                  disabled={enviandoComent}
                  maxLength={5000}
                  style={{ resize: "vertical" }}
                />
                <GifDraftStrip
                  gifs={gifsNovo}
                  onRemove={(i) => setGifsNovo((g) => g.filter((_, j) => j !== i))}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <EmojiPicker
                    disabled={enviandoComent}
                    onPick={(e) =>
                      inserirNoCursor(topComentRef, novoComent, setNovoComent, e)
                    }
                  />
                  <GifPicker
                    disabled={enviandoComent}
                    onPick={(url) => setGifsNovo((g) => [...g, url])}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={enviarComentario}
                    disabled={enviandoComent || (!novoComent.trim() && gifsNovo.length === 0)}
                    style={{ padding: "6px 12px" }}
                  >
                    {enviandoComent ? "Enviando…" : "Comentar"}
                  </button>
                </div>

                {erroCom && (
                  <div className="error-box" style={{ marginTop: 8 }}>{erroCom}</div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* Rodape da coluna principal: confirmacao de exclusao e fallback do copiar. */
function RodapeDaTarefa({
  task, filhos, confirmandoExcluir, setConfirmandoExcluir, excluindo, excluir,
  copiaErro,
}: {
  task: Task;
  filhos: Task[];
  confirmandoExcluir: boolean;
  setConfirmandoExcluir: (v: boolean) => void;
  excluindo: boolean;
  excluir: () => void;
  copiaErro: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-7 py-3">
        {confirmandoExcluir && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              marginTop: 4, padding: "10px 12px", borderRadius: 8,
              border: "1px solid var(--danger, #b42318)",
              background: "color-mix(in srgb, var(--danger, #b42318) 8%, transparent)",
            }}
          >
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 220 }}>
              Excluir <strong>{task.title}</strong>? Isto apaga a tarefa e todos os comentários.
              {/* `filhos`, e nao `linhasSub`: a cascata leva a subarvore inteira,
                  arquivada ou nao. */}
              {filhos.length > 0 && (
                <> Também apaga as <strong>{filhos.length}</strong> subtarefa(s) diretas e as subtarefas delas.</>
              )}{" "}
              <strong>Não dá para desfazer pela tela.</strong>
            </span>
            <button
              type="button" className="btn btn-primary" onClick={excluir} disabled={excluindo}
              style={{ padding: "6px 14px", background: "var(--danger, #b42318)", borderColor: "transparent" }}
            >
              {excluindo ? "…" : "Excluir"}
            </button>
            <button
              type="button" className="btn btn-ghost" onClick={() => setConfirmandoExcluir(false)}
              disabled={excluindo} style={{ padding: "6px 14px" }}
            >
              Cancelar
            </button>
          </div>
        )}

        {copiaErro && (
          // A copia automatica falhou: mostra o endereco para copiar na mao.
          <div
            className="error-box"
            style={{ marginTop: 8, fontSize: 13, wordBreak: "break-all" }}
          >
            Não consegui copiar automaticamente. O endereço é:{" "}
            <span style={{ userSelect: "all" }}>{copiaErro}</span>
          </div>
        )}

    </div>
  );
}

// Uma linha do thread: avatar + autor + hora + conteudo, com acoes inline.
// Lapis (editar) so pro autor; lixeira (apagar) pro autor OU quem modera a
// tarefa (`podeModerar`, do servidor). Tombstone nao tem acao. Apagar e 204:
// quem decide tombstone-vs-some e o backend -> a linha so dispara o reload.
function LinhaComentario({
  c,
  members,
  excluidos,
  me,
  taskId,
  podeModerar,
  onEditado,
  onApagado,
}: {
  c: Comment;
  members: Map<string, { name: string }>;
  /** Ids fora do autocompletar de `@`: desativados e quem nao alcanca a tarefa. */
  excluidos: Set<string>;
  me: CurrentUser | null;
  taskId: string;
  /** Modera comentario alheio nesta tarefa (`task.can_delete`). */
  podeModerar: boolean;
  onEditado: (atualizado: Comment) => void;
  onApagado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(c.content);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroLinha, setErroLinha] = useState<string | null>(null);
  const [erroReacao, setErroReacao] = useState<string | null>(null);

  const nome = members.get(c.user_id)?.name ?? "";
  const souAutor = me != null && me.id === c.user_id;
  const temAcao = !c.is_deleted && me != null;
  const podeEditar = temAcao && souAutor;
  const podeApagar = temAcao && (souAutor || podeModerar);
  // Quem ve reage, sem permissao propria. Tombstone nao.
  const podeReagir = temAcao;

  /**
   * Poe, troca ou tira a minha reacao (a regra mora em `lib/reacoes`). A linha
   * troca pelo comentario que o servidor devolve.
   */
  async function alternarReacao(emoji: string) {
    if (!me) return;
    setErroReacao(null);
    const acao = acaoDaPilula(c.reactions, emoji, me.id);
    try {
      const atualizado =
        acao === "tirar"
          ? await deleteCommentReaction(taskId, c.id)
          : await setCommentReaction(taskId, c.id, emoji);
      onEditado(atualizado);
    } catch (e) {
      const err = e as ApiError;
      setErroReacao(
        err.status === 404
          ? "Este comentário não está mais disponível."
          : err.message || "Não consegui reagir."
      );
    }
  }

  async function salvarEdicao() {
    const t = texto.trim();
    if (!t) return;
    setSalvando(true);
    setErroLinha(null);
    try {
      const atualizado = await editComment(taskId, c.id, t);
      onEditado(atualizado);
      setEditando(false);
    } catch (e) {
      const err = e as ApiError;
      setErroLinha(
        err.status === 403
          ? "So o autor pode editar."
          : err.message || "Não consegui editar."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    setApagando(true);
    setErroLinha(null);
    try {
      await deleteComment(taskId, c.id);
      setConfirmando(false);
      onApagado(); // recarrega: backend decide tombstone vs some
    } catch (e) {
      const err = e as ApiError;
      setErroLinha(
        err.status === 403
          ? "Você não pode apagar este comentário."
          : err.message || "Não consegui apagar."
      );
      setApagando(false);
    }
  }

  return (
    /* `group`: a bolinha de reagir aparece com o mouse ou o foco na linha. */
    <div
      className="group"
      style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
    >
      <Avatar
        id={c.user_id}
        name={nome}
        size="md"
        title={nome}
        color={c.is_deleted ? "var(--color-ink-faint)" : undefined}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {nome ? nomeCurto(nome) : "Alguem"}
          </span>
          <span className="muted" style={{ fontSize: 11.5 }}>{quando(c.created_at)}</span>
          {c.edited_at && !c.is_deleted && (
            <span className="muted" style={{ fontSize: 11.5 }}>(editado)</span>
          )}

          {/* Acoes inline (reagir / lapis / lixeira): aparecem com o mouse em
              cima da linha ou o foco dentro dela. */}
          {!editando &&
            !confirmando &&
            (podeReagir || podeEditar || podeApagar) && (
            <CapsulaDeAcoes>
              {podeReagir && <SeletorDeReacao onEscolher={alternarReacao} />}
              {podeEditar && (
                <button
                  type="button"
                  className={BOTAO_DA_CAPSULA}
                  onClick={() => {
                    setTexto(c.content);
                    setErroLinha(null);
                    setEditando(true);
                  }}
                  title="Editar"
                  aria-label="Editar comentário"
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
              {podeApagar && (
                <button
                  type="button"
                  className={BOTAO_DA_CAPSULA}
                  onClick={() => {
                    setErroLinha(null);
                    setConfirmando(true);
                  }}
                  title="Apagar"
                  aria-label="Apagar comentário"
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
            </CapsulaDeAcoes>
          )}

          {/* confirmacao de apagar (inline, sem dialog do browser) */}
          {confirmando && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>Apagar?</span>
              <button
                type="button" className="btn btn-ghost"
                onClick={apagar} disabled={apagando}
                style={{ padding: "0 8px", fontSize: 12, color: "var(--danger, #ef4444)" }}
              >
                {apagando ? "…" : "Sim"}
              </button>
              <button
                type="button" className="btn btn-ghost"
                onClick={() => setConfirmando(false)} disabled={apagando}
                style={{ padding: "0 8px", fontSize: 12 }}
              >
                Não
              </button>
            </span>
          )}
        </div>

        {editando ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {/* `onChange` do MentionTextarea entrega a string, nao o evento. */}
            <MentionTextarea
              value={texto}
              onChange={setTexto}
              members={members}
              excluidos={excluidos}
              autoFocus
              rows={2}
              disabled={salvando}
              maxLength={5000}
              style={{ resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button" className="btn btn-primary"
                onClick={salvarEdicao}
                disabled={salvando || !texto.trim()}
                style={{ padding: "4px 12px", fontSize: 13 }}
              >
                {salvando ? "…" : "Salvar"}
              </button>
              <button
                type="button" className="btn btn-ghost"
                onClick={() => {
                  setEditando(false);
                  setTexto(c.content);
                }}
                disabled={salvando}
                style={{ padding: "4px 12px", fontSize: 13 }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div
            // O canto reto do balao aponta para o avatar.
            className="comment-bubble"
            style={{
              fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: c.is_deleted ? "var(--text-faint)" : "var(--text)",
              fontStyle: c.is_deleted ? "italic" : "normal",
            }}
          >
            <CommentText content={c.content} deleted={c.is_deleted} />
          </div>
        )}

        {/* Comentario apagado nao tem fileira (evita ate o espaco em branco). */}
        {!c.is_deleted && (
          <FileiraDeReacoes
            reactions={c.reactions}
            membros={members}
            meuId={me?.id ?? null}
            onAlternar={alternarReacao}
            desabilitado={!podeReagir}
          />
        )}

        {erroReacao && (
          <div className="error-box" style={{ marginTop: 6 }}>{erroReacao}</div>
        )}

        {erroLinha && (
          <div className="error-box" style={{ marginTop: 6 }}>{erroLinha}</div>
        )}
      </div>
    </div>
  );
}

// Tira de preview dos GIFs em rascunho (abaixo do campo de comentario). Mostra
// o GIF, nao o link; o "x" remove antes de enviar. As URLs vem do picker (ja
// sao do dominio GIPHY).
function GifDraftStrip({
  gifs,
  onRemove,
}: {
  gifs: string[];
  onRemove: (i: number) => void;
}) {
  if (gifs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {gifs.map((u, i) => (
        <div key={`${u}-${i}`} style={{ position: "relative", lineHeight: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={u}
            alt="GIF"
            style={{
              height: 64,
              borderRadius: 6,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <button
            type="button"
            aria-label="Remover GIF"
            title="Remover"
            onClick={() => onRemove(i)}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 18,
              height: 18,
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 12,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
