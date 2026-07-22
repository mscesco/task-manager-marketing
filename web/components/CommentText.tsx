import React from "react";
import { isGiphyUrl } from "@/lib/giphy";
import { linkify } from "@/lib/linkify";

// Renderiza o conteudo de um comentario transformando tokens em UI:
//  - mencao  @[Nome](uuid)  -> "@Nome" destacado
//  - gif     [gif:URL]      -> <img> (SO se a URL for do dominio GIPHY)
// O resto vira texto normal COM URL clicavel (linkify) -- o pai aplica
// white-space: pre-wrap, entao quebras de linha sao preservadas.
// Comentario apagado (tombstone) nao e parseado: mostra o texto puro.
//
// Ordem importa: o token e extraido PRIMEIRO e o linkify roda so nos trechos
// que sobram. Assim a URL de dentro de [gif:...] nunca chega no linkify e o
// token nao corre risco de ser comido pela metade.

// Regex combinada (flag g p/ matchAll), literal fresca a cada render -- sem
// estado compartilhado de lastIndex. Alternancia:
//   grupo 1 = nome da mencao, grupo 2 = uuid  |  grupo 3 = url do gif
const RE =
  /@\[([^\]]+)\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)|\[gif:(https:\/\/[^\]\s]+)\]/g;

export default function CommentText({
  content,
  deleted,
}: {
  content: string;
  deleted?: boolean;
}) {
  if (deleted) return <>{content}</>;

  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let i = 0;

  for (const m of content.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > ultimo) partes.push(...linkify(content.slice(ultimo, idx), `l${i++}-`));

    if (m[1] !== undefined) {
      // Mencao.
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
    } else if (m[3] !== undefined && isGiphyUrl(m[3])) {
      // GIF valido (dominio GIPHY). Renderiza a imagem.
      partes.push(
        <img
          key={`g${i++}`}
          src={m[3]}
          alt="GIF"
          loading="lazy"
          style={{
            display: "block",
            marginTop: 4,
            maxWidth: 240,
            maxHeight: 240,
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        />
      );
    } else {
      // Token de gif com URL fora do dominio GIPHY: NAO vira imagem.
      // Cai como texto puro (trava XSS). Tambem NAO passa pelo linkify --
      // manter o token literal preserva o comportamento atual e nao promove
      // a link uma URL que ja foi reprovada na validacao de dominio.
      partes.push(m[0]);
    }

    ultimo = idx + m[0].length;
  }
  if (ultimo < content.length) partes.push(...linkify(content.slice(ultimo), `l${i++}-`));

  return <>{partes}</>;
}
