"use client";
// A tela `/notificacoes`: tudo, paginado, agrupado por dia, com abas, filtros e
// "marcar estas como lidas". A regra está em `lib/telaDeNotificacoes.ts`.
// Estado na URL sem `useSearchParams` (rota estática; o hook derruba o `next build` sem `Suspense`):
// lê `window.location` na montagem e grava com `history.replaceState`.

import { useFecharAoClicarForaDe } from "@/lib/useCliqueFora";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  Bell,
  Clock,
  EyeOff,
  MessageCircle,
  Smile,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

/** O ícone e a cor de cada tipo de aviso. */
const ICONE_DO_TIPO: Partial<Record<string, { Icone: LucideIcon; cor: string }>> = {
  TASK_COMMENTED: { Icone: MessageCircle, cor: "bg-violet-soft text-violet" },
  TASK_MENTIONED: { Icone: MessageCircle, cor: "bg-violet-soft text-violet" },
  TASK_COMMENT_REPLIED: { Icone: MessageCircle, cor: "bg-violet-soft text-violet" },
  TASK_COMMENT_REACTED: { Icone: Smile, cor: "bg-violet-soft text-violet" },
  TASK_ASSIGNED: { Icone: UserRound, cor: "bg-accent-soft text-accent" },
  TASK_WATCH_ADDED: { Icone: UserRound, cor: "bg-accent-soft text-accent" },
  TASK_WATCH_REMOVED: { Icone: UserRound, cor: "bg-accent-soft text-accent" },
  TASK_DUE_SOON: { Icone: Clock, cor: "bg-amber-soft text-amber" },
  TASK_OVERDUE: { Icone: Clock, cor: "bg-danger/10 text-danger" },
  TASK_DUE_CHANGED: { Icone: Clock, cor: "bg-amber-soft text-amber" },
  TASK_COLUMN_CHANGED: { Icone: ArrowRight, cor: "bg-teal-soft text-teal" },
  TASK_ARCHIVED: { Icone: Archive, cor: "bg-surface-2 text-ink-soft" },
  TASK_UNARCHIVED: { Icone: Archive, cor: "bg-surface-2 text-ink-soft" },
  TASK_DELETED: { Icone: Archive, cor: "bg-surface-2 text-ink-soft" },
  ACCESS_LOST: { Icone: EyeOff, cor: "bg-danger/10 text-danger" },
};
const ICONE_PADRAO = { Icone: Bell, cor: "bg-surface-2 text-ink-soft" };

import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Loading, { Esqueleto } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import Paginacao from "@/components/Paginacao";
import AbasEmPilula from "@/components/AbasEmPilula";
import {
  listNotifications,
  listNotificationTargets,
  markAllNotificationsRead,
  markNotificationRead,
  type AlvoDeNotificacao,
  type AppNotification,
} from "@/lib/api";
import { destinoDaNotificacao, textoDaNotificacao } from "@/lib/notificacoes";
import { agoraNoWorkspace } from "@/lib/prazo";
import {
  type Aba,
  type EstadoDaTelaDeNotificacoes,
  ESTADO_INICIAL,
  OPCOES_DE_TIPO,
  POR_PAGINA,
  agruparPorDia,
  filtroDaApi,
  filtroDeMarcar,
  lerEstado,
  queryDoEstado,
  rotuloDoBotaoMarcar,
  temFiltro,
} from "@/lib/telaDeNotificacoes";

const ABAS = [
  { id: "nao-lidas" as const, label: "Não lidas" },
  { id: "todas" as const, label: "Todas" },
  // O que a pessoa desligou aparece aqui, e só aqui.
  { id: "silenciadas" as const, label: "Silenciadas" },
];

