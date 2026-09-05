# BUILD 21 — Operator Runbook

For whoever operates a real deployment of this API. Every command below is real and was
exercised in this repository (BUILD 20's live-server run; BUILD 21 did not repeat a live
provider call since no credential exists in the build environment — see the final report).

## 1. Required environment variables

None are strictly mandatory to start the process (BUILD 02's bootstrap guarantee still
holds — an empty environment starts cleanly). What each one unlocks:

| Variable | Unlocks | If unset |
|---|---|---|
| `GEMINI_API_KEY` | Vision Analysis, Reference Intelligence, AI QC | `503 PROVIDER_NOT_CONFIGURED` on those routes |
| `NANO_BANANA_API_KEY` | Nano Banana image generation | `503 PROVIDER_NOT_CONFIGURED` |
| `CHATGPT_IMAGE_API_KEY` | ChatGPT Image generation/edit | `503 PROVIDER_NOT_CONFIGURED` |
| `VEO_API_KEY` | Image → Video (Veo) | `503 PROVIDER_NOT_CONFIGURED` |
| `GOOGLE_FLOW_API_KEY`, `SORA_API_KEY` | Reserved — both adapters are `NOT_IMPLEMENTED` regardless (no public API exists for either; see `docs/03` §13) | No effect either way |
| `DATABASE_URL` | Persistent SQLite file (unset = `:memory:`, wiped on restart) | Ephemeral dev-only data |
| `ASSET_STORE_URL` | Persistent local-disk asset storage (unset = a fresh OS temp dir per process) | Ephemeral dev-only assets |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) | Defaults to the Vite dev origin only |
| `ASSET_URL_SIGNING_SECRET` | Signs asset URLs | Asset URLs stay unsigned/unauthenticated |
| `REGISTRATION_SECRET` | Enables `POST /auth/register` | Registration is disabled entirely (deny-by-default) |
| `TRUST_HTTPS` | `true`/`false` — gates cookie `Secure` + HSTS | Defaults `false`; **setting `true` without `ASSET_URL_SIGNING_SECRET` refuses to start** (BUILD 19 fail-fast rule) |
| `API_PORT` | Listen port | Defaults `8080` |
| `RUN_LIVE_PROVIDER_SMOKE_TEST` | Opt-in live provider test (see §7) | Live suite skips |
| `EMAIL_PROVIDER` | `resend` — real email vendor (BUILD 22) | Unset = `InMemoryEmailSender`, never delivers |
| `EMAIL_FROM` | Required when `EMAIL_PROVIDER=resend` | Server refuses to start without it (fail-fast) |
| `EMAIL_REPLY_TO` | Optional default Reply-To | No Reply-To header sent |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend` | Server refuses to start without it (fail-fast) |
| `RUN_LIVE_EMAIL_SMOKE_TEST` | Opt-in live email test (BUILD 22) | Live suite skips |

**BUILD 22 update**: a real email vendor (Resend) is now implemented — see
`docs/BUILD_22_EMAIL_INTEGRATION.md` for the architecture and `RUN_LIVE_EMAIL_SMOKE_TEST`
below for how to verify it live. Unset `EMAIL_PROVIDER` keeps the exact BUILD 19 behavior
(`InMemoryEmailSender`, never delivers anything).

## 2. Configuring secrets safely

- Never commit `.env`. Use your platform's real secret manager (systemd
  `EnvironmentFile=`, a container orchestrator's secret mount, etc.) in production.
- `.env.example` in the repo root lists every variable with a safe placeholder — copy it to
  `.env` locally and fill in real values; `.env` is already `.gitignore`d.
- Generate `REGISTRATION_SECRET`/`ASSET_URL_SIGNING_SECRET` with real entropy, e.g.:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. Starting the app

```bash
npm run build                     # tsc -b (all packages) + vite build (apps/web)
DATABASE_URL=./data/avs.sqlite3 \
ASSET_STORE_URL=./data/assets \
REGISTRATION_SECRET=<generated>   \
ASSET_URL_SIGNING_SECRET=<generated> \
GEMINI_API_KEY=<real key>         \
NANO_BANANA_API_KEY=<real key>    \
ALLOWED_ORIGINS=https://your-real-domain \
API_PORT=8080 \
node apps/api/dist/server.js
```

A misconfigured/invalid environment refuses to start with a clear message (never a silent
partial start) — e.g. `TRUST_HTTPS=true` without `ASSET_URL_SIGNING_SECRET`.

## 4. Checking health

```bash
curl -s http://localhost:8080/health
# {"status":"ok"}   — process is alive. This is unconditional; it says nothing about dependencies.
```

## 5. Checking readiness

```bash
curl -s http://localhost:8080/ready
```

```json
{
  "status": "ready",
  "checks": { "database": { "status": "ok" }, "assetStore": { "status": "ok" } },
  "providers": {
    "gemini": { "configured": true },
    "nanoBanana": { "configured": true },
    "chatgptImage": { "configured": false },
    "veo": { "configured": false },
    "email": { "configured": false }
  }
}
```

`status` reflects ONLY the database and asset store — a missing AI provider or email vendor
key never flips overall readiness to `not_ready` (a deployment can legitimately serve
auth/asset traffic before an AI/email key is added). `providers.*.configured` means **a key
is present**, nothing more — it is never proof that provider has been verified against a real
request. That evidence only ever comes from §7 (AI) or §8 (email) below actually succeeding.

## 6. Running tests

```bash
npx vitest run          # unit + integration + security, ~559 tests, no credentials needed
npx tsc -b --force       # typecheck, whole workspace
npm run lint             # eslint, whole workspace
npm run build            # production build (tsc + vite)
```

All four must be clean before any deploy.

## 7. Running the live AI smoke test

Only runs with an explicit opt-in AND a real credential. Makes a real, small,
cost-bounded request to whichever provider you configure a key for:

```bash
RUN_LIVE_PROVIDER_SMOKE_TEST=true GEMINI_API_KEY=<real key> \
  npx vitest run apps/api/src/live-provider-smoke.test.ts
