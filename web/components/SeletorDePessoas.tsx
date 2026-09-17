"use client";
// components/SeletorDePessoas.tsx
// Uma linha de pessoas (pílulas com avatar) + o `+` que abre a busca com
// caixas. Spec 053, fatia D: nasce para "Seguidores" -- no detalhe da tarefa e
// no modal de criar.
//
// ⚠️ ELE DESENHA, e so. Quem decide a lista oferecida e `lib/seguidores.ts`;
// quem grava (na hora, no detalhe; no "Criar", no modal) e quem chama, pelo
// `onAlternar`.
//
// ⚠️ O PAINEL E `position: fixed`, e nao `absolute`, pela licao do modal de
// criar (22/08): o card do modal tem `overflowY: auto` e RECORTA filho absoluto
// -- com o campo perto do rodape, o painel abria cortado. `fixed` escapa do
// recorte enquanto nenhum ancestral tiver `transform`, `filter` ou `contain`.
// A medicao (e a virada para cima quando nao cabe embaixo) nao roda em jsdom:
// e conferencia de olho, na tela.
//
// ⚠️ A linha de "Responsaveis" do detalhe e do modal NAO usa este componente
// ainda -- tem a mesma forma, com estilo inline e regras proprias (obrigatorio,
// "Selecionar todos"). Juntar as duas e trabalho a parte.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import Avatar from "@/components/Avatar";
import { nomeCurto } from "@/lib/people";
import type { PessoaOferecida } from "@/lib/seguidores";

type Posicao = { top: number; left: number; maxAltura: number };

const LARGURA = 300;
const MARGEM = 12;

