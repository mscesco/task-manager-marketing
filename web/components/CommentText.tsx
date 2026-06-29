import React from "react";

// Renderiza o conteudo de um comentario transformando tokens de mencao
// @[Nome](uuid) em "@Nome" destacado. O resto vira texto normal -- o pai
// aplica white-space: pre-wrap, entao quebras de linha sao preservadas.
// Comentario apagado (tombstone) nao e parseado: mostra o texto puro.

export default function CommentText({
  content,
  deleted,
}: {
  content: string;
  deleted?: boolean;
}) {
  if (deleted) return <>{content}</>;

  // Regex literal fresca a cada render (com flag g p/ matchAll) -- sem estado
  // compartilhado de lastIndex. Mesma forma do backend (extract_mentions).
  const re =
    /@\[([^\]]+)\]\([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\)/g;

  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  for (const m of content.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > ultimo) partes.push(content.slice(ultimo, idx));
    partes.push(
      <span
        key={`m${i++}`}
        style={{
          color: "var(--accent)",
          background: "var(--accent-soft)",
          borderRadius: 4,
          padding: "0 3px",
          fontWeight: 600,
        }}
      >
        @{m[1]}
      </span>
    );
    ultimo = idx + m[0].length;
  }
  if (ultimo < content.length) partes.push(content.slice(ultimo));

  return <>{partes}</>;
}
