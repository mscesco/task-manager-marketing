"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import TaskDetail from "@/components/TaskDetail";
import TaskModal from "@/components/TaskModal";
import {
  listArchivedTasks,
  reactivateTask,
  listMembers,
  listAllProjects,
  listAllTasks,
  ApiError,
  type Task,
} from "@/lib/api";
import { STATUSES, STATUS_TEXT } from "@/lib/status";
import { mensagemExclusao } from "@/lib/exclusao";

// Tela de arquivadas (Spec 013, fatia 4). Lista paginada de tarefas
// arquivadas (manuais ou pela varredura) + reativar (volta pra BACKLOG e
// desarquiva). Pagina de verdade: o conjunto cresce sem fim.
//
// Spec 031 (C5): a linha ABRE O TaskDetail, e a exclusao acontece la dentro.
//
// ⚠️ Por que nao um botao "Excluir" na linha: tudo que ele precisaria ja existe
// no TaskDetail -- confirmacao com o nome, contagem de subtarefas diretas,
// aviso de que nao da pra desfazer, e o portao por `task.delete`. Um segundo
// caminho de exclusao seria uma segunda copia dessas quatro regras, e a copia
// que ninguem lembra de atualizar e a que apaga a coisa errada.
//
// De quebra resolve o pedido inteiro: da pra abrir, ler descricao, comentarios
// e subtarefas, e SO ENTAO decidir. Excluir da lista seria cascata cega -- a
// linha nao mostra que a tarefa leva 6 filhas junto.

const PAGE_SIZE = 30;

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
// Spec 031 (C1a): a cor do BADGE vem de STATUS_TEXT, nao de STATUSES[].color.
// STATUSES[].color e o token de TRACO (bolinha, borda de coluna) -- como texto
// ou como fundo sob texto ele reprova AA. Ver Spec 031 §2.2b/§2.2c.
const STATUS_COLOR: Record<string, string> = STATUS_TEXT;

export default function ArquivadasPage() {
  return (
    <AppShell>
      <Arquivadas />
    </AppShell>
  );
}

