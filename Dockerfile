# syntax=docker/dockerfile:1
#
# AI Architectural Visualization Studio — apps/api production image
# (BUILD 32, Production Deployment).
#
# This image runs ONLY the API server (apps/api/dist/server.js). The
# frontend (apps/web) is a separate static build
# (`npm run build --workspace=@avs/web` -> apps/web/dist/) meant for a
# static host/CDN — it is not served by this process (apps/api/src/server.ts
# has no static-file route; the frontend's VITE_API_BASE_URL points at this
# API's own separate origin). Build that bundle and deploy it wherever the
# frontend is hosted; this Dockerfile does not touch it beyond building it
# once as part of the monorepo's own `npm run build`.
#
# The only external runtime dependency anywhere in apps/api's own
# dependency tree is `zod` (packages/shared/package.json) plus this repo's
# own @avs/* workspace packages — no native addons — so a slim Alpine base
# is safe. `node:sqlite` (packages/storage-adapters) is a Node.js built-in,
# not an npm package.
#
# NOT build-tested against a real Docker daemon in the environment this was
# authored in (no Docker available there) — the underlying commands
# (`npm run build`, `node apps/api/dist/server.js`, GET /health, GET /ready,
# SIGTERM shutdown) were verified directly outside a container. Verify a
# real `docker build`/`docker run` once before relying on this in production.

FROM node:22-alpine AS builder
WORKDIR /app

# Install all workspace dependencies (dev+prod — needed to build) before
# copying full source, so this layer only re-runs when a package.json or
# the lockfile actually changes.
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/project-core/package.json packages/project-core/package.json
COPY packages/ai-core/package.json packages/ai-core/package.json
COPY packages/prompt-engine/package.json packages/prompt-engine/package.json
COPY packages/model-adapters/package.json packages/model-adapters/package.json
COPY packages/storage-adapters/package.json packages/storage-adapters/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Simplest correct option for an npm-workspaces monorepo: copy the builder
# stage's already-installed, already-built /app wholesale, rather than
# hand-pruning workspace-symlinked node_modules (error-prone without a
# workspace-aware prune tool). The image is a little larger than a
# hand-pruned one would be; nothing here is a correctness risk.
COPY --from=builder /app /app

EXPOSE 8080

# Liveness only — GET /health is unconditional "process alive." Real
# dependency readiness is GET /ready (apps/api/src/readiness.ts); neither
# route ever calls a live AI provider or mutates the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Config (DATABASE_URL, ASSET_STORE_URL, REGISTRATION_SECRET,
# ASSET_URL_SIGNING_SECRET, provider keys, etc.) is injected entirely via
# real environment variables at run time — see .env.example and
# docs/BUILD_21_OPERATOR_RUNBOOK.md. Nothing secret is baked into this image.
CMD ["node", "apps/api/dist/server.js"]
