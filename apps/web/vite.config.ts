import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve @avs/* workspace packages to their TS source rather than dist/,
// mirroring the repo-root vitest.config.ts so `vite dev`/`vite build` never
// depend on the library packages having been tsc-built first.
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// RELEASE 02 (Security & Production Access Hardening) — apps/api is proxied
// same-origin rather than called cross-origin: the session cookie's
// `SameSite=Strict` (apps/api/src/auth/session.ts) needs every real request
// to be same-site, and this is the dev-time half of that (a shared
// reverse-proxy domain is the production half, docs/03 §11). Only apps/api's
// own real path prefixes are proxied — never a catch-all — so this app's own
// client-side routes (/architecture, /interior) are never shadowed.
const API_PROXY_TARGET = process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:8080';
// BUILD 32B — added '/ready' (apps/api/src/readiness.ts), missing here since
// before this build nothing in dev needed to reach it through this proxy.
const PROXIED_API_PATHS = ['/projects', '/assets', '/auth', '/health', '/metrics', '/ready'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@avs/shared': pkg('shared'),
      '@avs/ui': pkg('ui'),
      '@avs/project-core': pkg('project-core'),
      '@avs/ai-core': pkg('ai-core'),
      '@avs/prompt-engine': pkg('prompt-engine'),
    },
  },
  server: {
    proxy: Object.fromEntries(PROXIED_API_PATHS.map((path) => [path, { target: API_PROXY_TARGET, changeOrigin: true }])),
  },
  build: {
    outDir: 'dist',
    // BUILD 32B (Frontend Production Deployment) — Vite's own default output
    // subdirectory is 'assets', which would collide with apps/api's real
    // `/assets/:id` route (real user-uploaded/generated images) once the
    // built frontend is served same-origin from apps/api
    // (apps/api/src/static-assets.ts) — a request for this app's own JS/CSS
    // bundle would otherwise be routed to the (auth-protected) asset-store
    // handler instead of the static file. Renamed to a name that can never
    // collide with any real apps/api route prefix.
    assetsDir: 'static',
  },
});