```

- Without `RUN_LIVE_PROVIDER_SMOKE_TEST=true`: the whole suite is skipped, zero network calls.
- With the flag but no provider key: that provider's own sub-suite skips individually.
- The test cleans up every asset it creates via the real `DELETE` route.
- **A PASS here is the only evidence that changes a provider's status from
  "configured" to "actually working."** Nothing else does.
- **BUILD 24**: this is also the release gate for declaring PRODUCTION READY (as opposed to
  PRODUCTION CANDIDATE) — see `docs/BUILD_24_PRODUCTION_READINESS.md` for the full release
  checklist and the exact result of the last release-validation attempt.

## 8. Testing email

**BUILD 22**: a real vendor (Resend) is now implemented. Set `EMAIL_PROVIDER=resend`,
`RESEND_API_KEY`, and `EMAIL_FROM` (a real, verified sender identity — configure one at
https://resend.com/docs/dashboard/domains/introduction) to enable it; leave `EMAIL_PROVIDER`
unset to keep the exact BUILD 19 behavior (`InMemoryEmailSender`, never delivers).

To verify it live — same opt-in gating pattern as §7, needs a real credential AND a real,
controlled test recipient (never a live user's address):

```bash
RUN_LIVE_EMAIL_SMOKE_TEST=true RESEND_API_KEY=<real key> EMAIL_FROM=you@yourdomain.com EMAIL_TEST_RECIPIENT=you+test@yourdomain.com \
  npx vitest run apps/api/src/live-email-smoke.test.ts
