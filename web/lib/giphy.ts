// lib/giphy.ts
// Cliente GIPHY para GIF em comentarios.
//
// A GIPHY EXIGE que as chamadas sejam feitas direto do client (sem proxy),
// entao a key vive no browser via NEXT_PUBLIC_GIPHY_KEY -- semi-publica por
// design (key beta). rating=g pra manter o conteudo apropriado ao ambiente de
// trabalho. Atribuicao "Powered by GIPHY" e obrigatoria onde a API aparece
// (fica no picker, Fatia 2).

const GIPHY_KEY = process.env.NEXT_PUBLIC_GIPHY_KEY || "";

// Se a key nao estiver configurada, o picker some (sem quebrar nada).
export const GIPHY_ENABLED = !!GIPHY_KEY;

export type Gif = {
  id: string;
  full: string; // rendition pra exibir no comentario (fixed_height)
  preview: string; // rendition leve pro grid do picker
  title: string;
  width: number;
  height: number;
};

// TRAVA DE SEGURANCA: so aceitamos/renderizamos URLs do dominio da GIPHY. Um
// token de GIF com URL arbitraria NUNCA vira <img> (evita pixel de rastreio /
// URL maliciosa injetada no texto do comentario).
export function isGiphyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "giphy.com" || u.hostname.endsWith(".giphy.com"))
    );
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGif(g: any): Gif {
  const img = g.images || {};
  const fh = img.fixed_height || {};
  const small = img.fixed_height_small || img.preview_gif || fh;
  return {
    id: String(g.id ?? ""),
    full: String(fh.url || ""),
    preview: String(small.url || fh.url || ""),
    title: String(g.title || "GIF"),
    width: Number(fh.width) || 0,
    height: Number(fh.height) || 0,
  };
}

async function fetchGifs(
  path: "search" | "trending",
  params: Record<string, string>
): Promise<Gif[]> {
  if (!GIPHY_KEY) return [];
  const q = new URLSearchParams({ api_key: GIPHY_KEY, rating: "g", ...params });
  const r = await fetch(`https://api.giphy.com/v1/gifs/${path}?${q.toString()}`);
  if (!r.ok) throw new Error(`giphy ${r.status}`);
  const data = await r.json();
  const lista: Gif[] = Array.isArray(data?.data) ? data.data.map(mapGif) : [];
  // Descarta itens sem rendition ou fora do dominio GIPHY.
  return lista.filter((g) => g.full && isGiphyUrl(g.full));
}

export function searchGifs(query: string, limit = 24): Promise<Gif[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return fetchGifs("search", { q, limit: String(limit), lang: "pt" });
}

export function trendingGifs(limit = 24): Promise<Gif[]> {
  return fetchGifs("trending", { limit: String(limit) });
}
