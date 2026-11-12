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

// Cor estavel derivada do id (mesma pessoa -> mesma cor sempre). Paleta com
// contraste suficiente para texto branco por cima.
const AVATAR_CORES = [
  "#0ea5e9", "#6366f1", "#f59e0b", "#22c55e",
  "#ef4444", "#a855f7", "#14b8a6", "#ec4899",
];

export function corAvatar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}
