"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import TaskDetail from "@/components/TaskDetail";
import TaskModal from "@/components/TaskModal";
import {
  getTask,
  listArchivedTasks,
  reactivateTask,
  listMembers,
  getRootTeamId,
  listAllProjects,
  listAllTasks,
  quadroGeralComIndice,
  ApiError,
  type Task,
} from "@/lib/api";
import { STATUSES, STATUS_TEXT } from "@/lib/status";
import { rotuloDeColuna, type OrigemDaColuna } from "@/lib/coluna";
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

// ⚠️ RESERVA DO BADGE (fatia 4c-2). O rotulo passou a sair de `coluna.name`;
// este mapa responde quando a coluna da tarefa nao esta na lista carregada --
// tarefa de OUTRO quadro (provavel aqui: `/arquivadas` lista o workspace
// inteiro e as colunas vem do quadro geral), coluna apagada, ou as colunas
// ainda a caminho. Sem ele o badge ficaria vazio nesses casos.
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
  // Fatia 4c-2: o badge de cada linha mostra o NOME da coluna. Em erro fica
  // `[]` e nao `null` -- a lista NAO espera pelas colunas, porque o badge e
  // acessorio aqui e o assunto da tela e reativar tarefa.

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
  // Spec 031 + escopo de time: quem alcanca a tarefa depende do subtime da
  // pessoa e do time DA TAREFA -- por isso vai o dado cru pro TaskDetail, que
  // e quem sabe qual tarefa esta focada. Ver `lib/escopoTarefa.ts`.
  const [subtimePorMembro, setSubtimePorMembro] = useState<Map<string, string | null>>(
    new Map()
  );
  const [rootTeamId, setRootTeamId] = useState<string | null>(null);
  const router = useRouter();
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  // ⚠️ `colunas` E O QUE A TELA CONHECE DO QUADRO GERAL; `indice` e o que ela
  // sabe de TODOS os quadros alcancaveis (fatia 5b-5b). Esta tela nao desenha
  // colunas -- e uma lista chapada e paginada do workspace inteiro -- entao
  // aqui o indice serve so ao rotulo do badge. E e justamente aqui que o caso
  // "nao sei qual coluna" e NORMAL: a tarefa pode viver num quadro que ficou
  // fora do alcance de quem olha, ou apagado.
  const [indice, setIndice] = useState<Map<string, OrigemDaColuna> | null>(null);
  // Pai da subtarefa aberta DIRETO da lista (04/08).
  //
  // ⚠️ Abrindo uma subtarefa arquivada DIRETO da lista -- o caso normal
  // aqui, porque a lista e chapada e nao mostra hierarquia -- nao havia
  // nenhuma indicacao de onde ela veio. A mensagem de erro do desarquivar
  // ("desarquive o pai primeiro") virava uma caca ao tesouro.
  //
  // Mesmo padrao ja usado em /tarefa/[id]: UMA chamada, so quando o detalhe
  // abre. Nao e N+1 na lista.
  const [paiDoDetalhe, setPaiDoDetalhe] = useState<Task | null>(null);
  // Filhos da tarefa focada. A listagem de arquivadas NAO traz a subarvore
  // (ela pagina so as arquivadas), entao busca sob demanda ao abrir -- e o
  // numero que a confirmacao de exclusao usa. `null` = ainda carregando.
  const [filhos, setFilhos] = useState<Task[] | null>(null);
  const [editando, setEditando] = useState<Task | null>(null);
  // Spec 033: tarefa que esta sendo DUPLICADA. Separado de `editando` de
  // proposito -- os dois abrem o mesmo modal em modos diferentes, e um estado
  // so faria "duplicar" e "editar" se sobrescreverem em silencio.
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // O indice de colunas de TODOS os quadros alcancaveis, so para o rotulo do
  // badge -- esta tela nao desenha coluna nenhuma.
  useEffect(() => {
    quadroGeralComIndice()
      .then(({ indice: ix }) => setIndice(ix))
      // ⚠️ FALHA EM SILENCIO, de proposito: o badge cai na reserva por status
      // e a tela segue funcionando. O assunto desta tela e reativar tarefa.
      .catch(() => setIndice(new Map()));
  }, []);

  useEffect(() => {
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
        setSubtimePorMembro(new Map(ms.map((m) => [m.id, m.team_id ?? null])));
      })
      .catch(() => {});
    // Memoizado no api.ts (uma chamada por navegacao). Falha => segue null, e
    // `foraDoEscopo` devolve conjunto vazio: nao esconde ninguem.
    getRootTeamId()
      .then(setRootTeamId)
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
    setFilhos(null);
    // ⚠️ Busca o pai SEMPRE, em vez de depender da `pilha`.
    //
    // A pilha desta tela NUNCA funcionou: `onAbrirSubtarefa` empilhava e
    // chamava `abrirDetalhe`, que fazia `setPilha([])` logo em seguida --
    // React agrupa os dois setters e o ultimo vence. `temVoltar` era sempre
    // false. Buscar o pai cobre os DOIS casos (navegou de dentro, ou abriu
    // direto da lista) com um caminho so, e some com o estado que mentia.
    //
    // Uma chamada por detalhe aberto, igual /tarefa/[id]. Falha em silencio:
    // sem o pai a tarefa continua utilizavel, so fica sem o "voltar".
    setPaiDoDetalhe(null);
    if (t.parent_task_id) {
      getTask(t.parent_task_id)
        .then((p) => setPaiDoDetalhe(p))
        .catch(() => setPaiDoDetalhe(null));
    }
    try {
      const r = await listAllTasks({ include_archived: true });
      setFilhos(r.items.filter((x) => x.parent_task_id === t.id));
    } catch {
      setFilhos([]);
    }
  }

  function fecharDetalhe() {
    setDetalhe(null);
    setPaiDoDetalhe(null);
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
              rotuloDaColuna={rotuloDeColuna(indice?.get(t.column_id))}
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
        temVoltar={paiDoDetalhe !== null}
        pai={paiDoDetalhe}
        // Fica NESTA tela de proposito: o pai tambem esta arquivado, e e aqui
        // que a pessoa vai desarquiva-lo -- que e o que a mensagem de erro do
        // desarquivar manda fazer.
        onVoltar={() => {
          if (paiDoDetalhe) abrirDetalhe(paiDoDetalhe);
        }}
        onClose={fecharDetalhe}
        onEditar={(t) => setEditando(t)}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={() => {}}
        onAbrirSubtarefa={(sub) => abrirDetalhe(sub)}
        // Esta tela E o arquivo: esconder subtarefa arquivada aqui seria
        // esconder justamente o que a pessoa veio ver.
        mostrarArquivadas
        projetosPessoais={projetosPessoais}
        membrosInativos={membrosInativos}
        subtimePorMembro={subtimePorMembro}
        rootTeamId={rootTeamId}
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
        open={editando !== null || duplicando !== null}
        task={editando}
        duplicarDe={duplicando}
        // A tela de arquivadas nao carrega a arvore: sem filhas conhecidas, a
        // caixa da D7 nao aparece (criterio 16) e a copia sai so com o pai.
        // Duplicar uma arquivada COM subarvore se faz pelo quadro.
        filhosDaOrigem={[]}
        defaultProjectId={null}
        defaultTeamId={null}
        onClose={() => {
          setEditando(null);
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // ⚠️ NAVEGA pra copia. Esta tela lista SO arquivadas, e a copia
            // nasce ATIVA -- recarregar a lista aqui nao mostraria nada e a
            // pessoa ficaria sem nenhum sinal de que a tarefa foi criada.
            setDuplicando(null);
            router.push(`/tarefa/${t.id}`);
            return;
          }
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
  rotuloDaColuna,
  primeira,
  onReativou,
  onAbrir,
}: {
  t: Task;
  /**
   * `Quadro · Coluna`, ou so a coluna quando a tarefa mora no quadro geral.
   *
   * ⚠️ `null` E O CASO NORMAL DESTA TELA, e nao um defeito. Ela lista o
   * workspace inteiro PAGINADO; a tarefa pode viver num quadro fora do alcance
   * de quem olha, ou apagado. Ali a reserva por status resolve, e por isso
   * `rotuloDeColuna` devolve `null` em vez de inventar um rotulo.
   *
   * ⚠️ Ao contrario do `TaskCard`, aqui a coluna nao decide REGRA nenhuma
   * (prazo, parada) -- e so um rotulo. Exigir a coluna forcaria esta tela a
   * esperar os quadros para desenhar a lista, e o assunto dela e reativar
   * tarefa.
   */
  rotuloDaColuna: string | null;
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
          {/* Nome da coluna; reserva no rotulo do status. A COR continua
              vindo de `STATUS_TEXT` -- `coluna.color` e token de traco e
              reprova AA como texto (Spec 031 §2.2b); a derivacao acessivel de
              cor arbitraria e da fatia 5 (`lib/coluna.ts::corEhHex`). */}
          {rotuloDaColuna ?? STATUS_LABEL[t.status] ?? t.status}
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
