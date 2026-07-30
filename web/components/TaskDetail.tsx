"use client";
// components/TaskDetail.tsx
// Painel de DETALHE da tarefa (padrao Trello): clicar no card abre isto.
// Reusa o objeto da lista (sem GET /tasks/{id} -- dodge do bug E6, ADR 0002).
//
// Responsaveis: pilulas dos atuais SEMPRE visiveis + gatilho "+" que abre a
//   lista (busca + checkbox) como POPOVER flutuante (fecha ao clicar fora).
//   Grava na hora (otimista).
// Subtarefas: lista os filhos diretos (do quadro); gatilho "+" ao lado do titulo
//   cria; o checkbox da linha conclui rapido (desmarcar volta pro status
//   anterior, guardado na sessao); clicar no titulo NAVEGA pra dentro.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { UserPlus } from "lucide-react";

import { useSaidaAnimada } from "@/lib/useSaidaAnimada";
import {
  addAssignee,
  removeAssignee,
  createSubtask,
  updateTask,
  moveTask,
  archiveTask,
  unarchiveTask,
  deleteTask,
  listComments,
  createComment,
  editComment,
  deleteComment,
  currentUser,
  ApiError,
  type Task,
  type Comment,
  type CurrentUser,
} from "@/lib/api";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  STATUSES,
  deadlineTone,
  DEADLINE_COLOR,
} from "@/lib/status";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/GifPicker";
import { isGiphyUrl } from "@/lib/giphy";
import CommentText from "@/components/CommentText";
import MentionTextarea from "@/components/MentionTextarea";
import { nomeCurto } from "@/lib/people";
import {
  acaoDoEnterNoTitulo,
  alternaResponsavel,
  motivoNaoCria,
  podeCriar,
  resumoResponsaveis,
  proximoDaSequencia,
} from "@/lib/criacaoTarefa";
import { linkify } from "@/lib/linkify";

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.color])
);

// Fatia B/C: gatilho compacto redondo -- substitui os botoes-fantasma gordos
// ("Designar" / "Mudar projeto" / "+ Subtarefa") por um alvo pequeno inline.
// "+" adiciona, "✎" edita, "×" fecha. Reusado nos tres campos.
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

