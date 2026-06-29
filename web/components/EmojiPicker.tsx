"use client";
import { useEffect, useRef, useState } from "react";

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
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        aria-label="Inserir emoji"
        title="Emoji"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: "4px 8px", fontSize: 15, lineHeight: 1 }}
      >
        😀
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            width: 260,
            maxHeight: 220,
            overflowY: "auto",
            padding: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 2,
          }}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              style={{
                fontSize: 18,
                lineHeight: 1,
                padding: "4px 0",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
              onMouseEnter={(ev) => {
                ev.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.background = "transparent";
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
