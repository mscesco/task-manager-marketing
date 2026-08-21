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
import { UserPlus, X, Pencil, Plus, Calendar, ChevronLeft } from "lucide-react";

import { mesclaTarefa } from "@/lib/mesclaTarefa";
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
  colunasDoQuadro,
  listMembers,
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
  STATUS_TEXT,
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
import { checklist } from "@/lib/subtarefas";
import { deadlineTonePorColuna, type Coluna } from "@/lib/coluna";
import {
  acaoDoEnterNoTitulo,
  alternaResponsavel,
  motivoNaoCria,
  podeCriar,
  resumoResponsaveis,
  proximoDaSequencia,
} from "@/lib/criacaoTarefa";
import { linkify } from "@/lib/linkify";

// ⚠️ RESERVA DO BADGE, e so isso (fatia 4c-2). O rotulo do badge passou a sair
// de `coluna.name`; este mapa responde pelo caso em que a coluna da tarefa nao
// esta na lista carregada -- quadro sem alcance, coluna apagada na fatia 5, ou
// as colunas ainda a caminho. Sem ele o badge ficaria vazio nesses casos.
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
// Spec 031 (C1a): a cor do BADGE vem de STATUS_TEXT, nao de STATUSES[].color.
// STATUSES[].color e o token de TRACO (bolinha, borda de coluna) -- como texto
// ou como fundo sob texto ele reprova AA. Ver Spec 031 §2.2b/§2.2c.
const STATUS_COLOR: Record<string, string> = STATUS_TEXT;

