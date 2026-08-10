"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import TaskDetail from "@/components/TaskDetail";
import TaskModal from "@/components/TaskModal";
import {
  getTask,
  listTasks,
  listMembers,
  getRootTeamId,
  listAllProjects,
  ApiError,
  type Task,
} from "@/lib/api";

// Rota CANONICA de uma tarefa: /tarefa/<id>.
//
// Por que ela existe: abrir uma tarefa no quadro nao mudava a URL, entao nao
// havia endereco pra compartilhar. O deep-link que ja existia
// (/minhas-tarefas?task=<id>) so funciona pra quem tem a tarefa na PROPRIA
// lista de atribuicoes -- mandar aquele link pra outra pessoa cai no aviso
// "essa tarefa nao esta na sua lista". Esta rota nao depende de lista
// nenhuma: busca a tarefa por id.
//
// Ela CONVIVE com o modal (decisao de produto): clicar num card no quadro
// segue abrindo o modal, rapido e sem sair da pagina. Esta rota e o destino
// de link compartilhado. O mesmo componente (TaskDetail) serve os dois, via
// prop `modo` -- aqui "pagina" (sem scrim, sem Esc).
//
// Permissao: quem valida e o backend (task_visible). Sem acesso -> 404, que
// e o mesmo retorno de "nao existe" (de proposito: nao vaza a existencia da
// tarefa). Por isso a mensagem cobre os dois casos.
//
// ⚠️ O "bug E6" (ADR 0002) FECHOU na Spec 037 (E5). Ele era a incoerencia
// entre lista e detalhe: a tarefa fora da lente aparecia em /minhas-tarefas
// e dava 404 aqui. Agora ela nao aparece na lista, e o 404 daqui passou a
// ser a resposta certa e coerente -- "sem alcance, sem tarefa" (ADR 0038).

const CAP_FILHOS = 100; // limite do backend; mesmo cap do detalhe no quadro

export default function TarefaPage() {
  return (
    <AppShell>
      <Tarefa />
    </AppShell>
  );
}