function Arquivadas() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  // --- Suporte ao TaskDetail (Spec 031, C5) --------------------------------
  // members e projects sao mapas de exibicao (nome do responsavel, nome do
  // projeto). Carregam em paralelo e NAO bloqueiam a lista: se falharem, o
  // detalhe abre com os nomes em branco em vez de nao abrir.
  const [members, setMembers] = useState<Map<string, { name: string }>>(new Map());
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [projetosPessoais, setProjetosPessoais] = useState<Set<string>>(new Set());
  // Spec 031 (C14): so tira do seletor e marca a pilula. `members` fica
  // completo -- tarefa arquivada costuma ter justamente quem ja saiu do time.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Filhos da tarefa focada. A listagem de arquivadas NAO traz a subarvore
  // (ela pagina so as arquivadas), entao busca sob demanda ao abrir -- e o
  // numero que a confirmacao de exclusao usa. `null` = ainda carregando.
  const [filhos, setFilhos] = useState<Task[] | null>(null);
  const [editando, setEditando] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
      })
      .catch(() => {});
    listAllProjects()
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        setProjetosPessoais(new Set(r.items.filter((p) => p.is_personal).map((p) => p.id)));
      })
      .catch(() => {});
  }, []);

  // ⚠️ Busca a subarvore ANTES de deixar o detalhe util: a confirmacao de
  // exclusao mostra `filhos.length`, e com a lista vazia ela mentiria dizendo
  // "0 subtarefas" numa tarefa que tem seis. Falhou? filhos = [] e a
  // confirmacao apenas omite a contagem -- nunca afirma que nao ha filhas.
  async function abrirDetalhe(t: Task) {
    setDetalhe(t);
    setPilha([]);
    setFilhos(null);
    try {
      const r = await listAllTasks({ include_archived: true });
      setFilhos(r.items.filter((x) => x.parent_task_id === t.id));
    } catch {
      setFilhos([]);
    }
  }

  function fecharDetalhe() {
    setDetalhe(null);
    setPilha([]);
    setFilhos(null);
  }

  async function carregar(p: number) {
    setErro(null);
    try {
      const r = await listArchivedTasks({ page: p, size: PAGE_SIZE });
      setTasks(r.items);
      setTotal(r.total);
      setPage(r.page);
      // Se a pagina ficou vazia apos reativar a ultima e nao e a 1a, recua.
      if (r.items.length === 0 && r.page > 1) {
        carregar(r.page - 1);
      }
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar as arquivadas.");
    }
  }

  useEffect(() => {
    carregar(1);
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (erro) return <div className="error-box" style={{ maxWidth: 560 }}>{erro}</div>;
  if (!tasks) return <div className="muted">Carregando arquivadas…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title="Arquivadas" count={total} />

      {tasks.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa arquivada"
          description="Tarefas concluídas ou canceladas antigas aparecem aqui."
        />
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {tasks.map((t, i) => (
            <LinhaArquivada
              key={t.id}
              t={t}
              primeira={i === 0}
              onReativou={() => carregar(page)}
              onAbrir={abrirDetalhe}
            />
          ))}
        </div>
      )}

      <TaskDetail
        task={detalhe}
        members={members}
        projects={projectNames}
        filhos={filhos ?? []}
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={() => {
          const p = pilha[pilha.length - 1];
          setPilha((s2) => s2.slice(0, -1));
          if (p) abrirDetalhe(p);
        }}
        onClose={fecharDetalhe}
        onEditar={(t) => setEditando(t)}
        onAssigneesChange={() => {}}
        onAbrirSubtarefa={(sub) => {
          if (detalhe) setPilha((s2) => [...s2, detalhe]);
          abrirDetalhe(sub);
        }}
        // Esta tela E o arquivo: esconder subtarefa arquivada aqui seria
        // esconder justamente o que a pessoa veio ver.
        mostrarArquivadas
        projetosPessoais={projetosPessoais}
        membrosInativos={membrosInativos}
        onSubtaskUpsert={() => carregar(page)}
        onTaskMoved={() => carregar(page)}
        onExcluir={(t, cascade) => {
          fecharDetalhe();
          carregar(page);
          setToast(mensagemExclusao(t.title, cascade));
          setTimeout(() => setToast(null), 4000);
        }}
      />

      <TaskModal
        open={editando !== null}
        task={editando}
        defaultProjectId={null}
        defaultTeamId={null}
        onClose={() => setEditando(null)}
        onSaved={() => {
          setEditando(null);
          carregar(page);
        }}
      />

      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "var(--text)", color: "var(--surface)", padding: "10px 16px",
            borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 60,
            boxShadow: "var(--shadow)", maxWidth: 420,
          }}
        >
          {toast}
        </div>
      )}

      {totalPaginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => carregar(page - 1)}
            style={{ padding: "6px 12px" }}
          >
            ← Anterior
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Página {page} de {totalPaginas}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPaginas}
            onClick={() => carregar(page + 1)}
            style={{ padding: "6px 12px" }}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}

function LinhaArquivada({
  t,
  primeira,
  onReativou,
  onAbrir,
}: {
  t: Task;
  primeira: boolean;
  onReativou: () => void;
  onAbrir: (t: Task) => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function reativar() {
    setBusy(true);
    setErro(null);
    try {
      await reactivateTask(t.id);
      onReativou();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Você não tem permissão para reativar esta tarefa."
          : a.message || "Não consegui reativar."
      );
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px",
        borderTop: primeira ? "none" : "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Spec 031 (C5): o TITULO abre o detalhe -- nao a linha inteira,
              que ja tem botoes dentro e produziria clique fantasma. */}
          <button
            type="button"
            className="tappable"
            onClick={() => onAbrir(t)}
            title="Abrir a tarefa"
            style={{
              display: "block", width: "100%", textAlign: "left",
              border: "none", background: "transparent", padding: 0,
              font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {t.title}
          </button>
        </div>
        <Badge tone="outline" size="md" weight="normal" color={STATUS_COLOR[t.status]} className="shrink-0">
          {STATUS_LABEL[t.status] || t.status}
        </Badge>

        {!confirmar && (
          <button
            className="btn btn-ghost"
            onClick={() => { setErro(null); setConfirmar(true); }}
            style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
          >
            Reativar
          </button>
        )}
      </div>

      {confirmar && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Reativar <strong>{t.title}</strong>? Volta ao quadro em <strong>Backlog</strong>.
          </span>
          <button className="btn btn-primary" onClick={reativar} disabled={busy} style={{ padding: "4px 12px", fontSize: 12 }}>
            {busy ? "…" : "Reativar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmar(false)} disabled={busy} style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {erro && <div className="error-box">{erro}</div>}
    </div>
  );
}