// Fatia B/C: gatilho compacto redondo -- substitui os botoes-fantasma gordos
// ("Designar" / "Mudar projeto" / "+ Subtarefa") por um alvo pequeno inline.
// Spec 031 (C10): os tres estados usavam glifo Unicode ("+", "✎", "×").
// Viraram icone `lucide-react` -- glifo muda de forma conforme a fonte do
// sistema e o leitor de tela le o nome do caractere. O `aria-label` de cada
// botao ja diz a acao, entao o icone vai `aria-hidden`. Reusado nos tres campos.
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
  pai,
  temVoltar,
  onVoltar,
  onClose,
  onEditar,
  onDuplicar,
  onAssigneesChange,
  onAbrirSubtarefa,
  onSubtaskUpsert,
  onTaskMoved,
  onExcluir,
  mostrarArquivadas,
  projetosPessoais,
  membrosInativos,
  subtimePorMembro,
  rootTeamId,
  modo = "modal",
}: {
  task: Task | null; // tarefa focada; null => fechado
  members: Map<string, { name: string }>;
  projects: Map<string, string>; // id do projeto -> titulo (Spec 022)
  // ⚠️ `filhos` DEIXOU DE SER PROP na Spec 042 (B1). O painel busca as
  // proprias filhas -- ver o `useEffect` no corpo. A remocao e o que permite
  // ao QUADRO parar de carregar a subarvore: 917 tarefas baixadas para
  // desenhar 170 cards (medido em 19/08).
  //
  // ⚠️ A PROP FOI REMOVIDA, E NAO TORNADA OPCIONAL, de proposito. Este arquivo
  // ja registra (nas tres props abaixo) que prop opcional e onde "esqueci um
  // chamador" vira silencio. Removendo, o `tsc` aponta os QUATRO chamadores.
  pai?: Task | null; // pai DIRETO (topo da pilha), pra rotular "Subtarefa de X"
  temVoltar: boolean;
  onVoltar: () => void;
  onClose: () => void;
  onEditar: (task: Task) => void;
  // Spec 033. ⚠️ OBRIGATORIA, pelo mesmo motivo das tres props abaixo: o
  // TaskDetail tem QUATRO chamadores, e prop opcional e onde "esqueci um
  // chamador" vira silencio -- o botao simplesmente nao apareceria em tres
  // telas e nenhum portao reclamaria. `tsc` faz a pergunta.
  onDuplicar: (task: Task) => void;
  onAssigneesChange: (taskId: string, userIds: string[]) => void;
  onAbrirSubtarefa: (sub: Task) => void;
  onSubtaskUpsert: (sub: Task) => void; // criar OU concluir rapido
  onTaskMoved: (task: Task) => void; // Spec 022: task mudou de projeto/avulsa
  onExcluir: (task: Task, cascadeCount: number) => void; // soft-delete cascateado
  // ⚠️ AS TRES PROPS ABAIXO SAO OBRIGATORIAS DE PROPOSITO. Elas eram
  // opcionais, e o resultado foi que a C13, a C14 e a C15 chegaram em UM dos
  // quatro chamadores (`Board`) e ficaram de fora dos outros tres -- sem
  // nenhum portao reclamar, porque prop opcional ausente e codigo valido. O
  // `?` era o que transformava "esqueci um chamador" em silencio.
  //
  // Custo aceito: quem montar o quinto chamador PRECISA decidir os tres
  // valores. E o ponto -- `tsc` passa a fazer a pergunta que o handoff vinha
  // fazendo em texto, quatro entregas seguidas.
  //
  // Quem nao busca arquivada (a rota /tarefa/[id]) passa `false` explicito;
  // quem nao tem o dado a mao passa `new Set()`, e isso fica VISIVEL na
  // chamada em vez de escondido no default.
  //
  // Espelha a caixa "Mostrar arquivadas" da tela de fora. Sem ela, a checklist
  // esconde a subtarefa arquivada (Spec 031, C11); com ela, a subtarefa volta
  // APAGADA -- mesmo tratamento que o card arquivado ja recebe no quadro.
  // ⚠️ O quadro so BUSCA arquivada quando a caixa esta marcada
  // (`include_archived: mostrarArquivadas`), entao sem esta prop o componente
  // nao teria como distinguir "nao ha arquivada" de "ha, mas escondida".
  mostrarArquivadas: boolean;
  // Ids de projeto PESSOAL. Eles continuam em `projects` -- o mapa resolve
  // NOME e a tarefa que ja mora num pessoal precisa exibir o dela. O que este
  // conjunto muda e o SELETOR: pessoal nao e destino oferecido.
  //
  // ⚠️ Mover tarefa de time pra projeto pessoal a faz sumir do quadro dos
  // outros -- o backend filtra por `is_personal=false OR created_by=me`
  // (task_repository:82-95). Nao e um bug do seletor: e o seletor oferecendo
  // um caminho que produz sumico silencioso.
  projetosPessoais: Set<string>;
  // Ids de membro DESATIVADO. Mesmo desenho de `projetosPessoais`: `members`
  // continua completo (a tarefa que ja tem um inativo designado precisa
  // resolver o NOME dele), e o conjunto so tira do SELETOR.
  //
  // ⚠️ Quem JA esta designado continua na lista, mesmo inativo -- senao nao
  // haveria como DESIGNAR DE VOLTA pra ninguem: a unica forma de tirar a
  // pessoa e desmarcando a caixa dela. `TaskModal` ja filtrava assim desde
  // sempre (linha 131); o detalhe e que ficou de fora.
  membrosInativos: Set<string>;
  // Subtime de cada membro (id -> subtime, ou null pra quem so esta na raiz)
  // e o id do time raiz. Juntos com `task.team_id` respondem quem ALCANCA
  // esta tarefa -- ver `lib/escopoTarefa.ts` para a regra e para a ressalva
  // sobre gestor/admin.
  //
  // ⚠️ Por que o dado CRU e nao um `Set` pronto: a resposta depende da tarefa
  // FOCADA, e a tarefa focada muda aqui dentro (navegar pra subtarefa). Um
  // conjunto calculado la fora congelaria no escopo da tarefa de entrada.
  subtimePorMembro: Map<string, string | null>;
  rootTeamId: string | null;
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
  // ⚠️ SPEC 042 (B1) -- AS FILHAS SAO BUSCADAS AQUI, e nao mais recebidas.
  // Ate aqui os quatro chamadores derivavam `filhos` da lista que ja tinham
  // em memoria, e era exatamente isso que obrigava o quadro a baixar a
  // subarvore inteira.
  //
  // ⚠️ LIMPA ANTES DE BUSCAR. Sem o `setFilhos([])`, navegar para uma
  // subtarefa mostra por um instante a checklist da tarefa ANTERIOR -- e
  // navegar entre tarefas e o gesto comum desta tela.
  //
  // ⚠️ `cancelado` guarda contra resposta fora de ordem: abrir A, ir para B, e
  // a resposta de A chegar depois pintaria a checklist de B com as filhas de A.
  //
  // ⚠️ ERRO NAO VIRA LISTA VAZIA EM SILENCIO. Checklist vazia se le como "esta
  // tarefa nao tem subtarefa" -- foi essa leitura falsa que a duplicacao
  // produziu em 05/08 ("duplicou sem as subtarefas", e elas estavam no banco).
  // Por isso `erroFilhos` existe e a tela o mostra.
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

  // ⚠️ O UPSERT PRECISA BATER NOS DOIS ESTADOS, e este e o ponto mais facil de
  // errar na B1. Antes dela quem guardava `filhos` era o chamador, e o
  // `onSubtaskUpsert` sozinho ja atualizava a checklist -- o teste
  // `TaskDetailChecklist` provava isso com um `Pai` que mexia no proprio
  // estado. Agora a lista mora AQUI: sem esta funcao, marcar a caixinha manda
  // o PATCH, avisa o quadro, e NAO muda nada na tela em que a pessoa clicou.
  //
  // ⚠️ NAO SERVE PARA A PROPRIA TAREFA FOCADA. Em `alternarArquivo` o
  // `onSubtaskUpsert` recebe a tarefa aberta (nao uma filha) -- chamar isto
  // la a inseriria na lista de filhas dela mesma.
  function upsertFilhaLocal(sub: Task) {
    setFilhos((atual) => {
      const i = atual.findIndex((f) => f.id === sub.id);
      if (i === -1) return [...atual, sub];
      const copia = [...atual];
      // ⚠️ PRESERVAR O QUE A MUTACAO NAO DEVOLVE (ADR 0025). Foi a ausencia
      // disto que fez a bolinha do responsavel SUMIR ao marcar a caixinha,
      // relatado na tela em 21/08/2026. A guarda mora num lugar so desde o
      // review da Spec 042 -- ver `lib/mesclaTarefa.ts`, que lista as quatro
      // vezes em que o mesmo defeito apareceu.
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
  const [erro, setErro] = useState<string | null>(null);

  // Projeto (Spec 022): eco local do project_id exibido -- atualiza no sucesso
  // do move sem depender do round-trip do pai. abertoProj abre o seletor;
  // movendoProj bloqueia (nao-otimista, aplica so no sucesso).
  const [projetoAtual, setProjetoAtual] = useState<string | null>(null);
  const [abertoProj, setAbertoProj] = useState(false);
  const [movendoProj, setMovendoProj] = useState(false);
  const [erroProj, setErroProj] = useState<string | null>(null);

  // Datas (Spec 038, fatia A): a cápsula com início e entrega.
  //
  // ⚠️ ECO LOCAL DOS DOIS, pelo mesmo motivo do `projetoAtual`: o painel fecha
  // no sucesso e a linha precisa mostrar o valor novo sem esperar o pai
  // refetchar. Sem isto a pessoa salva, o painel fecha, e a data continua a
  // antiga por um instante -- que é indistinguível de "não salvou".
  const [inicioAtual, setInicioAtual] = useState<string | null>(null);
  const [prazoAtual, setPrazoAtual] = useState<string | null>(null);
  // ⚠️ Spec 038, fatia B. `null` = "vence no dia". Guardado separado do prazo
  // porque sao dois estados de produto: apagar a hora NAO apaga a data.
  const [horaAtual, setHoraAtual] = useState<string | null>(null);
  const [abertoDatas, setAbertoDatas] = useState(false);
  const [salvandoDatas, setSalvandoDatas] = useState(false);
  const [erroDatas, setErroDatas] = useState<string | null>(null);
  // ⚠️ RASCUNHO SEPARADO DO ECO. O painel tem DOIS campos e um botão de
  // salvar: editar direto o eco mandaria uma requisição por tecla, e pior,
  // deixaria a tela mostrando um estado que o servidor recusou (o backend
  // recusa `start_date > due_date` com 422). O rascunho só vira eco no sucesso.
  const [rascunhoInicio, setRascunhoInicio] = useState("");
  const [rascunhoPrazo, setRascunhoPrazo] = useState("");
  const [rascunhoHora, setRascunhoHora] = useState("");

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
  // ⚠️ Fatia 4c-2: a checklist e a caixinha decidem pela COLUNA, entao o
  // detalhe precisa das colunas do quadro DA TAREFA. `null` = ainda chegando.
  // Carregado AQUI, e nao recebido por prop, porque o `TaskDetail` e usado por
  // QUATRO telas (quadro, /minhas-tarefas, /arquivadas, /tarefa/[id]) e duas
  // delas nao carregam quadro nenhum. Uma requisicao a mais ao abrir o
  // detalhe; ⚠️ NAO MEDIDA (o item de desempenho do handoff continua aberto).
  const [colunas, setColunas] = useState<Coluna[] | null>(null);
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
  // Spec 031 (C8): o seletor de projeto virou painel flutuante e ganhou a
  // mesma ancora + fechar-ao-clicar-fora. Antes era um <select> inline: nao
  // precisava fechar sozinho porque nao flutuava sobre nada.
  const projWrapRef = useRef<HTMLDivElement>(null);
  const datasWrapRef = useRef<HTMLDivElement>(null);

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
    // ⚠️ AS DATAS ENTRAM NO MESMO RESET, e esquecer isto seria o defeito mais
    // provável desta fatia: navegar de uma tarefa para outra deixaria o eco da
    // ANTERIOR na tela. O `projetoAtual` já ensinou isso três linhas acima.
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

  // Clicar no scrim fecha; ARRASTAR de dentro pra fora nao (ver o modulo).
  const scrimProps = useFecharAoClicarFora(fecharSuave);

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

  // Fecha o painel de projeto ao clicar fora (mesmo padrao do de responsaveis).
  useEffect(() => {
    if (!abertoProj) return;
    function onDown(e: MouseEvent) {
      if (projWrapRef.current && !projWrapRef.current.contains(e.target as Node)) {
        setAbertoProj(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abertoProj]);

  // Fecha o painel de datas ao clicar fora -- MESMO padrao dos dois acima.
  //
  // ⚠️ E NAO O `useFecharAoClicarFora`, que resolve outro problema: aquele
  // pareia `mousedown` com `mouseup` porque em MODAL, selecionar texto dentro
  // e soltar fora fechava e apagava formulario. Painel suspenso usa este.
  //
  // ⚠️ FECHAR DESCARTA O RASCUNHO, e isso e deliberado: o painel tem botao de
  // salvar, entao clicar fora e o cancelar. Salvar no fechamento mandaria
  // requisicao por engano toda vez que a pessoa clicasse ao lado.
  useEffect(() => {
    if (!abertoDatas) return;
    function onDown(e: MouseEvent) {
      if (datasWrapRef.current && !datasWrapRef.current.contains(e.target as Node)) {
        setAbertoDatas(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abertoDatas]);

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
        if (vivo) setErroCom(e.message || "Não consegui carregar os comentários.");
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Spec 034: quem alcanca ESTA tarefa vem do BACKEND, pela mesma regra que o
  // POST de designacao usa (`user_can_view_task`). Ate 03/08 isto era
  // reconstruido aqui com `foraDoEscopo(subtimePorMembro, ...)`, e a regra do
  // front so tinha `team_id` -- nunca papel. Consequencia reportada: gestor e
  // admin sumiam do seletor de tarefa interna de subtime, embora a API
  // aceitasse os dois.
  //
  // `null` = ainda carregando (ou a chamada falhou).
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
        // ⚠️ Guarda de corrida: trocar de tarefa rapido pode fazer a resposta
        // da ANTERIOR chegar depois e pintar o seletor da atual com a lista
        // errada. Nenhum portao pega isso.
        if (vivo) setAlcancamAqui(new Set(ms.map((m) => m.id)));
      })
      .catch(() => {
        // Falha => segue `null` => nao esconde ninguem. Mesma filosofia do
        // `foraDoEscopo`: errar oferecendo demais devolve o comportamento
        // anterior, com o 422 do backend ainda de pe; errar escondendo demais
        // tira gente do trabalho sem explicar por que.
        if (vivo) setAlcancamAqui(null);
      });
    return () => {
      vivo = false;
    };
  }, [task?.id]);

  // Quem NAO alcanca. Vazio enquanto a lista nao chegou (ver acima).
  const foraDoEscopoAqui = useMemo(() => {
    const fora = new Set<string>();
    if (alcancamAqui === null) return fora;
    for (const id of members.keys()) {
      if (!alcancamAqui.has(id)) fora.add(id);
    }
    return fora;
  }, [alcancamAqui, members]);

  // Nao entra no autocompletar de @: desativado (nao le mais) + fora do
  // escopo (recebe notificacao de tarefa que nao consegue abrir). Aqui NAO
  // ha a excecao do "ja designado" do seletor: mencionar quem nao ve a
  // tarefa e sempre escrever pra ninguem.
  const foraDoAutocompletar = useMemo(
    () => new Set<string>([...membrosInativos, ...foraDoEscopoAqui]),
    [membrosInativos, foraDoEscopoAqui]
  );

  // Lista do picker da subtarefa. Separada de `filtrados` (que serve ao
  // picker da tarefa mae) porque as buscas sao independentes -- compartilhar
  // o termo faria digitar num lugar filtrar o outro.
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
      // Fora do escopo sai pela MESMA excecao: quem ja esta designado fica,
      // senao a unica forma de tirar a pessoa (desmarcar a caixa dela)
      // desapareceria junto.
      .filter((e) => !foraDoEscopoAqui.has(e.id) || assignees.includes(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [members, busca, membrosInativos, assignees, foraDoEscopoAqui]);

  if (!task) return null;
  const tid = task.id;
  const tidProjeto = task.project_id ?? null; // pai e subtarefa no mesmo projeto
  // Spec 022: task de topo pode trocar/tirar projeto; subtarefa herda do pai
  // (read-only). Nome do projeto atual resolve do Map (null/ausente => avulsa).
  const ehTopo = !task.parent_task_id;
  const nomeProjetoAtual = projetoAtual ? projects.get(projetoAtual) ?? null : null;
  // ⚠️ SOBRE O ECO, e nao sobre `task.due_date` (Spec 038, fatia A). Depois de
  // salvar uma data nova, o `task` do pai ainda e o antigo por um instante --
  // ler dele deixaria a cor de atraso discordando da data ao lado dela.
  const dueTone = deadlineTone(prazoAtual, task.status, task.is_archived, horaAtual);
  // ⚠️ ARQUIVADA SAI DA CHECKLIST (Spec 031, C11). O quadro entrega `filhos`
  // sem filtrar -- a lista dele nao sabe que esta alimentando um checklist.
  // Filtrar AQUI conserta os tres chamadores de uma vez (quadro, minhas
  // tarefas, arquivadas) e evita a regra em triplicata.
  //
  // Por que a checklist e diferente do resto: ela responde "o que falta
  // fazer", e arquivar E dizer "isto saiu do fluxo". A subtarefa continua no
  // banco e no quadro com "Mostrar arquivadas" -- so nao conta mais aqui, nem
  // na barra de progresso, nem no "(2/5)" do titulo.
  //
  // ⚠️ UMA chamada so, de proposito. As LINHAS e a CONTA vinham de duas
  // chamadas separadas e divergiram: o numerador era o trabalho vivo e o
  // denominador era `linhas.length`, que INCLUI arquivada quando a caixa esta
  // marcada. Dava "(1/3)" com a barra em 50%. Ver `lib/subtarefas.ts`.
  //   linhasSub -> o que DESENHA (arquivada entra apagada)
  //   totalSub  -> o denominador do rotulo E da barra (so trabalho vivo)
  // ⚠️ `?? []` e nao `!`: enquanto as colunas nao chegam, o mapa e VAZIO e a
  // conta da 0 -- por isso o rotulo e a barra so aparecem depois (ver o
  // `colunas &&` no render). Numero errado por meio segundo e o defeito que a
  // conferencia manual de 10/08 pegou; numero ausente por meio segundo, nao.
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
          ? "Você não pode designar nesta tarefa."
          : err.status === 422
          ? "Essa pessoa não alcança esta tarefa (fora do time)."
          : "Não consegui atualizar o responsável."
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
  function abrirDatas() {
    // ⚠️ O RASCUNHO NASCE DO ECO, e nao do `task`. Depois de um salvamento o
    // `task` do pai pode ainda ser o antigo (ele refetcha depois), e reabrir o
    // painel mostraria a data velha por cima da nova.
    setRascunhoInicio(inicioAtual ?? "");
    setRascunhoPrazo(prazoAtual ?? "");
    // ⚠️ `HH:MM` NO INPUT, e o backend devolve `HH:MM:SS`. Um `<input
    // type="time">` com valor de 8 caracteres fica VAZIO no navegador -- e a
    // hora sumiria ao reabrir o painel, parecendo que nao salvou.
    setRascunhoHora((horaAtual ?? "").slice(0, 5));
    setErroDatas(null);
    setAbertoDatas(true);
  }

  async function salvarDatas() {
    if (salvandoDatas) return;
    // ⚠️ `""` VIRA `null`, E NAO VIAJA COMO STRING VAZIA. O backend usa
    // `fields_set`: `null` apaga a data, `""` nao e data e volta 422.
    const inicio = rascunhoInicio || null;
    const prazo = rascunhoPrazo || null;
    // ⚠️ HORA SEM DATA E RECUSADA PELO BACKEND (422). Limpar a data e deixar a
    // hora produziria esse par, e o erro falaria de um campo que a pessoa nao
    // tocou -- entao a tela DESFAZ a combinacao antes de mandar.
    const hora = prazo ? rascunhoHora || null : null;
    // No-op: nada mudou. Sem isto, abrir e salvar sem tocar gravaria uma
    // entrada de historico que nao aconteceu do ponto de vista de quem usa.
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
      // ⚠️ MANDA OS DOIS SEMPRE, e nao so o que mudou. O backend valida
      // `start_date <= due_date` sobre o estado FINAL da tarefa
      // (`_validate_dates`), entao mandar so um campo pode montar um par
      // invalido com o valor que ficou no banco -- e a recusa apareceria
      // falando de um campo que a pessoa nao tocou.
      const t = await updateTask(tid, {
        start_date: inicio,
        due_date: prazo,
        due_time: hora,
      });
      setInicioAtual(t.start_date ?? null);
      setPrazoAtual(t.due_date ?? null);
      setHoraAtual(t.due_time ?? null);
      setAbertoDatas(false);
      // ⚠️ O PAI PRECISA SABER. Prazo muda a COR do card e o filtro
      // "Atrasadas" do quadro -- sem avisar, a tarefa fica com data nova no
      // detalhe e cor velha atras dele. `onTaskMoved` e o canal que ja
      // significa "mexeu em mais do que esta tarefa, reaja".
      onTaskMoved(t);
    } catch (e) {
      const err = e as ApiError;
      // ⚠️ A MENSAGEM DO BACKEND VEM PRIMEIRO no 422: e ela que diz "Data de
      // inicio nao pode ser posterior a data limite", que e a unica recusa
      // que a pessoa consegue consertar sozinha.
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
      upsertFilhaLocal(nova);
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
      setErroSub((e as ApiError).message || "Não consegui criar a subtarefa.");
    } finally {
      setSalvandoSub(false);
    }
  }

  /**
   * A caixinha da subtarefa (fatia 4c-2) -- agora escreve COLUNA.
   *
   * ⚠️ MARCAR e "mover para a coluna de conclusao", nao "gravar COMPLETED". O
   * status vem derivado dela pelo servidor (ADR 0041), e o front NAO o
   * adivinha: quem le status na resposta e a linha do `onSubtaskUpsert` logo
   * depois do `await`.
   *
   * ⚠️ DESMARCAR MANDA SEMPRE PARA A COLUNA ABERTA PADRAO. Decisao de
   * 10/08, e ela substitui uma tentativa de ser esperto que a conferencia
   * manual reprovou.
   *
   * A versao anterior (herdada do codigo por `status`) guardava em estado do
   * componente de onde a subtarefa tinha saido e devolvia para la. O efeito
   * real: **funcionava na primeira vez e depois nao.** A memoria vive
   * enquanto o detalhe esta aberto; fechar para conferir no quadro e reabrir
   * apaga tudo, e o desmarcar seguinte caia num fallback silencioso. Duas
   * respostas diferentes para o mesmo clique, sem nada na tela explicando a
   * diferenca.
   *
   * ⚠️ REGRA QUE FUNCIONA AS VEZES E PIOR QUE REGRA BURRA, porque ninguem
   * consegue criar habito em cima dela. O preco aceito: desmarcar sem querer
   * uma subtarefa que estava em `Em Andamento` a joga para `Backlog`, e
   * arrastar de volta e trabalho manual.
   *
   * A saida boa esta registrada e NAO e esta: o `task_history` passou a
   * gravar movimentacao de coluna na fatia 5a (ADR 0041, D5), entao existe o
   * dado para descobrir a coluna real de antes. Ler o historico e entrega
   * propria.
   */
  async function alternarConclusao(f: Task) {
    if (!colunas) return; // colunas ainda chegando: a caixa nem esta desenhada
    const concluida = colunaPorId.get(f.column_id)?.semantic === "DONE";

    // ⚠️ `is_default_target` PRIMEIRO, e este e o primeiro leitor que essa flag
    // ganha no front. Ela responde exatamente "para onde vai a tarefa desta
    // semantica neste quadro". Sem ela, um quadro com duas colunas de
    // conclusao mandaria a tarefa para a primeira da lista, que e a ordem de
    // `position` -- ou seja, arbitraria.
    const alvo = (semantic: Coluna["semantic"]) =>
      colunas.find((c) => c.semantic === semantic && c.is_default_target) ??
      colunas.find((c) => c.semantic === semantic);

    const destino = concluida ? alvo("OPEN")?.id : alvo("DONE")?.id;

    // ⚠️ QUADRO SEM COLUNA DE CONCLUSAO E ESTADO POSSIVEL na fatia 5, quando o
    // CRUD deixar apagar coluna. Erro visivel e melhor que caixa que nao faz
    // nada.
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
    // ⚠️ Otimista nos DOIS campos. A coluna e o que a checklist le; o `status`
    // anda junto para nao deixar os dois discordando na memoria -- mesma
    // divida registrada no `onDragEnd`, e ela morre quando o ultimo leitor de
    // `status` do front morrer.
    // ⚠️ `"BACKLOG"` ao reabrir NAO e chute: o destino e a coluna aberta
    // padrao, e ela devolve `BACKLOG` nos dois caminhos da ADR 0041 -- pela
    // ponte (a coluna `Backlog` padrao tem `legacy_status = BACKLOG`) e pela
    // semantica (o mapa manda `OPEN -> BACKLOG`). Fora deste caso o front
    // continua NAO adivinhando status: le da resposta.
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
      const desarquivando = task!.is_archived;
      const r = desarquivando ? await unarchiveTask(tid) : await archiveTask(tid);
      onSubtaskUpsert(r); // upsert generico: o quadro reflete is_archived
      // ⚠️ CASCATA (05/08): a subarvore inteira mudou no banco e NENHUMA
      // dessas filhas veio na resposta -- o estado do chamador esta velho.
      // `onTaskMoved` e o canal que ja significa "mexeu em mais do que esta
      // tarefa, reaja": no quadro ele recarrega, em minhas-tarefas faz upsert
      // com os filhos. Sem isto a checklist continuaria mostrando subtarefa
      // ativa que ja esta arquivada -- a mesma stale de estado que a
      // duplicacao tinha.
      if (r.cascade_count > 0) {
        onTaskMoved(r);
        // ⚠️ B1: a cascata mudou as filhas no banco e NENHUMA veio na
        // resposta. Antes bastava `onTaskMoved` (o quadro recarregava e
        // `filhos` era derivado dele); agora a lista e daqui e precisa ser
        // relida, senao a checklist segue mostrando ativa o que ja arquivou.
        void recarregarFilhos();
        // Avisar nao e opcional: a operacao mexeu em tarefas que a pessoa nao
        // citou. Em silencio, ela so descobriria pela ausencia delas.
        const n = r.cascade_count;
        const plural = n === 1 ? "subtarefa foi" : "subtarefas foram";
        window.alert(
          desarquivando
            ? `${n} ${plural} desarquivada${n === 1 ? "" : "s"} junto.`
            : `${n} ${plural} arquivada${n === 1 ? "" : "s"} junto.`
        );
      }
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Você não pode arquivar esta tarefa."
          : // ⚠️ `a.message` no 422: e aqui que chega a mensagem que NOMEIA o
            // pai arquivado ("Desarquive a tarefa pai primeiro…", 04/08).
            // Trocada por um texto generico, aquela instrucao -- que existe
            // justamente porque a pessoa nao tem como adivinhar o pai --
            // nunca aparecia nesta tela. A /arquivadas ja mostrava.
            a.message || "Não consegui arquivar a tarefa."
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

  // Apagar e 204 (sem corpo) e o resultado depende de ter replica viva
  // (some) ou nao (tombstone). Em vez de reimplementar a regra D5 aqui,
  // recarrego o thread -- o backend decide.
  async function recarregarComentarios() {
    try {
      const r = await listComments(tid, { size: 100 });
      setComentarios(r.items);
    } catch (e) {
      setErroCom((e as ApiError).message || "Não consegui recarregar os comentários.");
    }
  }

  return (
    <div
      // Modo modal: o scrim inteiro e clicavel pra fechar -- mas so no CLIQUE,
      // nao no arraste que termina aqui (`lib/useCliqueFora.ts`). Modo pagina:
      // nao ha scrim nem "fora" pra clicar -- o container vira um bloco comum.
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
              maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap",
              display: "inline-flex", alignItems: "center", gap: 4,
              // `overflow: hidden` zera o min-height automatico deste flex item
              // (CSS Flexbox 4.5). Sem flexShrink 0, o botao encolhe na vertical
              // quando o conteudo do modal estoura 88vh e o texto sai cortado
              // pela metade. NAO remover junto com o overflow.
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

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          {/* Spec 039 (F1): título do painel = 22px / 700. */}
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.27 }}>
            {task.title}
          </h2>
          <button
            type="button" className="btn btn-ghost" onClick={fecharSuave}
            style={{ padding: "4px 10px", flexShrink: 0 }} aria-label="Fechar"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {task.parent_task_id && (
            <Badge tone="soft" size="md" color="var(--accent)">
              Subtarefa
            </Badge>
          )}
          {/* ⚠️ O ROTULO SAI DA COLUNA (fatia 4c-2) -- e o nome que a pessoa
              ve no kanban e que a fatia 5 vai deixar editar. A COR continua
              vindo de `STATUS_TEXT`, e isso NAO e esquecimento: `coluna.color`
              e token de TRACO (bolinha, borda), e como fundo sob texto ele
              reprova AA (Spec 031 §2.2b). A cor acessivel de uma coluna
              arbitraria tem de sair da luminancia, e `lib/coluna.ts::corEhHex`
              ja registra que essa derivacao e da FATIA 5. Ate la, cor por
              status e rotulo por coluna. */}
          <Badge tone="solid" size="md" color={STATUS_COLOR[task.status]}>
            {colunaPorId.get(task.column_id)?.name ??
              STATUS_LABEL[task.status] ??
              task.status}
          </Badge>
          <Badge tone="soft" size="md" color={PRIORITY_COLOR[task.priority]}>
            {PRIORITY_LABEL[task.priority] || task.priority}
          </Badge>
          {/* Spec 031 (C8): a pilula de projeto SAIU daqui. Ela era read-only e
              o controle de projeto ficava 200px abaixo, dizendo a mesma coisa --
              duas representacoes do mesmo dado na mesma tela. Agora ha UMA, na
              faixa de metadados logo abaixo, e ela e o proprio controle. */}
          {/* ---- Datas (Spec 038, fatia A) --------------------------------
              ⚠️ ESTA PILULA VIROU O CONTROLE, e nao ganhou um controle ao lado.
              É a lição da C8 escrita três linhas acima, aplicada: a de projeto
              era read-only aqui e o controle ficava 200px abaixo, dizendo a
              mesma coisa. Repetir isso com data daria o mesmo defeito.

              ⚠️ E POR ISSO ELA APARECE MESMO SEM DATA. Antes era
              `{task.due_date && …}`: sem prazo não havia pílula, e sem pílula
              não haveria onde clicar para PÔR um. O vazio se distingue por
              borda tracejada e tom, igual ao "nenhum" do projeto -- mesma
              caixa, mesma altura.

              ⚠️ `T00:00:00` NA LEITURA, SEMPRE. `new Date("2026-08-19")` é
              interpretado como UTC e escorrega um dia em fuso negativo -- é o
              mesmo aviso que o `hojeISO()` do `Board.tsx` carrega. */}
          <div
            ref={datasWrapRef}
            style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
          >
            {/* ⚠️ A PILULA E O PROPRIO GATILHO (decisao da Camila, 18/08).
                A primeira versao punha um botao redondo AO LADO do texto, como
                o de projeto -- e o desenho dela e outro: a data e uma PILULA
                irma de "Coluna" e "Prioridade", e clicar nela abre a edicao.
                Um alvo, e nao dois.

                ⚠️ E POR ISSO O TEXTO VAZIO E "Sem datas", no PLURAL. Antes era
                "sem prazo", que nomeia so metade do que a capsula edita -- a
                pessoa clicaria esperando mexer no prazo e encontraria dois
                campos. Mesma forma de "Sem Projeto".

                ⚠️ inline-flex + flexShrink 0 + nowrap, NAO verticalAlign. Este
                elemento e filho de um flex com flexWrap: sem flexShrink 0 ele
                encolhe ate o minimo e QUEBRA entre o icone e a data -- foi o
                que aconteceu na entrega da C10.

                ⚠️ A COR DE ATRASO SOBREVIVEU a virada para botao, e nao e
                enfeite: e o unico sinal de que a tarefa venceu nesta linha. */}
            <button
              type="button"
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
                // ⚠️ AQUI HAVIA UM `font: "inherit"` DEPOIS DO `fontSize`, E
                // ELE MATAVA O TAMANHO. `font` e ATALHO: ele redefine
                // font-size junto com a familia, e como vinha por ultimo, o
                // `fontSize: 12.5` era codigo morto -- a pilula herdava o
                // tamanho do `body`.
                //
                // Ficou invisivel enquanto o body era 14px (a pilula so
                // parecia um pouco maior que os selos de 12). A F1 subiu o
                // body para 15 e a diferenca virou 3px: a Camila viu na tela
                // que "Sem datas" estava maior que o resto, e era isto.
                //
                // ⚠️ O atalho era redundante de qualquer forma: o
                // `globals.css` ja tem `button { font-family: inherit }`.
                // Por isso ele SAIU, em vez de so mudar de lugar.
                fontSize: 12, cursor: "pointer",
                fontWeight: dueTone ? 600 : 400,
                // Cheia e vazia usam a MESMA caixa -- o vazio se distingue por
                // borda tracejada e tom, igual ao "nenhum" do projeto.
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
              {prazoAtual
                ? new Date(prazoAtual + "T00:00:00").toLocaleDateString("pt-BR")
                : "Sem datas"}
              {/* ⚠️ `slice(0, 5)` PORQUE O BACKEND DEVOLVE `HH:MM:SS`. Sem
                  cortar, a pilula diria "19/08/2026 18:00:00". */}
              {prazoAtual && horaAtual && <>{" "}{horaAtual.slice(0, 5)}</>}
              {/* ⚠️ O INICIO SO APARECE QUANDO EXISTE. Desenhar "sem inicio" ao
                  lado poria duas ausencias na linha mais disputada da tela. */}
              {inicioAtual && (
                <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  · início {new Date(inicioAtual + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
              )}
              {/* ⚠️ SEM `ehTopo`, E A DIFERENCA PARA O PROJETO E REAL (Camila,
                  18/08): subtarefa HERDA projeto do pai (Spec 022) e por isso
                  nao o edita, mas tem prazo PROPRIO -- este mesmo arquivo ja o
                  desenha na checklist. Copiar a trava foi engano meu. */}
              {abertoDatas ? (
                <X size={11} strokeWidth={2.2} aria-hidden />
              ) : (
                <Pencil size={11} strokeWidth={2.2} aria-hidden style={{ opacity: 0.65 }} />
              )}
            </button>

            {abertoDatas && (
              <div
                style={{
                  // ⚠️ NAO usar maxWidth: "100%" -- o ancora e um flex item do
                  // tamanho do conteudo, e 100% dele espremeria o painel. Erro
                  // ja cometido na entrega da C8, anotado no painel de projeto.
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                  width: 240, maxWidth: "80vw",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 10, boxShadow: "var(--shadow)", padding: 10,
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                {/* ⚠️ O RÓTULO "Datas" ESTAVA NO DESENHO E EU O OMITI. A
                    cápsula da Camila é um cartão TITULADO, e sem o título o
                    painel não diz do que ele é -- só mostra dois campos soltos
                    ancorados num "+". Não é enfeite: é o que faz a cápsula
                    ser uma cápsula. */}
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
                {/* ⚠️ A HORA SO APARECE COM DATA, e nao e enfeite: hora sem
                    data e recusada com 422 pelo backend (`_validate_hora`).
                    Esconder o campo e mais forte que aceitar e recusar depois
                    -- a pessoa nao chega a digitar algo que nao pode existir.

                    ⚠️ E LIMPAR A DATA LIMPA A HORA (ver `salvarDatas`). Sem
                    isso, apagar so a data mandaria o par proibido e o erro
                    falaria de um campo que ela nao tocou. */}
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
                      {/* ⚠️ LIMPAR PRECISA DE BOTAO PROPRIO (pedido da Camila,
                          18/08, na tela). O `<input type="time">` tem um "x"
                          nativo em alguns navegadores e nenhum em outros, e
                          apagar com o teclado exige selecionar o campo inteiro
                          -- ou seja, "tirar a hora" dependia do navegador. Um
                          botao explicito nao depende.

                          ⚠️ E ELE SO APARECE COM HORA PREENCHIDA: um "limpar"
                          sobre campo vazio e afordancia que nao faz nada. */}
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
            )}
          </div>
          {task.is_archived && (
            <span className="muted" style={{ fontSize: 12.5 }}>arquivada</span>
          )}
        </div>

        {/* Criacao: data + quem criou (nome resolvido; sem nome -> so a data). */}
        <div className="muted" style={{ fontSize: 12.5 }}>
          Criada em {criadoEm}
          {criador ? ` por ${criador}` : ""}
        </div>

        {/* ---- Faixa de metadados (Spec 031, C8) -------------------------
             Responsaveis e Projeto eram DOIS blocos `field` empilhados, ~104px
             para dizer "duas pessoas" e "nenhum projeto", e o de projeto ainda
             repetia a pilula do cabecalho. Viraram uma linha so, ACIMA da
             descricao: metadado primeiro, conteudo depois. Quem abre a tarefa
             quer ler a descricao e os comentarios, nao confirmar que nao ha
             projeto.

             Os dois popovers continuam iguais -- so mudaram de ancora. Cada um
             tem seu wrapper `position: relative` proprio, senao abririam
             relativos a faixa inteira e cairiam no lugar errado. ---- */}
        <div
          style={{
            display: "flex", flexWrap: "wrap", alignItems: "center",
            gap: 18, rowGap: 10,
          }}
        >
          {/* -- Responsaveis -- */}
          <div
            ref={respWrapRef}
            style={{
              position: "relative", display: "flex", flexWrap: "wrap",
              alignItems: "center", gap: 6, minWidth: 0,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-soft)", flexShrink: 0 }}>
              Responsáveis
            </span>
            {assignees.length > 0 ? (
              assignees.map((id) => {
                const nome = members.get(id)?.name ?? "";
                const inativo = membrosInativos.has(id);
                return (
                  <span
                    key={id}
                    // Responsavel desativado precisa ser VISIVEL como tal: a
                    // tarefa esta designada pra quem nao entra mais no sistema.
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

            {abertoResp && (
              <div
                style={{
                  // Mesmo motivo do painel de projeto: sem responsavel nenhum o
                  // ancora tem ~90px e o maxWidth relativo espremeria a busca.
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                  width: 300, maxWidth: "80vw",
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
              </div>
            )}
          </div>

          {/* -- Projeto. Subtarefa herda do pai (Spec 022): mostra, nao edita. -- */}
          <div
            ref={projWrapRef}
            style={{
              position: "relative", display: "flex", alignItems: "center",
              gap: 6, minWidth: 0,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-soft)", flexShrink: 0 }}>
              Projeto
            </span>
            {/* Os dois estados usam a MESMA caixa: mesma altura, mesmo raio,
                mesmo padding. Antes "nenhum" era texto solto ao lado de uma
                pilula e de um botao de 26px -- tres alturas diferentes na
                mesma linha, e o olho lia como desalinhado. O vazio se
                distingue por borda tracejada e tom, nao por forma. */}
            <span
              style={{
                display: "inline-flex", alignItems: "center", height: 24,
                borderRadius: 999, padding: "0 10px", fontSize: 12.5,
                maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                background: projetoAtual ? "var(--surface-2)" : "transparent",
                border: projetoAtual ? "1px solid transparent" : "1px dashed var(--border)",
                color: projetoAtual ? "var(--text)" : "var(--text-faint)",
              }}
            >
              {projetoAtual ? nomeProjetoAtual ?? "Projeto atual" : "nenhum"}
            </span>

            {ehTopo && (
              <button
                type="button"
                onClick={() => setAbertoProj((v) => !v)}
                disabled={movendoProj}
                aria-label={projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"}
                aria-expanded={abertoProj}
                title={projetoAtual ? "Mudar projeto" : "Adicionar a um projeto"}
                style={{ ...GATILHO_STYLE, opacity: movendoProj ? 0.5 : 1 }}
              >
                {abertoProj ? (
                  <X size={13} strokeWidth={2.2} aria-hidden />
                ) : projetoAtual ? (
                  <Pencil size={12} strokeWidth={2.2} aria-hidden />
                ) : (
                  <Plus size={13} strokeWidth={2.2} aria-hidden />
                )}
              </button>
            )}

            {movendoProj && (
              <span className="muted" style={{ fontSize: 12.5 }}>movendo…</span>
            )}

            {/* O seletor virou PAINEL FLUTUANTE. Antes empurrava o layout com
                `marginTop: 6` -- numa linha compacta isso deslocaria a faixa
                inteira a cada abertura. */}
            {abertoProj && (
              <div
                style={{
                  // ⚠️ NAO usar maxWidth: "100%". O ancora e um flex item do
                  // tamanho do conteudo ("Projeto nenhum +", ~110px), entao 100%
                  // dele espremia o painel de 280 para 110 e o <select> saia
                  // cortado ("— Sem proj⌄"). Erro da entrega da C8.
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                  width: 280, maxWidth: "80vw",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
                }}
              >
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
                    // Pessoal fora, MENOS o atual: se a tarefa ja esta num
                    // pessoal e ele nao entrasse na lista, o <select> ficaria
                    // com valor que nao existe entre as opcoes e o browser
                    // mostraria a primeira -- dando a impressao de que o
                    // projeto mudou sozinho.
                    .filter(([id]) => !projetosPessoais.has(id) || id === projetoAtual)
                    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
                    .map(([id, titulo]) => (
                      <option key={id} value={id}>{titulo}</option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Erro do move fica FORA da faixa: dentro dela a caixa de erro
            espremeria os controles e sumiria junto com o painel. */}
        {erroProj && <div className="error-box">{erroProj}</div>}

        <div className="field">
          <span className="label">Descrição</span>
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
            <span className="muted" style={{ fontSize: 13 }}>Sem descrição.</span>
          )}
        </div>

        {/* ---- Subtarefas ---- */}
        <div className="field">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="label">
              {/* ⚠️ SEM COLUNA, SEM NUMERO. `colunas &&` de proposito: com o
                  mapa vazio a conta daria "(0/2)" -- que foi exatamente o
                  numero errado que a conferencia manual de 10/08 pegou. */}
              Subtarefas
              {colunas && totalSub > 0 ? ` (${concluidas}/${totalSub})` : ""}
            </span>
            {/* ⚠️ B1: checklist vazia NAO pode significar duas coisas. Desde
                que o painel busca as proprias filhas, "ainda carregando" e
                "falhou" precisam se distinguir de "nao tem subtarefa" -- foi a
                leitura falsa "duplicou sem as subtarefas" (05/08) que provou
                que o vazio silencioso engana. */}
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

          {/* Barra de progresso das subtarefas. Anima sozinha: `concluidas`
              recomputa quando alternarConclusao faz o upsert OTIMISTA no estado
              do pai (a caixa marca -> a barra enche na hora, sem esperar a API;
              reverte se o PATCH falhar). Proporcao = concluidas / filhos ATIVOS. */}
          {colunas && totalSub > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
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
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
              {linhasSub.map((f, i) => {
                // ⚠️ A MARCA SAI DA COLUNA (fatia 4c-2), igual a conta logo
                // acima. Se sair de `status`, a caixa fica desmarcada com a
                // barra em 100% -- os dois numeros discordando de novo, so que
                // agora dentro da MESMA tela.
                const colunaDela = colunaPorId.get(f.column_id);
                const concluida = colunaDela?.semantic === "DONE";
                // ⚠️ Enquanto as colunas nao chegam a caixa fica DESABILITADA,
                // e nao so desmarcada: clicar antes disso nao teria coluna de
                // destino para onde mandar.
                const ocupado = subSaving.has(f.id) || !colunas;
                // Mesmo 0.55 do card arquivado no quadro -- arquivada le como
                // "fora do fluxo" pelo tom, nao por um rotulo so.
                const apagada = f.is_archived;
                // Mesma regra do card do quadro: concluida/arquivada nao alerta.
                // ⚠️ `null` e nao `"none"`: o tipo `DeadlineTone` usa `null`
                // para "sem alerta", e e o que o render logo abaixo testa.
                // Coluna desconhecida = sem alerta, e nao alerta cinza.
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
                            {f.due_date && (
                              <span
                                className={tone ? undefined : "muted"}
                                title={new Date(
                                  f.due_date + "T00:00:00"
                                ).toLocaleDateString("pt-BR")}
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
              <span>Comentários ({comentarios.length})</span>
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
            <span className="label">Comentários</span>
          )}

          {comentarios === null ? (
            <span className="muted" style={{ fontSize: 13 }}>Carregando…</span>
          ) : comentarios.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              Nenhum comentário ainda.
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
                      excluidos={foraDoAutocompletar}
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
                            excluidos={foraDoAutocompletar}
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
            excluidos={foraDoAutocompletar}
            rows={2}
            placeholder="Escreva um comentário… (@ menciona)"
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
              {/* ⚠️ `filhos`, NAO `linhasSub`: a cascata (ADR 0005) leva a
                  subarvore inteira, arquivada ou nao. Ver lib/subtarefas.ts. */}
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
            title="Copia o endereço desta tarefa pra compartilhar"
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
          {/* Spec 033. Exige `task.create`: duplicar E criar. Sem a checagem,
              quem so pode comentar veria o botao e levaria 403 no salvar. */}
          {(me?.permissions.includes("task.create") ?? false) &&
            !confirmandoExcluir && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onDuplicar(task)}
                title="Criar uma cópia desta tarefa"
              >
                Duplicar
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
  excluidos,
  me,
  taskId,
  onEditado,
  onApagado,
}: {
  c: Comment;
  members: Map<string, { name: string }>;
  /**
   * Spec 032: ids que NAO entram no autocompletar de `@` da caixa de EDICAO --
   * desativados + quem nao alcanca a tarefa. Mesmo conjunto que as caixas de
   * criar e responder ja usavam.
   *
   * ⚠️ OBRIGATORIA de proposito, sem `?`. Prop opcional e onde "esqueci um
   * chamador" vira silencio: o `tsc` aceita a ausencia e o segundo chamador
   * (a REPLICA) sairia sem filtro nenhum, sem ninguem notar. Foi assim que
   * C13/C14/C15 chegou em um dos quatro chamadores do TaskDetail em 31/07.
   */
  excluidos: Set<string>;
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
                  aria-label="Editar comentário"
                >
                  <Pencil size={13} strokeWidth={2} aria-hidden />
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
                Não
              </button>
            </span>
          )}
        </div>

        {editando ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {/* Spec 032: era um <textarea> cru -- digitar `@` na edicao nao
                abria lista nenhuma. As caixas de criar e responder ja usavam
                o MentionTextarea; esta ficou de fora.
                ⚠️ `onChange` do MentionTextarea entrega a STRING, nao o
                evento. Manter `(e) => setTexto(e.target.value)` compila e
                quebra em runtime.
                ⚠️ O token cru (`@[Nome](uuid)`) CONTINUA aparecendo aqui --
                a caixa de criar tambem mostra, e sempre mostrou. Medido em
                03/08; render de nome e entrega propria. */}
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
