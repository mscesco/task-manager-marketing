"use client";
import { useEffect, useRef, useState } from "react";
import { searchGifs, trendingGifs, GIPHY_ENABLED, type Gif } from "@/lib/giphy";

// Seletor de GIF (GIPHY). Mesmo padrao do EmojiPicker: um botao que abre um
// popover; ao escolher, chama onPick(url) e quem usa insere o token [gif:url]
// na posicao do cursor. Se a key da GIPHY nao estiver configurada, o botao
// nem aparece (GIPHY_ENABLED=false).
//
// A GIPHY exige atribuicao "Powered by GIPHY" onde a API aparece -> rodape do
// painel. Busca com debounce (nao queimar o rate limit da key beta: 100/h).

export default function GifPicker({
  onPick,
  disabled,
}: {
  onPick: (url: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora.
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

  // Ao abrir: trending imediato. Ao digitar: busca com debounce de 400ms.
  // Vazio -> volta pro trending. Cancela em voo se query muda ou fecha.
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    const q = query.trim();
    setErro(null);
    const t = setTimeout(
      async () => {
        setLoading(true);
        try {
          const res = q ? await searchGifs(q) : await trendingGifs();
          if (!cancelado) setGifs(res);
        } catch {
          if (!cancelado) {
            setGifs([]);
            setErro("Nao consegui buscar GIFs agora. Tente de novo.");
          }
        } finally {
          if (!cancelado) setLoading(false);
        }
      },
      q ? 400 : 0
    );
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [query, open]);

  function fechar() {
    setOpen(false);
    setQuery("");
    setGifs([]);
    setErro(null);
  }

  if (!GIPHY_ENABLED) return null;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        aria-label="Inserir GIF"
        title="GIF"
        onClick={() => (open ? fechar() : setOpen(true))}
        style={{ padding: "4px 8px", fontSize: 12, fontWeight: 700, lineHeight: 1 }}
      >
        GIF
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            width: 320,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar GIF…"
            style={{
              width: "100%",
              fontSize: 13,
              padding: "7px 10px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
            }}
          />

          <div
            style={{
              maxHeight: 260,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 6,
              minHeight: 60,
            }}
          >
            {loading && (
              <div className="muted" style={{ gridColumn: "1 / -1", fontSize: 12, padding: 8 }}>
                Carregando…
              </div>
            )}
            {!loading && erro && (
              <div style={{ gridColumn: "1 / -1", fontSize: 12, padding: 8, color: "var(--danger, #dc2626)" }}>
                {erro}
              </div>
            )}
            {!loading && !erro && gifs.length === 0 && (
              <div className="muted" style={{ gridColumn: "1 / -1", fontSize: 12, padding: 8 }}>
                {query.trim() ? "Nenhum GIF encontrado." : "Sem GIFs pra mostrar."}
              </div>
            )}
            {!loading &&
              !erro &&
              gifs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onPick(g.full);
                    fechar();
                  }}
                  title={g.title}
                  style={{
                    padding: 0,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "var(--surface-2)",
                    aspectRatio: "1 / 1",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={g.preview}
                    alt={g.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
          </div>

          <div
            className="muted"
            style={{ fontSize: 10, textAlign: "right", letterSpacing: 0.2 }}
          >
            Powered by GIPHY
          </div>
        </div>
      )}
    </div>
  );
}
