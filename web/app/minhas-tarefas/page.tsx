"use client";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import { STATUSES, PRIORITY_LABEL, PRIORITY_COLOR } from "@/lib/status";
import {
  listMyAssignments,
  listMembers,
  ApiError,
  type Task,
  type MyTaskItem,
} from "@/lib/api";

const RELATION_LABEL: Record<string, string> = {
  assignee: "Responsavel",
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
  const [erro, setErro] = useState<string | null>(null);

  // Filtros (client-side, sobre a lista ja carregada). Comecam "tudo visivel".
  const [relFiltro, setRelFiltro] = useState<string>("todas");
  const [statusOn, setStatusOn] = useState<Set<string>>(() => new Set(TODOS_STATUS));

  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  const [editando, setEditando] = useState<Task | null>(null);
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);

  useEffect(() => {
    listMyAssignments({ size: 100 })
      .then((r) => {
        // Camila (E9): esconder out_of_scope por ora -- essas tarefas dao 404
        // no detalhe (bug conhecido E6). Quando for tratar, troca este filtro.
        setItems(r.items.filter((t) => !t.out_of_scope));
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => setMembers(new Map(ms.map((m) => [m.id, { name: m.name }]))))
      .catch(() => {});
  }, []);

  // Deep-link da notificacao: ?task=<id> abre o detalhe da task da PROPRIA
  // lista (E6-safe: reusa o objeto que listMyAssignments ja trouxe, sem
  // GET /tasks/{id}). Roda uma vez, depois da lista carregar. Procura na lista
  // COMPLETA (items), nao na filtrada -- um filtro ativo nao deve furar o link.
  useEffect(() => {
    if (deepLinkFeito || items === null) return;
    setDeepLinkFeito(true);
    const alvo = new URLSearchParams(window.location.search).get("task");
    if (!alvo) return;
    const t = items.find((x) => x.id === alvo);
    if (t) {
      setPilha([]);
      setDetalhe(t);
    }
  }, [items, deepLinkFeito]);

  // --- abrir / navegar / fechar o detalhe (mesma logica do quadro) ---
  function abrirDetalhe(t: Task) {
    setPilha([]);
    setDetalhe(t);
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
        };
        return [nova, ...prev];
      }
      const merged: MyTaskItem = {
        ...t,
        relations: existente.relations,
        out_of_scope: existente.out_of_scope,
        assignee_ids: t.assignee_ids ?? existente.assignee_ids,
      };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setItems((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
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
    setStatusOn(new Set(TODOS_STATUS));
  }

  // Aplica relacao + status sobre a lista carregada.
  const filtrados = useMemo(() => {
    return (items ?? []).filter((t) => {
      const okStatus = statusOn.has(t.status);
      const okRel = relFiltro === "todas" || t.relations.includes(relFiltro);
      return okStatus && okRel;
    });
  }, [items, statusOn, relFiltro]);

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

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <div className="muted">Carregando…</div>;

  // Detalhe e subtarefas SEMPRE sobre a lista completa (um filtro ativo nao
  // pode quebrar abrir/navegar uma task que esta fora do filtro atual).
  const focado = detalhe ? items.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? items.filter((t) => t.parent_task_id === focado.id) : [];

  const visiveis = filtrados.length;
  const todosLigados = statusOn.size === TODOS_STATUS.length;
  const contagem =
    visiveis === items.length ? `${items.length} tarefas` : `${visiveis} de ${items.length}`;

  // Uma linha de tarefa. A data saiu daqui — agora vive no cabeçalho do grupo.
  function linhaTarefa(t: MyTaskItem, i: number) {
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
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{t.title}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {STATUS_LABEL[t.status] || t.status}
            </span>
            {t.relations.map((r) => (
              <Badge key={r} tone="neutral" size="sm" weight="semibold" className="bg-surface-2 text-ink-soft">
                {RELATION_LABEL[r] || r}
              </Badge>
            ))}
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
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Minhas tarefas" count={contagem} />

      {items.length === 0 ? (
        <EmptyState
          title="Voce esta em dia"
          description="Tarefas em que voce e responsavel, criador ou acompanha aparecem aqui."
        />
      ) : (
        <div className="max-w-[1100px]">
          {barraFiltros()}

          {visiveis === 0 ? (
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
        filhos={filhosFocado}
        temVoltar={pilha.length > 0}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onEditar={(t) => {
          setEditando(t);
        }}
        onAssigneesChange={aoMudarResponsaveis}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsert}
        onExcluir={(t) => {
          // Remove a task (e a subtree por path) da lista e fecha.
          setItems((prev) =>
            (prev ?? []).filter(
              (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
            )
          );
          fecharDetalhe();
        }}
      />
    </div>
  );
}
