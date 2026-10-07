"use client";
// components/bases/PaginaDaBase.tsx
// Uma Base aberta (Spec 056, fatia E): nome, o texto do topo (D15), a tabela,
// o aviso de linhas (D23) e excluir pedindo o nome (D26).
//
// ⚠️⚠️ ATUALIZA A CADA 10 s ATÉ O AO VIVO (fatia G). Outras pessoas editam a
// mesma base, e sem isto a tela de cada um envelheceria até recarregar. Mesmo
// desenho do sino (`NotificationBell`): pula com a aba escondida, volta ao
// reaparecer, para no 401. ⚠️ E PULA ENQUANTO ALGUÉM EDITA uma célula: trocar
// as linhas por baixo de um editor aberto o fecharia no meio da digitação.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import DescricaoEditavel from "@/components/DescricaoEditavel";
import Loading from "@/components/Loading";
import TextoFormatado from "@/components/TextoFormatado";
import { useAvisar } from "@/components/Toasts";
import TabelaDaBase, { type Pessoas } from "@/components/bases/TabelaDaBase";
import {
  ApiError,
  deleteBase,
  getBase,
  listBaseRows,
  listMembers,
  listMembersDoTime,
  updateBase,
  type BaseDetail,
  type BaseRow,
  type BaseRowList,
} from "@/lib/api";
import { avisoDeLinhas, nomeConfere } from "@/lib/baseTable";
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

  const carregar = useCallback(async () => {
    const [b, l] = await Promise.all([getBase(id), listBaseRows(id)]);
    setBase(b);
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

  // A recarga de 10 s (ver o topo).
  useEffect(() => {
    let parado = false;
    const tick = () => {
      if (parado || document.hidden || ocupadoRef.current) return;
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
  }, [carregar]);

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

      <TabelaDaBase
        base={base}
        linhas={linhas}
        pessoas={pessoas}
        noTeto={noTeto}
        onBase={(f) => setBase((b) => (b ? f(b) : b))}
        onLinhas={(f) => setLinhas((l) => (l ? f(l) : l))}
        ocupadoRef={ocupadoRef}
      />
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
