/** @type {import('next').NextConfig} */

// =====================================================================
// Content-Security-Policy (revisão de segurança, 23/09)
// =====================================================================
// ⚠️ MORA AQUI, E NÃO NO TRAEFIK, de propósito: o Traefik cuida do que é
// infraestrutura (HSTS, nosniff, referrer-policy), e a CSP descreve o que ESTE
// código carrega -- os domínios do GIPHY estão em `lib/giphy.ts`, não no
// compose. No arquivo do app ela viaja com o código, aparece no `git log` junto
// com a mudança que a exigiu, e tem portão (`lib/__tests__/csp.test.ts`).
//
// ⚠️⚠️ `script-src` MANTÉM `'unsafe-inline'`, E ISSO É UMA ESCOLHA CONSCIENTE:
// o Next injeta scripts inline (bootstrap de hidratação) e o `app/layout.tsx`
// tem o script que aplica o tema ANTES da primeira pintura. Tirar o
// `'unsafe-inline'` exige nonce por requisição, o que significa middleware do
// Next e propagação do nonce -- outra entrega, com risco próprio.
//
// O que esta CSP JÁ impede, mesmo com `'unsafe-inline'`:
//   - `connect-src`: um XSS não consegue MANDAR os dados (nem os tokens do
//     localStorage) para um servidor de fora. É a linha que mais importa aqui;
//   - `form-action`: formulário não pode ser reapontado para outro domínio;
//   - `base-uri`: `<base>` injetada não consegue sequestrar caminho relativo;
//   - `object-src`/`frame-src`: nada de plugin ou iframe embutido;
//   - `frame-ancestors`: a versão moderna do `frameDeny` (anti clickjacking).
//
// ⚠️ GIPHY É EXCEÇÃO NECESSÁRIA: o seletor de GIF busca em `api.giphy.com` e
// desenha imagens de `*.giphy.com`. `lib/giphy.ts` já recusa URL de qualquer
// outro domínio ao transformar o token `[gif:…]` em `<img>` -- a CSP é a
// segunda tranca da mesma porta.
const GIPHY_API = "https://api.giphy.com";
const GIPHY_MEDIA = "https://*.giphy.com";

function cspDiretivas(dev) {
  return {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "img-src": ["'self'", "data:", "blob:", GIPHY_MEDIA],
    "font-src": ["'self'", "data:"],
    // Estilo inline é o desenho do projeto inteiro (`style={{…}}` em toda
    // tela); tirar isto seria reescrever a interface, não endurecer a política.
    "style-src": ["'self'", "'unsafe-inline'"],
    // ⚠️ `'unsafe-eval'` SÓ EM DESENVOLVIMENTO: o Fast Refresh precisa, o build
    // de produção não. Sem esta separação, o dev quebra ou a produção afrouxa.
    "script-src": dev
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", "'unsafe-inline'"],
    // Em dev o HMR fala por WebSocket com o próprio servidor.
    "connect-src": dev
      ? ["'self'", GIPHY_API, "ws:", "wss:"]
      : ["'self'", GIPHY_API],
  };
}

export function csp(dev = false) {
  return Object.entries(cspDiretivas(dev))
    .map(([nome, valores]) => `${nome} ${valores.join(" ")}`)
    .join("; ");
}

// Recursos que este produto não usa. Negar é mais barato que auditar depois.
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";

const nextConfig = {
  // Build standalone: gera .next/standalone (server.js + node_modules minimo)
  // para uma imagem Docker enxuta. Sem isto, a imagem precisaria do
  // node_modules inteiro + `next start`.
  output: "standalone",
  // Topologia A (ver docs/adr/0001-topologia-mesmo-host.md):
  // o front sempre fala com a API por caminho RELATIVO (/api/...), mesma
  // origem do browser. Em produção o Traefik roteia /api -> backend ANTES
  // de chegar aqui, então este rewrite nem entra em ação lá.
  //
  // Em DEV (npm run dev), não há Traefik: o Next reescreve /api -> :8000.
  // Resultado: o browser só conversa com localhost:3000 -> CORS nunca aparece,
  // nem agora nem na VPS.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const backend = process.env.API_PROXY_TARGET || "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    const dev = process.env.NODE_ENV === "development";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp(dev) },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
        ],
      },
    ];
  },
};

export default nextConfig;
