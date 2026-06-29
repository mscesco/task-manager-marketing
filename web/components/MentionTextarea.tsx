"use client";
import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";

// Textarea com autocomplete de @mencao. Encapsula a deteccao do "@fragmento"
// em digitacao e a insercao do token @[Nome](id) -- o mesmo formato que o
// backend (extract_mentions) e o CommentText (render) entendem.
//
// forwardRef: expoe o <textarea> interno pro pai (o EmojiPicker insere emoji
// na posicao do cursor usando essa ref).

type MembersMap = Map<string, { name: string }>;

// Acha o "@fragmento" logo antes do cursor (sem espaco). null se nao houver.
function mencaoAtiva(
  texto: string,
  caret: number
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = texto[i];
    if (ch === "@") {
      const prev = i > 0 ? texto[i - 1] : " ";
      // @ so vale no inicio ou apos espaco/quebra (evita disparar em e-mail)
      if (i === 0 || /\s/.test(prev)) {
        return { start: i, query: texto.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null; // mencao em digitacao nao tem espaco
    i--;
  }
  return null;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  members: MembersMap;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  autoFocus?: boolean;
  maxLength?: number;
  style?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
};

const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function MentionTextarea(
    {
      value,
      onChange,
      members,
      placeholder,
      disabled,
      rows,
      autoFocus,
      maxLength,
      style,
      wrapperStyle,
    },
    ref
  ) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    // Expoe o textarea interno pra ref do pai (usada pelo EmojiPicker).
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [hi, setHi] = useState(0);

    const lista = open
      ? Array.from(members.entries())
          .map(([id, m]) => ({ id, name: m.name }))
          .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6)
      : [];

    function recalc(v: string, caret: number) {
      const am = mencaoAtiva(v, caret);
      if (am) {
        setQuery(am.query);
        setHi(0);
        setOpen(true);
      } else {
        setOpen(false);
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const v = e.target.value;
      onChange(v);
      recalc(v, e.target.selectionStart ?? v.length);
    }

    function escolher(m: { id: string; name: string }) {
      const el = innerRef.current;
      const caret = el?.selectionStart ?? value.length;
      const am = mencaoAtiva(value, caret);
      if (!am) {
        setOpen(false);
        return;
      }
      const antes = value.slice(0, am.start);
      const depois = value.slice(caret);
      const token = `@[${m.name}](${m.id}) `;
      onChange(antes + token + depois);
      const pos = (antes + token).length;
      setOpen(false);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (!open || lista.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHi((h) => (h + 1) % lista.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHi((h) => (h - 1 + lista.length) % lista.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        escolher(lista[hi]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }

    return (
      <div style={{ position: "relative", width: "100%", ...wrapperStyle }}>
        <textarea
          ref={innerRef}
          className="input"
          rows={rows}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          maxLength={maxLength}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={(e) =>
            recalc(
              value,
              (e.target as HTMLTextAreaElement).selectionStart ?? value.length
            )
          }
          style={{ width: "100%", ...style }}
        />
        {open && lista.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 4px)",
              left: 0,
              zIndex: 30,
              minWidth: 200,
              maxHeight: 200,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "var(--shadow)",
              padding: 4,
            }}
          >
            {lista.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                // onMouseDown + preventDefault: nao perder a selecao do
                // textarea antes de inserir (se fosse onClick, o blur zeraria
                // o cursor e a insercao iria pro lugar errado).
                onMouseDown={(e) => {
                  e.preventDefault();
                  escolher(m);
                }}
                onMouseEnter={() => setHi(idx)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 8px",
                  fontSize: 13,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: idx === hi ? "var(--accent-soft)" : "transparent",
                  color: "var(--text)",
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

export default MentionTextarea;
