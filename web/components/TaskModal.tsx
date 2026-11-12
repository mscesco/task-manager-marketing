"use client";
// Modal de CRIAR (sem `duplicarDe`) e DUPLICAR (com `duplicarDe`) tarefa.
// Editar é no `TaskDetail`. O time não aparece: quem define é o quadro.

import { useEffect, useMemo, useRef, useState, type CSSProperties, useCallback } from "react";
import { Plus, X } from "lucide-react";
import {
  createTask,
  duplicateTask,
  listProjects,
  listMembers,
  listMembersDoTime,
  getRootTeamId,
  putTaskLinks,
  ApiError,
  type Task,
  type Project,
  type Member,
} from "@/lib/api";
import EditorDeDescricao from "@/components/EditorDeDescricaoAdiado";
import EditorDeLinks from "@/components/EditorDeLinks";
import {
  errosDosLinks,
  MAX_LINKS,
  paraEnvio,
  passaDoTeto,
  temErro,
  type RascunhoLink,
} from "@/lib/links";
import { PRIORITY_LABEL } from "@/lib/status";
import {
  deveBloquearEnter,
  ehAtalhoDeSalvar,
  primeiroSelecionavel,
} from "@/lib/teclasFormulario";
import {
  motivoNaoCria,
  comTodosOsResponsaveis,
  todosJaEscolhidos,
} from "@/lib/criacaoTarefa";
import {
  haPendencias,
  linhasDasSubtarefas,
  motivoNaoDuplicar,
  payloadDasSubtarefas,
  textoDaPendencia,
} from "@/lib/duplicacaoSubtarefas";
import {
  rotuloCaixaSubtarefas,
  valoresIniciaisDaCopia,
} from "@/lib/duplicacaoTarefa";
import { useFecharAoClicarFora, useFecharAoClicarForaDe } from "@/lib/useCliqueFora";
import { useWarnBeforeUnload } from "@/lib/useWarnBeforeUnload";
import { timeDaTarefaNova, type NewTaskTeam } from "@/lib/escopoTarefa";
import Avatar from "@/components/Avatar";
import { nomeCurto } from "@/lib/people";

import Loading from "@/components/Loading";
import { useAvisar } from "@/components/Toasts";
import SeletorDePessoas from "@/components/SeletorDePessoas";
import { pessoasOferecidas } from "@/lib/seguidores";
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// Gatilho redondo "+" que abre a lista com busca (mesmo padrão do detalhe).
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

