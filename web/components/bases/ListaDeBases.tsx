"use client";
// components/bases/ListaDeBases.tsx
// A lista de Bases (Spec 056, fatia E): as bases que a pessoa lê, agrupadas
// pelo time raiz quando ela está em mais de um; criar; e a lixeira.
//
// ⚠️ NÃO RECORTA PELO TIME ATIVO do menu, ao contrário de Projetos: a base é
// do time RAIZ, e a lista é curta. O time ativo só pré-escolhe onde criar.
//
// ⚠️ QUEM CRIA E ONDE, QUEM RESTAURA: tudo vem do servidor -- `can_create_base`
// por time (`GET /teams`) e `can_restore` por item da lixeira. A tela não
// deduz nada de papel (spec §5.6).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Table2 } from "lucide-react";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import Loading from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  createBase,
  listBases,
  listBaseTrash,
  listTeamsAll,
  restoreBase,
  type BaseSummary,
  type BaseTrashItem,
  type Team,
} from "@/lib/api";
import ImportWizard from "@/components/bases/ImportWizard";
import { agruparPorRaiz, dataParaTela } from "@/lib/baseTable";
import { rootTeamOf } from "@/lib/areas";
import { diaNoWorkspace } from "@/lib/prazo";
import { plural } from "@/lib/plural";
import { useActiveTeamId } from "@/lib/useActiveTeam";

