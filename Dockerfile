# syntax=docker/dockerfile:1
# Spendo — single container: API + cron workers + admin SPA (web/dist)

FROM node:20-bookworm-slim AS deps
WORKDIR /app
# argon2 (and similar) need compile tooling on slim images
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci && npm ci --prefix web

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY web ./web
# Do not copy config/workspaces.json — connections live in DB after seed
RUN npm run build \
  && npm run web:build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 spendo \
  && useradd --system --uid 1001 --gid spendo --home-dir /app --shell /usr/sbin/nologin spendo

COPY --from=build --chown=spendo:spendo /app/package.json ./
COPY --from=build --chown=spendo:spendo /app/node_modules ./node_modules
COPY --from=build --chown=spendo:spendo /app/dist ./dist
COPY --from=build --chown=spendo:spendo /app/web/dist ./web/dist

USER spendo
EXPOSE 8080
# App Platform injects PORT; default matches common DO http_port
ENV PORT=8080

# Migrate then start API + in-process sync/webhook cron
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