```

- Without `RUN_LIVE_EMAIL_SMOKE_TEST=true`, or missing any of the three other variables: the
  whole suite is skipped, zero network calls.
- Sends exactly one real, controlled test email and prints the vendor's own message id
  (safe — never a secret) on success.
- **A PASS here is the only evidence that changes email's status from "configured" to
  "actually working."** Nothing else does — not `RESEND_API_KEY` merely being set.

## 9. Verifying asset retrieval

```bash
# after any real upload/generation, the response includes a URL like:
# /assets/<id>?exp=<unix-ts>&sig=<hex>
curl -s -b cookies.txt "http://localhost:8080/assets/<id>?exp=...&sig=..." -o out.png
# a request with no sig/exp query params is rejected 403 INVALID_ASSET_SIGNATURE
# a request from a different account is rejected 404 ASSET_NOT_FOUND (ownership-checked
# independently of the signature — ownership is real IDOR protection, not implied by a valid sig)
```

## 10. Handling a provider 401/403

Means the configured API key is invalid, revoked, or lacks the needed scope/project access.
The response is `502` with the adapter's own code (e.g. `NANO_BANANA_PROVIDER_ERROR`) and
`providerCode: "PROVIDER_AUTH_FAILED"` — never retryable. Rotate the key (see §14) and
restart the process; there is nothing to retry on the existing request.

## 11. Handling 429 (provider rate limited)

`providerCode: "PROVIDER_RATE_LIMITED"`, marked retryable. The caller may retry after a
backoff; this project does not auto-retry server-side by design (image generation is
cost-bearing — a silent auto-retry could double-bill on a request that actually succeeded
upstream but was slow to respond). If you see this often in production, it means real
traffic has exceeded the provider's own quota — raise the quota with the provider, not in
this codebase.

## 12. Handling timeouts

`providerCode: "PROVIDER_TIMEOUT"`. Every provider call has a real, bounded
`AbortController` timeout (60s default; Veo's video download uses 180s). A timeout never
hangs the request indefinitely and never leaves a job stuck `'running'` forever — it's
marked `'failed'` and the caller sees a clean, retryable error.

## 13. Rollback

```bash
git log --oneline -5              # find the commit before this build
git revert <build-21-commit-sha>  # every change in this build is additive/independently revertable
                                   # — see docs/BUILD_21_PRODUCTION_INTEGRATION.md §10
npm run build && node apps/api/dist/server.js
```

No database migration, no schema change, and no env var removal is required either way.

## 14. Rotating a credential

1. Obtain the new key from the provider's own console.
2. Update your secret manager/`.env` — never edit it in place in a way that gets logged.
3. Restart the process (env vars are read once at `parseServerEnv()` time, not hot-reloaded).
4. Confirm with `GET /ready` that `providers.<name>.configured` is `true`.
5. Run §7's (AI) or §8's (email) live smoke test once to confirm the NEW key actually works
   before relying on it — "configured" is not "verified" (see §5).
6. Revoke the OLD key at the provider console once the new one is confirmed working.
7. To remove a credential entirely (e.g. taking a deployment back to dev-only email): unset
   `EMAIL_PROVIDER`/`RESEND_API_KEY` in your secret manager, restart, and confirm `GET /ready`
   now reports `providers.email.configured: false` — the app falls back to
   `InMemoryEmailSender` cleanly, never a broken state.

## 15. What must never be committed

- `.env` (already `.gitignore`d — verify with `git check-ignore -v .env` before any commit).
- Any real API key, `REGISTRATION_SECRET`, `ASSET_URL_SIGNING_SECRET`, or `RESEND_API_KEY`
  value, anywhere, including in a commit message, a test fixture, or a doc example.
- The generated `data/` directory (SQLite file + local-disk assets) — already `.gitignore`d
  (`/data/`, `**/data/`, `*.sqlite3*`, `*.db*`).
- Any real user-uploaded image or real generated output — these belong only in the
  configured asset store, never in the repository.
- Before every commit: `git status` (check untracked files), `git diff --check` (whitespace),
  and a manual scan of the diff for anything secret-shaped — this project has no automated
  secret-scanning tool wired into CI as of this build.
