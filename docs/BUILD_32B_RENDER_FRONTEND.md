# BUILD 32B — Render Frontend Deployment & API Connection (corrected architecture)

Supersedes the two-service plan in `docs/BUILD_32A_RENDER_DEPLOYMENT.md` — read this
one, not that one, for how to actually get the frontend live. That doc's own architecture
section is left as a historical record of what was tried, not a live instruction set.

## Why one service, not two

BUILD 32A's plan (a separate Render Static Site for the frontend) doesn't work with this
app's real authentication design. The session cookie is `SameSite=Strict`
(`apps/api/src/auth/session.ts`) — safe and correct *only* because the app's documented
architecture puts the frontend and API behind the same origin (see that file's own
comment, and `apps/web/vite.config.ts`'s dev-time proxy, which does the exact same thing
locally). Render deliberately lists `onrender.com` in the [Public Suffix
List](https://publicsuffix.org/) (the same reason `github.io`/`vercel.app` are listed) so
that different customers' `*.onrender.com` subdomains can't read each other's cookies —
which also means **your own** two subdomains (a static site + a web service) are
different "sites" to the browser. A `SameSite=Strict` cookie set by one is never sent to
the other. Two separate free services would mean login, upload, generation — anything
requiring a session — silently fails once deployed, even though everything works locally.

The fix (BUILD 32B): `apps/api` now serves the built frontend itself, same-origin, when
given a `WEB_DIST_DIR` env var (`apps/api/src/static-assets.ts`). This isn't a new
architecture — it's the production realization of the exact split
`apps/web/vite.config.ts` already does for local dev (API paths handled directly,
everything else the frontend). One free Render Web Service, genuinely $0/month, no
change to the free tier.

## Updating your existing live service

Your backend is already live at `https://ai-architectural-visualization-studio.onrender.com`.
**Do not create a second service** — update this one's settings in the Render dashboard:

1. **Build Command** — change to (if it isn't already) `npm ci && npm run build`. This
   already builds both `apps/api` (to JS) and `apps/web` (to `apps/web/dist`) — no change
   needed here if you followed `docs/BUILD_21_OPERATOR_RUNBOOK.md`'s or BUILD 32A's build
   command, since it was already the full monorepo build.
2. **Start Command** — unchanged: `node apps/api/dist/server.js`.
3. **Environment → Add Environment Variable**:
   - `WEB_DIST_DIR` = `apps/web/dist`

   That's the only new variable required for the frontend to appear. Everything else
   you've already configured (or left unset, per BUILD 32/32A) is unaffected.
4. Save — Render redeploys automatically. Watch the deploy log for `Serving frontend
   same-origin from apps/web/dist` in the startup output, confirming it took effect.

If you're instead trying **New → Blueprint** with the repo's `render.yaml`: it's already
updated to this single-service shape (service name `ai-architectural-visualization-studio`,
matching your live service) — using it against a service that already exists updates that
service's config rather than creating a duplicate, per Render's own Blueprint behavior.

## What you should NOT do

- Don't create a separate Render Static Site for `apps/web` — see above, it breaks auth.
- Don't set `VITE_API_BASE_URL` for this deployment — leave it unset. The frontend's
  default (`apps/web/src/api/client.ts`) is a relative, same-origin base URL, which is
  now exactly correct once `WEB_DIST_DIR` makes the deployment same-origin.
- Don't set `ALLOWED_ORIGINS` to anything for this specific frontend — same-origin
  requests don't need CORS headers at all. Only set it if some *other*, genuinely
  different origin also needs to call this API directly.

## Verifying it after redeploy

```bash
curl -s https://ai-architectural-visualization-studio.onrender.com/health
# {"status":"ok"}

curl -s https://ai-architectural-visualization-studio.onrender.com/ready
# "status":"ready" (persistence.*.persistent reflects whether you've set
# DATABASE_URL/ASSET_STORE_URL — see the ephemeral-storage note below either way)
```

Then in a browser:

1. Open `https://ai-architectural-visualization-studio.onrender.com/` — the app loads.
2. Open `https://ai-architectural-visualization-studio.onrender.com/architecture` directly
   (or refresh on it) — the SPA shell still loads (this is exactly the client-side-routing
   fallback `static-assets.ts` provides; a plain static host without that fallback would
   404 on a direct/refreshed load of a client-side route).
3. Open DevTools → Network — confirm the JS/CSS bundle requests are `200`, served from
   `/static/*` (renamed from Vite's default `/assets/*` specifically to avoid colliding
   with this app's own real `/assets/:id` API route — see `vite.config.ts`'s comment).
4. Register an account, log in, upload an image — confirm the session persists across
   page loads (this is the exact same-origin cookie behavior BUILD 32A's split
   architecture would have broken).
5. Confirm the AI Image Model selector shows exactly 3 models — Nano Banana 2 (default),
   Nano Banana Pro, ChatGPT Image — never Auto, never Google Flow.
6. Live generation will return `PROVIDER_NOT_CONFIGURED` (no key) or
   `PROVIDER_QUOTA_EXCEEDED` (BUILD 29's still-blocked quota, if a key is set) — expected,
   not a defect. This build does not attempt to make that work.

## Storage — unchanged limitation from BUILD 32/32A

Render Free's filesystem is ephemeral. Whatever `DATABASE_URL`/`ASSET_STORE_URL` you've
configured gives real persistence *within* one running instance, but every
project/upload/generation should be assumed gone on the next fresh deploy or spin-up.
`GET /ready`'s `persistence.*.persistent` field tells you which mode you're in — this
build does not change that behavior or attempt to work around it.
