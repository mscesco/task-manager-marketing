"use client";
// components/TaskModal.tsx
// Modal de CRIAR e EDITAR tarefa.
//  - sem `task`  -> criar  (POST /tasks, pin do time raiz no api.ts)
//  - com `task`  -> editar (PATCH /tasks/{id} SO com o que mudou)
//
// EDITAR prefilla com o objeto que a listagem ja trouxe -- nao ha
// GET /tasks/{id} (contorna o bug E6, ver web/docs/adr/0002).
// O time NAO aparece de proposito: o quadro define o time (ADR 0001).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import {
  createTask,
  duplicateTask,
  updateTask,
  listProjects,
  listMembers,
  listMembersDoTime,
  getRootTeamId,
  ApiError,
  type Task,
  type TaskUpdateInput,
  type Project,
  type Member,
} from "@/lib/api";
import { PRIORITY_LABEL, STATUSES } from "@/lib/status";
import {
  deveBloquearEnter,
  ehAtalhoDeSalvar,
  primeiroSelecionavel,
} from "@/lib/teclasFormulario";
import { motivoNaoCria } from "@/lib/criacaoTarefa";
import {
  avisoSemResponsaveis,
  rotuloCaixaSubtarefas,
  valoresIniciaisDaCopia,
} from "@/lib/duplicacaoTarefa";
import { useFecharAoClicarFora } from "@/lib/useCliqueFora";
import { timeDaTarefaNova } from "@/lib/escopoTarefa";
import Avatar from "@/components/Avatar";
import { nomeCurto } from "@/lib/people";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// Gatilho compacto redondo (mesmo padrao do detalhe): troca o despejo de 30
// chips por um "+" que abre a lista com busca. Duplicado de proposito -- se
// virar mais lugares, extrai pra um modulo compartilhado.
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
  task,
  onClose,
  onSaved,
  defaultProjectId = null,
  defaultTeamId = null,
  duplicarDe = null,
  filhosDaOrigem = [],
}: {
  open: boolean;
  task?: Task | null; // presente => modo editar
  onClose: () => void;
  onSaved: (task: Task) => void;
  defaultProjectId?: string | null; // criar dentro deste projeto (Entrega 11)
  // Fatia 5: time da task de topo. So o quadro de SUBTIME passa (o id do
  // subtime) -> task nasce interna. Null nos demais -> pin na raiz.
  defaultTeamId?: string | null;
  // Spec 033: presente => modo DUPLICAR. Mutuamente exclusivo com `task`
  // (nao se duplica editando). O modal abre pre-preenchido a partir daqui.
  duplicarDe?: Task | null;
  // Filhas DIRETAS da origem, pra contar o rotulo da caixa (D7). Vem do
  // chamador porque quem tem a arvore e o quadro, nao o modal.
  filhosDaOrigem?: Task[];
}) {
  const editando = !!task;
  const duplicando = !editando && !!duplicarDe;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>("BACKLOG");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Seletor de projeto: so ao CRIAR fora de um projeto fixo (quadro geral).
  // No quadro de SUBTIME (defaultTeamId setado) a task de topo nasce INTERNA
  // do subtime por decisao do modelo -> esconder o seletor. Sem isto, dava
  // pra criar uma task com team_id=subtime E project_id=projeto-da-raiz (o
  // backend aceita, pois o subtime e descendente da raiz), e essa task sumia
  // do quadro geral e aparecia so no projeto + como "Interna" no subtime.
  // ⚠️ Ao DUPLICAR o seletor some: a cópia herda o projeto da origem
  // (critério 8 -- cópia de subtarefa nasce irmã, e irmã fora do projeto
  // do pai é combinação que o backend recusa).
  const mostrarSeletorProjeto =
    !editando && !duplicando && !defaultProjectId && !defaultTeamId;
  const [projetos, setProjetos] = useState<Project[]>([]);
  const [projetoSel, setProjetoSel] = useState(""); // "" => avulsa

  // Spec 021: responsaveis na criacao (so no modo CRIAR). invalidIds = quem o
  // backend recusou no 422 -> fica marcado em vermelho, com a selecao preservada.
  const [membros, setMembros] = useState<Member[]>([]);
  // Id do time raiz -- necessario pra distinguir "tarefa geral" (todo mundo
  // alcanca) de "tarefa interna de subtime" (so o subtime alcanca).
  const [rootTeamId, setRootTeamId] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  // Picker com busca (popover): abre/fecha, termo, e ref pra clique-fora.
  // Spec 033: as duas caixas. `levarSubtarefas` = D7; `levarResponsaveis` =
  // D13, e manda SO nas subtarefas -- os do pai estao no campo acima, que a
  // pessoa edita direto.
  const [levarSubtarefas, setLevarSubtarefas] = useState(true);
  const [levarResponsaveis, setLevarResponsaveis] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abertoResp, setAbertoResp] = useState(false);
  const [buscaResp, setBuscaResp] = useState("");
  const respWrapRef = useRef<HTMLDivElement>(null);

  // Prefilla (ou limpa) sempre que abre / troca a task alvo.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(task?.priority ?? "MEDIUM");
    setDueDate(task?.due_date ?? "");
    setStatus(task?.status ?? "BACKLOG");
    setProjetoSel("");
    setAssigneeIds([]);
    setInvalidIds(new Set());
    setAbertoResp(false);
    setBuscaResp("");
    setErro(null);
    setLevarSubtarefas(true);
    setLevarResponsaveis(true);
    setAviso(null);
  }, [open, task]);

  // Carrega projetos comuns pro seletor (so quando ele aparece).
  useEffect(() => {
    if (!open || !mostrarSeletorProjeto) return;
    listProjects({ size: 100 })
      .then((r) => setProjetos(r.items.filter((p) => !p.is_personal)))
      .catch(() => {});
  }, [open, mostrarSeletorProjeto]);

  // Carrega membros pro seletor de responsaveis (so ao CRIAR).
  useEffect(() => {
    if (!open || editando) return;
    listMembers()
      .then((ms) => setMembros(ms.filter((m) => m.is_active)))
      .catch(() => {});
    // Memoizado no api.ts. Falha => segue null e `foraDoEscopo` devolve
    // conjunto vazio (nao esconde ninguem), que e o comportamento antigo.
    getRootTeamId()
      .then(setRootTeamId)
      .catch(() => {});
  }, [open, editando]);

  // Esc fecha (quando aberto e nao salvando).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) fechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving]);

  // Fecha o picker de responsaveis ao clicar fora (padrao EmojiPicker/detalhe).
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

  // Membros filtrados pela busca do picker, ordenados por nome.
  // Bloqueio do botao: no modo CRIAR exige titulo E responsavel; na edicao
  // basta o titulo. A mensagem vai no `title` do botao, para a pessoa saber o
  // que falta antes de tentar.
  const motivoBloqueio = editando
    ? title.trim()
      ? null
      : "Escreva o título da tarefa."
    : motivoNaoCria({ titulo: title, assigneeIds, dueDate });
  const podeSalvar = motivoBloqueio === null;

  // ⚠️ ESCOPO DE TIME NA CRIACAO.
  // A tarefa nova ja nasce com time decidido AQUI: `defaultTeamId` (quadro de
  // subtime -> nasce INTERNA daquele subtime) ou, quando null, a raiz -- e o
  // que o `createTask` faz com o pin (`lib/api.ts`). Logo da pra saber, antes
  // de oferecer, quem vai alcancar a tarefa.
  //
  // Antes esta lista era TODO MUNDO e o comentario acima do campo dizia "o
  // backend valida escopo e recusa os invalidos com 422". Recusava mesmo --
  // depois de a pessoa escolher, escrever o resto e apertar Salvar.
  // Spec 034 (Fatia 5): quem alcanca vem do BACKEND, pela mesma regra do
  // POST de designacao -- agora por TIME, porque a tarefa ainda nao existe.
  //
  // ⚠️ Ate 03/08 isto era `foraDoEscopo(...)`, que so tinha `team_id` e nunca
  // papel. Reportado com captura: criando tarefa no quadro do subtime "CRM e
  // Automacao", a GESTORA sumia do seletor. `timeDaTarefaNova` continua sendo
  // quem decide QUAL time perguntar -- ela espelha o pin do `createTask`.
  //
  // `null` = ainda carregando (ou falhou) => nao esconde ninguem, com o 422
  // do backend ainda de pe.
  const timeAlvo = timeDaTarefaNova(defaultTeamId, rootTeamId);
  const [alcancamTime, setAlcancamTime] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!open || !timeAlvo) {
      setAlcancamTime(null);
      return;
    }
    let vivo = true;
    setAlcancamTime(null);
    listMembersDoTime(timeAlvo)
      .then((ms) => {
        // Guarda de corrida: abrir o modal em quadros diferentes em sequencia
        // pode fazer a resposta do time ANTERIOR chegar depois.
        if (vivo) setAlcancamTime(new Set(ms.map((m) => m.id)));
      })
      .catch(() => {
        if (vivo) setAlcancamTime(null);
      });
    return () => {
      vivo = false;
    };
  }, [open, timeAlvo]);

  // Spec 033 (D9): inativo tambem nao pode entrar no pre-preenchimento --
  // `assign_many_or_fail` recusa inativo do mesmo jeito que recusa quem nao
  // alcanca, e o 422 sai igual.
  const membrosInativosDaqui = useMemo(
    () => new Set(membros.filter((m) => !m.is_active).map((m) => m.id)),
    [membros]
  );

  const foraDoEscopoAqui = useMemo(() => {
    const fora = new Set<string>();
    if (alcancamTime === null) return fora;
    for (const m of membros) {
      if (!alcancamTime.has(m.id)) fora.add(m.id);
    }
    return fora;
  }, [alcancamTime, membros]);

  // Spec 033 -- pre-preenchimento do modo DUPLICAR.
  //
  // ⚠️ EFEITO SEPARADO, e depende de `foraDoEscopoAqui`, que so fica pronto
  // quando `listMembersDoTime` responde. Juntar isto ao efeito acima faria o
  // pre-preenchimento rodar com o conjunto de excluidos AINDA VAZIO: um
  // responsavel sem alcance entraria marcado, e a pessoa levaria um 422 no
  // salvar nomeando alguem que ela talvez nem conheca (D9).
  useEffect(() => {
    if (!open || !duplicarDe) return;
    const v = valoresIniciaisDaCopia(
      {
        title: duplicarDe.title,
        description: duplicarDe.description ?? "",
        priority: duplicarDe.priority,
        assignee_ids: duplicarDe.assignee_ids ?? [],
      },
      new Set([...membrosInativosDaqui, ...foraDoEscopoAqui]),
      filhosDaOrigem.map((f) => ({ is_archived: f.is_archived }))
    );
    setTitle(v.title);
    setDescription(v.description);
    setPriority(v.priority);
    // D5: as duas datas ficam vazias. Ver lib/duplicacaoTarefa.
    setDueDate(v.dueDate);
    setAssigneeIds(v.assigneeIds);
  }, [
    open,
    duplicarDe,
    foraDoEscopoAqui,
    membrosInativosDaqui,
    filhosDaOrigem,
  ]);

  const membrosFiltrados = useMemo(() => {
    const q = buscaResp.trim().toLowerCase();
    return membros
      // Quem ja foi escolhido fica, mesmo fora do escopo: senao a pessoa nao
      // teria como DESMARCAR (a caixa dela sumiria marcada).
      .filter((m) => !foraDoEscopoAqui.has(m.id) || assigneeIds.includes(m.id))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [membros, buscaResp, foraDoEscopoAqui, assigneeIds]);

  // Spec 033 (D14): o aviso e recalculado a cada mudanca das caixas.
  const subtarefasVivas = useMemo(
    () => filhosDaOrigem.filter((f) => !f.is_archived).length,
    [filhosDaOrigem]
  );
  useEffect(() => {
    if (!duplicando) {
      setAviso(null);
      return;
    }
    setAviso(
      avisoSemResponsaveis(
        levarSubtarefas,
        levarResponsaveis,
        subtarefasVivas
      )
    );
  }, [duplicando, levarSubtarefas, levarResponsaveis, subtarefasVivas]);

  // ⚠️ ANTES do `if (!open)`: hook nao pode ficar depois de return
  // condicional. `fechar` e declaracao de funcao, entao ja esta no escopo.
  const scrimProps = useFecharAoClicarFora(fechar);

  if (!open) return null;

  function fechar() {
    if (saving) return;
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

  // `e` e opcional: o <form onSubmit> passa o evento; o atalho Ctrl/Cmd+Enter
  // chama sem evento (ja tratou o preventDefault no handler de tecla).
  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
    const t = title.trim();
    if (!t) {
      setErro("O título é obrigatório.");
      return;
    }
    // Responsavel obrigatorio ao CRIAR (29/07). Nao vale na edicao: o modal de
    // edicao nao mexe em responsaveis (Spec 021), e cobrar aqui travaria quem
    // so quer corrigir um titulo.
    //
    // Medido antes da regra: 50 tarefas ativas sem ninguem designado. Nas
    // raizes o habito ja era atribuir -- nenhuma das 13 em Backlog estava sem
    // responsavel -- entao a trava formaliza a pratica em vez de mudar
    // comportamento. A obrigacao e de UI: o POST segue aceitando sem
    // responsavel, senao n8n e triagem de solicitacao quebravam.
    if (!editando) {
      const impedimento = motivoNaoCria({
        titulo: t,
        assigneeIds: assigneeIds,
        dueDate: dueDate,
      });
      if (impedimento) {
        setErro(impedimento);
        return;
      }
    }
    setSaving(true);
    setErro(null);
    try {
      let saved: Task;
      if (editando && task) {
        // PATCH parcial: monta so o que mudou em relacao ao original.
        const diff: TaskUpdateInput = {};
        if (t !== task.title) diff.title = t;
        const d = description.trim();
        if (d !== (task.description ?? "")) diff.description = d;
        if (priority !== task.priority) diff.priority = priority;
        if (status !== task.status) diff.status = status;
        const due = dueDate || null;
        if (due !== (task.due_date ?? null)) diff.due_date = due;

        if (Object.keys(diff).length === 0) {
          // Nada mudou: nao chama a API, so fecha.
          setSaving(false);
          onClose();
          return;
        }
        saved = await updateTask(task.id, diff);
      } else if (duplicando && duplicarDe) {
        // ⚠️ `duplicateTask`, nao `createTask`: a subarvore inteira precisa
        // nascer na MESMA transacao do backend (criterio 10). Criar o pai
        // aqui e depois criar as filhas em chamadas separadas devolveria
        // "meia arvore no quadro" a cada falha de rede.
        //
        // ⚠️ Sem `due_date` no payload, de proposito (D5) -- o campo nem
        // aparece no modo copia.
        const copia = await duplicateTask(duplicarDe.id, {
          title: t,
          description: description.trim(),
          priority,
          project_id: duplicarDe.project_id,
          // D3: copia de subtarefa nasce IRMA, sob o mesmo pai.
          parent_task_id: duplicarDe.parent_task_id,
          team_id: duplicarDe.team_id,
          assignee_ids: assigneeIds,
          include_subtasks: levarSubtarefas,
          include_assignees: levarResponsaveis,
        });
        // ⚠️ UM alerta só, com tudo que a pessoa precisa saber. Dois alertas
        // seguidos fazem qualquer um clicar OK no segundo sem ler.
        //
        // Nenhum dos dois avisos é erro: a cópia JÁ existe. Segurar o modal
        // aberto aqui faria a pessoa clicar de novo e duplicar duas vezes.
        const avisos: string[] = [];
        if (copia.promoted_to_root) {
          // A cópia seria irmã dentro de um pai arquivado, e o quadro só
          // desenha raiz -- ela nasceria invisível. Promover em silêncio
          // mudaria a hierarquia pelas costas de quem clicou.
          avisos.push(
            "A cópia foi criada como tarefa de topo, porque a original " +
              "estava dentro de uma tarefa arquivada."
          );
        }
        if (copia.skipped_assignees?.length) {
          // D9-c.
          const nomes = copia.skipped_assignees
            .map((id) => membros.find((m) => m.id === id)?.name ?? "alguém")
            .join(", ");
          avisos.push(
            "Estas pessoas não foram levadas para as subtarefas porque não " +
              `alcançam mais a tarefa: ${nomes}.`
          );
        }
        if (avisos.length) {
          window.alert(`Cópia criada. ${avisos.join(" ")}`);
        }
        saved = copia;
      } else {
        saved = await createTask({
          title: t,
          description: description.trim(),
          priority,
          due_date: dueDate || null,
          project_id: defaultProjectId ?? (projetoSel || null),
          assignee_ids: assigneeIds,
          team_id: defaultTeamId,
        });
      }
      setSaving(false);
      onSaved(saved);
    } catch (err) {
      const e = err as ApiError;
      const invalidos: string[] | undefined = e.details?.invalid_ids;
      if (invalidos?.length) {
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
      // ⚠️ Arrastar pra selecionar texto e soltar aqui NAO fecha. Antes
      // fechava, e neste modal fechar significa perder o formulario inteiro
      // sem pergunta nenhuma. Ver `lib/useCliqueFora.ts`.
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
        // Mata o "submit implicito" do HTML: sem isto, Enter em QUALQUER input
        // deste form criava a tarefa com o que estivesse preenchido no
        // instante -- em geral so o titulo, e sem responsavel. Regras em
        // lib/teclasFormulario (textarea e botao seguem funcionando; o atalho
        // deliberado passa a ser Ctrl/Cmd+Enter).
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
          width: 700, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 14, padding: 24,
          boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>
            {editando
              ? "Editar tarefa"
              : duplicando
                ? "Duplicar tarefa"
                : "Nova tarefa"}
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
          <label className="label" htmlFor="t-desc">
            Descrição <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
          </label>
          <textarea
            id="t-desc" className="input" value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes, contexto, links…" rows={4}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

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
          {/* ⚠️ D5: no modo COPIA o campo de prazo NAO aparece.
              Esconder e mais forte que abrir vazio -- vazio convida a
              preencher com a data da origem, e cópia com data velha nasce
              vencida: o job de prazo dispara TASK_OVERDUE para todas na
              primeira execução (51 numa única execução em 01/08). A pessoa
              define o prazo depois, na tarefa criada. */}
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

        {/* Spec 021: responsaveis -- so na criacao (na edicao, mexe-se no detalhe).
            Lista os membros ativos que ALCANCAM a tarefa que vai nascer (ver
            `foraDoEscopoAqui`). O 422 do backend continua sendo a trava real
            -- os recusados ficam vermelhos aqui, sem perder a selecao --, mas
            agora ele e a rede de seguranca, nao o primeiro aviso. */}
        {!editando && (
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
              <span className="muted" style={{ fontSize: 13 }}>Carregando membros…</span>
            ) : (
              <div ref={respWrapRef} style={{ position: "relative" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  {assigneeIds.length === 0 && (
                    <span className="muted" style={{ fontSize: 13 }}>Ninguem designado.</span>
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
                      value={buscaResp}
                      autoFocus
                      onChange={(e) => setBuscaResp(e.target.value)}
                      // Enter aqui SELECIONA o primeiro da lista filtrada. Era
                      // o pior caso do submit implicito: a pessoa digitava o
                      // nome, apertava Enter esperando escolher, e a tarefa
                      // nascia sem responsavel nenhum. Deixar o Enter inerte
                      // consertaria pela metade -- o que se espera dele aqui e
                      // escolher. Para o form nao ver a tecla (o handler de
                      // cima ja bloquearia, mas explicito e melhor que sorte).
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
                    <div
                      style={{
                        maxHeight: 240, overflowY: "auto", marginTop: 6,
                        border: "1px solid var(--border)", borderRadius: 8,
                      }}
                    >
                      {membrosFiltrados.length === 0 ? (
                        <div className="muted" style={{ fontSize: 13, padding: "10px 12px" }}>
                          Ninguem encontrado.
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
        )}

        {/* Status so no modo editar -- na criacao nasce BACKLOG e arrasta-se depois. */}
        {editando && (
          <div className="field">
            <label className="label" htmlFor="t-status">Status</label>
            <select
              id="t-status" className="input" value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
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
            {/* Critério 16: sem filha viva, a caixa não aparece -- oferecer
                "levar 0 subtarefas" é ruído. */}
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

                {/* D13: esta caixa manda SÓ nas subtarefas. Os responsáveis
                    do pai estão no campo acima, editáveis um a um -- uma
                    caixa para eles duplicaria um controle que já existe. */}
                <label
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    fontSize: 13.5, marginLeft: 22,
                    opacity: levarSubtarefas ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={levarResponsaveis}
                    disabled={saving || !levarSubtarefas}
                    onChange={(e) => setLevarResponsaveis(e.target.checked)}
                  />
                  Levar os responsáveis das subtarefas
                </label>
              </>
            )}

            {/* ⚠️ D14: este aviso é a ÚNICA proteção contra o passivo que a
                regra de 29/07 combate (44 das 50 tarefas ativas sem
                responsável eram subtarefas). Não remova sem remover a caixa. */}
            {aviso && (
              <p
                className="muted"
                style={{ margin: "2px 0 0 22px", fontSize: 12.5, color: "var(--warn, var(--text-soft))" }}
              >
                ⚠️ {aviso}
              </p>
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
          disabled={saving || !podeSalvar}
          title={motivoBloqueio ?? undefined}
        >
            {saving
              ? "Salvando…"
              : editando
                ? "Salvar"
                : duplicando
                  ? "Duplicar"
                  : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