export default function TelaDeNotificacoes() {
  // `null` até ler a URL: senão seriam duas buscas e a lista piscaria.
  const [estado, setEstado] = useState<EstadoDaTelaDeNotificacoes | null>(null);
  const [itens, setItens] = useState<AppNotification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [naoLidas, setNaoLidas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setEstado(lerEstado(window.location.search));
  }, []);

  const mudar = useCallback((parcial: Partial<EstadoDaTelaDeNotificacoes>) => {
    setEstado((atual) => {
      const base = atual ?? ESTADO_INICIAL;
      // Mudar qualquer filtro volta para a pagina 1; so mudar a pagina, nao.
      const pagina = "pagina" in parcial ? parcial.pagina ?? 1 : 1;
      return { ...base, ...parcial, pagina };
    });
  }, []);

  // A URL espelha o estado num efeito, e não no `setEstado`: `replaceState` durante o render
  // dispara "Cannot update a component (Router) while rendering". Na montagem não grava.
  useEffect(() => {
    if (!estado) return;
    const query = queryDoEstado(estado);
    if (window.location.search === query) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query}`,
    );
  }, [estado]);

  useEffect(() => {
    if (!estado) return;
    let vivo = true;
    setItens(null);
    setErro(null);
    const filtro = filtroDaApi(estado);
    Promise.all([
      listNotifications({
        ...filtro,
        unread_only: estado.aba === "nao-lidas",
        page: estado.pagina,
        size: POR_PAGINA,
      }),
      // Quantas não lidas há no recorte: o número do botão de marcar.
      listNotifications({ ...filtro, unread_only: true, page: 1, size: 1 }),
    ])
      .then(([pagina, contagem]) => {
        if (!vivo) return;
        setItens(pagina.items);
        setTotal(pagina.total);
        setNaoLidas(contagem.total);
      })
      .catch(() => {
        if (vivo) setErro("Não consegui carregar as notificações.");
      });
    return () => {
      vivo = false;
    };
  }, [estado, recarga]);

  async function marcarEstas() {
    if (!estado) return;
    setMarcando(true);
    try {
      await markAllNotificationsRead(filtroDeMarcar(estado));
      setRecarga((n) => n + 1);
    } catch {
      setErro("Não consegui marcar as notificações como lidas.");
    } finally {
      setMarcando(false);
    }
  }

  if (!estado) return <Loading />;

  const filtrado = temFiltro(estado);
  const grupos = itens ? agruparPorDia(itens, agoraNoWorkspace()) : [];

  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader
        title="Notificações"
        count={naoLidas === 1 ? "1 não lida" : `${naoLidas} não lidas`}
        actions={
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            <AbasEmPilula<Aba>
              abas={ABAS.map((a) => (a.id === "nao-lidas" ? { ...a, count: naoLidas } : a))}
              ativa={estado.aba}
              onSelect={(aba) => mudar({ aba })}
              aria-label="Quais notificações"
              group="notificacoes"
            />
            {/* O link de preferências mora aqui, e não no sino. */}
            <Link href="/perfil#notificacoes" className="btn btn-ghost">
              Configurar
            </Link>
            <button
              type="button"
              className="btn"
              onClick={marcarEstas}
              disabled={marcando || naoLidas === 0}
            >
              {marcando ? "Marcando…" : rotuloDoBotaoMarcar(filtrado, naoLidas)}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="filtro-tipo">
          Tipo
        </label>
        <select
          id="filtro-tipo"
          className="input w-auto"
          value={estado.tipo ?? ""}
          onChange={(e) => mudar({ tipo: e.target.value || null })}
        >
          <option value="">Todos os tipos</option>
          {OPCOES_DE_TIPO.map((o) => (
            <option key={o.chave} value={o.chave}>
              {o.rotulo}
            </option>
          ))}
        </select>

        {estado.alvo ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-base">
            {estado.alvo.kind === "project" ? "Projeto" : "Tarefa"}:{" "}
            <strong className="max-w-[260px] truncate font-semibold">
              {estado.alvo.nome || "sem nome"}
            </strong>
            <button
              type="button"
              className="btn btn-ghost"
              // Padding inline: o `.btn` do globals.css não está em camada e
              // vence `px-*`/`py-*` do Tailwind.
              style={{ padding: "0 4px" }}
              aria-label="Tirar o filtro de tarefa ou projeto"
              onClick={() => mudar({ alvo: null })}
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        ) : (
          <BuscaDeAlvo onEscolher={(a) => mudar({ alvo: { kind: a.kind, id: a.id, nome: a.title } })} />
        )}

        {filtrado && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => mudar({ tipo: null, alvo: null })}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {erro && (
        <div className="error-box mt-4" role="alert">
          {erro}
        </div>
      )}

      <div className="mt-5">
        {itens === null && !erro ? (
          <Esqueleto forma="linhas" rotulo="Carregando as notificações" />
        ) : itens && itens.length === 0 ? (
          <EmptyState
            title={
              filtrado
                ? "Nenhuma notificação com esses filtros"
                : estado.aba === "nao-lidas"
                  ? "Nenhuma notificação não lida"
                  : // Vazio aqui é bom sinal: nada foi silenciado.
                    estado.aba === "silenciadas"
                    ? "Nenhuma notificação silenciada"
                    : "Nenhuma notificação"
            }
            action={
              filtrado ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => mudar({ tipo: null, alvo: null })}
                >
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          grupos.map((g) => (
            <section key={g.rotulo} className="mb-5">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.07em] text-ink-faint">
                {g.rotulo}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {g.itens.map((n) => (
                  <LinhaDeAviso
                    key={n.id}
                    aviso={n}
                    filtrandoEstaTarefa={
                      estado.alvo?.kind === "task" && estado.alvo.id === n.task_id
                    }
                    onSoDestaTarefa={() =>
                      n.task_id &&
                      mudar({
                        alvo: {
                          kind: "task",
                          id: n.task_id,
                          nome: n.payload?.task_title ?? "",
                        },
                      })
                    }
                    onLida={() =>
                      setItens((atual) =>
                        atual?.map((x) =>
                          x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x,
                        ) ?? null,
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <Paginacao
        pagina={estado.pagina}
        total={total}
        porPagina={POR_PAGINA}
        rotulo="Notificações"
        onIr={(pagina) => {
          mudar({ pagina });
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

function LinhaDeAviso({
  aviso,
  filtrandoEstaTarefa,
  onSoDestaTarefa,
  onLida,
}: {
  aviso: AppNotification;
  filtrandoEstaTarefa: boolean;
  onSoDestaTarefa: () => void;
  onLida: () => void;
}) {
  const destino = destinoDaNotificacao(aviso);
  const naoLida = aviso.read_at === null;
  const hora = agoraNoWorkspace(new Date(aviso.updated_at ?? aviso.created_at)).hora;
  const inacessivel = aviso.task_access === "gone";

  function marcarLida() {
    if (!naoLida) return;
    onLida();
    markNotificationRead(aviso.id).catch(() => {});
  }

  const { Icone, cor } = ICONE_DO_TIPO[aviso.type] ?? ICONE_PADRAO;
  const conteudo = (
    <>
      <span
        aria-hidden
        className={`inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${cor}`}
      >
        <Icone size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-md ${inacessivel ? "text-ink-faint" : "text-ink"}`}>
          {naoLida && <span className="sr-only">Não lida: </span>}
          {textoDaNotificacao(aviso)}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-faint">
          {hora}
          {inacessivel && (
            <Badge tone="soft" size="sm" color="var(--text-faint)">
              tarefa excluída ou sem acesso
            </Badge>
          )}
        </span>
      </span>
    </>
  );

  return (
    <li
      // Não lida = filete no bordo esquerdo.
      className={`flex items-start gap-3 rounded-xl border border-border bg-surface py-3 pr-3 transition-[border-color] duration-200 hover:border-accent ${
        naoLida ? "border-l-[3px] border-l-accent pl-3" : "border-l-[3px] border-l-transparent pl-3"
      }`}
    >
      {destino ? (
        // `<Link>`, e não `<div onClick>`: abrir em aba nova tem de funcionar.
        <Link href={destino} onClick={marcarLida} className="flex min-w-0 flex-1 items-start gap-2">
          {conteudo}
        </Link>
      ) : (
        // Tarefa excluída ou fora do alcance: apagado e sem link.
        <div className="flex min-w-0 flex-1 items-start gap-2 opacity-80">{conteudo}</div>
      )}
      {aviso.task_id && !filtrandoEstaTarefa && (
        <button
          type="button"
          className="btn btn-ghost shrink-0"
          // Inline pelo mesmo motivo do `×` do filtro (o `.btn` vence o Tailwind).
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={onSoDestaTarefa}
        >
          Só desta tarefa
        </button>
      )}
    </li>
  );
}

