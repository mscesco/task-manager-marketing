/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;
