"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SmilePlus } from "lucide-react";

import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { BOTAO_DA_CAPSULA } from "@/components/CapsulaDeAcoes";
import { CATALOGO_DE_EMOJI } from "@/lib/emojiCatalogo.generated";
import { REACOES_SUGERIDAS, filtrarCatalogo, porGrupo } from "@/lib/reacoes";

/** Largura do painel -- informada ao calculo de borda do `AnchoredPanel`. */
const LARGURA = 288;
/** O conteudo, descontado o `padding: 6` de cada lado do painel. */
const LARGURA_DO_CONTEUDO = "w-[276px]";

/** Os grupos do catálogo, calculados uma vez por carga da página (há um seletor por comentário). */
const GRUPOS = porGrupo(CATALOGO_DE_EMOJI);

/**
 * O botão de reagir e o seletor que ele abre, com 👍 e ❤️ na frente.
 * Painel no `AnchoredPanel` porque o detalhe rola por dentro e cortaria um `absolute`.
 * A grade entra dois quadros depois da caixa, num espaço de altura fixa: montá-la no
 * clique atrasava o primeiro quadro da animação. Ao fechar, o conteúdo sai antes da caixa.
 * Um grupo por vez (o catálogo tem ~1.900 emojis); a busca é o caminho para o resto.
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
  const [gradeLiberada, setGradeLiberada] = useState(false);
  // O app nao tem `MotionConfig`: a preferencia do sistema e respeitada aqui.
  const menosMovimento = useReducedMotion();

  // A busca é limpa ao abrir: cada abertura começa do grupo.
  const fechar = useCallback(() => setAberto(false), []);
  const abrir = useCallback(() => {
    setTermo("");
    setGradeLiberada(false);
    setAberto(true);
  }, []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    fechar,
    // O botão fica no canto direito: o painel abre embaixo e para a esquerda.
    { larguraPainel: LARGURA, alinhar: "direita" },
  );

  // Dois quadros: o primeiro `requestAnimationFrame` roda antes da pintura da caixa.
  useEffect(() => {
    if (!aberto) return;
    let segundo = 0;
    const primeiro = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => setGradeLiberada(true));
    });
    return () => {
      cancelAnimationFrame(primeiro);
      cancelAnimationFrame(segundo);
    };
  }, [aberto]);

  const achados = useMemo(
    () => filtrarCatalogo(CATALOGO_DE_EMOJI, termo),
    [termo],
  );
  const buscando = termo.trim() !== "";
  const mostrando = buscando ? achados : (GRUPOS[grupoAtivo]?.itens ?? []);

  function escolher(emoji: string) {
    onEscolher(emoji);
    fechar();
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={BOTAO_DA_CAPSULA}
        disabled={desabilitado}
        aria-label="Reagir ao comentário"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title="Reagir"
        onClick={() => (aberto ? fechar() : abrir())}
      >
        <SmilePlus size={15} strokeWidth={2} aria-hidden />
      </button>

      {/* `AnimatePresence` permite a saída animada. */}
      <AnimatePresence>
        {aberto && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            role="dialog"
            aria-label="Escolher reação"
            minWidth={LARGURA}
          >
            {/* Largura fixa: o `AnchoredPanel` só define a mínima. `initial={false}`: o conteúdo entra com a caixa. */}
            <motion.div
              className={LARGURA_DO_CONTEUDO}
              initial={false}
              exit={{
                opacity: 0,
                transition: { duration: menosMovimento ? 0 : 0.06, ease: "easeOut" },
              }}
            >
              <div className="flex items-center gap-1 px-1 pb-2">
                {REACOES_SUGERIDAS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-xl transition-colors hover:bg-surface-2"
                    onClick={() => escolher(emoji)}
                    aria-label={`Reagir com ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="border-t border-border px-1 pt-2">
                <input
                  className="input w-full text-xs"
                  placeholder="Buscar emoji… (joia, coração, festa)"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  autoFocus
                  aria-label="Buscar emoji"
                />
              </div>

              {/* Abas com o primeiro emoji de cada grupo (vindo do catálogo); o nome vai no rótulo e no título. */}
              {!buscando && (
                <div
                  className="mt-2 flex items-center justify-between px-1"
                  role="tablist"
                  aria-label="Grupos de emoji"
                >
                  {GRUPOS.map((g, i) => (
                    <button
                      key={g.grupo}
                      type="button"
                      role="tab"
                      aria-selected={i === grupoAtivo}
                      aria-label={g.grupo}
                      title={g.grupo}
                      className={
                        i === grupoAtivo
                          ? "flex h-[26px] w-[26px] items-center justify-center rounded-md bg-accent-soft text-base"
                          : "flex h-[26px] w-[26px] items-center justify-center rounded-md text-base opacity-60 transition-opacity hover:bg-surface-2 hover:opacity-100"
                      }
                      onClick={() => setGrupoAtivo(i)}
                    >
                      {g.itens[0]?.emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Altura fixa, e não máxima: a grade chega depois e o painel não pode crescer. */}
              <div
                className="mt-1 grid h-40 grid-cols-8 content-start gap-0.5 overflow-y-auto px-1"
                role="group"
                aria-label="Emojis"
              >
                {gradeLiberada &&
                  mostrando.map((item) => (
                    <button
                      key={item.emoji}
                      type="button"
                      className="flex aspect-square items-center justify-center rounded-md text-lg transition-colors hover:bg-surface-2"
                      onClick={() => escolher(item.emoji)}
                      title={item.nome}
                      aria-label={item.nome}
                    >
                      {item.emoji}
                    </button>
                  ))}
                {gradeLiberada && buscando && mostrando.length === 0 && (
                  <p className="col-span-8 py-3 text-center text-xs text-ink-faint">
                    Nenhum emoji para “{termo}”.
                  </p>
                )}
              </div>
            </motion.div>
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </>
  );
}
