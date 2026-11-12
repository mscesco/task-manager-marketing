/** @type {import('next').NextConfig} */

// Content-Security-Policy. Mora aqui, e não no Traefik, porque descreve o que
// este código carrega; o portão é `lib/__tests__/csp.test.ts`.
// `script-src` mantém `'unsafe-inline'`: o Next injeta scripts inline e o
// `app/layout.tsx` tem o script do tema; tirá-lo exigiria nonce por requisição.
// GIPHY é exceção necessária: o seletor de GIF busca em `api.giphy.com` e desenha
// imagens de `*.giphy.com` (`lib/giphy.ts` já recusa URL de outro domínio).
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
    // Estilo inline (`style={{…}}`) está em toda tela.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `'unsafe-eval'` só em desenvolvimento: o Fast Refresh precisa, a produção não.
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
  // Gera .next/standalone (server.js + node_modules mínimo) para a imagem Docker.
  output: "standalone",
  // O front fala com a API por caminho relativo (/api/...). Em produção o
  // Traefik roteia /api antes de chegar aqui; em dev o Next reescreve para :8000.
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
