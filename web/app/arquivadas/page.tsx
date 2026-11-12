"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import Badge from "@/components/Badge";
import TaskDetail from "@/components/TaskDetail";
import { dataParaTela } from "@/lib/baseTable";
import { nomeCurto } from "@/lib/people";
import { diaNoWorkspace } from "@/lib/prazo";
import TaskModal from "@/components/TaskModal";
import { useAvisar } from "@/components/Toasts";
import {
  getTask,
  listArchivedTasks,
  reactivateTask,
  listMembers,
  listAllProjects,
  quadroGeralComIndice,
  ApiError,
  type Task,
} from "@/lib/api";
import { STATUSES, STATUS_TEXT } from "@/lib/status";
import { rotuloDeColuna, type OrigemDaColuna } from "@/lib/coluna";
import { mensagemExclusao } from "@/lib/exclusao";

import Loading from "@/components/Loading";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import Paginacao from "@/components/Paginacao";
// Tela de arquivadas: lista paginada + reativar (volta pra BACKLOG e
// desarquiva). A linha abre o TaskDetail, e a exclusão acontece lá dentro: um
// segundo caminho de exclusão duplicaria as regras de confirmação e permissão.

const PAGE_SIZE = 30;

// Reserva do badge quando a coluna da tarefa não está na lista carregada
// (outro quadro, coluna apagada ou colunas ainda a caminho).
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
);
// A cor do badge vem de STATUS_TEXT: STATUSES[].color é token de traço e reprova AA como texto.
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
  // Nome da coluna no badge. Em erro fica `[]`: a lista não espera pelas colunas.

  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  // --- suporte ao TaskDetail -------------------------------------------------
  // Mapas de exibição; carregam em paralelo e não bloqueiam a lista.
  const [members, setMembers] = useState<Map<string, { name: string }>>(new Map());
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  // Só tira do seletor e marca a pílula; `members` fica completo (arquivada costuma ter quem já saiu).
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const router = useRouter();
  const [detalhe, setDetalhe] = useState<Task | null>(null);
  // `colunas` é o quadro geral; `indice`, todos os quadros alcançáveis (aqui só
  // para o rótulo do badge).
  const [indice, setIndice] = useState<Map<string, OrigemDaColuna> | null>(null);
  // Pai da subtarefa aberta direto da lista (a lista é chapada e não mostra hierarquia).
  const [paiDoDetalhe, setPaiDoDetalhe] = useState<Task | null>(null);
  // Tarefa sendo duplicada (o modal desta tela só duplica).
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  const avisar = useAvisar();
  // Time ativo vem da barra: `useSearchParams` aqui quebraria o build da rota estática.
  const { active, teamName: nomeDoTime } = useActiveTeam();
  const timeAtivo = useActiveTeamId();

  // O índice de colunas de todos os quadros alcançáveis, só para o rótulo do badge.
  useEffect(() => {
    // `null` de propósito: esta tela usa só o `indice`, que é de todos os quadros.
    quadroGeralComIndice(null)
      .then(({ indice: ix }) => setIndice(ix))
      // Falha em silêncio: o badge cai na reserva por status.
      .catch(() => setIndice(new Map()));
  }, []);

  useEffect(() => {
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
      })
      .catch(() => {});
    listAllProjects({
      // Só rotula (id -> título para o selo de projeto); não recorta por time.
      teamId: null,
    })
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
      })
      .catch(() => {});
  }, []);

  function abrirDetalhe(t: Task) {
    setDetalhe(t);
    // Busca o pai sempre (uma chamada por detalhe aberto), para o "voltar" e
    // para indicar de onde veio a subtarefa. Falha em silêncio: sem o pai só fica sem o "voltar".
    setPaiDoDetalhe(null);
    if (t.parent_task_id) {
      getTask(t.parent_task_id)
        .then((p) => setPaiDoDetalhe(p))
        .catch(() => setPaiDoDetalhe(null));
    }
  }

  function fecharDetalhe() {
    setDetalhe(null);
    setPaiDoDetalhe(null);
  }

  async function carregar(p: number) {
    setErro(null);
    try {
      const r = await listArchivedTasks({
        page: p,
        size: PAGE_SIZE,
        teamId: timeAtivo,
      });
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
    // Espera a barra resolver. `active === null` ("ainda não sei") difere de
    // `kind: "none"` ("sem time"), senão uma falha da barra carregaria para sempre.
    if (active === null) return;
    carregar(1);
    // Trocar de time refaz a busca e volta para a página 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `active === null`, não `active`: o objeto é novo a cada render e refaria o pedido.
  }, [timeAtivo, active === null]);


  if (erro) return <div className="error-box" style={{ maxWidth: 560 }}>{erro}</div>;
  if (!tasks) return <Loading rotulo="Carregando arquivadas" />;

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* O nome do time diz que a lista está recortada. */}
      <PageHeader
        title={nomeDoTime ? `Arquivadas · ${nomeDoTime}` : "Arquivadas"}
        count={total}
      />

      {tasks.length === 0 ? (
        <EmptyState
          title={
            nomeDoTime
              ? `Nenhuma tarefa arquivada em ${nomeDoTime}`
              : "Nenhuma tarefa arquivada"
          }
          description="Tarefas concluídas ou canceladas antigas aparecem aqui."
        />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="label px-3 py-2.5 text-left">Tarefa</th>
                <th scope="col" className="label px-3 py-2.5 text-left">Projeto</th>
                <th scope="col" className="label px-3 py-2.5 text-left">Coluna</th>
                <th scope="col" className="label px-3 py-2.5 text-left">Concluída em</th>
                <th scope="col" className="label px-3 py-2.5 text-left">Responsável</th>
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <LinhaArquivada
                  key={t.id}
                  t={t}
                  rotuloDaColuna={rotuloDeColuna(indice?.get(t.column_id))}
                  projeto={t.project_id ? projectNames.get(t.project_id) ?? null : null}
                  responsaveis={(t.assignee_ids ?? []).map((id) => ({ id, nome: members.get(id)?.name ?? "" }))}
                  onReativou={() => carregar(page)}
                  onAbrir={abrirDetalhe}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskDetail
        task={detalhe}
        members={members}
        projects={projectNames}
        temVoltar={paiDoDetalhe !== null}
        pai={paiDoDetalhe}
        // Fica nesta tela: o pai também está arquivado, e é aqui que se desarquiva.
        onVoltar={() => {
          if (paiDoDetalhe) abrirDetalhe(paiDoDetalhe);
        }}
        onClose={fecharDetalhe}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={() => {}}
        onAbrirSubtarefa={(sub) => abrirDetalhe(sub)}
        // Esta tela é o arquivo: não esconde subtarefa arquivada.
        mostrarArquivadas
        membrosInativos={membrosInativos}
        onSubtaskUpsert={() => carregar(page)}
        onTaskMoved={() => carregar(page)}
        onExcluir={(t, cascade) => {
          fecharDetalhe();
          carregar(page);
          avisar(mensagemExclusao(t.title, cascade));
        }}
      />

      <TaskModal
        open={duplicando !== null}
        duplicarDe={duplicando}
        // Esta tela não carrega a árvore: a cópia sai só com o pai. Duplicar com
        // subárvore se faz pelo quadro.
        filhosDaOrigem={[]}
        defaultProjectId={null}
        // Esta tela nao cria tarefa do zero (`open` exige duplicar).
        newTaskTeam={null}
        onClose={() => {
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // Navega para a cópia: ela nasce ativa e não apareceria nesta lista.
            setDuplicando(null);
            router.push(`/tarefa/${t.id}`);
            return;
          }
          carregar(page);
        }}
      />

      <Paginacao
        pagina={page}
        total={total}
        porPagina={PAGE_SIZE}
        rotulo="Tarefas"
        onIr={carregar}
      />
    </div>
  );
}

