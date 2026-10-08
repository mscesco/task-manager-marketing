"use client";
import { useState } from "react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";

// Seletor de emoji simples (sem dependencia externa): um botao que abre
// uma grade de emojis curados. Ao escolher, chama onPick(emoji) -- quem usa
// decide onde inserir (no TaskDetail, na posicao do cursor do textarea).
// Emoji ja e texto UTF-8: o backend armazena e renderiza sem mudanca nenhuma;
// isto e so a conveniencia de inserir pela UI.

// Conjunto curado, single-codepoint/bem suportados (evita ZWJ que renderiza
// torto em alguns sistemas). O suficiente pra "ter a opcao".
const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","🙂","🙃","😉",
  "😍","🥰","😘","😋","😎","🤩","🥳","😏","😴","🤔","😐","🙄",
  "😬","😮","😯","😲","😳","🥺","😢","😭","😤","😠","😡","🤯",
  "😱","😨","😥","😓","🤗","🤭","🤫","🤥","😶","😇","🙈","🤝",
  "👍","👎","👏","🙌","👌","✌️","🤞","👋","🤙","💪","🙏","👀",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","💯","🔥","✨",
  "⭐","🎉","🎊","🚀","✅","❌","⚠️","💩","🎯","💡","📌","⏰",
];

export default function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // ⚠️ `AnchoredPanel` (revisao de 07/10): era `position: absolute` dentro do
  // fluxo, e uma caixa com rolagem em volta o recortava. O painel fixo vira
  // para cima sozinho quando falta espaco embaixo, e fecha ao clicar fora.
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    open,
    () => setOpen(false),
    { larguraPainel: 260 },
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        aria-label="Inserir emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Emoji"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: "4px 8px", fontSize: 15, lineHeight: 1 }}
      >
        😀
      </button>
      {open && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label="Emojis" minWidth={260}>
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className="cursor-pointer rounded-md border-0 bg-transparent py-1 text-[18px] leading-none hover:bg-surface-2"
                onClick={() => {
                  onPick(e);
                  setOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}