/** O campo "Tarefa ou projeto", com sugestões enquanto se digita. */
function BuscaDeAlvo({ onEscolher }: { onEscolher: (a: AlvoDeNotificacao) => void }) {
  const [termo, setTermo] = useState("");
  const [sugestoes, setSugestoes] = useState<AlvoDeNotificacao[]>([]);
  const [aberto, setAberto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Espera a pessoa parar de digitar: uma consulta por pausa, nao por tecla.
  useEffect(() => {
    const t = termo.trim();
    if (!t) {
      setSugestoes([]);
      return;
    }
    let vivo = true;
    const id = setTimeout(() => {
      listNotificationTargets(t)
        .then((r) => {
          if (vivo) setSugestoes(r);
        })
        .catch(() => {
          if (vivo) setSugestoes([]);
        });
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [termo]);

  useFecharAoClicarForaDe(wrapRef, aberto, () => setAberto(false));

  return (
    <div ref={wrapRef} className="relative">
      <label className="sr-only" htmlFor="filtro-alvo">
        Tarefa ou projeto
      </label>
      <input
        id="filtro-alvo"
        className="input w-[260px]"
        placeholder="Tarefa ou projeto…"
        value={termo}
        autoComplete="off"
        onChange={(e) => {
          setTermo(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
      />
      {aberto && termo.trim() && (
        <ul
          role="listbox"
          aria-label="Sugestões"
          className="absolute left-0 top-[calc(100%+4px)] z-30 w-[320px] overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          {sugestoes.length === 0 ? (
            <li className="px-3 py-2 text-base text-ink-faint">Nada com esse nome nas suas notificações.</li>
          ) : (
            sugestoes.map((s) => (
              <li key={`${s.kind}-${s.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base hover:bg-surface-2"
                  onClick={() => {
                    onEscolher(s);
                    setTermo("");
                    setAberto(false);
                  }}
                >
                  <span className="text-sm text-ink-faint">
                    {s.kind === "project" ? "Projeto" : "Tarefa"}
                  </span>
                  <span className="min-w-0 truncate">{s.title}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