function LinhaArquivada({
  t,
  rotuloDaColuna,
  projeto,
  responsaveis,
  onReativou,
  onAbrir,
}: {
  t: Task;
  /**
   * `Quadro · Coluna`, ou só a coluna quando a tarefa mora no quadro geral.
   * `null` é normal aqui (quadro fora do alcance ou apagado): cai na reserva por status.
   */
  rotuloDaColuna: string | null;
  /** Nome do projeto, se a tarefa tem um e o mapa já chegou. */
  projeto: string | null;
  responsaveis: { id: string; nome: string }[];
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

  // Uma linha de tabela; a confirmação de reativar e o erro abrem numa segunda linha.
  return (
    <>
      <tr className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
        <td className="max-w-[360px] px-3 py-2 align-middle">
          {/* O título abre o detalhe, não a linha inteira, que tem botões dentro. */}
          <button
            type="button"
            className="tappable block w-full truncate text-left font-semibold text-ink"
            onClick={() => onAbrir(t)}
            title="Abrir a tarefa"
            style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontWeight: 600 }}
          >
            {t.title}
          </button>
        </td>
        <td className="px-3 py-2 align-middle">
          {projeto ? (
            <Badge tone="neutral" size="sm" weight="semibold" className="bg-surface-2 text-ink-soft">
              {projeto}
            </Badge>
          ) : (
            <span className="muted text-xs">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-middle">
          <Badge tone="soft" size="sm" color={STATUS_COLOR[t.status]}>
            {/* Nome da coluna, ou o rótulo do status. A cor vem de `STATUS_TEXT`:
                `coluna.color` é token de traço e reprova AA como texto. */}
            {rotuloDaColuna ?? STATUS_LABEL[t.status] ?? t.status}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-3 py-2 align-middle text-ink-soft">
          {t.completed_at ? dataParaTela(diaNoWorkspace(t.completed_at)) : <span className="muted">—</span>}
        </td>
        <td className="px-3 py-2 align-middle">
          {responsaveis.length === 0 ? (
            <span className="muted text-xs">sem responsável</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="flex">
                {responsaveis.slice(0, 3).map((r, i) => (
                  <Avatar
                    key={r.id}
                    id={r.id}
                    name={r.nome}
                    size="sm"
                    title={r.nome || "Responsável"}
                    className="border-[1.5px] border-surface"
                    style={{ marginLeft: i === 0 ? 0 : -6 }}
                  />
                ))}
              </span>
              <span className="truncate text-sm">
                {responsaveis.length === 1 ? nomeCurto(responsaveis[0].nome) : `${responsaveis.length} pessoas`}
              </span>
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
          {!confirmar && (
            <button
              className="btn btn-ghost"
              onClick={() => { setErro(null); setConfirmar(true); }}
              style={{ padding: "4px 10px", fontSize: 12 }}
            >
              Reativar
            </button>
          )}
        </td>
      </tr>
      {(confirmar || erro) && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={6} className="px-3 pb-3 pt-1">
            {confirmar && (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="muted text-sm">
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
            {erro && <div className="error-box mt-2">{erro}</div>}
          </td>
        </tr>
      )}
    </>
  );
}
