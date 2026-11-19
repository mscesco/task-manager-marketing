"use client";
// Aba "Referência" da página de desenvolvedor (Spec 065): todas as rotas, geradas da API.

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import Loading from "@/components/Loading";
import { getOpenApi, type ApiError } from "@/lib/api";
import { filtrar, rotasPorAssunto, type Assunto, type Rota } from "@/lib/referenciaDaApi";

const COR_DO_METODO: Record<string, string> = {
  GET: "var(--teal)",
  POST: "var(--accent)",
  PUT: "var(--amber)",
  PATCH: "var(--amber)",
  DELETE: "var(--danger)",
};

export default function ReferenciaDaApi() {
  const [assuntos, setAssuntos] = useState<Assunto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    getOpenApi()
      .then((api) => setAssuntos(rotasPorAssunto(api)))
      .catch((e: ApiError) => setErro(e.message || "Não consegui carregar a referência."));
  }, []);

  const visiveis = useMemo(() => (assuntos ? filtrar(assuntos, busca) : []), [assuntos, busca]);

  if (erro) return <div className="error-box">{erro}</div>;
  if (!assuntos) return <Loading />;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative max-w-[420px]">
        <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          className="input w-full"
          // Inline: o padding do `.input` vence o Tailwind.
          style={{ paddingLeft: 32 }}
          type="search"
          placeholder="Buscar rota (ex.: tarefa, /boards, aprovar)"
          aria-label="Buscar rota"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {visiveis.length === 0 && <p className="muted m-0 text-sm">Nenhuma rota com “{busca}”.</p>}
      {visiveis.map((a) => (
        <section key={a.id} aria-label={a.nome} className="flex flex-col gap-1.5">
          <h2 className="m-0 text-md font-semibold">{a.nome}</h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
            {a.rotas.map((r) => (
              <LinhaDaRota key={`${r.metodo} ${r.caminho}`} rota={r} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LinhaDaRota({ rota: r }: { rota: Rota }) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span
            className="w-[58px] shrink-0 font-mono text-xs font-bold"
            style={{ color: COR_DO_METODO[r.metodo] ?? "var(--text)" }}
          >
            {r.metodo}
          </span>
          <code className="min-w-0 max-w-full break-all text-xs">{r.caminho}</code>
          <span className="muted min-w-0 flex-1 text-xs max-sm:basis-full">{r.resumo}</span>
        </summary>
        <div className="flex flex-col gap-2 border-t border-border bg-surface-2 px-3 py-2.5 text-xs">
          {r.descricao && <p className="m-0 whitespace-pre-line">{r.descricao}</p>}
          {r.campos.length === 0 ? (
            <p className="muted m-0">Sem parâmetros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-ink-soft">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Campo</th>
                    <th className="py-1 pr-3 font-semibold">Onde</th>
                    <th className="py-1 pr-3 font-semibold">Tipo</th>
                    <th className="py-1 font-semibold">Obrigatório</th>
                  </tr>
                </thead>
                <tbody>
                  {r.campos.map((c) => (
                    <tr key={`${c.onde}-${c.nome}`} className="border-t border-border align-top">
                      <td className="py-1 pr-3">
                        <code>{c.nome}</code>
                        {c.descricao && <div className="muted mt-0.5 max-w-[420px]">{c.descricao}</div>}
                      </td>
                      <td className="py-1 pr-3">{c.onde}</td>
                      <td className="py-1 pr-3">{c.tipo}</td>
                      <td className="py-1">{c.obrigatorio ? "sim" : "não"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
