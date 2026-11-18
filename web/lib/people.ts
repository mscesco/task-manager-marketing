// Apresentação de pessoas: nome curto do selo, iniciais e cor estável do
// avatar. O backend guarda o nome num campo só (users.name).
//
// Nome curto: primeiro token + inicial do último + "." (sem tratar
// partícula). Ex.: "Camila Cesco" -> "Camila C."; "Maria da Silva" -> "Maria S.".

function _tokens(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

export function nomeCurto(name: string): string {
  const p = _tokens(name);
  if (p.length === 0) return "";
  if (p.length === 1) return p[0];
  const ultimo = p[p.length - 1];
  return `${p[0]} ${ultimo[0].toUpperCase()}.`;
}

export function iniciais(name: string): string {
  const p = _tokens(name);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

// Cor estavel derivada do id (mesma pessoa -> mesma cor sempre). Todas com
// contraste AA (4.5:1) para as iniciais brancas; o guardiao e `people.test.ts`.
export const AVATAR_CORES = [
  "#0369a1", "#4f46e5", "#b45309", "#15803d",
  "#dc2626", "#9333ea", "#0f766e", "#be185d",
];
export const AVATAR_SEM_ID = "#737373";

export function corAvatar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}