// Data/hora curta do comentario (ex.: "24/06 14:30"). created_at vem ISO
// com timezone; o browser converte pro fuso local.
function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskDetail({
  task,
  members,
  projects,
  filhos,
  pai,
  temVoltar,
  onVoltar,
  onClose,
  onEditar,
  onAssigneesChange,
  onAbrirSubtarefa,
  onSubtaskUpsert,
  onTaskMoved,
  onExcluir,
  modo = "modal",
}: {
  task: Task | null; // tarefa focada; null => fechado
  members: Map<string, { name: string }>;
  projects: Map<string, string>; // id do projeto -> titulo (Spec 022)
  filhos: Task[]; // filhos DIRETOS da tarefa focada (do quadro)
  pai?: Task | null; // pai DIRETO (topo da pilha), pra rotular "Subtarefa de X"
  temVoltar: boolean;
  onVoltar: () => void;
  onClose: () => void;
  onEditar: (task: Task) => void;
  onAssigneesChange: (taskId: string, userIds: string[]) => void;
  onAbrirSubtarefa: (sub: Task) => void;
  onSubtaskUpsert: (sub: Task) => void; // criar OU concluir rapido
  onTaskMoved: (task: Task) => void; // Spec 022: task mudou de projeto/avulsa
  onExcluir: (task: Task, cascadeCount: number) => void; // soft-delete cascateado
  // Como renderizar o container externo:
  //   "modal"  (padrao) -> overlay fixo com scrim, clique fora e Esc fecham.
  //                        Comportamento historico; quadro e minhas-tarefas
  //                        NAO passam esta prop e seguem identicos.
  //   "pagina"          -> card no fluxo normal, sem scrim e sem Esc. Usado
  //                        pela rota /tarefa/[id], onde um scrim escuro por
  //                        cima de uma pagina vazia pareceria bug e Esc
  //                        "fechando" (= navegar pra outra rota) surpreende.
  modo?: "modal" | "pagina";
}) {
  const [assignees, setAssignees] = useState<string[]>([]);
  const [abertoResp, setAbertoResp] = useState(false);
  const [busca, setBusca] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  // Projeto (Spec 022): eco local do project_id exibido -- atualiza no sucesso
  // do move sem depender do round-trip do pai. abertoProj abre o seletor;
  // movendoProj bloqueia (nao-otimista, aplica so no sucesso).
  const [projetoAtual, setProjetoAtual] = useState<string | null>(null);
  const [abertoProj, setAbertoProj] = useState(false);
  const [movendoProj, setMovendoProj] = useState(false);
  const [erroProj, setErroProj] = useState<string | null>(null);

  const [criandoSub, setCriandoSub] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  // Criacao rapida de subtarefa (29/07): responsavel OBRIGATORIO, prazo
  // opcional. 44 das 50 tarefas ativas sem responsavel eram subtarefas --
  // porque este campo aceitava so o titulo. Regras em lib/criacaoSubtarefa.
  const [subAssignees, setSubAssignees] = useState<string[]>([]);
  const [subPrazo, setSubPrazo] = useState("");
  const [subPickerAberto, setSubPickerAberto] = useState(false);
  const [subBusca, setSubBusca] = useState("");
  const subPickerRef = useRef<HTMLDivElement>(null);
  const subTituloRef = useRef<HTMLInputElement>(null);
  const [salvandoSub, setSalvandoSub] = useState(false);
  const [erroSub, setErroSub] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState<Set<string>>(new Set());
  // Status de antes de concluir, pra desmarcar voltar pra ele (sessao).
  const [statusAnterior, setStatusAnterior] = useState<Record<string, string>>({});
  const [arquivando, setArquivando] = useState(false);
  // Feedback do botao "Copiar link" (volta pro texto normal sozinho).
  const [copiado, setCopiado] = useState(false);
  // Falha de copia tem estado PROPRIO em vez de reusar `erro`: a caixa de
  // `erro` renderiza no meio do card e o botao fica no rodape -- num card com
  // rolagem a mensagem cairia fora da vista de quem acabou de clicar.
  const [copiaErro, setCopiaErro] = useState<string | null>(null);
  // Exclusao (soft-delete cascateado). Confirmacao inline mostra o estrago.
  const [confirmandoExcluir, setConfirmandoExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // ---- Comentarios (Entrega 14, Fatia 2) ----
  const [comentarios, setComentarios] = useState<Comment[] | null>(null);
  const [erroCom, setErroCom] = useState<string | null>(null);
  const [novoComent, setNovoComent] = useState("");
  const [enviandoComent, setEnviandoComent] = useState(false);
  const [respondendoId, setRespondendoId] = useState<string | null>(null);
  const [textoResposta, setTextoResposta] = useState("");
  // Fatia A: historico de comentarios colavel (o composer abaixo fica SEMPRE
  // visivel). Sessao-level de proposito: NAO entra no reset por task -- fica
  // como a pessoa deixou enquanto navega entre tarefas.
  const [threadAberto, setThreadAberto] = useState(true);

  // GIFs escolhidos no rascunho (viram token [gif:URL] so no envio). Ficam como
  // chip de preview abaixo do campo -- o textarea nao mostra o link.
  const [gifsNovo, setGifsNovo] = useState<string[]>([]);
  const [gifsResp, setGifsResp] = useState<string[]>([]);
  const [enviandoResp, setEnviandoResp] = useState(false);
  const topComentRef = useRef<HTMLTextAreaElement>(null);
  const respostaRef = useRef<HTMLTextAreaElement>(null);
  // Fatia B: wrapper do popover de responsaveis (ancora + deteccao de clique-fora).
  const respWrapRef = useRef<HTMLDivElement>(null);

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
    setErro(null);
    setSaving(new Set());
    setProjetoAtual(task?.project_id ?? null);
    setAbertoProj(false);
    setMovendoProj(false);
    setErroProj(null);
    setCriandoSub(false);
    setNovoTitulo("");
    setErroSub(null);
    setSubSaving(new Set());
    setStatusAnterior({});
    setArquivando(false);
    // Estado de exclusao: ANTES nao era zerado aqui -> a confirmacao (e o
    // "excluindo") ficavam grudados e reapareciam travados ao reabrir/trocar.
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
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao trocar/fechar a resposta, zera os GIFs de rascunho da resposta.
  useEffect(() => {
    setGifsResp([]);
  }, [respondendoId]);

  // --- Saida animada (Spec 027, D4) ------------------------------------
  // A maquina de estados vive em `lib/useSaidaAnimada.ts`, coberta por teste.
  // Aqui fica so o consumo: este componente desenha, nao decide.
  const { saindo, fecharSuave } = useSaidaAnimada({
    idAtual: task?.id ?? null,
    animar: modo === "modal", // modo pagina nao tem scrim nem animacao
    onFechar: onClose,
  });

  useEffect(() => {
    // Esc so faz sentido no modo modal. Na rota /tarefa/[id] "fechar" e
    // navegar pra outra pagina -- disparar isso com Esc seria surpresa.
    if (!task || modo !== "modal") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fecharSuave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, fecharSuave, modo]);

  // Fatia B: fecha o popover de responsaveis ao clicar fora (mesmo padrao do
  // EmojiPicker: mousedown no documento, ignora cliques dentro do wrapper).
  useEffect(() => {
    if (!abertoResp) return;
    function onDown(e: MouseEvent) {
      if (respWrapRef.current && !respWrapRef.current.contains(e.target as Node)) {
        setAbertoResp(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abertoResp]);

  // Usuario logado: uma vez (memoizado). Falha silenciosa -> sem acoes
  // inline, mas o thread ainda renderiza.
  useEffect(() => {
    currentUser()
      .then(setMe)
      .catch(() => {});
  }, []);

  // Carrega o thread ao abrir/trocar de tarefa. size 100 cobre threads do
  // tamanho do time sem UI de paginacao (limite conhecido: acima disso,
  // trunca -- aceitavel em v1).
  useEffect(() => {
    if (!task) return;
    let vivo = true;
    setComentarios(null);
    setErroCom(null);
    listComments(task.id, { size: 100 })
      .then((r) => {
        if (vivo) setComentarios(r.items);
      })
      .catch((e: ApiError) => {
        if (vivo) setErroCom(e.message || "Nao consegui carregar os comentarios.");
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fecha o picker de responsavel da subtarefa ao clicar fora.
  useEffect(() => {
    if (!subPickerAberto) return;
    function onDown(e: MouseEvent) {
      if (subPickerRef.current && !subPickerRef.current.contains(e.target as Node)) {
        setSubPickerAberto(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [subPickerAberto]);

  // Lista do picker da subtarefa. Separada de `filtrados` (que serve ao
  // picker da tarefa mae) porque as buscas sao independentes -- compartilhar
  // o termo faria digitar num lugar filtrar o outro.
  const membrosParaSub = useMemo(() => {
    const q = subBusca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name }))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, subBusca]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return Array.from(members.entries())
      .map(([id, m]) => ({ id, name: m.name }))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, busca]);

  if (!task) return null;
  const tid = task.id;
  const tidProjeto = task.project_id ?? null; // pai e subtarefa no mesmo projeto
  // Spec 022: task de topo pode trocar/tirar projeto; subtarefa herda do pai
  // (read-only). Nome do projeto atual resolve do Map (null/ausente => avulsa).
  const ehTopo = !task.parent_task_id;
  const nomeProjetoAtual = projetoAtual ? projects.get(projetoAtual) ?? null : null;
  const dueTone = deadlineTone(task.due_date, task.status, task.is_archived);
  const concluidas = filhos.filter((f) => f.status === "COMPLETED").length;
  // Porcentagem concluida (0 quando nao ha subtarefas) -- alimenta a barra E o rotulo.
  const pctSub = filhos.length ? Math.round((concluidas / filhos.length) * 100) : 0;
  // Criacao: created_at e ISO com fuso (nao date-only) -> new Date direto ja
  // resolve pro fuso local. Nome do criador via members; se nao resolver
  // (ex.: usuario desativado / fora da lista), mostra so a data (nunca o UUID).
  const criadoEm = new Date(task.created_at).toLocaleDateString("pt-BR");
  const criador = members.get(task.created_by)?.name ?? null;

  async function toggle(userId: string) {
    const jaEra = assignees.includes(userId);
    const anterior = assignees;
    const otimista = jaEra
      ? assignees.filter((x) => x !== userId)
      : [...assignees, userId];

    setErro(null);
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
      const err = e as ApiError;
      setErro(
        err.status === 403
          ? "Voce nao pode designar nesta tarefa."
          : err.status === 422
          ? "Essa pessoa nao alcanca esta tarefa (fora do time)."
          : "Nao consegui atualizar o responsavel."
      );
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(userId);
        return n;
      });
    }
  }

  // Spec 022: move a task pra outro projeto (destino) OU tira de projeto
  // (destino === null -> detach). NAO otimista: o move reparenta a subtree e
  // pode ser recusado (visibilidade, 422), entao so aplica no sucesso. So faz
  // sentido em task de topo -- a UI abaixo esconde o controle em subtarefa.
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
          ? "Voce nao pode mover esta tarefa."
          : err.status === 422
          ? "Nao foi possivel mover pra esse projeto."
          : err.status === 404
          ? "Projeto nao encontrado ou sem acesso."
          : "Nao consegui mover a tarefa de projeto."
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
      // Trava de UI. O backend segue aceitando subtarefa sem responsavel de
      // proposito (n8n, triagem de solicitacao) -- a exigencia e daqui.
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
      onSubtaskUpsert(nova);
      // Fica ABERTO para a proxima: decompor trabalho vem em rajada, e fechar
      // a cada criacao custava uma ida ao "+" por subtarefa. Responsavel e
      // prazo ficam; o titulo limpa e recebe o foco de volta.
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
      setErroSub((e as ApiError).message || "Nao consegui criar a subtarefa.");
    } finally {
      setSalvandoSub(false);
    }
  }

  async function alternarConclusao(f: Task) {
    const concluida = f.status === "COMPLETED";
    const destino = concluida ? statusAnterior[f.id] ?? "BACKLOG" : "COMPLETED";
    if (!concluida) {
      // guarda o status de antes pra um futuro desmarcar
      setStatusAnterior((m) => ({ ...m, [f.id]: f.status }));
    }
    setErroSub(null);
    setSubSaving((s) => new Set(s).add(f.id));
    onSubtaskUpsert({ ...f, status: destino }); // otimista
    try {
      const atualizada = await updateTask(f.id, { status: destino });
      onSubtaskUpsert(atualizada);
    } catch (e) {
      onSubtaskUpsert(f); // revert
      setErroSub("Nao consegui atualizar a subtarefa.");
    } finally {
      setSubSaving((s) => {
        const n = new Set(s);
        n.delete(f.id);
        return n;
      });
    }
  }

  // Copia o link canonico da tarefa (/tarefa/<id>) pra area de transferencia.
  // A rota /tarefa/[id] e o endereco ESTAVEL: nao depende de qual quadro,
  // projeto ou lista a pessoa estava olhando quando copiou.
  //
  // navigator.clipboard so existe em contexto seguro (https ou localhost). O
  // prod e https, mas testar por IP na rede local cai no fallback do
  // execCommand (obsoleto, porem e o unico caminho fora de contexto seguro).
  // Se os dois falharem, mostra a URL pra pessoa copiar na mao -- nunca fica
  // um clique que aparentemente nao fez nada.
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
    setErro(null);
    setArquivando(true);
    try {
      const r = task!.is_archived ? await unarchiveTask(tid) : await archiveTask(tid);
      onSubtaskUpsert(r); // upsert generico: o quadro reflete is_archived
    } catch (e) {
      setErro(
        (e as ApiError).status === 403
          ? "Voce nao pode arquivar esta tarefa."
          : "Nao consegui arquivar a tarefa."
      );
    } finally {
      setArquivando(false);
    }
  }

  async function excluir() {
    setErro(null);
    setExcluindo(true);
    try {
      const r = await deleteTask(tid);
      onExcluir(task!, r.cascade_count); // quadro remove a subtree e fecha
    } catch (e) {
      setErro(
        (e as ApiError).status === 403
          ? "Voce nao pode excluir esta tarefa."
          : "Nao consegui excluir a tarefa."
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
      setErroCom((e as ApiError).message || "Nao consegui comentar.");
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
      setErroCom((e as ApiError).message || "Nao consegui responder.");
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

  // Apagar e 204 (sem corpo) e o resultado depende de ter replica viva
  // (some) ou nao (tombstone). Em vez de reimplementar a regra D5 aqui,
  // recarrego o thread -- o backend decide.
  async function recarregarComentarios() {
    try {
      const r = await listComments(tid, { size: 100 });
      setComentarios(r.items);
    } catch (e) {
      setErroCom((e as ApiError).message || "Nao consegui recarregar os comentarios.");
    }
  }

  return (
    <div
      // Modo modal: o scrim inteiro e clicavel pra fechar. Modo pagina: nao ha
      // scrim nem "fora" pra clicar -- o container vira um bloco comum.
      onClick={modo === "modal" ? fecharSuave : undefined}
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
        className={modo === "modal" ? "modal-card" : undefined}
        data-saindo={saindo ? "true" : undefined}
        style={{
          width: 700, maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 14, padding: 24,
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 16,
          // Modal: altura travada e rolagem POR DENTRO do card (a pagina atras
          // nao rola). Pagina: sem trava -- quem rola e a propria pagina, senao
          // o card ganharia uma segunda barra de rolagem aninhada.
          ...(modo === "modal"
            ? { maxHeight: "88vh", overflowY: "auto" as const }
            : { margin: "0 auto" }),
        }}
      >
        {temVoltar && (
          <button
            type="button" className="btn btn-ghost" onClick={onVoltar}
            style={{
              alignSelf: "flex-start", padding: "2px 8px", fontSize: 13,
              maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              // `overflow: hidden` zera o min-height automatico deste flex item
              // (CSS Flexbox 4.5). Sem flexShrink 0, o botao encolhe na vertical
              // quando o conteudo do modal estoura 88vh e o texto sai cortado
              // pela metade. NAO remover junto com o overflow.
              flexShrink: 0,
              lineHeight: 1.6,
            }}
            title={pai ? `Voltar para ${pai.title}` : "Voltar"}
          >
            ‹ Voltar{pai ? ` para ${pai.title}` : ""}
          </button>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
            {task.title}
          </h2>
          <button
            type="button" className="btn btn-ghost" onClick={fecharSuave}
            style={{ padding: "4px 10px", flexShrink: 0 }} aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {task.parent_task_id && (
            <Badge tone="soft" size="md" color="var(--accent)">
              Subtarefa
            </Badge>
          )}
          <Badge tone="solid" size="md" color={STATUS_COLOR[task.status]}>
            {STATUS_LABEL[task.status] || task.status}
          </Badge>
          <Badge tone="soft" size="md" color={PRIORITY_COLOR[task.priority]}>
            {PRIORITY_LABEL[task.priority] || task.priority}
          </Badge>
          {/* Spec 022: chip do projeto (glance). Com projeto resolvido -> nome;
              sem projeto (avulsa) -> "Sem projeto"; com projeto NAO resolvido no
              Map (arquivado/fora da lista) -> nao inventa, nao renderiza. */}
          {projetoAtual ? (
            nomeProjetoAtual ? (
              <Badge tone="soft" size="md" color="var(--text-faint)">
                {nomeProjetoAtual}
              </Badge>
            ) : null
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>Sem projeto</span>
          )}
          {task.due_date && (
            <span
              className={dueTone ? undefined : "muted"}
              style={{
                fontSize: 12.5,
                color: dueTone ? DEADLINE_COLOR[dueTone] : undefined,
                fontWeight: dueTone ? 600 : undefined,
              }}
            >
              ◷ {new Date(task.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
            </span>
          )}
          {task.is_archived && (
            <span className="muted" style={{ fontSize: 12.5 }}>arquivada</span>
          )}
        </div>

        {/* Criacao: data + quem criou (nome resolvido; sem nome -> so a data). */}
        <div className="muted" style={{ fontSize: 12.5 }}>
          Criada em {criadoEm}
          {criador ? ` por ${criador}` : ""}
        </div>

        <div className="field">
          <span className="label">Descricao</span>
          {task.description && task.description.trim().length > 0 ? (
            // linkify: URL http/https vira <a>. Descricao NAO passa pelo
            // parser de mencao/gif -- esses tokens so existem em comentario.
            // overflowWrap: URL longa SEM hifen (so barras/underscore) nao tem
            // ponto de quebra natural e vazaria a largura do modal.
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {linkify(task.description, "desc-")}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>Sem descricao.</span>
          )}
        </div>

        {/* ---- Projeto (Spec 022): chip acima; aqui o controle de trocar/tirar.
             So em task de topo -- subtarefa herda o projeto do pai (read-only). ---- */}
        {ehTopo && (
          <div className="field">
            <span className="label">Projeto</span>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {projetoAtual ? (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center",
                    background: "var(--surface-2)", borderRadius: 999,
                    padding: "3px 12px", fontSize: 12.5,
                  }}
                >
                  {nomeProjetoAtual ?? "Projeto atual"}
                </span>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  Sem projeto atrelado.
                </span>
              )}

              <button
                type="button"
                onClick={() => setAbertoProj((v) => !v)}
                disabled={movendoProj}
                aria-label={projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"}
                aria-expanded={abertoProj}
                title={projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"}
                style={{ ...GATILHO_STYLE, opacity: movendoProj ? 0.5 : 1 }}
              >
                {abertoProj ? "×" : projetoAtual ? "✎" : "+"}
              </button>
            </div>

            {abertoProj && (
              <div style={{ marginTop: 6 }}>
                <select
                  className="input"
                  value={projetoAtual ?? ""}
                  disabled={movendoProj}
                  onChange={(e) => mudarProjeto(e.target.value || null)}
                >
                  <option value="">— Sem projeto (tirar) —</option>
                  {Array.from(projects.entries())
                    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
                    .map(([id, titulo]) => (
                      <option key={id} value={id}>{titulo}</option>
                    ))}
                </select>
              </div>
            )}

            {movendoProj && (
              <span className="muted" style={{ fontSize: 13, marginTop: 4 }}>Movendo…</span>
            )}
            {erroProj && (
              <div className="error-box" style={{ marginTop: 8 }}>{erroProj}</div>
            )}
          </div>
        )}

        {/* ---- Responsaveis: pilulas atuais + gatilho "+" que abre a lista
             como POPOVER flutuante (nao empurra o layout; fecha ao clicar fora) ---- */}
        <div className="field">
          <span className="label">Responsaveis</span>

          <div ref={respWrapRef} style={{ position: "relative" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {assignees.length > 0 ? (
                assignees.map((id) => {
                  const nome = members.get(id)?.name ?? "";
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        background: "var(--surface-2)", borderRadius: 999,
                        padding: "2px 10px 2px 2px", fontSize: 12.5,
                      }}
                    >
                      <Avatar id={id} name={nome} size="sm" />
                      {nome ? nomeCurto(nome) : "Responsavel"}
                    </span>
                  );
                })
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>Ninguem designado.</span>
              )}

              <button
                type="button"
                onClick={() => setAbertoResp((v) => !v)}
                aria-label="Designar responsavel"
                aria-expanded={abertoResp}
                title="Designar"
                style={GATILHO_STYLE}
              >
                {abertoResp ? "×" : "+"}
              </button>
            </div>

            {abertoResp && (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                  width: 300, maxWidth: "100%",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
                }}
              >
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
                      Ninguem encontrado.
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
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {erro && (
            <div className="error-box" style={{ marginTop: 8 }}>{erro}</div>
          )}
        </div>

        {/* ---- Subtarefas ---- */}
        <div className="field">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="label">
              Subtarefas{filhos.length > 0 ? ` (${concluidas}/${filhos.length})` : ""}
            </span>
            {!criandoSub && (
              <button
                type="button"
                onClick={() => setCriandoSub(true)}
                aria-label="Adicionar subtarefa"
                title="Adicionar subtarefa"
                style={GATILHO_STYLE}
              >
                +
              </button>
            )}
          </div>

          {/* Barra de progresso das subtarefas. Anima sozinha: `concluidas`
              recomputa quando alternarConclusao faz o upsert OTIMISTA no estado
              do pai (a caixa marca -> a barra enche na hora, sem esperar a API;
              reverte se o PATCH falhar). Proporcao = concluidas / filhos. */}
          {filhos.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <div
                role="progressbar"
                aria-valuenow={concluidas}
                aria-valuemin={0}
                aria-valuemax={filhos.length}
                aria-label={`${concluidas} de ${filhos.length} subtarefas concluídas (${pctSub}%)`}
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

          {filhos.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
              {filhos.map((f, i) => {
                const concluida = f.status === "COMPLETED";
                const ocupado = subSaving.has(f.id);
                // Mesma regra do card do quadro: concluida/arquivada nao alerta.
                const tone = deadlineTone(f.due_date, f.status, f.is_archived);
                // Rotulo da prioridade; mesmo fallback do card do quadro.
                const rotuloPrio = PRIORITY_LABEL[f.priority] || f.priority;
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      opacity: ocupado ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={concluida}
                      disabled={ocupado}
                      title={concluida ? "Reabrir" : "Concluir"}
                      onChange={() => alternarConclusao(f)}
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
                        {/* Prazo e urgencia da subtarefa (pedido da equipe,
                            29/07). Os dados JA vinham no objeto -- a linha so
                            nao os desenhava. Mesma regra de cor do card do
                            quadro (deadlineTone), pra atrasada nao ser
                            vermelha la e cinza aqui, e a prioridade com o
                            mesmo selo e fallback que o card usa: TODAS
                            aparecem (decisao da Camila, 29/07). */}
                        {(f.due_date || rotuloPrio) && (
                          <span
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              flexWrap: "wrap", fontSize: 11,
                            }}
                          >
                            {rotuloPrio && (
                              <Badge
                                tone="soft"
                                size="sm"
                                color={PRIORITY_COLOR[f.priority]}
                              >
                                {rotuloPrio}
                              </Badge>
                            )}
                            {f.due_date && (
                              <span
                                className={tone ? undefined : "muted"}
                                title={new Date(
                                  f.due_date + "T00:00:00"
                                ).toLocaleDateString("pt-BR")}
                                style={{
                                  color: tone ? DEADLINE_COLOR[tone] : undefined,
                                  fontWeight: tone ? 600 : undefined,
                                }}
                              >
                                ◷{" "}
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
                marginTop: filhos.length > 0 ? 8 : 0,
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
                placeholder="Titulo da subtarefa…"
                value={novoTitulo}
                disabled={salvandoSub}
                maxLength={255}
                onChange={(e) => setNovoTitulo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    fecharCriacaoSub();
                    return;
                  }
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  // Enter com titulo e SEM responsavel abre o seletor em vez
                  // de criar. Criar aqui repetiria o bug do TaskModal, onde o
                  // Enter gerava tarefa sem ninguem designado.
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
                {/* Responsavel: obrigatorio. O botao carrega o estado no
                    proprio rotulo, para a exigencia ficar visivel antes do
                    erro aparecer. */}
                <div ref={subPickerRef} style={{ position: "relative" }}>
                  <button
                    type="button"
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

                  {subPickerAberto && (
                    <div
                      style={{
                        position: "absolute", top: "calc(100% + 6px)", left: 0,
                        zIndex: 40, width: 260, background: "var(--surface)",
                        border: "1px solid var(--border)", borderRadius: 10,
                        boxShadow: "var(--shadow)", padding: 8,
                      }}
                    >
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
                    </div>
                  )}
                </div>

                {/* Prazo: opcional. "Faz quando der" e decisao legitima. */}
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

        {/* ---- Comentarios (Entrega 14) ---- */}
        <div className="field">
          {comentarios && comentarios.length > 0 ? (
            <button
              type="button"
              onClick={() => setThreadAberto((v) => !v)}
              aria-expanded={threadAberto}
              className="label"
              style={{
                background: "transparent", border: "none", padding: 0,
                cursor: "pointer", display: "inline-flex", alignItems: "center",
                gap: 6, textAlign: "left", alignSelf: "flex-start",
              }}
            >
              <span>Comentarios ({comentarios.length})</span>
              <span
                aria-hidden
                style={{
                  fontSize: 13, lineHeight: 1, display: "inline-block",
                  transition: "transform 120ms ease",
                  transform: threadAberto ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                ›
              </span>
            </button>
          ) : (
            <span className="label">Comentarios</span>
          )}

          {comentarios === null ? (
            <span className="muted" style={{ fontSize: 13 }}>Carregando…</span>
          ) : comentarios.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              Nenhum comentario ainda.
            </span>
          ) : !threadAberto ? null : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {comentarios
                .filter((c) => !c.parent_comment_id)
                .map((c) => (
                  <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <LinhaComentario
                      c={c}
                      members={members}
                      me={me}
                      taskId={tid}
                      onEditado={aoEditado}
                      onApagado={recarregarComentarios}
                    />

                    {comentarios
                      .filter((r) => r.parent_comment_id === c.id)
                      .map((r) => (
                        <div key={r.id} style={{ marginLeft: 30 }}>
                          <LinhaComentario
                            c={r}
                            members={members}
                            me={me}
                            taskId={tid}
                            onEditado={aoEditado}
                            onApagado={recarregarComentarios}
                          />
                        </div>
                      ))}

                    {respondendoId === c.id ? (
                      <div style={{ marginLeft: 30, display: "flex", flexDirection: "column", gap: 6 }}>
                        <MentionTextarea
                          ref={respostaRef}
                          value={textoResposta}
                          onChange={setTextoResposta}
                          members={members}
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
                    ) : (
                      !c.is_deleted && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setRespondendoId(c.id);
                            setTextoResposta("");
                          }}
                          style={{
                            marginLeft: 30, alignSelf: "flex-start",
                            padding: "2px 8px", fontSize: 12,
                          }}
                        >
                          Responder
                        </button>
                      )
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* caixa de novo comentario (quem ve a tarefa pode comentar) */}
          <MentionTextarea
            ref={topComentRef}
            value={novoComent}
            onChange={setNovoComent}
            members={members}
            rows={2}
            placeholder="Escreva um comentario… (@ menciona)"
            disabled={enviandoComent}
            maxLength={5000}
            wrapperStyle={{ marginTop: 10 }}
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
          // Fallback visivel: a copia automatica falhou, entao mostra o
          // endereco pra pessoa selecionar e copiar na mao. Fica coladinho no
          // botao que ela acabou de clicar.
          <div
            className="error-box"
            style={{ marginTop: 8, fontSize: 13, wordBreak: "break-all" }}
          >
            Não consegui copiar automaticamente. O endereço é:{" "}
            <span style={{ userSelect: "all" }}>{copiaErro}</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button" className="btn btn-ghost" onClick={alternarArquivo}
            disabled={arquivando} style={{ marginRight: "auto" }}
          >
            {arquivando ? "…" : task.is_archived ? "Desarquivar" : "Arquivar"}
          </button>
          <button
            type="button" className="btn btn-ghost" onClick={copiarLink}
            title="Copia o endereco desta tarefa pra compartilhar"
          >
            {copiado ? "Copiado!" : "Copiar link"}
          </button>
          {(me?.permissions.includes("task.delete") ?? false) && !confirmandoExcluir && (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => { setErro(null); setConfirmandoExcluir(true); }}
              style={{ color: "var(--danger, #b42318)" }}
            >
              Excluir
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onEditar(task)}>
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}

// Uma linha do thread: avatar + autor + hora + conteudo, com acoes inline.
// Lapis (editar) so pro autor; lixeira (apagar) pro autor OU quem tem
// task.delete (mirror do backend). Tombstone nao tem acao. Apagar e 204:
// quem decide tombstone-vs-some e o backend -> a linha so dispara o reload.
function LinhaComentario({
  c,
  members,
  me,
  taskId,
  onEditado,
  onApagado,
}: {
  c: Comment;
  members: Map<string, { name: string }>;
  me: CurrentUser | null;
  taskId: string;
  onEditado: (atualizado: Comment) => void;
  onApagado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(c.content);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroLinha, setErroLinha] = useState<string | null>(null);

  const nome = members.get(c.user_id)?.name ?? "";
  const souAutor = me != null && me.id === c.user_id;
  const podeModerar = me?.permissions.includes("task.delete") ?? false;
  const temAcao = !c.is_deleted && me != null;
  const podeEditar = temAcao && souAutor;
  const podeApagar = temAcao && (souAutor || podeModerar);

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
          : err.message || "Nao consegui editar."
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
          ? "Voce nao pode apagar este comentario."
          : err.message || "Nao consegui apagar."
      );
      setApagando(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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

          {/* acoes inline (lapis / lixeira) */}
          {!editando && !confirmando && (podeEditar || podeApagar) && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {podeEditar && (
                <button
                  type="button" className="btn btn-ghost"
                  onClick={() => {
                    setTexto(c.content);
                    setErroLinha(null);
                    setEditando(true);
                  }}
                  title="Editar"
                  style={{ padding: "0 6px", fontSize: 12 }}
                >
                  ✎
                </button>
              )}
              {podeApagar && (
                <button
                  type="button" className="btn btn-ghost"
                  onClick={() => {
                    setErroLinha(null);
                    setConfirmando(true);
                  }}
                  title="Apagar"
                  style={{ padding: "0 6px", fontSize: 12 }}
                >
                  🗑
                </button>
              )}
            </span>
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
                Nao
              </button>
            </span>
          )}
        </div>

        {editando ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <textarea
              className="input"
              autoFocus
              rows={2}
              value={texto}
              disabled={salvando}
              maxLength={5000}
              onChange={(e) => setTexto(e.target.value)}
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
