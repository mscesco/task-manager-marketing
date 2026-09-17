"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import { CornerDownRight } from "lucide-react";
import Badge from "@/components/Badge";
import TaskModal from "@/components/TaskModal";
import TaskDetail from "@/components/TaskDetail";
import TaskCard from "@/components/TaskCard";
import {
  // ⚠️ `STATUSES` SAIU DESTA TELA na fatia 4c-2. A vista de LISTA ja lia as
  // colunas da API desde a 4b; agora o KANBAN tambem le, e nao sobrou leitor
  // aqui. O que ainda vem de `lib/status` sao rotulos e cores de PRIORIDADE e
  // de PRAZO, que nao tem nada a ver com coluna.
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  deadlineLabel,
  DEADLINE_COLOR,
} from "@/lib/status";
import {
  colunaEquivalente,
  colunasPadraoMinhasTarefas,
  deadlineTonePorColuna,
  rotuloDeColuna,
  terminal,
  type Coluna,
  type OrigemDaColuna,
} from "@/lib/coluna";
import { normalizarBusca } from "@/lib/filtrosQuadro";
import {
  listAllMyAssignments,
  quadroGeralComIndice,
  getTask,
  listTasks,
  listMembers,
  listAllProjects,
  updateTask,
  ApiError,
  type Task,
  type MyTaskItem,
} from "@/lib/api";
import { sincronizarTaskNaUrl } from "@/lib/urlTarefa";
import { ORDENACOES, ordenar, type Ordenacao } from "@/lib/ordenacao";
import { ALL_TEAMS, withTeam } from "@/lib/activeTeam";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";

import Loading from "@/components/Loading";
import { useAvisar } from "@/components/Toasts";
import { useDrawnOutline } from "@/components/AnimatedOutline";
const RELATION_LABEL: Record<string, string> = {
  assignee: "Responsável",
  creator: "Criei",
  // Spec 053, fatia D (D1): na tela e "seguir". Era "Acompanho" enquanto so
  // o n8n ou a API inscreviam alguem.
  watcher: "Sigo",
};
// ⚠️ `STATUS_LABEL` e `STATUS_COLOR` SAIRAM DAQUI (Spec 036, fatia 4b).
// Eram derivadas de `STATUSES` em escopo de MODULO -- calculadas no import,
// antes do primeiro render. Com as colunas vindo da API isso deixa de ser
// possivel, e as duas viraram `useMemo` dentro do componente (`rotuloDaColuna`
// e `colunaDe`). Ver `plan.md` da Spec 036, §Fatia 4 -- por que ela virou
// TRES (era a `sondagem-fatia-4.md` §2, absorvida em 13/08).

// Opcoes do seletor de relacao. "todas" = sem filtro de relacao.
const RELACOES = [
  { key: "todas", label: "Todas" },
  { key: "creator", label: "Que criei" },
  { key: "assignee", label: "Designadas a mim" },
  // Spec 053, fatia D (D7): VOLTOU, agora que o botao "Seguir" existe no
  // detalhe. Tinha saido em agosto por prometer uma lista que ninguem conseguia
  // preencher. "Todas" continua incluindo as tarefas que a pessoa segue.
  { key: "watcher", label: "Que sigo" },
] as const;

