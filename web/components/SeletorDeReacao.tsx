"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SmilePlus } from "lucide-react";

import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";
import { BOTAO_DA_CAPSULA } from "@/components/CapsulaDeAcoes";
import { CATALOGO_DE_EMOJI } from "@/lib/emojiCatalogo.generated";
import { REACOES_SUGERIDAS, filtrarCatalogo, porGrupo } from "@/lib/reacoes";

/** Largura do painel -- informada ao calculo de borda do `AnchoredPanel`. */
const LARGURA = 288;
/** O conteudo, descontado o `padding: 6` de cada lado do painel. */
const LARGURA_DO_CONTEUDO = "w-[276px]";

/**
 * O botao de reagir e o seletor que ele abre (Spec 050, §4.7).
 *
 * O gesto e o do WhatsApp, pedido dela em 15/09: o botao aparece ao passar o
 * mouse pelo comentario (quem o revela e a `CapsulaDeAcoes`), e o clique abre
 * o seletor com 👍 e ❤️ na frente e os outros depois.
 *
 * ⚠️⚠️ O PAINEL E O `AnchoredPanel`, E NAO UM `absolute`. A primeira versao era
 * `absolute`, e o detalhe da tarefa rola por dentro: o painel nascia cortado
 * pela borda da gaveta -- o MESMO defeito que o `PillSelect` ja tinha tido.
 * Com ele vem a animacao dos seletores da organizacao, e as SECOES entram em
 * cascata com o mesmo `PANEL_ITEM` das linhas de la.
 *
 * ⚠️ UM GRUPO POR VEZ, e nao a grade inteira: sao 1.914 emojis no catalogo, e
 * desenhar todos sao 1.914 botoes no DOM. A busca (em portugues, sem acento) e
 * o caminho para o resto.
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

  // A busca e limpa ao ABRIR: cada abertura comeca do grupo, sem o termo da
  // vez anterior.
  // ⚠️ Nao e por causa da animacao de saida, e isto foi medido: o
  // `AnimatePresence` congela o painel que sai com o ultimo conteudo desenhado,
  // entao limpar no fechar tambem nao trocaria nada na tela. A sabotagem que
  // pos a limpeza de volta no fechar nao derrubou teste nenhum (16/09).
  const fechar = useCallback(() => setAberto(false), []);
  const abrir = useCallback(() => {
    setTermo("");
    setAberto(true);
  }, []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    fechar,
    // O botao fica no canto DIREITO da linha: o painel abre embaixo e para a
    // esquerda, dentro do detalhe da tarefa -- onde ela desenhou em 16/09.
    { larguraPainel: LARGURA, alinhar: "direita" },
  );

  const grupos = useMemo(() => porGrupo(CATALOGO_DE_EMOJI), []);
  const achados = useMemo(
    () => filtrarCatalogo(CATALOGO_DE_EMOJI, termo),
    [termo],
  );
  const buscando = termo.trim() !== "";
  const mostrando = buscando ? achados : (grupos[grupoAtivo]?.itens ?? []);

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

      {/* ⚠️ `AnimatePresence` e o que permite a SAIDA animada: sem ele o React
          desmonta o painel na hora e o `exit` nunca roda. */}
      <AnimatePresence>
        {aberto && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            role="dialog"
            aria-label="Escolher reação"
            minWidth={LARGURA}
          >
            {/* ⚠️⚠️ LARGURA FIXA NO CONTEUDO. O `AnchoredPanel` so define
                largura MINIMA, e o conteudo esticava o painel ate a borda da
                janela -- a captura de 16/09 ("o seletor ficou ainda pior"). */}
            <div className={LARGURA_DO_CONTEUDO}>
              {/* Os dois de sempre, maiores -- pedido dela. */}
              <motion.div
                variants={PANEL_ITEM}
                className="flex items-center gap-1 px-1 pb-2"
              >
                {REACOES_SUGERIDAS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-xl transition-colors hover:bg-surface-2"
                    onClick={() => escolher(emoji)}
                    aria-label={`Reagir com ${emoji}`}
                  >
                    <span aria-hidden>{emoji}</span>
                  </button>
                ))}
              </motion.div>

              <motion.div
                variants={PANEL_ITEM}
                className="border-t border-border px-1 pt-2"
              >
                <input
                  className="input w-full text-xs"
                  placeholder="Buscar emoji… (joia, coração, festa)"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  autoFocus
                  aria-label="Buscar emoji"
                />
              </motion.div>

              {/* ⚠️⚠️ AS ABAS SAO O PRIMEIRO EMOJI DE CADA GRUPO, e nao o nome
                  escrito. Com o nome, dez abas nao cabiam: a linha ganhava
                  barra de rolagem lateral e o conteudo passava da altura
                  maxima do painel, que rolava inteiro (a captura de 16/09
                  mostra as duas barras). O nome continua no rotulo e no
                  titulo -- para o leitor de tela e para o mouse em cima.
                  ⚠️ O emoji vem do CATALOGO, e nao de uma lista escrita aqui:
                  um grupo novo na fonte ganha aba sozinho. */}
              {!buscando && (
                <motion.div
                  variants={PANEL_ITEM}
                  className="mt-2 flex items-center justify-between px-1"
                  role="tablist"
                  aria-label="Grupos de emoji"
                >
                  {grupos.map((g, i) => (
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
                      <span aria-hidden>{g.itens[0]?.emoji}</span>
                    </button>
                  ))}
                </motion.div>
              )}

              <motion.div
                variants={PANEL_ITEM}
                className="mt-1 grid max-h-40 grid-cols-8 gap-0.5 overflow-y-auto px-1"
                role="group"
                aria-label="Emojis"
              >
                {mostrando.map((item) => (
                  <button
                    key={item.emoji}
                    type="button"
                    className="flex aspect-square items-center justify-center rounded-md text-lg transition-colors hover:bg-surface-2"
                    onClick={() => escolher(item.emoji)}
                    title={item.nome}
                    aria-label={item.nome}
                  >
                    <span aria-hidden>{item.emoji}</span>
                  </button>
                ))}
                {buscando && mostrando.length === 0 && (
                  <p className="col-span-8 py-3 text-center text-xs text-ink-faint">
                    Nenhum emoji para “{termo}”.
                  </p>
                )}
              </motion.div>
            </div>
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </>
  );
}
