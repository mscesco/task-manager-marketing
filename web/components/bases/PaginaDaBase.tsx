"use client";
// components/bases/PaginaDaBase.tsx
// Uma Base aberta (Spec 056, fatia E): nome, o texto do topo (D15), a tabela,
// o aviso de linhas (D23) e excluir pedindo o nome (D26).
//
// ⚠️⚠️ AO VIVO (fatia G): o canal (`useAoVivo`) avisa quando outra pessoa
// mexe, e a página recarrega. A recarga de 10 s da fatia E FICOU, mas só vale
// com o canal fora do ar -- ele é um atalho, nunca o único caminho. Mesmo
// desenho do sino (`NotificationBell`): pula com a aba escondida, volta ao
// reaparecer, para no 401. ⚠️ E NADA RECARREGA ENQUANTO ALGUÉM EDITA uma
// célula: trocar as linhas por baixo de um editor aberto o fecharia no meio da
// digitação -- o aviso fica pendente e vale quando a edição acaba.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Redo2, Undo2 } from "lucide-react";
import DescricaoEditavel from "@/components/DescricaoEditavel";
import Loading from "@/components/Loading";
import TextoFormatado from "@/components/TextoFormatado";
import { useAvisar } from "@/components/Toasts";
import TabelaDaBase, { type Pessoas } from "@/components/bases/TabelaDaBase";
import BarraDeVisoes from "@/components/bases/BarraDeVisoes";
import CalendarioDaBase from "@/components/bases/CalendarioDaBase";
import ControlesDaVisao from "@/components/bases/ControlesDaVisao";
import QuadroDaBase from "@/components/bases/QuadroDaBase";
import type { Escolha } from "@/components/bases/EditorDeEscolha";
import { useGravarCelula } from "@/components/bases/useGravarCelula";
import { useAoVivo } from "@/components/bases/useAoVivo";
import { useDesfazer } from "@/components/bases/useDesfazer";
import {
  ApiError,
  currentUser,
  deleteBase,
  getBase,
  listBaseRows,
  listMembers,
  listMembersDoTime,
  updateBase,
  updateBaseView,
  type BaseColumn,
  type BaseDetail,
  type BaseRow,
  type BaseRowList,
} from "@/lib/api";
import { esperarGravacoes, geracao, haGravando } from "@/lib/gravacoesDaBase";
import { avisoDeLinhas, nomeConfere } from "@/lib/baseTable";
import {
  aplicarVisao,
  colunasVisiveis,
  lerConfig,
  visaoAtiva,
  type ConfigDaVisao,
} from "@/lib/baseViews";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const RECARGA_MS = 10_000;