function Tarefa() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  const [task, setTask] = useState<Task | null>(null);
  const [pai, setPai] = useState<Task | null>(null);
  const [filhos, setFilhos] = useState<Task[]>([]);
  const [members, setMembers] = useState<Map<string, { name: string }>>(
    new Map()
  );
  const [projectNames, setProjectNames] = useState<Map<string, string>>(
    new Map()
  );
  // Spec 031 (C13/C14): conjuntos de EXCLUSAO do seletor. Os mapas acima ficam
  // completos (resolvem nome de quem/do que ja esta na tarefa); estes so tiram
  // da lista de escolha -- projeto pessoal como destino some a tarefa do quadro
  // dos outros, e membro desativado nao deve receber tarefa nova.
  const [projetosPessoais, setProjetosPessoais] = useState<Set<string>>(new Set());
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  // Escopo de time: quem alcanca a tarefa focada. Dado cru porque a tarefa
  // focada muda dentro do TaskDetail. Ver `lib/escopoTarefa.ts`.
  const [subtimePorMembro, setSubtimePorMembro] = useState<Map<string, string | null>>(
    new Map()
  );
  const [rootTeamId, setRootTeamId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Task | null>(null);
  // Spec 033: tarefa que esta sendo DUPLICADA. Separado de `editando` de
  // proposito -- os dois abrem o mesmo modal em modos diferentes, e um estado
  // so faria "duplicar" e "editar" se sobrescreverem em silencio.
  const [duplicando, setDuplicando] = useState<Task | null>(null);

  // Contexto que nao depende do id (nomes de pessoa e de projeto). listMembers
  // tem cache de modulo; listAllProjects nao, mas roda uma vez por navegacao.
  // Falha aqui NAO derruba a pagina: sem o nome, o detalhe degrada sozinho.
  useEffect(() => {
    let vivo = true;
    listMembers()
      .then((ms) => {
        if (!vivo) return;
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
        setSubtimePorMembro(new Map(ms.map((m) => [m.id, m.team_id ?? null])));
      })
      .catch(() => {});
    getRootTeamId()
      .then((r) => {
        if (vivo) setRootTeamId(r);
      })
      .catch(() => {});
    listAllProjects()
      .then((r) => {
        if (!vivo) return;
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        setProjetosPessoais(
          new Set(r.items.filter((p) => p.is_personal).map((p) => p.id))
        );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // ⚠️ EXTRAIDO DO EFEITO em 05/08. A busca dos filhos precisou virar funcao
  // porque o arquivar passou a CASCATEAR: arquivar esta tarefa arquiva a
  // subarvore inteira no banco, e a checklist desta pagina continuaria
  // desenhando subtarefa ativa que ja nao esta mais. `vivo` entra como funcao
  // para a guarda de corrida continuar valendo quando a chamada vem do efeito.
  const recarregarFilhos = useCallback(
    (alvoId: string, vivo: () => boolean = () => true) => {
      listTasks({ parent_task_id: alvoId, size: CAP_FILHOS })
        .then((r) => {
          if (vivo()) setFilhos(r.items);
        })
        .catch(() => {});
    },
    []
  );

  // Carga principal, chaveada pelo id. Navegar de uma subtarefa pra outra
  // (/tarefa/A -> /tarefa/B) NAO remonta o componente no App Router: so muda
  // o param. Por isso o efeito depende de `id` e zera o estado antes de
  // buscar -- senao a tela mostraria a tarefa anterior enquanto carrega.
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    setTask(null);
    setPai(null);
    setFilhos([]);

    (async () => {
      let alvo: Task;
      try {
        alvo = await getTask(id);
      } catch (e) {
        if (!vivo) return;
        const err = e as ApiError;
        setErro(
          err.status === 404
            ? "Tarefa não encontrada, ou você não tem acesso a ela."
            : err.message || "Não consegui carregar esta tarefa."
        );
        setCarregando(false);
        return;
      }
      if (!vivo) return;
      setTask(alvo);
      setCarregando(false);

      // Filhos diretos e pai sao complementares: falha em qualquer um dos
      // dois nao invalida a tarefa em si, entao degradam em silencio.
      recarregarFilhos(alvo.id, () => vivo);

      if (alvo.parent_task_id) {
        getTask(alvo.parent_task_id)
          .then((p) => {
            if (vivo) setPai(p);
          })
          .catch(() => {
            // Pai inacessivel (lente ou E6): a tarefa continua utilizavel,
            // so fica sem o botao "voltar para <pai>".
            if (vivo) setPai(null);
          });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [id]);

  // Merge que PRESERVA assignee_ids: respostas de mutacao (PATCH/move) nao
  // trazem esse campo, e sobrescrever com undefined apagaria o selo do card.
  const mesclar = useCallback((antigo: Task, novo: Task): Task => {
    return {
      ...novo,
      assignee_ids: novo.assignee_ids ?? antigo.assignee_ids,
    };
  }, []);

  const aoUpsertFilho = useCallback(
    (sub: Task) => {
      setFilhos((prev) => {
        const i = prev.findIndex((x) => x.id === sub.id);
        if (i === -1) {
          // Só entra na lista se for filho DIRETO desta tarefa.
          return sub.parent_task_id === id ? [...prev, sub] : prev;
        }
        const copia = [...prev];
        copia[i] = mesclar(copia[i], sub);
        return copia;
      });
    },
    [id, mesclar]
  );

  const aoMudarResponsaveis = useCallback(
    (taskId: string, userIds: string[]) => {
      setTask((prev) =>
        prev && prev.id === taskId ? { ...prev, assignee_ids: userIds } : prev
      );
      setFilhos((prev) =>
        prev.map((x) =>
          x.id === taskId ? { ...x, assignee_ids: userIds } : x
        )
      );
    },
    []
  );

  if (carregando) return <div className="muted">Carregando…</div>;

  if (erro || !task) {
    return (
      <div className="muted">
        {erro ?? "Tarefa não encontrada."} Volte ao{" "}
        <a href="/quadro" className="text-accent underline">
          quadro geral
        </a>
        .
      </div>
    );
  }

  return (
    <>
      <TaskDetail
        modo="pagina"
        task={task}
        members={members}
        projects={projectNames}
        filhos={filhos}
        pai={pai}
        // ⚠️ Esta rota NAO pede `include_archived` no `listTasks` que carrega
        // `filhos`, entao nao ha arquivada ali pra esconder ou mostrar.
        // `false` explicito em vez de default: a prop e obrigatoria justamente
        // pra esta decisao aparecer na chamada.
        mostrarArquivadas={false}
        projetosPessoais={projetosPessoais}
        membrosInativos={membrosInativos}
        subtimePorMembro={subtimePorMembro}
        rootTeamId={rootTeamId}
        // "Voltar" so aparece quando o pai foi carregado de fato -- e leva pra
        // rota do pai (cada nivel tem endereco proprio, entao nao ha pilha).
        temVoltar={pai !== null}
        onVoltar={() => {
          if (pai) router.push(`/tarefa/${pai.id}`);
        }}
        // Nesta rota nao existe "fechar": o X leva pro quadro.
        onClose={() => router.push("/quadro")}
        onEditar={(t) => setEditando(t)}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        // Subtarefa vira NAVEGACAO: ganha endereco proprio, compartilhavel em
        // qualquer profundidade (era o ganho principal sobre a pilha de modal).
        onAbrirSubtarefa={(sub) => router.push(`/tarefa/${sub.id}`)}
        onSubtaskUpsert={aoUpsertFilho}
        onTaskMoved={(t) => {
          setTask((prev) => (prev ? mesclar(prev, t) : t));
          // Cascata de arquivamento (05/08): as filhas mudaram no banco e nao
          // vieram na resposta. Sem esta recarga a checklist fica velha.
          recarregarFilhos(t.id);
        }}
        onExcluir={() => {
          // A tarefa desta pagina deixou de existir -> nao ha o que mostrar.
          router.push("/quadro");
        }}
      />

      <TaskModal
        open={editando !== null || duplicando !== null}
        task={editando}
        duplicarDe={duplicando}
        filhosDaOrigem={duplicando ? filhos : []}
        onClose={() => {
          setEditando(null);
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // ⚠️ A copia e outra tarefa: mesclar no `task` da pagina
            // sobrescreveria a ORIGEM com os dados da copia. Aqui so navega.
            setDuplicando(null);
            router.push(`/tarefa/${t.id}`);
            return;
          }
          setTask((prev) => (prev ? mesclar(prev, t) : t));
          setEditando(null);
        }}
      />
    </>
  );
}