export default function ListaDeBases() {
  const router = useRouter();
  const avisar = useAvisar();
  const timeAtivo = useActiveTeamId();

  const [bases, setBases] = useState<BaseSummary[] | null>(null);
  const [lixeira, setLixeira] = useState<BaseTrashItem[]>([]);
  const [times, setTimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [nome, setNome] = useState("");
  const [raizId, setRaizId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([listBases(), listTeamsAll()])
      .then(([b, t]) => {
        if (!vivo) return;
        setBases(b);
        setTimes(t);
      })
      .catch((e: ApiError) => vivo && setErro(e.message));
    // ⚠️ A lixeira pede `base.restore`: quem não o tem leva 403, e a seção
    // simplesmente não aparece -- não é erro da tela.
    listBaseTrash()
      .then((l) => vivo && setLixeira(l))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const raizesQueCria = times.filter(
    (t) => t.parent_team_id === null && t.can_create_base === true
  );

  // O time ativo (pode ser subtime) pré-escolhe a raiz dele, se ela serve.
  useEffect(() => {
    if (raizId) return;
    const daAtiva = timeAtivo ? rootTeamOf(timeAtivo, times) : null;
    const serve = raizesQueCria.find((r) => r.id === daAtiva);
    if (serve) setRaizId(serve.id);
    else if (raizesQueCria.length === 1) setRaizId(raizesQueCria[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeAtivo, times]);

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) {
      setErroForm("Dê um nome à base.");
      return;
    }
    if (!raizId) {
      setErroForm("Escolha o time da base.");
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      const nova = await createBase({ name: limpo, team_id: raizId });
      router.push(`/bases/${nova.id}`);
    } catch (e) {
      setErroForm((e as ApiError).message || "Não consegui criar a base.");
      setSalvando(false);
    }
  }

  async function restaurar(item: BaseTrashItem) {
    try {
      const volta = await restoreBase(item.id);
      setLixeira((l) => l.filter((x) => x.id !== item.id));
      setBases((b) => (b ? [...b, volta] : [volta]));
      avisar(`"${item.name}" voltou para as bases.`);
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui restaurar a base.");
    }
  }

  if (erro) return <div className="error-box max-w-[480px]">{erro}</div>;
  if (!bases) return <Loading />;

  const grupos = agruparPorRaiz(bases, times);
  const variasRaizes = grupos.length > 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bases"
        count={plural(bases.length, "base", "bases")}
        actions={
          raizesQueCria.length > 0 && !criando ? (
            <div className="ml-auto flex gap-2">
              {/* Spec 057: uma base nova a partir de uma planilha. */}
              <button className="btn" onClick={() => setImportando(true)}>
                Importar planilha
              </button>
              <button className="btn btn-primary" onClick={() => setCriando(true)}>
                Nova base
              </button>
            </div>
          ) : undefined
        }
      />

      {importando && (
        <ImportWizard
          target={{
            kind: "new",
            teams: raizesQueCria.map((r) => ({ id: r.id, name: r.name })),
            defaultTeamId: raizId || (raizesQueCria.length === 1 ? raizesQueCria[0].id : null),
          }}
          onClose={() => setImportando(false)}
          onDone={(r) => {
            setImportando(false);
            avisar(`${r.imported} linhas importadas.`);
            if (r.base_id) router.push(`/bases/${r.base_id}`);
          }}
        />
      )}

      {criando && (
        <Card className="flex max-w-[640px] flex-col gap-3">
          <div className="field">
            <label className="label" htmlFor="nova-base-nome">
              Nome
            </label>
            <input
              id="nova-base-nome"
              className="input"
              name="nome-da-base"
              autoComplete="off"
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") criar();
                if (e.key === "Escape") setCriando(false);
              }}
              placeholder="Calendário de conteúdo"
            />
          </div>
          {raizesQueCria.length > 1 && (
            <div className="field">
              <label className="label" htmlFor="nova-base-time">
                Time
              </label>
              <select
                id="nova-base-time"
                className="input"
                value={raizId}
                onChange={(e) => setRaizId(e.target.value)}
              >
                <option value="">Escolha…</option>
                {raizesQueCria.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {erroForm && (
            <div className="error-box text-xs" role="alert">
              {erroForm}
            </div>
          )}
          <p className="muted m-0 text-xs">
            A base nasce com uma coluna de título e a visão de tabela. As outras
            colunas, você cria nela.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={salvando} onClick={criar}>
              {salvando ? "Criando…" : "Criar base"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={salvando}
              onClick={() => setCriando(false)}
            >
              Cancelar
            </button>
          </div>
        </Card>
      )}

      {bases.length === 0 ? (
        <EmptyState
          title="Nenhuma base ainda"
          description="Uma base é uma tabela que a equipe monta: colunas, linhas e visões, como um calendário de conteúdo."
          action={
            raizesQueCria.length > 0 && !criando ? (
              <button className="btn btn-primary" onClick={() => setCriando(true)}>
                Criar a primeira base
              </button>
            ) : undefined
          }
        />
      ) : (
        grupos.map((g) => (
          <section key={g.raiz?.id ?? "sem-raiz"} className="flex flex-col gap-2">
            {variasRaizes && (
              <h2 className="label m-0">{g.raiz?.name ?? "Outros times"}</h2>
            )}
            {/* Redesign (fatia 7): grade de cards com uma miniatura de tabela,
                como a prancha. A miniatura e decoracao (`aria-hidden`). */}
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-0">
              {g.bases.map((b) => (
                <li key={b.id} className="min-w-0">
                  <Link
                    href={`/bases/${b.id}`}
                    // O nome acessivel e so o da base; a data e detalhe visual.
                    aria-label={b.name}
                    className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-ink no-underline transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
                  >
                    <span aria-hidden className="grid grid-cols-[1.4fr_1fr_1fr] gap-px overflow-hidden rounded-lg border border-border bg-border">
                      {Array.from({ length: 12 }, (_, i) => (
                        <span key={i} className={`h-3.5 ${i < 3 ? "bg-surface-2" : "bg-surface"}`}>
                          <span
                            className={`mx-1.5 mt-1 block h-1.5 rounded-sm ${i % 3 === 2 && i > 2 ? "bg-accent-soft" : "bg-border"}`}
                            style={{ width: `${45 + ((i * 17) % 40)}%` }}
                          />
                        </span>
                      ))}
                    </span>
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-md font-bold">{b.name}</span>
                      <Table2 size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
                    </span>
                    <span className="muted text-xs">
                      editada em {dataParaTela(diaNoWorkspace(b.updated_at))}
                    </span>
                  </Link>
                </li>
              ))}
              {raizesQueCria.some((r) => r.id === g.raiz?.id) && !criando && (
                <li className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setRaizId(g.raiz?.id ?? raizId);
                      setCriando(true);
                    }}
                    className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-transparent text-sm font-semibold text-ink-faint transition-colors duration-200 hover:border-accent hover:bg-accent-soft hover:text-accent"
                  >
                    <Plus size={22} aria-hidden />
                    Nova base
                    <span className="text-xs font-medium">começa com uma coluna de texto</span>
                  </button>
                </li>
              )}
            </ul>
          </section>
        ))
      )}

      {lixeira.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="lixeira-de-bases">
          <h2 id="lixeira-de-bases" className="label m-0">
            Lixeira
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {lixeira.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 items-center gap-3 rounded-md border border-dashed border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-ink-soft">{item.name}</span>
                <span className="muted shrink-0 text-xs">
                  volta até {dataParaTela(diaNoWorkspace(item.restorable_until))}
                </span>
                {item.can_restore && (
                  <button className="btn btn-ghost text-xs" onClick={() => restaurar(item)}>
                    Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
