"use client";
// components/TelaDeNotificacoes.tsx
// A tela `/notificacoes` (Spec 053, fatia F): tudo, paginado, agrupado por dia,
// com abas Nao lidas / Todas, filtro por tipo e por tarefa ou projeto, e
// "marcar estas como lidas".
//
// Pedido dela, 17/09: *"um 'ver todas' no dropdown das notificacoes que leva
// pra uma tela que mostre (...) uma paginacao com as notificacoes, sabe?
// porque a galera que recebe muitas acaba perdendo"*.
//
// ⚠️ MORA EM `components/` e nao em `app/`, para ter guardiao (o `include` do
// vitest nao le `app/`). A regra esta em `lib/telaDeNotificacoes.ts`.
//
// ⚠️ ESTADO NA URL SEM `useSearchParams`: `/notificacoes` e rota ESTATICA, e o
// hook derruba o `next build` sem `Suspense` (AGENTS.md §6). Le
// `window.location` na montagem e grava com `history.replaceState` -- o mesmo
// desenho de `lib/estadoDaTela.ts`.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Loading from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import Paginacao from "@/components/Paginacao";
import Tabs from "@/components/Tabs";
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
  // Spec 054 (D5): o que a pessoa desligou continua aqui, e SO aqui.
  { id: "silenciadas" as const, label: "Silenciadas" },
];

export default function TelaDeNotificacoes() {
  // ⚠️ `null` ate ler a URL: carregar com o estado inicial e depois com o da
  // URL faria duas buscas e a lista piscaria.
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
      const novo = { ...base, ...parcial, pagina };
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${queryDoEstado(novo)}`,
      );
      return novo;
    });
  }, []);

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
      // Quantas NAO LIDAS ha no recorte -- o numero do botao de marcar (D25).
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
          <div className="ml-auto flex items-center gap-2">
            {/* Spec 054 (§9.6): o link mora AQUI, e nao no sino -- o sino e
                para ler o aviso, nao para configurar. */}
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

      <Tabs<Aba>
        tabs={ABAS}
        active={estado.aba}
        onSelect={(aba) => mudar({ aba })}
        aria-label="Quais notificações"
        group="notificacoes"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
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
              // ⚠️ Padding INLINE: o `.btn` do globals.css nao esta em camada e
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
          <Loading tamanho="linha" rotulo="Carregando as notificações" />
        ) : itens && itens.length === 0 ? (
          <EmptyState
            title={
              filtrado
                ? "Nenhuma notificação com esses filtros"
                : estado.aba === "nao-lidas"
                  ? "Nenhuma notificação não lida"
                  : // Spec 054: vazio aqui é bom sinal -- nada foi silenciado.
                    // "Nenhuma notificação" seria mentira: elas estão nas
                    // outras abas.
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
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.06em] text-ink-faint">
                {g.rotulo}
              </h2>
              <ul className="overflow-hidden rounded-lg border border-border bg-surface">
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

  const conteudo = (
    <>
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${naoLida ? "bg-accent" : "bg-transparent"}`}
      />
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
      className={`flex items-start gap-2 border-b border-border px-3 py-2.5 last:border-b-0 ${
        naoLida ? "bg-accent-soft" : ""
      }`}
    >
      {destino ? (
        // ⚠️ `<Link>`, e nao `<div onClick>` (web/AGENTS.md §5): abrir numa
        // aba nova com Ctrl/clique do meio tem de funcionar.
        <Link href={destino} onClick={marcarLida} className="flex min-w-0 flex-1 items-start gap-2">
          {conteudo}
        </Link>
      ) : (
        // D27: tarefa excluida ou fora do alcance -> apagado e SEM link.
        <div className="flex min-w-0 flex-1 items-start gap-2 opacity-80">{conteudo}</div>
      )}
      {aviso.task_id && !filtrandoEstaTarefa && (
        <button
          type="button"
          className="btn btn-ghost shrink-0"
          // ⚠️ Inline pelo mesmo motivo do `×` do filtro (o `.btn` vence o Tailwind).
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={onSoDestaTarefa}
        >
          Só desta tarefa
        </button>
      )}
    </li>
  );
}

/** O campo "Tarefa ou projeto", com sugestoes enquanto se digita (D23). */
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

  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto]);

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
