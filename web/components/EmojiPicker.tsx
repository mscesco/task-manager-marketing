"use client";
import { useState } from "react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";

// Seletor de emoji simples: um botão que abre uma grade curada. Ao escolher,
// chama onPick(emoji); quem usa decide onde inserir.

// Só emojis de um codepoint (ZWJ renderiza torto em alguns sistemas).
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
  // `AnchoredPanel`: uma caixa com rolagem em volta recortaria um `absolute`.
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
