# =====================================================
# Dockerfile - frontend Next.js 14 (App Router)
# Multi-stage + output:"standalone" (next.config.mjs) -> imagem enxuta.
# Topologia A (ADR 0001): o front fala com a API por caminho RELATIVO
# (/api/...). Em producao quem roteia /api -> backend e o Traefik, ANTES
# de chegar aqui. Por isso nao ha proxy embutido neste runner.
# =====================================================

# ---------- Stage 1: deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
# Instala dependencias com lockfile (build reprodutivel).
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 2: builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Chave GIPHY: NEXT_PUBLIC_* e assada no bundle em BUILD TIME (nao em runtime).
# Chega aqui via build-arg (docker-compose.prod.yml -> args). Se vier vazia, o
# picker de GIF some (GIPHY_ENABLED=false) sem quebrar o build.
ARG NEXT_PUBLIC_GIPHY_KEY
ENV NEXT_PUBLIC_GIPHY_KEY=$NEXT_PUBLIC_GIPHY_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ e opcional no projeto; garante que exista para o COPY do runner.
RUN mkdir -p public && npm run build

# ---------- Stage 3: runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuario nao-root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Saida standalone: server.js + node_modules minimo, estaticos e public.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# O server standalone respeita HOSTNAME/PORT do ambiente.
CMD ["node", "server.js"]
