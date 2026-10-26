# syntax=docker/dockerfile:1

# ---- build: install deps + build the web SPA ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/packager/package.json packages/packager/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build -w @forge/web

# ---- run: the server serves both the API and the built SPA (same origin) ----
FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    FORGE_DB=/data/forge.db
# app source + installed deps (server runs via tsx; workspace symlinks under packages/ resolve)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
RUN mkdir -p /data
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "--import", "tsx", "packages/server/src/server.ts"]