export default function TaskModal({
  open,
  onClose,
  onSaved,
  defaultProjectId = null,
  newTaskTeam,
  defaultBoardId = null,
  nomeDoQuadro = null,
  duplicarDe = null,
  filhosDaOrigem = [],
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
  defaultProjectId?: string | null; // criar dentro deste projeto
  /**
   * Time da tarefa nova, decidido pelo quadro (`lib/escopoTarefa.ts`).
   * `null` = esta tela não cria do zero, só duplica. Obrigatória para o `tsc`
   * apontar todo chamador.
   */
  newTaskTeam: NewTaskTeam | null;
  /** Quadro onde a tarefa de topo nasce; `null` = Quadro geral. */
  defaultBoardId?: string | null;
  /**
   * Nome do quadro para o cabeçalho (`null` = não mostra). Vem do chamador: o
   * modal não tem a lista de quadros.
   */
  nomeDoQuadro?: string | null;
  // Presente => modo DUPLICAR, pré-preenchido daqui.
  duplicarDe?: Task | null;
  // Filhas diretas da origem, para o rótulo da caixa de subtarefas.
  filhosDaOrigem?: Task[];
}) {
  const duplicando = !!duplicarDe;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Texto com que o modal abriu; "sujo" é diferir dele (a cópia já abre preenchida).
  const textoInicial = useRef({ title: "", description: "" });
  const sujo =
    title.trim() !== textoInicial.current.title.trim() ||
    description.trim() !== textoInicial.current.description.trim();
  // Links com nome: na criação, o que estiver no editor é o que vai.
  const [rascunhoLinks, setRascunhoLinks] = useState<RascunhoLink[]>([]);
  const [tentouSalvarLinks, setTentouSalvarLinks] = useState(false);
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  // Opcional: não entra em `motivoNaoCria`.
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Seletor de projeto só ao criar no quadro geral. Em quadro próprio
  // (`internal`) a tarefa nasce interna; na cópia herda o projeto da origem.
  // Usa `internal`, não `teamId`: no quadro geral da raiz há time e há seletor.
  const mostrarSeletorProjeto =
    !duplicando && !defaultProjectId && !newTaskTeam?.internal;
  const [projetos, setProjetos] = useState<Project[]>([]);
  const [projetoSel, setProjetoSel] = useState(""); // "" => avulsa

  // Responsáveis na criação. `invalidIds` = recusados no 422, marcados em vermelho.
  const [membros, setMembros] = useState<Member[]>([]);
  // Time raiz: distingue tarefa geral de tarefa interna de subtime.
  const [rootTeamId, setRootTeamId] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // Seguidores na criação: nascem vazios, seleção local até o "Criar".
  const [watcherIds, setWatcherIds] = useState<string[]>([]);
  const [buscaSeg, setBuscaSeg] = useState("");
  const [invalidSeg, setInvalidSeg] = useState<Set<string>>(new Set());
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  // Caixa "levar subtarefas" da duplicação.
  const [levarSubtarefas, setLevarSubtarefas] = useState(true);
  // Passo 2 da duplicação: responsáveis de cada subtarefa que não pode herdar.
  const [escolhasSub, setEscolhasSub] = useState<Record<string, string[]>>({});
  const avisar = useAvisar();
  const [puladasSub, setPuladasSub] = useState<Set<string>>(new Set());
  const [abertoResp, setAbertoResp] = useState(false);
  /**
   * Posição do painel de responsáveis, em coordenadas de viewport. Precisa ser
   * `fixed`: o card do modal tem overflow e recortaria um `absolute`. Só escapa
   * do recorte enquanto o card não tiver `transform`, `filter` ou `contain`.
   * Sem portal, para manter o clique-fora e o foco.
   */
  const [posResp, setPosResp] = useState<{
    top: number;
    left: number;
    largura: number;
    maxAltura: number;
  } | null>(null);
  const [buscaResp, setBuscaResp] = useState("");
  const respWrapRef = useRef<HTMLDivElement>(null);

  /** Mede onde o painel cabe e vira para cima quando não cabe embaixo (não testável em jsdom). */
  const medirResp = useCallback(() => {
    const el = respWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const MARGEM = 12;
    const LARGURA = 300;
    const espacoAbaixo = window.innerHeight - r.bottom - MARGEM;
    const espacoAcima = r.top - MARGEM;
    // Só vira com embaixo apertado E em cima melhor, senão pula a cada rolagem.
    const paraCima = espacoAbaixo < 220 && espacoAcima > espacoAbaixo;
    const maxAltura = Math.max(160, Math.min(360, paraCima ? espacoAcima : espacoAbaixo));
    setPosResp({
      // Preso na janela: perto da borda direita o painel sairia da tela.
      left: Math.max(
        MARGEM,
        Math.min(r.left, window.innerWidth - LARGURA - MARGEM),
      ),
      top: paraCima ? Math.max(MARGEM, r.top - maxAltura - 6) : r.bottom + 6,
      largura: LARGURA,
      maxAltura,
    });
  }, []);

  // `scroll` com capture: quem rola é o card do modal, e esse evento não sobe.
  useEffect(() => {
    if (!abertoResp) return;
    medirResp();
    window.addEventListener("resize", medirResp);
    window.addEventListener("scroll", medirResp, true);
    return () => {
      window.removeEventListener("resize", medirResp);
      window.removeEventListener("scroll", medirResp, true);
    };
  }, [abertoResp, medirResp]);

  // Limpa sempre que abre (o modo duplicar pre-preenche depois, ver abaixo).
  useEffect(() => {
    if (!open) return;
    textoInicial.current = { title: "", description: "" };
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setDueDate("");
    setStartDate("");
    setProjetoSel("");
    setAssigneeIds([]);
    setInvalidIds(new Set());
    setAbertoResp(false);
    setBuscaResp("");
    setWatcherIds([]);
    setBuscaSeg("");
    setInvalidSeg(new Set());
    setErro(null);
    setLevarSubtarefas(true);
    // Zera as flags de "já respondeu", senão reabrir pré-preenche com o alcance anterior.
    setMembrosResolvidos(false);
    setRootResolvido(false);
    setAlcanceResolvido(false);
    setRascunhoLinks([]);
    setTentouSalvarLinks(false);
  }, [open]);

  // Projetos do seletor, recortados pelo time. Aqui `teamId` é a raiz: o
  // seletor só aparece quando `internal` é falso.
  useEffect(() => {
    if (!open || !mostrarSeletorProjeto) return;
    listProjects({ size: 100, teamId: newTaskTeam?.teamId ?? null })
      .then((r) => setProjetos(r.items))
      .catch(() => {});
  }, [open, mostrarSeletorProjeto, newTaskTeam?.teamId]);

  // Carrega membros pro seletor de responsaveis.
  useEffect(() => {
    if (!open) return;
    listMembers()
      .then((ms) => setMembros(ms.filter((m) => m.is_active)))
      .catch(() => {})
      .finally(() => setMembrosResolvidos(true));
    // Com `newTaskTeam.teamId` a raiz não é usada (ver `timeAlvo`); perguntar
    // levantaria com várias raízes.
    if (newTaskTeam?.teamId) {
      setRootResolvido(true);
      return;
    }
    // Falha => segue null, e ninguém é escondido.
    getRootTeamId()
      .then(setRootTeamId)
      .catch((e) => console.error("TaskModal: time indefinido", e))
      .finally(() => setRootResolvido(true));
  }, [open, newTaskTeam?.teamId]);

  // Esc fecha (quando aberto e nao salvando).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // `defaultPrevented`: Esc já usado por um menu de dentro (ver TaskDetail).
      if (e.key === "Escape" && !saving && !e.defaultPrevented) fechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving]);

  // Fecha o picker de responsaveis ao clicar fora (padrao EmojiPicker/detalhe).
  useFecharAoClicarForaDe(respWrapRef, abertoResp, () => setAbertoResp(false));

  // Bloqueio do botão: exige título, responsável e prazo; o motivo vai no `title`.
  const motivoBloqueio = motivoNaoCria({ titulo: title, assigneeIds, dueDate });

  // Quem alcança o time da tarefa nova vem do backend, pela mesma regra da
  // designação. `timeDaTarefaNova` espelha o pin do `createTask`; `rootTeamId`
  // só entra em `/quadro` sem time na URL. `null` = carregando ou falhou, não
  // esconde ninguém.
  const timeAlvo = timeDaTarefaNova(newTaskTeam?.teamId ?? null, rootTeamId);
  const [alcancamTime, setAlcancamTime] = useState<Set<string> | null>(null);
  // `alcancamTime === null` é "carregando" ou "falhou"; esta flag separa os dois
  // para o pré-preenchimento esperar um e seguir no outro.
  const [alcanceResolvido, setAlcanceResolvido] = useState(false);
  const [membrosResolvidos, setMembrosResolvidos] = useState(false);
  // `rootTeamId` também vem da rede: sem esta flag, o primeiro render
  // pré-preencheria sem o alcance.
  const [rootResolvido, setRootResolvido] = useState(false);

  useEffect(() => {
    if (!open) {
      setAlcancamTime(null);
      setAlcanceResolvido(false);
      return;
    }
    // Ainda nao sabemos qual e o time alvo: NAO e "resolvido por ausencia".
    if (!rootResolvido) return;
    if (!timeAlvo) {
      // Raiz conhecida e mesmo assim sem time alvo: nao ha o que buscar.
      setAlcancamTime(null);
      setAlcanceResolvido(true);
      return;
    }
    let vivo = true;
    setAlcancamTime(null);
    setAlcanceResolvido(false);
    listMembersDoTime(timeAlvo)
      .then((ms) => {
        // Guarda de corrida: a resposta de um time anterior pode chegar depois.
        if (vivo) setAlcancamTime(new Set(ms.map((m) => m.id)));
      })
      .catch(() => {
        if (vivo) setAlcancamTime(null);
      })
      .finally(() => {
        // Falha também resolve, senão o modal fica em branco.
        if (vivo) setAlcanceResolvido(true);
      });
    return () => {
      vivo = false;
    };
  }, [open, timeAlvo, rootResolvido]);

  const foraDoEscopoAqui = useMemo(() => {
    const fora = new Set<string>();
    if (alcancamTime === null) return fora;
    for (const m of membros) {
      if (!alcancamTime.has(m.id)) fora.add(m.id);
    }
    return fora;
  }, [alcancamTime, membros]);

  // Pré-preenchimento da duplicação. Aplica UMA vez (guarda de `ref`): as
  // dependências mudam depois de aberto e sobrescreveriam o que a pessoa digitou.
  // Espera as duas buscas resolverem para não marcar quem não alcança.
  // `filhosDaOrigem` fica fora das dependências: o chamador passa array novo a cada render.
  const permitidosNaCopia = useMemo(
    () =>
      new Set(
        membros
          .filter((m) => m.is_active && !foraDoEscopoAqui.has(m.id))
          .map((m) => m.id)
      ),
    [membros, foraDoEscopoAqui]
  );

  const copiaPrePreenchida = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !duplicarDe) {
      copiaPrePreenchida.current = null;
      return;
    }
    if (copiaPrePreenchida.current === duplicarDe.id) return;
    if (!alcanceResolvido || !membrosResolvidos) return;

    const v = valoresIniciaisDaCopia(
      {
        title: duplicarDe.title,
        description: duplicarDe.description ?? "",
        priority: duplicarDe.priority,
        assignee_ids: duplicarDe.assignee_ids ?? [],
      },
      // Membros carregados (sem inativos) menos quem não alcança.
      permitidosNaCopia,
      []
    );
    textoInicial.current = { title: v.title, description: v.description };
    setTitle(v.title);
    setDescription(v.description);
    setPriority(v.priority);
    // As duas datas ficam vazias. Ver lib/duplicacaoTarefa.
    setDueDate(v.dueDate);
    setAssigneeIds(v.assigneeIds);
    copiaPrePreenchida.current = duplicarDe.id;
  }, [
    open,
    duplicarDe,
    alcanceResolvido,
    membrosResolvidos,
    permitidosNaCopia,
  ]);

  const membrosFiltrados = useMemo(() => {
    const q = buscaResp.trim().toLowerCase();
    return membros
      // Quem já foi escolhido fica, mesmo fora do escopo, para poder desmarcar.
      .filter((m) => !foraDoEscopoAqui.has(m.id) || assigneeIds.includes(m.id))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [membros, buscaResp, foraDoEscopoAqui, assigneeIds]);

  const seguidoresOferecidos = useMemo(
    () =>
      pessoasOferecidas({
        membros,
        busca: buscaSeg,
        inativos: new Set(),
        foraDoEscopo: foraDoEscopoAqui,
        marcados: watcherIds,
      }),
    [membros, buscaSeg, foraDoEscopoAqui, watcherIds]
  );

  const nomesDosMembros = useMemo(
    () => new Map(membros.map((m) => [m.id, { name: m.name }])),
    [membros]
  );

  function alternarSeguidor(id: string) {
    setWatcherIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setInvalidSeg((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const subtarefasVivas = useMemo(
    () => filhosDaOrigem.filter((f) => !f.is_archived).length,
    [filhosDaOrigem]
  );

  // Passo 2 da duplicação (regra em lib/duplicacaoSubtarefas). Só fica correto
  // depois que `membros` e `alcancamTime` chegam: antes disso tudo aparece pendente.
  const linhasSub = useMemo(
    () => linhasDasSubtarefas(filhosDaOrigem, permitidosNaCopia),
    [filhosDaOrigem, permitidosNaCopia]
  );
  const prontoPraDecidir = alcanceResolvido && membrosResolvidos;
  const mostrarPasso2 =
    duplicando &&
    levarSubtarefas &&
    prontoPraDecidir &&
    haPendencias(linhasSub);
  const travaDasSubtarefas =
    duplicando && levarSubtarefas && prontoPraDecidir
      ? motivoNaoDuplicar(linhasSub, escolhasSub, puladasSub)
      : null;

  // Trocar de origem zera as decisões.
  useEffect(() => {
    setEscolhasSub({});
    setPuladasSub(new Set());
  }, [duplicarDe?.id, open]);

  // A trava do passo 2 usa o mesmo caminho do `motivoBloqueio` (o `title` do botão).
  const motivoFinal = motivoBloqueio ?? travaDasSubtarefas;
  const podeSalvarTudo = motivoFinal === null;

  // Antes do `if (!open)`: hook não pode vir depois de return condicional.
  const scrimProps = useFecharAoClicarFora(fechar);
  useWarnBeforeUnload(open && sujo && !saving);

  if (!open) return null;

  function fechar() {
    if (saving) return;
    if (sujo && !window.confirm("Descartar a tarefa que você estava criando?")) return;
    onClose();
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    // Corrigiu: tira a marca vermelha desse id.
    setInvalidIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // `e` é opcional: o atalho Ctrl/Cmd+Enter chama sem evento.
  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
    const t = title.trim();
    if (!t) {
      setErro("O título é obrigatório.");
      return;
    }
    // Responsável obrigatório só na UI: o POST aceita sem (n8n e triagem dependem disso).
    const impedimento = motivoNaoCria({
      titulo: t,
      assigneeIds: assigneeIds,
      dueDate: dueDate,
    });
    if (impedimento) {
      setErro(impedimento);
      return;
    }
    // Links validam antes de qualquer escrita. Na cópia os links vão pelo servidor.
    if (!duplicando) {
      setTentouSalvarLinks(true);
      if (temErro(errosDosLinks(rascunhoLinks))) {
        setErro("Confira os links marcados.");
        return;
      }
      if (passaDoTeto(rascunhoLinks)) {
        setErro(`No máximo ${MAX_LINKS} links.`);
        return;
      }
    }
    const temLinks = !duplicando && paraEnvio(rascunhoLinks).length > 0;
    setSaving(true);
    setErro(null);
    try {
      let saved: Task;
      if (duplicando && duplicarDe) {
        // `duplicateTask`: a subárvore nasce numa transação só. Sem `due_date` de propósito.
        const copia = await duplicateTask(duplicarDe.id, {
          title: t,
          description: description.trim(),
          priority,
          project_id: duplicarDe.project_id,
          // Cópia de subtarefa nasce irmã, sob o mesmo pai.
          parent_task_id: duplicarDe.parent_task_id,
          team_id: duplicarDe.team_id,
          assignee_ids: assigneeIds,
          include_subtasks: levarSubtarefas,
          // Quem não pode herdar já foi resolvido no passo 2, antes do POST.
          ...(levarSubtarefas
            ? payloadDasSubtarefas(linhasSub, escolhasSub, puladasSub)
            : {}),
        });
        // Um aviso só. Nenhum é erro: a cópia já existe, e segurar o modal faria duplicar de novo.
        const avisos: string[] = [];
        if (copia.promoted_to_root) {
          // Pai arquivado: a cópia nasceria invisível no quadro.
          avisos.push(
            "A cópia foi criada como tarefa de topo, porque a original " +
              "estava dentro de uma tarefa arquivada."
          );
        }
        if (copia.skipped_assignees?.length) {
          const nomes = copia.skipped_assignees
            .map((id) => membros.find((m) => m.id === id)?.name ?? "alguém")
            .join(", ");
          avisos.push(
            "Estas pessoas não foram levadas para as subtarefas porque não " +
              `alcançam mais a tarefa: ${nomes}.`
          );
        }
        if (avisos.length) {
          avisar(`Cópia criada. ${avisos.join(" ")}`);
        }
        saved = copia;
      } else {
        saved = await createTask({
          title: t,
          description: description.trim(),
          priority,
          due_date: dueDate || null,
          // O `createTask` monta o corpo campo a campo: campo novo precisa da linha lá também.
          start_date: startDate || null,
          // Sem hora na criação; a hora fica no detalhe.
          due_time: null,
          project_id: defaultProjectId ?? (projetoSel || null),
          assignee_ids: assigneeIds,
          // Mesma armadilha do `start_date`.
          watcher_ids: watcherIds,
          // O mesmo time que o seletor de responsável usou; divergir gera 422.
          team_id: newTaskTeam?.teamId ?? null,
          // `null` = Quadro geral. Sem esta linha a tarefa nasceria no geral em silêncio.
          board_id: defaultBoardId,
        });
        // Links vão depois de a tarefa existir; se falharem, só avisa (reenviar criaria outra).
        if (temLinks) {
          try {
            await putTaskLinks(saved.id, paraEnvio(rascunhoLinks));
          } catch (errLinks) {
            avisar(
              "Tarefa criada, mas os links não foram salvos: " +
                ((errLinks as ApiError).message || "erro desconhecido") +
                ". Abra a tarefa e adicione os links por lá.",
            );
          }
        }
      }
      setSaving(false);
      onSaved(saved);
    } catch (err) {
      const e = err as ApiError;
      const invalidos: string[] | undefined = e.details?.invalid_ids;
      if (invalidos?.length && e.details?.field === "watcher_ids") {
        // 422 dos seguidores: nada foi criado, a seleção fica e os recusados ficam em vermelho.
        setInvalidSeg(new Set(invalidos));
        const nomes = invalidos
          .map((id) => membros.find((m) => m.id === id)?.name ?? "alguem")
          .join(", ");
        setErro(
          `Não foi possível pôr para seguir: ${nomes}. ` +
            "Essas pessoas não alcançam o time desta tarefa — remova-as para criar."
        );
      } else if (invalidos?.length) {
        // Marca os recusados em vermelho, mantem o resto da selecao.
        setInvalidIds(new Set(invalidos));
        const nomes = invalidos
          .map((id) => membros.find((m) => m.id === id)?.name ?? "alguem")
          .join(", ");
        setErro(
          `Não foi possível atribuir: ${nomes}. ` +
            "Essas pessoas não alcançam o time desta tarefa — remova-as para criar."
        );
      } else {
        setErro(e.message || "Não foi possível salvar a tarefa.");
      }
      setSaving(false);
    }
  }

  return (
    <div
      // Arrastar para selecionar texto e soltar aqui não fecha. Ver `lib/useCliqueFora.ts`.
      {...scrimProps}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(16,24,40,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 16px 24px",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={salvar}
        // Mata o submit implícito: Enter num input não cria a tarefa (regras em lib/teclasFormulario).
        onKeyDown={(e) => {
          if (ehAtalhoDeSalvar(e)) {
            e.preventDefault();
            if (!saving) void salvar();
            return;
          }
          if (e.key !== "Enter") return;
          if (deveBloquearEnter((e.target as HTMLElement).tagName)) {
            e.preventDefault();
          }
        }}
        style={{
          width: 700, maxWidth: "100%", maxHeight: "88dvh", overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 16, padding: 24,
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>
            {duplicando ? "Duplicar tarefa" : "Nova tarefa"}
            {/* Só na criação: a cópia nasce no quadro da origem. */}
            {!duplicando && nomeDoQuadro && (
              <span
                className="muted"
                style={{ fontSize: 13, fontWeight: 600, marginLeft: 8 }}
              >
                {/* Um nó de texto só, para `getByText` e leitor de tela. */}
                {`no quadro ${nomeDoQuadro}`}
              </span>
            )}
          </h2>
          <button
            type="button" className="btn btn-ghost" onClick={fechar}
            style={{ padding: "4px 10px" }} aria-label="Fechar"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <div className="field">
          <label className="label" htmlFor="t-title">Título</label>
          <input
            id="t-title" className="input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que precisa ser feito?" maxLength={255}
          />
        </div>

        <div className="field">
          {/* `span` com id: o editor é `contenteditable`, e `label` só aponta para campo de formulário. */}
          <span className="label" id="t-desc-rotulo">
            Descrição <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
          </span>
          <EditorDeDescricao
            rotuloId="t-desc-rotulo"
            valor={description}
            onChange={setDescription}
            rows={4}
          />
        </div>

        {/* Na cópia o servidor copia os links da original. */}
        {duplicando ? (
          <p className="muted text-xs">Os links da tarefa original vão junto na cópia.</p>
        ) : (
          <div className="field">
            <span className="label">
              Links <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </span>
            <EditorDeLinks
              valor={rascunhoLinks}
              onChange={setRascunhoLinks}
              desabilitado={saving}
              mostrarErros={tentouSalvarLinks}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="t-prio">Prioridade</label>
            <select
              id="t-prio" className="input" value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p] || p}</option>
              ))}
            </select>
          </div>
          {/* Na cópia, prazo e início não aparecem: data velha nasceria vencida. */}
          {!duplicando && (
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="t-start">
                Início <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
              </label>
              <input
                id="t-start" className="input" type="date" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          )}
          {!duplicando && (
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="t-due">
                Prazo <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
              </label>
              <input
                id="t-due" className="input" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          )}
        </div>

        {mostrarSeletorProjeto && (
          <div className="field">
            <label className="label" htmlFor="t-proj">
              Projeto <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </label>
            <select
              id="t-proj" className="input" value={projetoSel}
              onChange={(e) => setProjetoSel(e.target.value)}
            >
              <option value="">Nenhum (avulsa)</option>
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Responsáveis: só quem alcança a tarefa; o 422 do backend é a trava real. */}
        <div className="field">
          <label className="label">
            Responsáveis{" "}
            <span
              style={{ fontWeight: 400, color: "#dc2626" }}
              aria-hidden="true"
            >
              *
            </span>{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (obrigatório)
            </span>
          </label>
          {membros.length === 0 ? (
            <Loading tamanho="linha" rotulo="Carregando os membros" />
          ) : (
            <div ref={respWrapRef} style={{ position: "relative" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {assigneeIds.length === 0 && (
                  <span className="muted" style={{ fontSize: 13 }}>Ninguém designado.</span>
                )}
                {assigneeIds.map((id) => {
                  const m = membros.find((x) => x.id === id);
                  const nome = m?.name ?? "";
                  const bad = invalidIds.has(id);
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        borderRadius: 999, padding: "2px 4px 2px 2px", fontSize: 12.5,
                        background: bad ? "rgba(220,38,38,0.08)" : "var(--surface-2)",
                        border: `1px solid ${bad ? "var(--danger)" : "transparent"}`,
                        color: bad ? "var(--danger)" : "var(--text)",
                      }}
                    >
                      <Avatar id={id} name={nome} size="sm" />
                      {nome ? nomeCurto(nome) : "Responsável"}
                      <button
                        type="button"
                        aria-label={`Remover ${nome || "responsável"}`}
                        title="Remover"
                        onClick={() => toggleAssignee(id)}
                        style={{
                          width: 16, height: 16, borderRadius: 999, border: "none",
                          background: "transparent", color: "inherit", cursor: "pointer",
                          fontSize: 13, lineHeight: 1, padding: 0,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}

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
              </div>

              {abertoResp && (
                <div
                  style={{
                    // `fixed`: ver `posResp`.
                    position: "fixed",
                    top: posResp?.top ?? 0,
                    left: posResp?.left ?? 0,
                    // Folga: o card não abre contexto de empilhamento hoje.
                    zIndex: 70,
                    width: posResp?.largura ?? 300,
                    maxWidth: "calc(100vw - 24px)",
                    // Invisível até medir, para não pular de 0,0.
                    visibility: posResp ? "visible" : "hidden",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
                  }}
                >
                  <input
                    className="input"
                    placeholder="Buscar pessoa…"
                    value={buscaResp}
                    autoFocus
                    onChange={(e) => setBuscaResp(e.target.value)}
                    // Enter aqui seleciona o primeiro da lista filtrada, sem chegar ao form.
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      e.stopPropagation();
                      const id = primeiroSelecionavel(membrosFiltrados);
                      if (id === null) return;
                      toggleAssignee(id);
                      setBuscaResp("");
                    }}
                  />
                  {/* "Selecionar todos" e "Limpar": só na criação, onde a seleção é local
                      até o "Criar". "Todos" = os visíveis na busca (o rótulo leva o número). */}
                  {!duplicando && (
                    <div
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        marginTop: 6,
                      }}
                    >
                      {!todosJaEscolhidos(
                        assigneeIds,
                        membrosFiltrados.map((m) => m.id),
                      ) && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: "3px 8px" }}
                          onClick={() =>
                            setAssigneeIds((prev) =>
                              comTodosOsResponsaveis(
                                prev,
                                membrosFiltrados.map((m) => m.id),
                              ),
                            )
                          }
                        >
                          Selecionar todos ({membrosFiltrados.length})
                        </button>
                      )}
                      {/* Só com alguém escolhido. */}
                      {assigneeIds.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: "3px 8px" }}
                          onClick={() => setAssigneeIds([])}
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    style={{
                      // Altura vem da medição (desconta busca, ações e bordas) para rolar por dentro.
                      maxHeight: Math.max(120, (posResp?.maxAltura ?? 336) - 96),
                      overflowY: "auto", marginTop: 6,
                      border: "1px solid var(--border)", borderRadius: 8,
                    }}
                  >
                    {membrosFiltrados.length === 0 ? (
                      <div className="muted" style={{ fontSize: 13, padding: "10px 12px" }}>
                        Ninguém encontrado.
                      </div>
                    ) : (
                      membrosFiltrados.map((m, i) => {
                        const on = assigneeIds.includes(m.id);
                        const bad = invalidIds.has(m.id);
                        return (
                          <label
                            key={m.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "8px 12px", cursor: "pointer",
                              borderTop: i === 0 ? "none" : "1px solid var(--border)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleAssignee(m.id)}
                            />
                            <Avatar id={m.id} name={m.name} size="sm" />
                            <span
                              style={{
                                fontSize: 13.5,
                                color: bad ? "var(--danger)" : undefined,
                              }}
                            >
                              {m.name}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Seguidores na criação; a cópia não leva seguidores. */}
        {!duplicando && (
          <div className="field">
            <label className="label">
              Seguidores <span className="muted font-normal">(opcional)</span>
            </label>
            {membros.length === 0 ? (
              <Loading tamanho="linha" rotulo="Carregando os membros" />
            ) : (
              <SeletorDePessoas
                marcados={watcherIds}
                nomes={nomesDosMembros}
                inativos={new Set()}
                invalidos={invalidSeg}
                oferecidas={seguidoresOferecidos}
                busca={buscaSeg}
                onBusca={setBuscaSeg}
                onAlternar={alternarSeguidor}
                podeAbrir
                textoVazio="Ninguém segue ainda."
                rotuloDoBotao="Escolher seguidores"
              />
            )}
          </div>
        )}

        {duplicando && (
          <div
            className="field"
            style={{
              gap: 6,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            {/* Sem filha viva, a caixa não aparece. */}
            {rotuloCaixaSubtarefas(subtarefasVivas) !== null && (
              <>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}
                >
                  <input
                    type="checkbox"
                    checked={levarSubtarefas}
                    disabled={saving}
                    onChange={(e) => setLevarSubtarefas(e.target.checked)}
                  />
                  {rotuloCaixaSubtarefas(subtarefasVivas)}
                </label>

                {/* Passo 2: aparece só quando há o que decidir. */}
                {mostrarPasso2 && (
                  <div
                    style={{
                      marginLeft: 22, marginTop: 4, display: "flex",
                      flexDirection: "column", gap: 10,
                      borderLeft: "2px solid var(--border)", paddingLeft: 10,
                    }}
                  >
                    <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                      Estas subtarefas precisam de responsável na cópia:
                    </p>
                    {linhasSub
                      .filter((l) => l.pendente !== null)
                      .map((l) => {
                        const pulada = puladasSub.has(l.id);
                        const escolha = escolhasSub[l.id]?.[0] ?? "";
                        return (
                          <div
                            key={l.id}
                            style={{
                              display: "flex", flexDirection: "column", gap: 4,
                              opacity: pulada ? 0.5 : 1,
                            }}
                          >
                            <strong style={{ fontSize: 13 }}>{l.title}</strong>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {textoDaPendencia(l)}
                            </span>
                            <select
                              aria-label={`Responsável de ${l.title}`}
                              value={escolha}
                              disabled={saving || pulada}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEscolhasSub((prev) => ({
                                  ...prev,
                                  [l.id]: v ? [v] : [],
                                }));
                              }}
                            >
                              <option value="">Escolha quem vai fazer…</option>
                              {membros
                                .filter((m) => permitidosNaCopia.has(m.id))
                                .sort((a, b) =>
                                  a.name.localeCompare(b.name, "pt-BR")
                                )
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                            </select>
                            <label
                              style={{
                                display: "flex", alignItems: "center",
                                gap: 6, fontSize: 12.5,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={pulada}
                                disabled={saving}
                                onChange={(e) => {
                                  const marcar = e.target.checked;
                                  setPuladasSub((prev) => {
                                    const n = new Set(prev);
                                    if (marcar) n.add(l.id);
                                    else n.delete(l.id);
                                    return n;
                                  });
                                }}
                              />
                              Não levar esta subtarefa
                            </label>
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            )}

            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
              A cópia nasce em <strong>Backlog</strong> e <strong>sem prazo</strong>.
            </p>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={fechar} disabled={saving}>
            Cancelar
          </button>
          <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || !podeSalvarTudo}
          title={motivoFinal ?? undefined}
        >
            {saving
              ? "Salvando…"
              : duplicando
                  ? "Duplicar"
                  : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