// ⚠️ `TODOS_STATUS` SAIU DAQUI pelo mesmo motivo. Quem responde "todas as
// colunas" agora e o proprio estado `colunas`, carregado da API.

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
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  // Spec 031 (C14): `members` continua COMPLETO (resolve o nome de quem ja
  // esta designado) e este conjunto so tira do seletor e marca a pilula como
  // desativado. ⚠️ Este comentario citava `projetosPessoais` como o desenho
  // gemeo -- ele saiu em 10/09 com o projeto pessoal, e este ficou como unico
  // exemplo do padrao.
  const [membrosInativos, setMembrosInativos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  // null = nao truncou. Se a lista passar do teto de busca, vira aviso honesto
  // no lugar de perda silenciosa (mesmo padrao do quadro).
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null);

  // Colunas do quadro geral, vindas da API (Spec 036, fatia 4b).
  // `null` = ainda carregando. `[]` = carregou e nao ha coluna -- estado
  // diferente, e a tela desenha os dois de formas diferentes.
  const [colunas, setColunas] = useState<Coluna[] | null>(null);

  // Filtros (client-side, sobre a lista ja carregada). Comecam "tudo visivel".
  const [relFiltro, setRelFiltro] = useState<string>("todas");
  // ⚠️ ANTES ISTO ERA UM INICIALIZADOR DE `useState` chamando
  // `statusPadraoMinhasTarefas()` -- rodava no PRIMEIRO RENDER, antes de
  // qualquer fetch (`plan.md` §Fatia 4 -- por que ela virou TRES, "o ponto
  // mais duro"; era a `sondagem-fatia-4.md` §5). Com as colunas vindo da API o
  // dado nao existe nessa hora, entao o conjunto nasce `null` e e preenchido
  // quando as colunas chegam. **A tela nao renderiza ate la** (decisao de
  // 10/08), e o portao ja existia: ver `if (!items || !colunas)` mais abaixo.
  const [colunasOn, setColunasOn] = useState<Set<string> | null>(null);
  // ⚠️ `column_id -> de onde ela vem`, sobre TODOS os quadros alcancaveis
  // (fatia 5b-5b). Separado de `colunas` de proposito: `colunas` e o que a
  // tela DESENHA (o quadro geral); o indice e o que ela SABE.
  const [indice, setIndice] = useState<Map<string, OrigemDaColuna> | null>(null);
  // Arquivadas escondidas por padrao (paridade com o quadro). Sessao-only.
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  // Spec 031 (C3, D4-ter): esta tela nao tinha busca. Uma linha de pastilhas
  // com "Busca:" numa tela e nao na outra e a mesma deriva que a fatia mata.
  const [busca, setBusca] = useState("");

  const [detalhe, setDetalhe] = useState<Task | null>(null);
  const [pilha, setPilha] = useState<Task[]>([]);
  // Filhos COMPLETOS da tarefa focada (todas as subtarefas, nao so as minhas).
  // minhas-tarefas so carrega minhas atribuicoes, entao o pai mostraria uma
  // lista de subtarefas incompleta (bug: no quadro geral aparecem todas). Busca
  // sob demanda por parent_task_id. null = ainda carregando -> cai no fallback
  // de `items` (evita flash de lista vazia). O fetch keys por detalhe?.id (=
  // id do foco); `focado` so existe depois das guardas, entao uso detalhe.
  const [filhosDoFocado, setFilhosDoFocado] = useState<Task[] | null>(null);
  // Spec 033: tarefa que esta sendo DUPLICADA. ⚠️ O `editando` que morava ao
  // lado saiu na Spec 052 (fatia D): titulo, descricao e links se editam no
  // proprio detalhe, e o modal so cria e duplica.
  const [duplicando, setDuplicando] = useState<Task | null>(null);
  const [deepLinkFeito, setDeepLinkFeito] = useState(false);
  // Libera a ESCRITA do ?task= na URL. Separado do deepLinkFeito porque a
  // leitura e async: so vira true quando a abertura inicial resolve.
  const [urlLiberada, setUrlLiberada] = useState(false);

  // ⚠️⚠️ OS DOIS RECORTES DA §4.3, E ELES SÃO INDEPENDENTES. Decisão dela,
  // depois de eu propor tirar a visão de quadro e ela recusar:
  //
  //   LISTA  -> `tudo | por time raiz`. Mora na URL (`?time=`), porque é o
  //             recorte DA TELA -- link compartilhável, botão Voltar.
  //   QUADRO -> exige UM time. *"Kanban não espelha dois quadros ao mesmo
  //             tempo"*: as colunas são as do quadro geral daquele time.
  //
  // ⚠️ E O DO QUADRO NÃO VAI NA URL, de propósito: `?time=` significa "o
  // recorte desta tela", e o time do quadro é uma escolha DENTRO de uma das
  // duas visões. Dois parâmetros disputando o mesmo sentido exigiriam uma
  // regra de quem ganha -- e a própria visão (lista/quadro) já é sessão-only
  // pelo mesmo motivo.
  const {
    active,
    search,
    teams: timesDisponiveis,
    teamName: nomeDoTime,
  } = useActiveTeam();
  /** `null` = "tudo" (ou nenhum time). O `kind: "all"` cai aqui. */
  const timeDaLista = useActiveTeamId();
  const [timeDoQuadro, setTimeDoQuadro] = useState<string | null>(null);

  // Vista: lista (agrupada por prazo) x quadro (kanban por status). Sessao-only.
  const [vista, setVista] = useState<"lista" | "quadro">("lista");
  // Mesmo seletor do quadro geral, mesmo comparador (`lib/ordenacao.ts`).
  // ⚠️ So no modo QUADRO. No modo lista as tarefas ja vem agrupadas por dia
  // de entrega, com cabecalho de data: um "Ordenar: prazo" ali nao teria o
  // que fazer e um "Ordenar: prioridade" so reordenaria DENTRO do dia --
  // dois rotulos prometendo mais do que entregam. Se a lista tiver que
  // ordenar tambem, o agrupamento por data e que precisa sair, e isso e
  // outra decisao.
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("criacao");
  // Drag no modo quadro (mesmo padrao do Board).
  const [activeId, setActiveId] = useState<string | null>(null);
  const avisar = useAvisar();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const suprimirClique = useRef(false);

  // --- Trava a vista QUADRO na altura da viewport (scroll por coluna) ---
  // Mesma tecnica do componente Board: mede o topo real das colunas e trava a
  // altura ate o rodape, cada coluna rola por dentro. So afeta a vista quadro
  // (a lista segue com scroll normal de pagina). medirAltura sai cedo quando o
  // container nao existe (vista lista) -> nada acontece ali.
  const colunasRef = useRef<HTMLDivElement>(null);
  const [alturaColunas, setAlturaColunas] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const el = colunasRef.current;
    if (!el) return;
    // Clamp em 0: pagina rolada pra baixo -> top negativo estourava a altura
    // (innerHeight - top). Cobre o commit-durante-scroll; nao cobre o mobile.
    const top = Math.max(0, el.getBoundingClientRect().top);
    const RODAPE = 24;
    const h = Math.max(240, Math.round(window.innerHeight - top - RODAPE));
    setAlturaColunas((atual) => (atual === h ? atual : h));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", medirAltura);
    return () => window.removeEventListener("resize", medirAltura);
  }, [medirAltura]);
  useLayoutEffect(() => {
    medirAltura();
  });

  // ⚠️ O time do QUADRO é semeado pelo da lista, e não pisa numa escolha feita
  // (`atual ?? ...`): trocar a lista para "tudo" não deve resetar o quadro que
  // a pessoa estava olhando. Sem time na lista, cai no primeiro PREFERIDO --
  // onde ela trabalha, e não o primeiro do alfabeto (defeito 3.1).
  useEffect(() => {
    const reserva = timeDaLista ?? timesDisponiveis[0]?.id ?? null;
    if (reserva) setTimeDoQuadro((atual) => atual ?? reserva);
  }, [timeDaLista, timesDisponiveis]);

  useEffect(() => {
    // ⚠️⚠️ ESPERA A BARRA RESOLVER. `active === null` = "ainda não sei";
    // `kind: "all"` e `kind: "none"` JÁ são respostas, e as duas dão
    // `timeDaLista === null` -- que aqui significa "de todos os times", o modo
    // que esta tela oferece de propósito.
    if (active === null) return;
    // ⚠⚠ GUARDA DE CORRIDA (14/09). Sem ela, um pedido mais velho que
    // respondesse depois do novo sobrescrevia a lista -- foi o que pos as
    // tarefas do Marketing numa tela que dizia Comercial.
    let vivo = true;
    listAllMyAssignments(timeDaLista)
      .then((r) => {
        if (!vivo) return;
        // ⚠️ O FILTRO DE CLIENTE SAIU AQUI (Spec 037, E5). Ele descartava
        // os itens marcados pela ADR 0017 porque elas davam 404 no detalhe
        // (o "bug E6"), e o comentario dizia "quando for tratar, troca este
        // filtro". Foi tratado na origem: o backend nao manda mais esses
        // itens, entao nao ha o que filtrar -- e lista e detalhe passaram a
        // concordar.
        setItems(r.items);
        setTruncadoTotal(r.truncated ? r.total : null);
      })
      .catch((e: ApiError) => {
        if (vivo) setErro(e.message);
      });
    return () => {
      vivo = false;
    };
    // ⚠️ `active === null` E NÃO `active`: o objeto é NOVO a cada render da
    // barra, e depender dele refazia o pedido a cada render -- vários pedidos
    // em voo, e o último a responder vencia (defeito de 14/09).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDaLista, active === null]);

  useEffect(() => {
    // ⚠️ Guarda de corrida: o seletor do QUADRO troca `timeDoQuadro` sem
    // recarregar a página, e as colunas do time anterior não podem chegar
    // depois das do novo.
    let vivo = true;
    // Colunas do quadro geral E o indice de todas as colunas alcancaveis. O
    // filtro padrao da tela sai das colunas: liga todas menos as de semantica
    // DONE (ADR 0040 -- Cancelado CONTINUA aparecendo).
    //
    // ⚠️ O INDICE E O QUE FAZ TAREFA DE OUTRO QUADRO APARECER (fatia 5b-5b).
    // Antes daqui a tela so conhecia as colunas do geral, e tarefa de quadro
    // avulso sumia da LISTA em silencio e caia no contador `foraDaColuna` no
    // kanban. Uma requisicao so, a mesma de antes.
    // ⚠️⚠️ AS COLUNAS SÃO DO TIME DO QUADRO, e este é o defeito 3.3: a função
    // fazia `quadros.find(q => q.is_default)` -- "o" padrão, no singular. Com
    // dois times raiz existem dois, e a tela espelhava as colunas de um
    // enquanto mostrava as tarefas do outro.
    quadroGeralComIndice(timeDoQuadro)
      .then(({ colunas: cs, indice: ix }) => {
        if (!vivo) return;
        setColunas(cs);
        setIndice(ix);
        setColunasOn(new Set(colunasPadraoMinhasTarefas(cs)));
      })
      .catch((e: ApiError) => setErro(e.message));
    listMembers()
      .then((ms) => {
        setMembers(new Map(ms.map((m) => [m.id, { name: m.name }])));
        setMembrosInativos(new Set(ms.filter((m) => !m.is_active).map((m) => m.id)));
      })
      .catch(() => {});
    // Spec 022: alimenta o chip de projeto e o seletor de "mudar projeto" no detalhe.
    listAllProjects({
      // ROTULAR, nao escolher: este mapa id -> titulo desenha o selo de
      // projeto no card. Recortar por time apagaria o selo de uma tarefa que
      // a pessoa ENXERGA, em vez de proteger algo -- a lente do backend ja
      // limita o que volta. Ver `listProjects` em `lib/api.ts`.
      teamId: null,
    })
      .then((r) => {
        setProjectNames(new Map(r.items.map((p) => [p.id, p.title])));
        // Spec 031 (C13): guardado a parte -- o mapa de nomes precisa de TODOS
        // (inclusive pessoal, pra resolver o nome de quem ja mora la), mas o
        // seletor de "mudar projeto" nao deve OFERECER pessoal.
      })
      .catch(() => {});
    // ⚠️ `timeDoQuadro` NAS DEPENDÊNCIAS: trocar o time do quadro tem de
    // rebuscar as COLUNAS, senão o kanban desenha as colunas do time anterior
    // com os cards do novo -- e ninguém vê erro nenhum.
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDoQuadro]);

  // Abre o detalhe de uma task pelo id, procurando na lista COMPLETA (items),
  // nao na filtrada -- um filtro ativo nao deve furar o link. Se a task nao
  // esta na lista (mencao/comentario em tarefa que nao e sua, ou tarefa fora
  // da lente de time), avisa em vez de falhar em silencio.
  const abrirTarefaDaLista = useCallback(
    async (id: string) => {
      if (items === null) return;
      const t = items.find((x) => x.id === id);
      if (!t) {
        avisar("Não foi possível abrir: essa tarefa não está na sua lista.");
        return;
      }
      // Se for SUBTAREFA, abre no modo sub com "voltar" pro(s) pai(s) -- mesma
      // UX de quando navego manualmente de um pai pra um filho. Monta a cadeia
      // de ancestrais: cada pai pode nao estar na minha lista (posso estar so
      // na sub), entao busca por id nesse caso. A pilha fica [raiz..paiDireto];
      // voltarDetalhe tira do fim -> volta um nivel por vez ate a raiz.
      const pilhaPais: Task[] = [];
      const vistos = new Set<string>([t.id]); // guarda anti-ciclo
      let paiId = t.parent_task_id;
      while (paiId && !vistos.has(paiId)) {
        vistos.add(paiId);
        let pai: Task | null = items.find((x) => x.id === paiId) ?? null;
        if (!pai) {
          try {
            pai = await getTask(paiId);
          } catch {
            pai = null;
          }
        }
        if (!pai) break; // pai inacessivel -> para a cadeia (volta ate onde deu)
        pilhaPais.unshift(pai);
        paiId = pai.parent_task_id;
      }
      setPilha(pilhaPais);
      setDetalhe(t);
    },
    [items]
  );

  // Deep-link ao ENTRAR na pagina vindo de outra rota: le ?task=<id> depois
  // que a lista carrega (uma vez). E6-safe: reusa o objeto ja carregado.
  useEffect(() => {
    if (deepLinkFeito || items === null) return;
    setDeepLinkFeito(true);
    const alvo = new URLSearchParams(window.location.search).get("task");
    if (!alvo) {
      setUrlLiberada(true);
      return;
    }
    // So libera a escrita da URL quando a abertura RESOLVER. abrirTarefaDaLista
    // e async (pode esperar getTask pra montar a cadeia de pais); liberar antes
    // deixaria o efeito de escrita rodar com detalhe=null e apagar o ?task=
    // no meio do caminho -- um F5 nessa janela perderia a tarefa.
    // finally e nao then: se a abertura falhar (tarefa fora da lista), a URL
    // tambem precisa voltar a mandar, pra nao ficar travada mentindo.
    abrirTarefaDaLista(alvo).finally(() => setUrlLiberada(true));
  }, [items, deepLinkFeito, abrirTarefaDaLista]);

  // Deep-link com a pagina JA ABERTA: o sino faz router.push da mesma rota
  // (so muda a query), o que NAO remonta a pagina nem re-dispara o efeito de
  // cima -> era o "clico e nao acontece nada". O sino tambem emite este evento,
  // que abre o detalhe na hora, sem depender de remontar.
  useEffect(() => {
    function onAbrir(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) abrirTarefaDaLista(id);
    }
    window.addEventListener("abrir-tarefa", onAbrir);
    return () => window.removeEventListener("abrir-tarefa", onAbrir);
  }, [abrirTarefaDaLista]);

  // Escrita da URL viva (?task=<id>): espelha a tarefa aberta. Cobre abrir,
  // fechar, entrar em subtarefa e voltar -- todos passam por `detalhe`.
  //
  // Gated no urlLiberada (nao no deepLinkFeito): a leitura acima e async, e
  // liberar cedo demais faria este efeito apagar o ?task= antes de a tarefa
  // abrir. Ver o comentario do efeito de leitura.
  //
  // replaceState: o Voltar do navegador segue saindo da pagina, nao virando
  // um "desfazer" de cada abertura de tarefa.
  useEffect(() => {
    if (!urlLiberada) return;
    sincronizarTaskNaUrl(detalhe?.id ?? null);
  }, [detalhe, urlLiberada]);

  // Busca as subtarefas COMPLETAS do foco (todas, nao so as minhas) quando o
  // detalhe muda. Sem include_archived (paridade com o padrao do quadro geral).
  // Erro -> null (cai no fallback de items). Cap de 100 filhos diretos (limite
  // do backend) -- suficiente; se um dia passar disso, so os 100 primeiros.
  useEffect(() => {
    const id = detalhe?.id;
    if (!id) {
      setFilhosDoFocado(null);
      return;
    }
    let vivo = true;
    setFilhosDoFocado(null); // carregando -> fallback de items enquanto isso
    listTasks({ parent_task_id: id, size: 100 })
      .then((r) => {
        if (vivo) setFilhosDoFocado(r.items);
      })
      .catch(() => {
        if (vivo) setFilhosDoFocado(null);
      });
    return () => {
      vivo = false;
    };
  }, [detalhe?.id]);

  // --- abrir / navegar / fechar o detalhe (mesma logica do quadro) ---
  function abrirDetalhe(t: Task) {
    if (suprimirClique.current) return; // acabou de arrastar: nao abre
    // Reusa a construcao de cadeia de pais: se `t` for subtarefa, abre no modo
    // sub com "voltar" pro pai -- igual ao deep-link da notificacao. `t` veio da
    // lista, entao esta em items (nao dispara o toast de "nao esta na lista").
    abrirTarefaDaLista(t.id);
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
  // (relations) e o assignee_ids (mutacao nao devolve -- ADR 0025).
  function aoUpsert(t: Task) {
    setItems((prev) => {
      if (!prev) return prev;
      const existente = prev.find((x) => x.id === t.id);
      if (!existente) {
        // subtarefa criada aqui: eu sou o criador, entra como "Criei".
        const nova: MyTaskItem = {
          ...t,
          relations: ["creator"],
          assignee_ids: t.assignee_ids ?? [],
          // A resposta de criacao nao traz parent_title (so /me/assignments
          // monta o lote). Como a subtarefa nasceu daqui, a mae e a task que
          // esta aberta -- resolvemos localmente e o selo ja aparece certo,
          // sem esperar recarregar a pagina.
          parent_title:
            t.parent_task_id
              ? prev.find((x) => x.id === t.parent_task_id)?.title ?? null
              : null,
        };
        return [nova, ...prev];
      }
      const merged: MyTaskItem = {
        ...t,
        relations: existente.relations,
        assignee_ids: t.assignee_ids ?? existente.assignee_ids,
        // Mutacao de task nao devolve parent_title -> preserva o local, mesma
        // regra do assignee_ids (ADR 0025). Sem isto o selo sumiria ao editar.
        parent_title: existente.parent_title,
      };
      return prev.map((x) => (x.id === t.id ? merged : x));
    });
  }

  // Upsert que TAMBEM reflete na lista de filhos buscada do foco, pra o detalhe
  // atualizar na hora (marcar/desmarcar subtarefa, criar subtarefa) sem esperar
  // refetch. Atualiza in-place se ja existe; adiciona se for filho do foco atual.
  function aoUpsertComFilhos(t: Task) {
    aoUpsert(t);
    setFilhosDoFocado((prev) => {
      if (prev === null) return prev;
      if (prev.some((x) => x.id === t.id)) {
        return prev.map((x) => (x.id === t.id ? { ...x, ...t } : x));
      }
      return t.parent_task_id === detalhe?.id ? [...prev, t] : prev;
    });
  }

  function aoMudarResponsaveis(taskId: string, userIds: string[]) {
    setItems((prev) =>
      prev ? prev.map((t) => (t.id === taskId ? { ...t, assignee_ids: userIds } : t)) : prev
    );
  }

  // --- Drag no modo quadro: arrastar card muda o status (mesmo padrao do Board) ---
  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    suprimirClique.current = true;
    setTimeout(() => (suprimirClique.current = false), 60);

    const taskId = String(e.active.id);
    const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;

    const atual = (items ?? []).find((t) => t.id === taskId);
    // ⚠️ `destino` E UM `column_id` (fatia 4c-2), nao mais uma chave de status.
    if (!atual || atual.column_id === destino) return;

    // ⚠️ RECUSA CARD QUE MORA EM OUTRO QUADRO (fatia 5b-5b). O card ja nasce
    // com `useDraggable({ disabled })`, entao no navegador ele nem levanta --
    // esta guarda existe porque `disabled` e do dnd-kit e nao e testavel em
    // jsdom, e porque uma so das duas seria uma trava com um guardiao so.
    // Soltar aqui trocaria o QUADRO da tarefa, que e a fatia 5c e hoje volta
    // 422 do backend, depois de o card pular na frente da pessoa e voltar.
    const origemAtual = indice?.get(atual.column_id);
    if (!origemAtual || origemAtual.nomeDoQuadro !== null) return;

    // A coluna tem de estar na lista desta tela. ⚠️ AQUI ISSO NAO E FORMALIDADE
    // como no `Board.tsx`: `/minhas-tarefas` junta tarefas de QUALQUER quadro e
    // desenha as colunas do quadro GERAL (`colunasDoQuadroGeral`, fatia 4b).
    // No dia do quadro interno, arrastar uma tarefa de subtime para uma coluna
    // do quadro geral seria um 422 do backend depois de o card ja ter pulado
    // na frente da pessoa.
    const colunaDestino = (colunas ?? []).find((c) => c.id === destino);
    if (!colunaDestino) return;

    const colunaAnterior = atual.column_id;

    // Cascata de conclusao (espelha o backend): arrastar um PAI pra coluna de
    // conclusao conclui a subtree. Aqui items so tem MINHAS tasks -> cascateia
    // as minhas subtarefas visiveis. Guarda o estado antigo pra reverter.
    // Pula as que ja estao em coluna terminal e as arquivadas.
    //
    // DIVERGENCIA CONHECIDA: o backend conclui a subarvore INTEIRA no banco;
    // este otimista so alcanca as minhas tasks carregadas. As demais (de outros
    // responsaveis, ou fora do limite de exibicao) so aparecem no reload.
    //
    // ⚠️ GUARDA OS DOIS CAMPOS e mexe nos DOIS, igual ao `Board.tsx`: a
    // checklist do detalhe le coluna e outros pontos ainda leem `status`.
    // Deixar um dos dois para tras foi o defeito que a conferencia manual de
    // 10/08 pegou. A metade `status` morre com o ultimo leitor dela.
    const concluindo = colunaDestino.semantic === "DONE";
    const prefixo = atual.path + ".";
    const anteriores = new Map<string, { coluna: string; status: string }>();
    if (concluindo) {
      for (const t of items ?? []) {
        // ⚠️ A coluna REAL da subtarefa, pelo indice: ela pode viver em outro
        // quadro que o desta tela, e `terminal()` tem de ler a semantica dela.
        const colunaDela = indice?.get(t.column_id)?.coluna;
        if (
          t.path.startsWith(prefixo) &&
          colunaDela &&
          !terminal(colunaDela) &&
          !t.is_archived
        ) {
          anteriores.set(t.id, { coluna: t.column_id, status: t.status });
        }
      }
    }

    // Otimista (pai + cascata).
    setItems((prev) =>
      prev
        ? prev.map((t) => {
            if (t.id === taskId) return { ...t, column_id: destino };
            if (anteriores.has(t.id))
              return { ...t, column_id: destino, status: "COMPLETED" };
            return t;
          })
        : prev
    );

    try {
      // ⚠️ MANDA SO `column_id`: os dois campos juntos e 422 (ADR 0041, D3), e
      // o status certo vem NA RESPOSTA.
      const atualizada = await updateTask(taskId, { column_id: destino });
      aoUpsert(atualizada); // re-merge do servidor, preservando relations/assignees
    } catch (err) {
      setItems((prev) =>
        prev
          ? prev.map((t) => {
              if (t.id === taskId) return { ...t, column_id: colunaAnterior };
              const ant = anteriores.get(t.id);
              return ant !== undefined
                ? { ...t, column_id: ant.coluna, status: ant.status }
                : t;
            })
          : prev
      );
      const e2 = err as ApiError;
      avisar(
        e2.status === 403
          ? "Você não pode mover esta tarefa. Voltei pra coluna anterior."
          : "Não consegui mover o card. Voltei pra coluna anterior."
      );
    }
  }

  function aoSalvar(saved: Task) {
    aoUpsert(saved);
  }

  // --- filtros ---
  function toggleStatus(key: string) {
    setColunasOn((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function todosStatus() {
    setColunasOn(new Set((colunas ?? []).map((c) => c.id)));
  }
  function limparStatus() {
    setColunasOn(new Set());
  }
  function limparTudo() {
    setRelFiltro("todas");
    // Volta ao PADRAO da tela, nao a "tudo ligado": limpar filtro e voltar ao
    // estado de abertura, e nele as concluidas nao aparecem.
    setColunasOn(new Set(colunasPadraoMinhasTarefas(colunas ?? [])));
  }

  // Arquivadas: escondidas por padrao. O backend de assignments INCLUI
  // arquivadas na resposta, entao o filtro e no cliente -- o toggle liga/desliga
  // sem refetch. `itemsBase` e a FONTE das duas vistas (lista e quadro).
  // Detalhe/subtarefas seguem na lista COMPLETA `items` (mais abaixo): um
  // filtro de view nao pode quebrar abrir uma task fora do filtro.
  const buscaNorm = normalizarBusca(busca);

  // ---------------------------------------------------------------------
  // ⚠️ AS DUAS PERGUNTAS DE CADA CARD (fatia 5b-5b), resolvidas UMA vez.
  //
  //   `origem`       -- a coluna REAL da tarefa, no quadro onde ela mora.
  //                     E ela que decide ALERTA DE PRAZO (`notify_deadline` e
  //                     semantica sao propriedades da coluna de verdade) e o
  //                     texto da tag.
  //   `colunaDaTela` -- em qual das colunas do quadro GERAL este card e
  //                     desenhado e filtrado. Sai de `colunaEquivalente`, que
  //                     e a ADR 0042 escrita no front: exata primeiro, alvo da
  //                     semantica depois.
  //
  // ⚠️ CONFUNDIR AS DUAS E O DEFEITO CLASSICO AQUI. Usar `colunaDaTela` para o
  // prazo faria uma tarefa em "Aguardando cliente" (`notify_deadline: false`)
  // de um quadro avulso ganhar alerta so porque a equivalente dela no geral e
  // "Em Andamento". Usar `origem` para agrupar poria o card numa coluna que
  // esta tela nao desenha, e ele sumiria.
  //
  // ⚠️ UM MAPA SO, e nao duas funcoes chamadas por card. `colunaEquivalente`
  // varre o array de colunas; chama-la dentro do filtro, do agrupamento e do
  // render seria tres varreduras por card a cada tecla digitada na busca.
  // ---------------------------------------------------------------------
  const posicaoDaTarefa = useMemo(() => {
    const m = new Map<
      string,
      { origem: OrigemDaColuna; colunaDaTela: Coluna | undefined }
    >();
    if (!indice || !colunas) return m;
    for (const t of items ?? []) {
      const origem = indice.get(t.column_id);
      // Sem origem = a coluna nao veio em quadro nenhum que a pessoa alcanca.
      // Caso normal quando o quadro foi apagado ou ficou fora do alcance.
      if (!origem) continue;
      m.set(t.id, {
        origem,
        colunaDaTela: colunaEquivalente(origem.coluna, colunas),
      });
    }
    return m;
  }, [items, indice, colunas]);

  const itemsBase = useMemo(
    () => (items ?? []).filter((t) => mostrarArquivadas || !t.is_archived),
    [items, mostrarArquivadas]
  );

  // Aplica relacao + coluna sobre a lista carregada.
  const filtrados = useMemo(() => {
    return itemsBase.filter((t) => {
      // ⚠️ FILTRA PELA COLUNA DA TELA, e nao pelo `column_id` cru (fatia
      // 5b-5b). Os chips desta tela sao as colunas do quadro GERAL; o
      // `column_id` de uma tarefa de quadro avulso nunca esta neles, entao a
      // versao anterior (`colunasOn.has(t.column_id)`) escondia essa tarefa da
      // LISTA em silencio -- sem contador, sem aviso, ao contrario do kanban.
      //
      // ⚠️ SEM COLUNA DA TELA, PASSA. Tarefa cuja coluna nao mapeia em nada
      // (quadro fora de alcance, ou semantica sem alvo no geral) nao pode ser
      // excluida por um chip que ela nao tem. Esconder seria repetir o defeito
      // que esta linha existe para consertar; o principio desta tela e "card
      // que some da tela tem de sumir com aviso".
      const daTela = posicaoDaTarefa.get(t.id)?.colunaDaTela;
      const okStatus =
        colunasOn === null || daTela === undefined || colunasOn.has(daTela.id);
      const okRel = relFiltro === "todas" || t.relations.includes(relFiltro);
      const okBusca =
        buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm);
      return okStatus && okRel && okBusca;
    });
  }, [itemsBase, colunasOn, relFiltro, buscaNorm, posicaoDaTarefa]);

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

  // Modo QUADRO: filtra so por relacao (o status vira coluna, nao filtro) e
  // agrupa por status.
  //
  // ⚠️ MIGRADA NA FATIA 4c-2 (10/08). O bloqueio abaixo, que era real, acabou
  // quando o `PATCH /tasks/{id}` passou a aceitar `column_id` (fatia 5a, ADR
  // 0041): agora o `id` do droppable E o `column_id`, o front manda a coluna e
  // o servidor deriva o status. Fica o registro do que bloqueava, porque
  // explica por que a 4b entregou so a vista de LISTA:
  //
  //   "arrastar chama `onDragEnd`, que manda `status`; se as colunas viessem
  //    da API o destino seria `column_id`, e NAO ha como traduzir coluna ->
  //    status no front -- `legacy_status` nao e exposto pelo `GET /boards`
  //    (ADR 0033), e a semantica nao resolve porque QUATRO colunas padrao tem
  //    `IN_PROGRESS`."
  //
  // ⚠️ O AVISO QUE CONTINUA VALENDO: arrastar NAO e testavel em jsdom. Os
  // testes desta tela cobrem o agrupamento e o desenho; o `onDragEnd` daqui
  // so tem conferencia manual, igual ao do `Board.tsx`.
  const porRelacao = useMemo(() => {
    return itemsBase.filter(
      (t) =>
        (relFiltro === "todas" || t.relations.includes(relFiltro)) &&
        (buscaNorm === "" || normalizarBusca(t.title).includes(buscaNorm))
    );
  }, [itemsBase, relFiltro, buscaNorm]);

  // ⚠️ AGRUPA POR COLUNA (fatia 4c-2). `foraDaColuna` conta o que nao coube em
  // coluna nenhuma, pelo mesmo motivo do `Board.tsx`: card que some da tela
  // tem de somer com aviso. Aqui o caso e MAIS provavel que la -- esta tela
  // mistura tarefas de quadros diferentes assim que o quadro interno existir,
  // e as colunas vem do quadro GERAL (`colunasDoQuadroGeral`, fatia 4b).
  const { porColuna, foraDaColuna } = useMemo(() => {
    const map: Record<string, MyTaskItem[]> = {};
    for (const c of colunas ?? []) map[c.id] = [];
    // Ordena ANTES de distribuir: a distribuicao preserva a ordem, entao uma
    // passada resolve todas as colunas (mesmo caminho do Board).
    let fora = 0;
    for (const t of ordenar(porRelacao, ordenacao)) {
      // ⚠️ AGRUPA PELA COLUNA DA TELA (fatia 5b-5b). A versao anterior usava
      // `map[t.column_id]`, e tarefa de quadro avulso caia SEMPRE no `fora`:
      // contada e nao desenhada. Agora `colunaEquivalente` a leva para a
      // coluna do geral com a mesma semantica, e a TAG do card diz de onde ela
      // veio -- sem a tag, o agrupamento pareceria defeito.
      const daTela = posicaoDaTarefa.get(t.id)?.colunaDaTela;
      const lista = daTela ? map[daTela.id] : undefined;
      if (lista) lista.push(t);
      else fora++;
    }
    return { porColuna: map, foraDaColuna: fora };
  }, [porRelacao, ordenacao, colunas, posicaoDaTarefa]);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  // ⚠️ O PORTAO ESPERA OS DOIS (Spec 036, fatia 4b). Ele ja existia para
  // `items`; `colunas` entrou aqui. E a decisao de 10/08: a tela NAO renderiza
  // ate as colunas chegarem, em vez de pintar sem filtro e reordenar depois --
  // lista que pisca mostrando concluidas que ninguem pediu e pior que meio
  // segundo de "Carregando".
  if (!items || !colunas) return <Loading />;

  // Detalhe e subtarefas SEMPRE sobre a lista completa (um filtro ativo nao
  // pode quebrar abrir/navegar uma task que esta fora do filtro atual).
  const focado = detalhe ? items.find((t) => t.id === detalhe.id) ?? detalhe : null;
  const filhosFocado = focado ? items.filter((t) => t.parent_task_id === focado.id) : [];
  // Filhos exibidos no detalhe: os COMPLETOS (buscados) quando prontos; enquanto
  // carrega/erro, cai nos meus (items) pra nao piscar vazio. So os do foco atual.
  const filhosParaDetalhe: Task[] =
    filhosDoFocado !== null && focado
      ? filhosDoFocado.filter((f) => f.parent_task_id === focado.id)
      : filhosFocado;

  const visiveis = vista === "quadro" ? porRelacao.length : filtrados.length;
  const todosLigados = (colunasOn?.size ?? 0) === colunas.length;
  // Coluna de uma tarefa, pelo `column_id` que a Spec 036 fatia 3 passou a
  // devolver na resposta. `undefined` nao deveria acontecer -- significaria
  // tarefa apontando para coluna de outro quadro, o que a FK composta impede
  // no banco (`invariantes.sql`, consulta 2).
  // A coluna REAL de uma tarefa -- a do quadro onde ela mora, vinda do indice
  // (fatia 5b-5b). ⚠️ NAO E `colunaPorId.get(t.column_id)`: aquele mapa so tem
  // as colunas do quadro GERAL, entao tarefa de quadro avulso devolvia
  // `undefined` e PERDIA o alerta de prazo -- o comentario de `dueTone` dizia
  // que sem coluna "o lado seguro e nao alertar", o que era verdade quando
  // "sem coluna" significava dado faltando, e deixou de ser quando passou a
  // significar "outro quadro".
  const colunaPorId = new Map(colunas.map((c) => [c.id, c]));
  const colunaDe = (t: MyTaskItem): Coluna | undefined =>
    posicaoDaTarefa.get(t.id)?.origem.coluna ?? colunaPorId.get(t.column_id);
  // A tag `Quadro · Coluna` da LISTA. `null` = nao ha o que dizer, e a tela cai
  // na reserva por status (ver `rotuloDeColuna`).
  const rotuloDe = (t: MyTaskItem): string | null =>
    rotuloDeColuna(posicaoDaTarefa.get(t.id)?.origem);
  // A tag do CARD, no kanban. ⚠️ SO PARA TAREFA DE OUTRO QUADRO, e a diferenca
  // para a lista e deliberada: no kanban o card ja esta DENTRO de uma coluna
  // com o nome no cabecalho acima dele, entao repetir "Em Andamento" na tag e
  // ruido, e pior -- some no meio das outras pastilhas do card. A tag so ganha
  // sentido quando responde uma pergunta que o cabecalho NAO responde: "este
  // card esta em Em Andamento, mas a coluna dele chama Em Revisão, e ela e do
  // quadro Campanhas". Na lista nao ha cabecalho, entao la ela e sempre.
  const rotuloForaDoQuadro = (t: MyTaskItem): string | undefined => {
    const origem = posicaoDaTarefa.get(t.id)?.origem;
    if (!origem || origem.nomeDoQuadro === null) return undefined;
    return rotuloDeColuna(origem) ?? undefined;
  };
  // ⚠️ SO ARRASTA CARD QUE MORA NO QUADRO DESTA TELA. `nomeDoQuadro === null`
  // e exatamente isso. Enquanto mover tarefa entre quadros nao existir (fatia
  // 5c), soltar uma tarefa de quadro avulso numa coluna do geral trocaria o
  // quadro dela -- o backend recusa com 422, mas so depois de o card ja ter
  // pulado na frente da pessoa e voltado.
  const arrastavel = (t: MyTaskItem): boolean =>
    posicaoDaTarefa.get(t.id)?.origem.nomeDoQuadro === null;
  const contagem =
    visiveis === items.length ? `${items.length} tarefas` : `${visiveis} de ${items.length}`;

  // Uma linha de tarefa. A data saiu daqui — agora vive no cabeçalho do grupo.
  function linhaTarefa(t: MyTaskItem, i: number) {
    // Spec 023: cor de prazo por-card (respeita status/arquivada). null = sem
    // alerta. Barra lateral colorida + chip com o motivo.
    const col = colunaDe(t);
    // Spec 036 fatia 4a: quem decide se ha alerta e a COLUNA
    // (`notify_deadline` + semantica), nao mais uma lista de status cravada.
    // Sem coluna resolvida nao ha como decidir -> sem alerta, que e o lado
    // seguro (o contrario pintaria de vermelho por falta de dado).
    const dueTone = col ? deadlineTonePorColuna(col, t.due_date, t.is_archived, t.due_time) : null;
    return (
      <FaixaClicavel
        key={t.id}
        onAbrir={() => abrirDetalhe(t)}
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
          borderTop: i === 0 ? "none" : "1px solid var(--border)",
          // Reserva sempre a borda (transparente) pra nao deslocar o texto.
          borderLeft: `3px solid ${dueTone ? DEADLINE_COLOR[dueTone] : "transparent"}`,
        }}
      >
        <span
          title={rotuloDe(t) ?? t.status}
          style={{
            width: 9, height: 9, borderRadius: 999, flexShrink: 0,
            background: col?.color ?? "#999",
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Spec 031 (C6): titulo em UMA linha, com reticencias.
              Antes ele quebrava em 2-3 linhas e a segunda linha encostava na
              faixa de meta abaixo -- o "aparece por baixo de Responsavel".
              `title` preserva o texto inteiro no hover, e o detalhe esta a um
              clique. Lista com altura de linha uniforme e o ponto de ser lista. */}
          <div
            title={t.title}
            style={{
              fontSize: 14, fontWeight: 600, lineHeight: 1.35,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {t.title}
          </div>
          {/* `minWidth: 0` deixa os filhos ENCOLHEREM. Sem isso o padrao e
              `min-width: auto` = "nao encolho abaixo do meu conteudo", e a
              pastilha longa empurra o resto da faixa pra fora. */}
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
            {/* ⚠️ A TAG CARREGA AS DUAS INFORMACOES (fatia 5b-5b): o quadro
                responde "onde mora", a coluna responde "por que este card esta
                agrupado em Em Andamento se a coluna dele chama outra coisa".
                `rotuloDeColuna` devolve `null` quando nao sabe, e a reserva
                por status e decisao DESTA tela. */}
            <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
              {rotuloDe(t) ?? t.status}
            </span>
            {t.parent_task_id && (
              // Nomeia a mae quando o backend a resolveu. Cai no generico se
              // parent_title vier null (mae fora da lente) -- nunca inventa.
              <span
                title={
                  t.parent_title
                    ? `Subtarefa de: ${t.parent_title}`
                    : "Subtarefa"
                }
                style={{ display: "inline-flex", maxWidth: 260, minWidth: 0, flexShrink: 1 }}
              >
                <Badge tone="soft" size="sm" color="var(--accent)">
                  {t.parent_title ? (
                    <>
                      <CornerDownRight size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginRight: 4 }} />
                      {t.parent_title}
                    </>
                  ) : (
                    "Subtarefa"
                  )}
                </Badge>
              </span>
            )}
            {t.relations.map((r) => (
              <Badge key={r} tone="neutral" size="sm" weight="semibold" className="bg-surface-2 text-ink-soft">
                {RELATION_LABEL[r] || r}
              </Badge>
            ))}
            {dueTone && t.due_date && (
              <span
                style={{
                  fontSize: 11.5, fontWeight: 600, color: DEADLINE_COLOR[dueTone],
                  flexShrink: 0,
                }}
              >
                {deadlineLabel(t.due_date, t.due_time)}
              </span>
            )}
          </div>
        </div>
        <Badge tone="soft" size="sm" color={PRIORITY_COLOR[t.priority]} className="shrink-0">
          {PRIORITY_LABEL[t.priority] || t.priority}
        </Badge>
      </FaixaClicavel>
    );
  }

  // Barra de filtros: seletor de relacao + chips de status (liga/desliga).
  function barraFiltros() {
    // Definido UMA vez e posicionado em dois lugares conforme a vista --
    // duplicar o JSX seria duas fontes de verdade pro mesmo controle.
    const arquivadasCheck = (
      <label
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: "var(--text-soft)", cursor: "pointer",
          marginLeft: 4,
        }}
      >
        <input
          type="checkbox"
          checked={mostrarArquivadas}
          onChange={(e) => setMostrarArquivadas(e.target.checked)}
        />
        Mostrar arquivadas
      </label>
    );

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

        {/* Spec 031 (C3, D4-ter): busca. A tela nao tinha. */}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título…"
          style={{
            fontSize: 13, padding: "6px 10px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text)", minWidth: 170,
          }}
        />

        {/* Ordenacao: so no modo quadro, e FORA do bloco de filtros -- ela
            nao esconde tarefa, so muda a ordem (mesma razao do quadro geral). */}
        {vista === "quadro" && (
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            aria-label="Ordenar tarefas"
            style={{
              fontSize: 13, padding: "6px 10px", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {ORDENACOES.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        )}

        {/* ⚠️⚠️ OS DOIS SELETORES DA §4.3, e o de cada visão aparece SÓ na
            visão dele. Desenhar os dois de uma vez faria a tela oferecer duas
            respostas para "qual time?" ao mesmo tempo -- e a pessoa ajustaria o
            que não está olhando.

            LISTA: tem "Tudo", e escreve na URL. É a única tela com "tudo",
            porque é a única que atravessa times de propósito -- *"o time muda
            com a área; o que é meu, não"*.

            QUADRO: NÃO tem "Tudo". Kanban espelha as colunas de UM quadro
            geral; com dois times não há conjunto de colunas que sirva. */}
        {timesDisponiveis.length > 1 && (
          <select
            className="input"
            aria-label={
              vista === "lista"
                ? "Time das minhas tarefas"
                : "Time do quadro"
            }
            style={{ width: "auto", padding: "5px 10px", fontSize: 12 }}
            value={
              vista === "lista"
                ? (timeDaLista ?? ALL_TEAMS)
                : (timeDoQuadro ?? "")
            }
            onChange={(e) => {
              if (vista === "quadro") {
                setTimeDoQuadro(e.target.value || null);
                return;
              }
              // ⚠️ `<a href>` E RECARGA TOTAL, como toda navegação deste app
              // (registrado no topo do `AppShell`). Um `router.replace` aqui
              // trocaria a URL sem recarregar, e metade das telas recarrega e
              // metade não -- a mistura que aquele bloco proibiu.
              window.location.href = withTeam(
                "/minhas-tarefas",
                search ?? "",
                e.target.value,
              );
            }}
          >
            {vista === "lista" && <option value={ALL_TEAMS}>Todos os times</option>}
            {timesDisponiveis.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {/* Toggle de vista (sessao-only). No quadro, as COLUNAS DA API viram
            as colunas do kanban (fatia 4c-2; antes eram os status). */}
        <div style={{ display: "inline-flex", gap: 4 }}>
          {(["lista", "quadro"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              aria-pressed={vista === v}
              className="tappable"
              style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12,
                fontWeight: 600, cursor: "pointer", lineHeight: 1,
                border: "1px solid var(--border)",
                background: vista === v ? "var(--accent-soft)" : "var(--surface-2)",
                color: vista === v ? "var(--accent)" : "var(--text-faint)",
              }}
            >
              {v === "lista" ? "Lista" : "Quadro"}
            </button>
          ))}
        </div>

        {vista === "lista" && (
          <>
            <span style={{ width: 1, height: 22, background: "var(--border)", flexShrink: 0 }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {/* ⚠️ `colunas ?? []` e nao `colunas`: o guard de carregamento la em
              cima ja garante que nao e null, mas este bloco vive dentro de
              `barraFiltros()`, declarada DEPOIS do guard -- e o `tsc` perde o
              narrowing em corpo de funcao. O `?? []` e inalcancavel na
              pratica; trocar por `!` esconderia o dia em que o guard sair. */}
          {(colunas ?? []).map((s) => {
            const on = colunasOn?.has(s.id) ?? false;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStatus(s.id)}
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
                {s.name}
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
            disabled={(colunasOn?.size ?? 0) === 0}
            className="tappable"
            style={{
              padding: "5px 8px", borderRadius: "var(--radius)", border: "none",
              background: "transparent",
              color: (colunasOn?.size ?? 0) === 0 ? "var(--text-faint)" : "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: (colunasOn?.size ?? 0) === 0 ? "default" : "pointer",
            }}
          >
            Limpar
          </button>

          {vista === "lista" && arquivadasCheck}
        </div>
          </>
        )}

        {/* Spec 031 (C9): na vista LISTA o checkbox mora ao lado de "Limpar",
            dentro da faixa de chips. Antes ele era irmao da faixa com
            `marginLeft: auto`, e como a faixa e larga ele quebrava sozinho
            numa terceira linha, encostado na direita, longe de tudo.
            Na vista QUADRO nao ha faixa de chips -> ele volta pra esta linha. */}
        {vista === "quadro" && arquivadasCheck}
      </div>
    );
  }

  // ⚠️ NAO ha barra de pastilhas de filtro ativo aqui, e isso e DECISAO
  // (Spec 031, C6 -- revoga o D4/D4-bis). Ela existe no Quadro porque la os
  // filtros moram dentro de um popover FECHADO: a pastilha responde "o que
  // esta ligado que eu nao estou vendo". Nesta tela todo controle esta visivel
  // o tempo todo -- o select "Mostrar", o campo de busca, os 8 chips de status
  // e o checkbox de arquivadas. A pastilha nao acrescentava informacao, so
  // repetia o que estava dois centimetros acima.
  //
  // Se um dia algum controle daqui for recolhido, ela volta -- o
  // `listaFiltrosAtivos` do lib continua servindo o Quadro.

  return (
    <div>
      <PageHeader title="Minhas tarefas" count={contagem} />

      {truncadoTotal !== null && (
        <div
          role="alert"
          style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--accent-soft)",
            color: "var(--text)", fontSize: 13,
          }}
        >
          Você tem <strong>{truncadoTotal}</strong> tarefas relacionadas, acima
          do limite de exibição. Mostrando as mais recentes — algumas podem não
          aparecer aqui nem entrar nos filtros. Arquive tarefas concluidas para
          reduzir o volume.
        </div>
      )}

      {items.length === 0 ? (
        // ⚠⚠ A BARRA FICA MESMO SEM TAREFA (14/09, reportado na tela). Até aqui o
        // vazio SUBSTITUÍA a barra inteira -- e desde a Spec 048 é nela que
        // mora o seletor de time. Com a lista recortada pelo Comercial e zero
        // tarefas lá, a tela sumia com a única porta de volta para o Marketing.
        // Antes do recorte "zero tarefas" era "zero em todo lugar", e esconder
        // os controles não custava nada; agora vazio é um estado de um time.
        <div className="max-w-[1100px]">
          {barraFiltros()}
          <EmptyState
            title={
              timeDaLista && nomeDoTime
                ? `Nenhuma tarefa sua em ${nomeDoTime}`
                : "Você está em dia"
            }
            description={
              timeDaLista && nomeDoTime
                ? "Troque o time acima para ver as tarefas de outro, ou escolha “Todos os times”."
                : "Tarefas em que você é responsável ou criador aparecem aqui."
            }
          />
        </div>
      ) : (
        <div className={vista === "quadro" ? "" : "max-w-[1100px]"}>
          {barraFiltros()}

          {vista === "lista" ? (
            visiveis === 0 ? (
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
            )
          ) : porRelacao.length === 0 ? (
            <div className="muted" style={{ padding: "20px 2px", fontSize: 14 }}>
              Nenhuma tarefa com esse filtro.{" "}
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
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              <div
                ref={colunasRef}
                style={{
                  display: "flex", gap: 14, overflowX: "auto", overflowY: "hidden",
                  paddingBottom: 8, height: alturaColunas ?? undefined,
                }}
              >
                {(colunas ?? []).map((c) => (
                  <ColunaMinhas key={c.id} coluna={c} count={porColuna[c.id]?.length ?? 0}>
                    {(porColuna[c.id] ?? []).map((t) => {
                      // ⚠️ `?? []` e nao `!`: a coluna vem de um mapa e pode
                      // faltar. Sem coluna o card nao desenha -- e o `!`
                      // esconderia o dia em que isso passar a acontecer.
                      // ⚠️ A COLUNA REAL da tarefa, e nao a coluna em que ela
                      // esta desenhada: e ela que decide prazo e "parada ha X
                      // dias" dentro do card.
                      const col = colunaDe(t);
                      return col ? (
                        <CardArrastavelMinhas
                          key={t.id}
                          task={t}
                          coluna={col}
                          rotuloDaColuna={rotuloForaDoQuadro(t)}
                          arrastavel={arrastavel(t)}
                          onAbrir={abrirDetalhe}
                          members={members}
                          projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
                        />
                      ) : null;
                    })}
                  </ColunaMinhas>
                ))}
              </div>

              {foraDaColuna > 0 && (
                <div className="muted" role="status" style={{ fontSize: 12, marginTop: 8 }}>
                  {foraDaColuna}{" "}
                  {foraDaColuna === 1 ? "tarefa está" : "tarefas estão"} em uma
                  coluna que não é deste quadro e não{" "}
                  {foraDaColuna === 1 ? "aparece" : "aparecem"} acima.
                </div>
              )}

              <DragOverlay>
                {activeId
                  ? (() => {
                      const at = (items ?? []).find((t) => t.id === activeId);
                      const colAt = at ? colunaDe(at) : undefined;
                      return at && colAt ? (
                        <div style={{ width: 256, cursor: "grabbing" }}>
                          <TaskCard
                            task={at}
                            coluna={colAt}
                            members={members}
                            projectName={at.project_id ? projectNames.get(at.project_id) : undefined}
                          />
                        </div>
                      ) : null;
                    })()
                  : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}

      <TaskModal
        open={duplicando !== null}
        duplicarDe={duplicando}
        // ⚠️ `filhosParaDetalhe` e nao `items`: esta tela lista SO as MINHAS
        // tarefas, entao uma subtarefa de outra pessoa nao esta em `items` e
        // a contagem sairia MENOR que a real. `filhosParaDetalhe` ja e a
        // busca completa dos filhos do foco.
        filhosDaOrigem={
          duplicando && focado?.id === duplicando.id ? filhosParaDetalhe : []
        }
        // Esta tela nao cria tarefa do zero (`open` exige duplicar).
        newTaskTeam={null}
        onClose={() => {
          setDuplicando(null);
        }}
        onSaved={(t) => {
          if (duplicando) {
            // ⚠️ Abre a CÓPIA, não a origem. Sem isto o detalhe continua na
            // tarefa original e a pessoa fica olhando a tela de onde saiu,
            // sem sinal nenhum de que algo foi criado -- pior ainda quando a
            // cópia é subtarefa, que não vira card no quadro (`depth !== 0`)
            // e só existe dentro da checklist do pai.
            setDuplicando(null);
            aoSalvar(t);
            setPilha([]);
            setDetalhe(t);
            return;
          }
          aoSalvar(t);
        }}
      />

      <TaskDetail
        task={focado}
        members={members}
        projects={projectNames}
        temVoltar={pilha.length > 0}
        pai={pilha[pilha.length - 1] ?? null}
        onVoltar={voltarDetalhe}
        onClose={fecharDetalhe}
        onDuplicar={(t) => setDuplicando(t)}
        onAssigneesChange={aoMudarResponsaveis}
        mostrarArquivadas={mostrarArquivadas}
        membrosInativos={membrosInativos}
        onAbrirSubtarefa={abrirSubtarefa}
        onSubtaskUpsert={aoUpsertComFilhos}
        onTaskMoved={aoUpsertComFilhos}
        onExcluir={(t) => {
          // Remove a task (e a subtree por path) da lista.
          setItems((prev) =>
            (prev ?? []).filter(
              (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
            )
          );
          // E tambem da lista de filhos buscada do foco (se estiver la).
          setFilhosDoFocado((prev) =>
            prev
              ? prev.filter(
                  (x) => x.id !== t.id && !x.path.startsWith(t.path + ".")
                )
              : prev
          );
          // Se veio de um pai (pilha), volta pro pai; senao fecha.
          if (pilha.length > 0) voltarDetalhe();
          else fecharDetalhe();
        }}
      />

    </div>
  );
}

// --- Kanban do minhas-tarefas (duplicado do Board de proposito: mantem o
// quadro geral intocado). Coluna droppable + card draggable, reusando TaskCard. ---
/**
 * Uma faixa clicável da lista — só a casca, com o contorno desenhado.
 *
 * ⚠️⚠️ ELA EXISTE PARA O CONTORNO, e não é só embrulho: o anel duro do
 * `.tappable:hover` saiu do CSS global em 10/09 e deu lugar ao traço que
 * corre, e o gancho que o desenha não pode ser chamado de dentro de
 * `linhaTarefa` -- aquela função roda uma vez por tarefa.
 *
 * ⚠️ E ELA LEVA SÓ `onAbrir` E `style`, e não a tarefa: passar `t` faria esta
 * casca conhecer o formato da linha, e aí ela deixaria de ser casca. O
 * conteúdo continua sendo montado em `linhaTarefa`, onde estão `colunaDe`,
 * `rotuloDe` e o resto do fechamento.
 *
 * ⚠️ `radius` 0: a faixa não tem raio -- as linhas se dividem por borda dentro
 * de um contêiner que tem o raio. Um traço arredondado no meio de uma lista de
 * cantos retos é pior que nenhum.
 *
 * ⚠️ O `onKeyDown` vem junto: a faixa é `role="button"`, então Enter e Espaço
 * TÊM de abrir. Deixá-lo em `linhaTarefa` faria a casca prometer um papel que
 * ela não cumpre.
 */
function FaixaClicavel({
  onAbrir,
  style,
  children,
}: {
  onAbrir: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { target, outline } = useDrawnOutline();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      {...target}
      // ⚠️ `position: relative` é o que faz o contorno medir ESTA faixa.
      style={{ position: "relative", cursor: "pointer", ...style }}
    >
      {outline}
      {children}
    </div>
  );
}

function ColunaMinhas({
  coluna,
  count,
  children,
}: {
  coluna: Coluna;
  count: number;
  children: React.ReactNode;
}) {
  // ⚠️ O `id` do droppable e o `column_id` (fatia 4c-2). E o que o `onDragEnd`
  // recebe em `e.over.id`, e o que o PATCH agora aceita.
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });
  return (
    <div
      ref={setNodeRef}
      // ⚠️ ANCORA ESTAVEL DA COLUNA. O teste de montagem achava a coluna com
      // `closest("div[style*='min-width']")` -- seletor que casa com QUALQUER
      // div cujo estilo inline mencione min-width. Em 21/08 o titulo do card
      // ganhou `minWidth: 0` (obrigatorio para ele encolher em vez de empurrar
      // os avatares), e o `closest` passou a achar o PROPRIO TITULO. O teste
      // nao acusou seletor frouxo: acusou "coluna errada".
      data-coluna={coluna.id}
      style={{
        flex: 1, minWidth: 240, minHeight: 0, borderRadius: 10, padding: 4,
        display: "flex", flexDirection: "column",
        background: isOver ? "var(--surface-2)" : "transparent",
        // Espelha o Board.tsx: anel na cor da coluna marca o alvo do drop.
        // `outline` nao ocupa espaco -> as colunas nao pulam de largura.
        outline: isOver ? `2px solid ${coluna.color}` : "none",
        outlineOffset: -2,
        transition: "background .12s",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
          paddingBottom: 8, borderBottom: `2px solid ${coluna.color}`,
          flexShrink: 0,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: coluna.color }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{coluna.name}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{count}</span>
      </div>
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          flex: 1, minHeight: 0, overflowY: "auto",
        }}
      >
        {children}
        {count === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>—</div>
        )}
      </div>
    </div>
  );
}

function CardArrastavelMinhas({
  task,
  coluna,
  rotuloDaColuna,
  arrastavel,
  onAbrir,
  members,
  projectName,
}: {
  task: MyTaskItem;
  // Fatia 5b-5b: `Quadro · Coluna` quando a tarefa mora em OUTRO quadro.
  // ⚠️ `undefined` quando ela mora no quadro desta tela -- o cabecalho da
  // coluna ja diz o nome, e repetir e ruido. Ver `rotuloForaDoQuadro`.
  rotuloDaColuna: string | undefined;
  // ⚠️ `false` para tarefa de outro quadro: nao ha para onde arrastar enquanto
  // mover entre quadros nao existir (fatia 5c).
  arrastavel: boolean;
  // Fatia 4c: o card decide prazo e "parada ha X dias" pela COLUNA. Esta tela
  // ja carrega as colunas da API desde a 4b -- so o repasse era o que faltava.
  // ⚠️ O KANBAN desta tela continua agrupando por STATUS: a migracao dele e a
  // 4c-2, e nao muda nada aqui.
  coluna: Coluna;
  onAbrir: (task: Task) => void;
  members: Map<string, { name: string }>;
  projectName?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !arrastavel,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAbrir(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir(task);
        }
      }}
      tabIndex={0}
      className="card-elev"
      style={{
        opacity: isDragging ? 0.4 : task.is_archived ? 0.55 : 1,
        touchAction: "none",
        ...(isDragging ? { transform: "none", boxShadow: "none" } : null),
      }}
    >
      <TaskCard
        task={task}
        coluna={coluna}
        rotuloDaColuna={rotuloDaColuna}
        members={members}
        projectName={projectName}
        parentTitle={(task as MyTaskItem).parent_title}
      />
    </div>
  );
}