export default function SeletorDePessoas({
  rotulo,
  marcados,
  nomes,
  inativos,
  invalidos,
  oferecidas,
  busca,
  onBusca,
  onAlternar,
  podeAbrir,
  ocupados,
  textoVazio,
  rotuloDoBotao,
}: {
  /** O rotulo ao lado das pilulas. Ausente quando quem chama ja tem um `<label>`. */
  rotulo?: string;
  /** Ids escolhidos, na ordem em que aparecem. */
  marcados: readonly string[];
  nomes: ReadonlyMap<string, { name: string }>;
  inativos: ReadonlySet<string>;
  /** Recusados pelo servidor: pílula e linha em vermelho. */
  invalidos?: ReadonlySet<string>;
  oferecidas: readonly PessoaOferecida[];
  busca: string;
  onBusca: (texto: string) => void;
  onAlternar: (id: string) => void;
  /** Sem permissao (ou tarefa arquivada): so a linha, sem `+`. */
  podeAbrir: boolean;
  ocupados?: ReadonlySet<string>;
  /** O que aparece sem ninguem escolhido. Ausente = nada, so o `+`. */
  textoVazio?: string;
  /** aria-label do `+`, ex.: "Escolher seguidores". */
  rotuloDoBotao: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<Posicao | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const medir = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const abaixo = window.innerHeight - r.bottom - MARGEM;
    const acima = r.top - MARGEM;
    const paraCima = abaixo < 220 && acima > abaixo;
    const maxAltura = Math.max(160, Math.min(360, paraCima ? acima : abaixo));
    setPos({
      left: Math.max(MARGEM, Math.min(r.left, window.innerWidth - LARGURA - MARGEM)),
      top: paraCima ? Math.max(MARGEM, r.top - maxAltura - 6) : r.bottom + 6,
      maxAltura,
    });
  }, []);

  // ⚠️ `scroll` COM CAPTURE: quem rola e o card do modal, e rolagem de elemento
  // nao sobe ate o `window`.
  useEffect(() => {
    if (!aberto) return;
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [aberto, medir]);

  // Clicar fora fecha. O painel e filho do wrapper no DOM (sem portal), entao
  // `contains` cobre os dois.
  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto]);

  // Perdeu a permissao com o painel aberto (a tarefa foi arquivada): fecha.
  useEffect(() => {
    if (!podeAbrir) setAberto(false);
  }, [podeAbrir]);

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-wrap items-center gap-1.5">
      {rotulo && <span className="shrink-0 text-sm text-ink-soft">{rotulo}</span>}

      {marcados.length === 0 ? (
        textoVazio ? <span className="text-base text-ink-faint">{textoVazio}</span> : null
      ) : (
        marcados.map((id) => {
          const nome = nomes.get(id)?.name ?? "";
          const inativo = inativos.has(id);
          const invalido = invalidos?.has(id) ?? false;
          return (
            <span
              key={id}
              title={inativo ? `${nome} (desativado)` : nome}
              className={[
                "inline-flex max-w-[180px] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full py-0.5 pl-0.5 pr-2.5 text-base",
                invalido
                  ? "border border-danger bg-surface text-danger"
                  : "border border-transparent bg-surface-2",
                inativo ? "text-ink-faint line-through" : "",
              ].join(" ")}
            >
              <Avatar id={id} name={nome} size="sm" />
              <span className="min-w-0 truncate">{nome ? nomeCurto(nome) : "Pessoa"}</span>
            </span>
          );
        })
      )}

      {podeAbrir && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-label={rotuloDoBotao}
          aria-expanded={aberto}
          title={rotuloDoBotao}
          className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface text-ink-soft"
        >
          {aberto ? (
            <X size={13} strokeWidth={2.2} aria-hidden />
          ) : (
            <Plus size={13} strokeWidth={2.2} aria-hidden />
          )}
        </button>
      )}

      {aberto && (
        <div
          role="dialog"
          aria-label={rotuloDoBotao}
          className="fixed z-[70] rounded-lg border border-border bg-surface p-2 shadow-card"
          // ⚠️ Posicao e altura sao MEDIDAS em tempo de execucao -- e a excecao
          // documentada ao "estilo nao nasce inline" (valor de runtime).
          // Enquanto nao mediu, fica invisivel: desenhar em 0,0 e pular e pior.
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            width: LARGURA,
            maxWidth: "calc(100vw - 24px)",
            visibility: pos ? "visible" : "hidden",
          }}
        >
          <input
            className="input"
            placeholder="Buscar pessoa…"
            value={busca}
            autoFocus
            onChange={(e) => onBusca(e.target.value)}
            // Enter ESCOLHE a primeira da lista, e nao envia formulario nenhum
            // (a mesma licao do seletor de responsaveis do modal).
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              const primeira = oferecidas.find((p) => !(ocupados?.has(p.id) ?? false));
              if (primeira) {
                onAlternar(primeira.id);
                onBusca("");
              }
            }}
          />
          <div
            className="mt-1.5 overflow-y-auto rounded-md border border-border"
            style={{ maxHeight: Math.max(120, (pos?.maxAltura ?? 336) - 60) }}
          >
            {oferecidas.length === 0 ? (
              <div className="px-3 py-2.5 text-base text-ink-faint">Ninguém encontrado.</div>
            ) : (
              oferecidas.map((p, i) => {
                const marcado = marcados.includes(p.id);
                const ocupado = ocupados?.has(p.id) ?? false;
                return (
                  <label
                    key={p.id}
                    className={[
                      "flex items-center gap-2.5 px-3 py-2",
                      i === 0 ? "" : "border-t border-border",
                      ocupado ? "cursor-wait opacity-60" : "cursor-pointer",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={ocupado}
                      onChange={() => onAlternar(p.id)}
                    />
                    <Avatar id={p.id} name={p.name} size="sm" />
                    <span className={invalidosTem(invalidos, p.id) ? "text-md text-danger" : "text-md"}>
                      {p.name}
                    </span>
                    {p.inativo && (
                      <span className="ml-auto text-xs text-ink-faint">inativo</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function invalidosTem(invalidos: ReadonlySet<string> | undefined, id: string): boolean {
  return invalidos?.has(id) ?? false;
}
