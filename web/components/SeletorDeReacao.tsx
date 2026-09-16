"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CATALOGO_DE_EMOJI } from "@/lib/emojiCatalogo.generated";
import { REACOES_SUGERIDAS, filtrarCatalogo, porGrupo } from "@/lib/reacoes";

/**
 * A bolinha de reagir e o seletor que ela abre (Spec 050, §4.7).
 *
 * O gesto e o do WhatsApp, pedido dela em 15/09: a bolinha aparece ao passar o
 * mouse pelo comentario, e o clique abre o seletor com 👍 e ❤️ na frente e os
 * outros depois.
 *
 * ⚠️⚠️ A BOLINHA TAMBEM APARECE PELO TECLADO. Quem desenha e o pai, com
 * `group` + `group-hover`/`group-focus-within` -- botao que so existe no hover
 * e inalcançavel por teclado, e o `web/AGENTS.md` §2 exige o caminho. Quando o
 * seletor esta aberto ela fica visivel de qualquer forma.
 *
 * ⚠️ UM GRUPO POR VEZ, e nao a grade inteira: sao 1.914 emojis no catalogo, e
 * desenhar todos sao 1.914 botoes no DOM de CADA comentario aberto. A busca
 * (em portugues, sem acento) e o caminho para o resto.
 */
export default function SeletorDeReacao({
  onEscolher,
  desabilitado,
}: {
  onEscolher: (emoji: string) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [grupoAtivo, setGrupoAtivo] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const grupos = useMemo(() => porGrupo(CATALOGO_DE_EMOJI), []);
  const achados = useMemo(
    () => filtrarCatalogo(CATALOGO_DE_EMOJI, termo),
    [termo],
  );
  const mostrando = termo.trim() ? achados : (grupos[grupoAtivo]?.itens ?? []);

  // Clique fora fecha -- mesmo padrao do EmojiPicker.
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

  function escolher(emoji: string) {
    onEscolher(emoji);
    setAberto(false);
    setTermo("");
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        className={
          aberto
            ? "btn btn-ghost rounded-full px-1.5 text-xs opacity-100"
            : "btn btn-ghost rounded-full px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
        }
        disabled={desabilitado}
        aria-label="Reagir ao comentário"
        aria-expanded={aberto}
        title="Reagir"
        onClick={() => setAberto((v) => !v)}
      >
        <span aria-hidden>🙂+</span>
      </button>

      {aberto && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setAberto(false);
            }
          }}
        >
          {/* Os dois de sempre, maiores -- pedido dela. */}
          <div className="flex items-center gap-1 border-b border-border pb-2">
            {REACOES_SUGERIDAS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="btn btn-ghost px-2 text-xl"
                onClick={() => escolher(emoji)}
                aria-label={`Reagir com ${emoji}`}
              >
                <span aria-hidden>{emoji}</span>
              </button>
            ))}
          </div>

          <input
            className="input mt-2 w-full text-xs"
            placeholder="Buscar emoji… (joia, coração, festa)"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
            aria-label="Buscar emoji"
          />

          {!termo.trim() && (
            <div
              className="mt-2 flex flex-wrap gap-1"
              role="tablist"
              aria-label="Grupos de emoji"
            >
              {grupos.map((g, i) => (
                <button
                  key={g.grupo}
                  type="button"
                  role="tab"
                  aria-selected={i === grupoAtivo}
                  className={
                    i === grupoAtivo
                      ? "rounded border border-accent px-1.5 py-0.5 text-[11px]"
                      : "rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-faint"
                  }
                  onClick={() => setGrupoAtivo(i)}
                >
                  {g.grupo}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
            {mostrando.map((item) => (
              <button
                key={item.emoji}
                type="button"
                className="rounded p-1 text-lg hover:bg-surface-2"
                onClick={() => escolher(item.emoji)}
                title={item.nome}
                aria-label={item.nome}
              >
                <span aria-hidden>{item.emoji}</span>
              </button>
            ))}
            {termo.trim() && mostrando.length === 0 && (
              <p className="col-span-8 py-2 text-center text-xs text-ink-faint">
                Nenhum emoji para “{termo}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
