"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import TaskDetail from "@/components/TaskDetail";
import TaskModal from "@/components/TaskModal";
import Loading from "@/components/Loading";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  getTask,
  listTasks,
  listMembers,
  listAllProjects,
  ApiError,
  type Task,
} from "@/lib/api";

// Rota canônica de uma tarefa: /tarefa/<id>, o destino de link compartilhado.
// Convive com o modal do quadro; o mesmo TaskDetail serve os dois, via `modo`
// ("pagina": sem scrim, sem Esc). Sem acesso o backend responde 404, igual a
// "não existe", por isso a mensagem cobre os dois casos.

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
  // `?comentario=` vem do link da notificação (`lib/notificacoes.ts`). Rota
  // dinâmica (`ƒ` no build), então `useSearchParams` não pede Suspense aqui.
  const comentarioEmFoco = useSearchParams().get("comentario");

  const [task, setTask] = useState<Task | null>(null);
  // A aba passa a se chamar pela tarefa (o layout da rota diz so "Tarefa").
  useDocumentTitle(task?.title);
  const [pai, setPai] = useState<Task | null>(null);
  const [filhos, setFilhos] = useState<Task[]>([]);
  const [members, setMembers] = useState<Map<string, { name: string }>>(
    new Map()
  );
  const [projectNames, setProjectNames] = useState<Map<string, string>>(
    new Map()
  );
  // Só tiram da lista de escolha; os mapas acima ficam completos. Projeto
  // pessoal como destino sumiria a tarefa dos outros; desativado não recebe tarefa.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Tarefa sendo duplicada (o modal desta tela só duplica).
  const [duplicando, setDuplicando] = useState<Task | null>(null);

  // Contexto que não depende do id (nomes de pessoa e de projeto). Falha aqui
  // não derruba a página: sem o nome, o detalhe degrada sozinho.
  useEffect(() => {
    let vivo = true;
    listMembers()
      .then((ms) => {
        if (!vivo) return;
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
      })
      .catch(() => {});
    listAllProjects({
      // Só rotula (id -> título para o selo de projeto); não recorta por time.
      teamId: null,
    })
      .then((r) => {
        if (!vivo) return;
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // Função, não só efeito: arquivar cascateia para a subárvore e a checklist
  // precisa recarregar. `vivo` mantém a guarda de corrida quando vem do efeito.
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
            // Pai inacessível: a tarefa continua utilizável, só sem o "voltar".
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

  if (carregando) return <Loading />;

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
        comentarioEmFoco={comentarioEmFoco}
        task={task}
        members={members}
        projects={projectNames}
        pai={pai}
        // Esta rota não pede `include_archived` para `filhos`: não há arquivada a
        // esconder. `false` explícito porque a prop é obrigatória.
        mostrarArquivadas={false}
        membrosInativos={membrosInativos}
        // "Voltar" so aparece quando o pai foi carregado de fato -- e leva pra
        // rota do pai (cada nivel tem endereco proprio, entao nao ha pilha).
        temVoltar={pai !== null}
        onVoltar={() => {
          if (pai) router.push(`/tarefa/${pai.id}`);
        }}
        // Nesta rota nao existe "fechar": o X leva pro quadro.
        onClose={() => router.push("/quadro")}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        // Subtarefa vira navegação: endereço próprio, compartilhável em qualquer profundidade.
        onAbrirSubtarefa={(sub) => router.push(`/tarefa/${sub.id}`)}
        onSubtaskUpsert={aoUpsertFilho}
        onTaskMoved={(t) => {
          setTask((prev) => (prev ? mesclar(prev, t) : t));
          // Cascata de arquivamento: as filhas mudaram no banco e não vieram na resposta.
          recarregarFilhos(t.id);
        }}
        onExcluir={() => {
          // A tarefa desta pagina deixou de existir -> nao ha o que mostrar.
          router.push("/quadro");
        }}
      />

      <TaskModal
        open={duplicando !== null}
        duplicarDe={duplicando}
        filhosDaOrigem={duplicando ? filhos : []}
        // Esta tela nao cria tarefa do zero (`open` exige duplicar).
        newTaskTeam={null}
        onClose={() => {
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // A cópia é outra tarefa: mesclar no `task` sobrescreveria a origem. Só navega.
            setDuplicando(null);
            router.push(`/tarefa/${t.id}`);
            return;
          }
          setTask((prev) => (prev ? mesclar(prev, t) : t));
        }}
      />
    </>
  );
}
