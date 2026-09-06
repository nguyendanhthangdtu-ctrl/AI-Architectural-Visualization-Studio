# BUILD 32A — Render Free Hosting Deployment

For whoever creates the actual Render services — this repo has no Render account access
of its own, so every step below that touches Render's dashboard/API must be done by a
human with that account. This doc gives the exact values; nothing here is a guess about
what your repo needs (see the BUILD 32A report for the audit this was built from).

**What this is not**: production-grade hosting. Render's Free plan is explicitly for
online preview, browser validation, UX testing, Mock E2E, and deployment validation —
see the report's `STORAGE_PERSISTENCE_BLOCKED` and `PRODUCTION_HOSTING_BLOCKED` notes.

## 1. Two free services, not one

This repo's `apps/api` is a JSON-only API (no static-file-serving code exists) and
`apps/web` is a separately-built SPA that already talks to the API via `VITE_API_BASE_URL`
— that split already exists in the source, this deployment doesn't invent it. Two Render
Free services mirror it exactly, both genuinely free:

- **`avs-api`** — Render **Web Service** (Node runtime). Spins down after ~15 minutes
  idle; a request after that pays a one-time cold-start delay while it restarts.
- **`avs-web`** — Render **Static Site**. Never spins down (served from Render's CDN).

A best-effort `render.yaml` Blueprint exists at the repo root — try **New → Blueprint** in
the Render dashboard first; if any field name has drifted from Render's current schema
(this was not validated against a real Render account), use the manual steps below
instead, which use the exact same values.

## 2. Creating `avs-api` (Web Service) manually

New → Web Service → connect this GitHub repository → branch `main`.

| Field | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `node apps/api/dist/server.js` |
| Plan | Free |
| Health Check Path | `/health` |

Render injects `PORT` itself — this app already falls back to it (BUILD 32A;
`parseServerEnv()` in `packages/shared/src/env.ts`). Nothing to configure for that.

**Environment variables** — set only what you actually need; every one of these is
optional in the sense that the app starts fine without it (see
`docs/BUILD_21_OPERATOR_RUNBOOK.md` §1 for what each unlocks/costs if left unset). Type
each value directly into Render's dashboard — never paste a real secret into a chat with
any AI assistant, including this one:

- `TRUST_HTTPS` = `true` (Render terminates TLS in front of your service)
- `DATABASE_URL` = `/opt/render/project/data/avs.sqlite3` — see §5 before relying on this
- `ASSET_STORE_URL` = `/opt/render/project/data/assets` — see §5
- `REGISTRATION_SECRET` = a real random value, e.g. generate locally with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste
  only the *output* into Render, never the command's result into this chat
- `ASSET_URL_SIGNING_SECRET` = a real random value, generated the same way
- `ALLOWED_ORIGINS` = leave blank for now — come back after §3 creates `avs-web`'s URL
- AI provider keys (`GEMINI_API_KEY`, `NANO_BANANA_API_KEY`, `CHATGPT_IMAGE_API_KEY`) —
  **leave unset for this build.** BUILD 29's Gemini quota/billing is still blocked
  regardless of what's configured here; setting a key doesn't change that, and BUILD 32A
  does not call live AI to "complete" anything.

Click **Create Web Service**. Wait for the first deploy to finish, then copy its URL
(`https://avs-api-<random>.onrender.com` or your chosen name).

## 3. Creating `avs-web` (Static Site) manually

New → Static Site → same repository → branch `main`.

| Field | Value |
|---|---|
| Build Command | `npm ci && npm run build --workspace=@avs/web` |
| Publish Directory | `apps/web/dist` |

Environment variable:

- `VITE_API_BASE_URL` = the `avs-api` URL you copied in §2 (e.g.
  `https://avs-api-xxxx.onrender.com`)

Click **Create Static Site**. Copy its URL once ready
(`https://avs-web-<random>.onrender.com`).

## 4. Closing the loop — CORS

Go back to `avs-api`'s environment variables and set:

- `ALLOWED_ORIGINS` = the `avs-web` URL from §3 (comma-separated if you also want to keep
  `http://localhost:5173` for local dev against the deployed API — you don't need to).

Save — Render redeploys `avs-api` automatically with the new value. This app's CORS
allowlist (`apps/api/src/cors.ts`) never reflects `*` with credentials, so this exact
origin match is required for the deployed frontend to call the deployed API at all.

## 5. Storage persistence — read this before trusting any uploaded data

Render Free web services have an **ephemeral filesystem**: local files (including a
SQLite file at `DATABASE_URL` and local-disk assets at `ASSET_STORE_URL`, both as
configured in §2) do **not** survive a redeploy, and are not guaranteed to survive a
spin-down/restart cycle either, since a fresh container may not reuse the same disk.

Setting `DATABASE_URL`/`ASSET_STORE_URL` to a real path (§2) still gives you real
persistence **within** a single running instance's lifetime — good enough for a browser
test session — but every project/upload/generation should be assumed **gone** the next
time the service spins up fresh. `GET /ready` reports this honestly
(`persistence.database.persistent` / `persistence.assetStore.persistent`) — check it
after deploying.

This is a Render Free platform limitation, not a bug in this app, and BUILD 32A does not
attempt to work around it (that would need a paid persistent disk or an external
database/object-store vendor — out of this build's scope, and not required to validate
the app online).

## 6. After both are live — the smoke test checklist

Run through this yourself (an AI assistant without your Render URL/account cannot do
this part):

1. Open the `avs-web` URL. The app loads, no fatal frontend error.
2. `curl https://<avs-api-url>/health` → `{"status":"ok"}`.
3. `curl https://<avs-api-url>/ready` → `"status":"ready"` (or `"not_ready"` if you left
   `DATABASE_URL`/`ASSET_STORE_URL` unset — that's still a valid, working ephemeral
   deployment, just check `persistence.*.persistent` is `false` as expected).
4. Register an account, upload an image, run Mock-safe flows through the UI.
5. Confirm the AI Image Model selector shows exactly 3 models — Nano Banana 2 (default),
   Nano Banana Pro, ChatGPT Image — never Auto, never Google Flow, never a 4th model.
6. Open the browser console — no uncaught error, no secret ever printed anywhere in a
   network response or the page source.
7. Reload the page — the app doesn't crash.
8. If the free instance spun down from idle, the first request after that will be slow
   (cold start) — this is expected Render Free behavior, not a defect. Do not set up a
   keep-alive ping to work around it (BUILD 32A explicitly asks not to).

Live AI generation will fail with `PROVIDER_NOT_CONFIGURED` (no key set) or
`PROVIDER_QUOTA_EXCEEDED` (BUILD 29's still-blocked quota, if you did set a key) either
way — that's the expected, correct, honest state for this build, not something to route
around.