export default function PaginaDaBase({ id }: { id: string }) {
  const router = useRouter();
  const avisar = useAvisar();
  const [base, setBase] = useState<BaseDetail | null>(null);
  const [linhas, setLinhas] = useState<BaseRow[] | null>(null);
  const [teto, setTeto] = useState<Pick<BaseRowList, "limit" | "warning_at">>({
    limit: 5000,
    warning_at: 4000,
  });
  const [pessoas, setPessoas] = useState<Pessoas>({ todos: new Map(), daArvore: new Set() });
  const [erro, setErro] = useState<string | null>(null);
  const ocupadoRef = useRef(false);
  useDocumentTitle(base?.name);

  // --- a visão (fatia F) ---
  // ⚠️ A URL diz a visão aberta (web/AGENTS.md §5): `?visao=<id>`. Lida e
  // escrita por `window.location`/`history`, e não por `useSearchParams` --
  // o mesmo cuidado das outras telas com o build.
  const [pedida, setPedida] = useState<string | null>(null);
  useEffect(() => {
    setPedida(new URLSearchParams(window.location.search).get("visao"));
  }, []);
  function escolherVisao(viewId: string) {
    setPedida(viewId);
    const url = new URL(window.location.href);
    url.searchParams.set("visao", viewId);
    window.history.replaceState(null, "", url);
  }
  // Linhas criadas nesta tela passam pelo filtro (ver `aplicarVisao`).
  const [fixadas, setFixadas] = useState<ReadonlySet<string>>(new Set());
  // ⚠️ A config grava com ATRASO: digitar o valor de um filtro seria uma
  // gravação (e uma entrada no diário) por tecla. E a recarga de 10 s espera,
  // senão traria a config velha por cima da que está para ser gravada.
  const gravacaoDaVisao = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ⚠️ Trava PRÓPRIA, e não o `ocupadoRef`: a tabela reescreve aquele a cada
  // render (editando ou não), e apagaria esta no meio do atraso.
  const salvandoVisao = useRef(false);
  const avisarErro = useAvisar();
  const visaoPendente = useRef<{ viewId: string; config: ConfigDaVisao } | null>(null);
  const gravarVisaoAgora = useCallback(async () => {
    if (gravacaoDaVisao.current) clearTimeout(gravacaoDaVisao.current);
    gravacaoDaVisao.current = null;
    const p = visaoPendente.current;
    visaoPendente.current = null;
    if (!p) return;
    try {
      await updateBaseView(id, p.viewId, { config: p.config });
    } catch (e) {
      avisarErro((e as ApiError).message || "Não consegui salvar a visão.");
    } finally {
      salvandoVisao.current = false;
    }
  }, [id, avisarErro]);
  function mudarConfig(viewId: string, config: ConfigDaVisao) {
    setBase((b) =>
      b ? { ...b, views: b.views.map((v) => (v.id === viewId ? { ...v, config } : v)) } : b
    );
    if (gravacaoDaVisao.current) clearTimeout(gravacaoDaVisao.current);
    salvandoVisao.current = true;
    visaoPendente.current = { viewId, config };
    gravacaoDaVisao.current = setTimeout(() => void gravarVisaoAgora(), 600);
  }

  const atualizarLinhas = useCallback(
    (f: (l: BaseRow[]) => BaseRow[]) => setLinhas((l) => (l ? f(l) : l)),
    []
  );
  const gravar = useGravarCelula(id, atualizarLinhas);

  const pendente = useRef(false);
  const carregar = useCallback(async () => {
    const g = geracao(id);
    const [b, l] = await Promise.all([getBase(id), listBaseRows(id)]);
    setBase(b);
    // ⚠️ Uma gravação de linha começou no meio da leitura: estas linhas podem
    // ser de ANTES dela e desfariam a edição na tela (ver
    // `lib/gravacoesDaBase`). Fica pendente, e a próxima volta relê.
    if (geracao(id) !== g || haGravando(id)) {
      pendente.current = true;
      return b;
    }
    setLinhas(l.items);
    setTeto({ limit: l.limit, warning_at: l.warning_at });
    return b;
  }, [id]);

  useEffect(() => {
    let vivo = true;
    carregar()
      .then((b) =>
        Promise.all([listMembers(), listMembersDoTime(b.team_id)]).then(([todos, doTime]) => {
          if (!vivo) return;
          setPessoas({
            todos: new Map(todos.map((m) => [m.id, { name: m.name, is_active: m.is_active }])),
            daArvore: new Set(doTime.map((m) => m.id)),
          });
        })
      )
      .catch((e: ApiError) => {
        if (!vivo) return;
        setErro(
          e.status === 404
            ? "Esta base não existe, foi excluída, ou você não tem acesso a ela."
            : e.message
        );
      });
    return () => {
      vivo = false;
    };
  }, [carregar]);

  // --- o ao vivo (fatia G) ---
  // ⚠️ Um aviso que chega com alguém EDITANDO fica PENDENTE, e a recarga
  // acontece quando a edição acaba: trocar as linhas por baixo de um editor
  // aberto o faria perder o que está sendo digitado.
  const [meuId, setMeuId] = useState<string | null>(null);
  useEffect(() => {
    currentUser()
      .then((u) => setMeuId(u.id))
      .catch(() => {});
  }, []);
  const recarregar = useCallback(() => {
    carregar().catch((e: ApiError) => {
      if (e.status === 404) setErro("Esta base foi excluída.");
    });
  }, [carregar]);
  const aoMudar = useCallback(() => {
    if (ocupadoRef.current || salvandoVisao.current || haGravando(id)) {
      pendente.current = true;
      return;
    }
    recarregar();
  }, [id, recarregar]);
  const aoVivo = useAoVivo(id, meuId, aoMudar);
  // Fatia H: o Ctrl+Z. Desfeito, recarrega -- o eco da própria ação não chega
  // pelo canal (ver `useAoVivo`), então a recarga é daqui.
  // ⚠️ E espera as gravações de linha em voo: sem isso, Ctrl+Z logo depois
  // de editar desfazia a ação ANTERIOR (revisão de 08/10).
  const antesDeDesfazer = useCallback(async () => {
    await gravarVisaoAgora();
    await esperarGravacoes(id);
  }, [id, gravarVisaoAgora]);
  const desfazer = useDesfazer(id, recarregar, antesDeDesfazer);
  useEffect(() => {
    const t = setInterval(() => {
      if (pendente.current && !ocupadoRef.current && !salvandoVisao.current && !haGravando(id)) {
        pendente.current = false;
        recarregar();
      }
    }, 1_000);
    return () => clearInterval(t);
  }, [id, recarregar]);

  // A recarga de 10 s (ver o topo) -- SÓ com o canal fora do ar.
  const aoVivoRef = useRef(aoVivo);
  aoVivoRef.current = aoVivo;
  useEffect(() => {
    let parado = false;
    const tick = () => {
      if (parado || aoVivoRef.current) return;
      if (document.hidden || ocupadoRef.current || salvandoVisao.current || haGravando(id)) return;
      carregar().catch((e: ApiError) => {
        if (e.status === 401) parado = true;
        if (e.status === 404) {
          parado = true;
          setErro("Esta base foi excluída.");
        }
      });
    };
    const intervalo = setInterval(tick, RECARGA_MS);
    const aoVoltar = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      parado = true;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [id, carregar]);

  if (erro) {
    return (
      <div className="flex flex-col gap-3">
        <div className="error-box max-w-[480px]">{erro}</div>
        <Link href="/bases" className="text-accent">
          Voltar para as bases
        </Link>
      </div>
    );
  }
  if (!base || !linhas) return <Loading />;

  const aviso = avisoDeLinhas(linhas.length, teto.warning_at, teto.limit);
  const noTeto = aviso?.nivel === "teto";

  const visao = visaoAtiva(base.views, pedida);
  const config = lerConfig(visao?.config);
  const nomeDePessoa = (pid: string) => pessoas.todos.get(pid)?.name ?? "";
  const daVisao = aplicarVisao(linhas, base.columns, config, { fixadas, nomeDePessoa });
  const escolhasDe = (c: BaseColumn): Escolha[] =>
    c.type === "person"
      ? [...pessoas.daArvore]
          .map((pid) => ({ id: pid, rotulo: pessoas.todos.get(pid)?.name ?? pid }))
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"))
      : c.options.map((o) => ({ id: o.id, rotulo: o.label }));
  const agrupar = base.columns.find((c) => c.id === config.group_by && c.type === "select");
  const colunaData = base.columns.find((c) => c.id === config.date_column && c.type === "date");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link href="/bases" className="flex items-center gap-1 text-sm text-ink-soft no-underline">
        <ChevronLeft size={14} aria-hidden="true" /> Bases
      </Link>

      <Cabecalho
        base={base}
        onBase={setBase}
        onExcluida={() => {
          avisar(`"${base.name}" foi para a lixeira. Ela volta por 10 dias.`);
          router.push("/bases");
        }}
      />

      {base.can_update ? (
        <div className="max-w-[860px]">
          <DescricaoEditavel
            valor={base.description || null}
            onSalvar={async (nova) => {
              setBase(await updateBase(base.id, { description: nova }));
            }}
          />
        </div>
      ) : (
        base.description && (
          <TextoFormatado texto={base.description} className="max-w-[860px]" />
        )
      )}

      {aviso && (noTeto || base.can_update) && (
        <div className={noTeto ? "error-box max-w-[860px]" : "muted max-w-[860px] text-sm"} role="status">
          {aviso.texto}
        </div>
      )}

      {visao && (
        // Fatia J: uma linha só, como no Notion -- as abas à esquerda, e
        // filtro, ordem, colunas e desfazer à direita, só com ícone.
        <div className="flex min-w-0 flex-wrap items-end gap-2 border-b border-border">
          <div className="min-w-0 flex-1">
            <BarraDeVisoes
              base={base}
              ativa={visao}
              onEscolher={escolherVisao}
              onViews={(f) => setBase((b) => (b ? { ...b, views: f(b.views) } : b))}
            />
          </div>
          <div className="flex items-center gap-0.5 pb-1">
            <ControlesDaVisao
              layout={visao.layout}
              colunas={base.columns}
              config={config}
              podeEditar={base.can_update_view}
              escolhasDe={escolhasDe}
              onConfig={(c) => mudarConfig(visao.id, c)}
            />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {/* Os botões existem para quem usa o mouse descobrir o atalho; o
                servidor diz o que há para desfazer, e a mensagem conta. */}
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 6px" }}
              disabled={desfazer.ocupado}
              aria-label="Desfazer"
              aria-keyshortcuts="Control+Z"
              title="Desfazer (Ctrl+Z)"
              onClick={() => desfazer.rodar("undo")}
            >
              <Undo2 size={14} aria-hidden="true" />
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 6px" }}
              disabled={desfazer.ocupado}
              aria-label="Refazer"
              aria-keyshortcuts="Control+Shift+Z Control+Y"
              title="Refazer (Ctrl+Shift+Z)"
              onClick={() => desfazer.rodar("redo")}
            >
              <Redo2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {visao?.layout === "board" ? (
        agrupar ? (
          <QuadroDaBase
            linhas={daVisao}
            colunas={base.columns}
            agrupar={agrupar}
            podeEditar={base.can_update_row}
            onGravar={gravar}
          />
        ) : (
          <p className="muted m-0 text-sm">Escolha em "Agrupar por" a coluna de Seleção que monta o quadro.</p>
        )
      ) : visao?.layout === "calendar" ? (
        colunaData ? (
          <CalendarioDaBase
            linhas={daVisao}
            colunas={base.columns}
            data={colunaData}
            podeEditar={base.can_update_row}
            onGravar={gravar}
          />
        ) : (
          <p className="muted m-0 text-sm">Escolha em "Data" a coluna que monta o calendário.</p>
        )
      ) : (
        <TabelaDaBase
          base={base}
          colunas={colunasVisiveis(base.columns, config)}
          linhas={daVisao}
          pessoas={pessoas}
          noTeto={noTeto}
          onBase={(f) => setBase((b) => (b ? f(b) : b))}
          onLinhas={atualizarLinhas}
          onLinhaCriada={(rid) => setFixadas((s) => new Set([...s, rid]))}
          ocupadoRef={ocupadoRef}
          config={config}
          onConfig={visao ? (c) => mudarConfig(visao.id, c) : undefined}
          onRecarregar={recarregar}
        />
      )}
    </div>
  );
}

function Cabecalho({
  base,
  onBase,
  onExcluida,
}: {
  base: BaseDetail;
  onBase: (b: BaseDetail) => void;
  onExcluida: () => void;
}) {
  const avisar = useAvisar();
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(base.name);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function salvarNome() {
    const limpo = nome.trim();
    setRenomeando(false);
    if (!limpo || limpo === base.name) {
      setNome(base.name);
      return;
    }
    try {
      onBase(await updateBase(base.id, { name: limpo }));
    } catch (e) {
      setNome(base.name);
      avisar((e as ApiError).message || "Não consegui renomear a base.");
    }
  }

  async function excluir() {
    setOcupado(true);
    try {
      await deleteBase(base.id);
      onExcluida();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui excluir a base.");
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {renomeando ? (
          <input
            className="input max-w-[560px] flex-1 text-xl font-semibold"
            aria-label="Nome da base"
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={salvarNome}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvarNome();
              if (e.key === "Escape") {
                setNome(base.name);
                setRenomeando(false);
              }
            }}
          />
        ) : (
          <h1 className="m-0 min-w-0 truncate text-3xl font-bold">{base.name}</h1>
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          {base.can_update && !renomeando && (
            <button className="btn btn-ghost" onClick={() => setRenomeando(true)}>
              Renomear…
            </button>
          )}
          {base.can_delete && !excluindo && (
            <button className="btn btn-ghost text-danger" onClick={() => setExcluindo(true)}>
              Excluir base…
            </button>
          )}
        </div>
      </div>

      {excluindo && (
        <div className="flex max-w-[560px] flex-col gap-2 rounded-md border border-danger p-3" role="alert">
          <p className="m-0 text-sm">
            A base vai para a lixeira com todas as linhas e visões, e volta por 10 dias.
            Para confirmar, digite o nome dela: <strong>{base.name}</strong>
          </p>
          <input
            className="input"
            aria-label="Digite o nome da base para confirmar"
            autoFocus
            autoComplete="off"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nomeConfere(confirmacao, base.name)) excluir();
              if (e.key === "Escape") setExcluindo(false);
            }}
          />
          <div className="flex gap-2">
            <button
              className="btn btn-danger"
              disabled={ocupado || !nomeConfere(confirmacao, base.name)}
              onClick={excluir}
            >
              {ocupado ? "Excluindo…" : "Excluir base"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={ocupado}
              onClick={() => {
                setExcluindo(false);
                setConfirmacao("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
