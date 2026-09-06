import { z } from 'zod';

/**
 * Environment architecture — docs/16_SECURITY_SPEC.md, docs/03 §9.
 * Every field is OPTIONAL at Bootstrap: no real integration exists yet, so no
 * secret is required to start the app locally (BUILD 02 acceptance
 * criterion). A later gate that wires a real provider/DB tightens its own
 * field to required at that point — this schema is not weakened, just honest
 * about what Bootstrap actually needs.
 *
 * This module must only ever be imported by server-side code (apps/api, a
 * worker) — never by apps/web — so provider/storage secrets can never reach
 * client-side code (CLAUDE.md rule 6, docs/16 "server-side provider calls").
 */
const serverEnvSchema = z.object({
  // BUILD 32A (Render Free deployment) — `API_PORT` is this app's own name
  // (predates any specific host); most PaaS platforms, Render included,
  // instead inject a `PORT` env var and require the process to listen on
  // exactly that port for their health check/routing to reach it at all.
  // `parseServerEnv()` below folds `PORT` in as a fallback source for this
  // field before validation — this field itself stays named `API_PORT`
  // everywhere else in the app (docs/config/tests unchanged); an explicit
  // `API_PORT` always wins if somehow both are set.
  API_PORT: z.coerce.number().int().positive().default(8080),

  // Model-provider credentials (docs/10). BUILD 12: NanoBananaAdapter and
  // ChatGPTImageAdapter are real — without their key, generate() throws
  // PROVIDER_NOT_CONFIGURED rather than the server failing to start.
  // GoogleFlowAdapter stays NOT_IMPLEMENTED regardless (no official public
  // API exists for Google Flow — see provider-adapters.ts).
  NANO_BANANA_API_KEY: z.string().optional(),
  GOOGLE_FLOW_API_KEY: z.string().optional(),
  CHATGPT_IMAGE_API_KEY: z.string().optional(),

  // Image → Video providers (docs/14, BUILD 16). VEO_API_KEY: real Gemini API
  // key for Veo (predictLongRunning). SORA_API_KEY: kept for completeness,
  // but SoraAdapter stays NOT_IMPLEMENTED regardless — OpenAI's Sora 2 Videos
  // API is deprecated, shutting down 2026-09-24 (see sora-adapter.ts).
  VEO_API_KEY: z.string().optional(),
  SORA_API_KEY: z.string().optional(),

  // Vision Analysis Engine provider (BUILD 07) — Google Gemini, chosen by the
  // user. Optional here too: without it, the engine throws a clear
  // PROVIDER_NOT_CONFIGURED error rather than the server failing to start.
  GEMINI_API_KEY: z.string().optional(),

  // Storage — BUILD 18: resolved to concrete, zero-external-vendor engines.
  // DATABASE_URL is a filesystem path node:sqlite's DatabaseSync opens directly
  // (or ':memory:' for an ephemeral instance); ASSET_STORE_URL is the local
  // directory asset bytes are written under. A real cloud DB/blob vendor swap
  // (docs/03 §13) still only needs new implementations behind the same
  // repository/AssetStore interfaces — never a caller-visible change.
  // ASSET_STORE_ACCESS_KEY/ASSET_STORE_SECRET_KEY stay unused until that swap.
  DATABASE_URL: z.string().optional(),
  ASSET_STORE_URL: z.string().optional(),
  ASSET_STORE_ACCESS_KEY: z.string().optional(),
  ASSET_STORE_SECRET_KEY: z.string().optional(),

  // CORS allowlist (docs/16, BUILD 18) — comma-separated origins; defaults to
  // the Vite dev server's own origin when unset (cors.ts).
  ALLOWED_ORIGINS: z.string().optional(),

  // BUILD 32B (Frontend Production Deployment) — a real, built apps/web/dist
  // directory to serve same-origin from this same process (see
  // apps/api/src/static-assets.ts's own doc comment for why same-origin is
  // required, not optional, for the SameSite=Strict session cookie to ever
  // reach this server on a real deployment). Unset (the default, and every
  // local-dev/test run): this server stays API-only, exactly as before —
  // the frontend is served separately (Vite dev server locally; nothing in
  // production until this is set).
  WEB_DIST_DIR: z.string().optional(),

  // Signs the time-limited asset URLs `GET /assets/:id` can require (BUILD
  // 18) — docs/03 §9 "signed, time-limited URLs from AssetStore — no public
  // bucket by default." Optional so local dev/tests never need a secret to
  // start (BUILD 02 acceptance criterion), same graceful-degradation pattern
  // as every provider key above: unset, asset URLs stay plain and
  // unauthenticated (today's behavior, unchanged); set, every asset URL this
  // API returns is signed and `GET /assets/:id` enforces the signature +
  // expiry for real.
  ASSET_URL_SIGNING_SECRET: z.string().optional(),

  // RELEASE 02 (Security & Production Access Hardening) — real accounts.
  // Unset: `POST /auth/register` is entirely disabled (deny-by-default for a
  // private deployment — never open public self-registration). Set: its
  // exact value must be supplied as `registrationSecret` in the request body
  // to create an account. Share it privately with intended users; it is not
  // a per-user password.
  REGISTRATION_SECRET: z.string().optional(),

  // RELEASE 02 — real-boolean parsing (zod's z.coerce.boolean() would treat
  // the literal string "false" as truthy, a well-known JS/zod footgun this
  // deliberately avoids). Governs both the session cookie's `Secure`
  // attribute and whether `Strict-Transport-Security` is sent. Defaults to
  // `false` so local dev over plain HTTP keeps working with zero
  // configuration (docs/03 §11 "CLIENT → HTTPS/TLS REVERSE PROXY → API" —
  // set this to `true` only once that reverse proxy is real).
  TRUST_HTTPS: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),

  // BUILD 32 (Production Deployment) — docs/03 §11's documented topology,
  // CLIENT -> HTTPS/TLS REVERSE PROXY -> API, means this process never sees
  // the real client IP on `req.socket.remoteAddress` — it sees the proxy's.
  // Per-IP rate limiting on the two routes that key by IP (`/auth/login`,
  // `/auth/register` — see rate-limit-middleware.ts) would otherwise bucket
  // every real client together under the proxy's one address. Same
  // opt-in-only shape as `TRUST_HTTPS`: defaults to `false` so a direct
  // (no-proxy) deployment isn't tricked by a client-supplied
  // `X-Forwarded-For` header into spoofing its rate-limit identity; set to
  // `true` only once a real reverse proxy is confirmed to always set that
  // header itself (docs/03 §11 — the same reverse proxy `TRUST_HTTPS=true`
  // already assumes exists).
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),

  // BUILD 22 (Real Email Vendor Integration) — real transactional email
  // (password reset today). `EMAIL_PROVIDER` unset (the default) means no
  // real vendor is wired: `EmailSender` stays `InMemoryEmailSender`
  // (docs/03 §13, same "concrete engine deferred" pattern BUILD 18
  // established for storage) — email "delivery" only ever records what
  // would have been sent, in-process, and no secret is required to start.
  // Setting it to `resend` opts into the one real vendor implemented so far
  // (`resend-email-sender.ts`) and requires `RESEND_API_KEY`/`EMAIL_FROM`
  // (enforced below) — a real vendor decision, not fabricated.
  EMAIL_PROVIDER: z.literal('resend').optional(),
  EMAIL_FROM: z.string().trim().email().optional(),
  EMAIL_REPLY_TO: z.string().trim().email().optional(),
  RESEND_API_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  /**
   * BUILD 19 Phase 5 (Production Environment Validation) — "fail fast when
   * mandatory production configuration is missing." `TRUST_HTTPS=true` is
   * this app's one real signal "this is a production-shaped deployment"
   * (docs/03 §11 — it's only ever set once a real reverse proxy exists); at
   * that point, asset URLs staying unsigned/unauthenticated is a real
   * confidentiality gap, not a cosmetic one, so this refuses to start rather
   * than silently serving unsigned URLs in what the operator declared a
   * trusted-HTTPS deployment. Every OTHER field stays optional here
   * deliberately (docs/03 §13 — e.g. `REGISTRATION_SECRET` unset is a valid,
   * intentional "registration permanently closed" choice, not a
   * misconfiguration to block on).
   */
  if (data.TRUST_HTTPS && !data.ASSET_URL_SIGNING_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ASSET_URL_SIGNING_SECRET'],
      message: 'ASSET_URL_SIGNING_SECRET is required when TRUST_HTTPS=true — asset URLs must be signed once this deployment is trusted to be behind real HTTPS.',
    });
  }

  /**
   * BUILD 22 — "Missing required production credentials must be detected"
   * / "Production configuration must not silently fall back to fake
   * credentials." An operator explicitly declaring `EMAIL_PROVIDER=resend`
   * has stated real email delivery is required; refuse to start rather than
   * silently keep using `InMemoryEmailSender` (which never delivers
   * anything) in what the operator declared a real-email deployment.
   */
  if (data.EMAIL_PROVIDER === 'resend' && !data.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend.',
    });
  }
  if (data.EMAIL_PROVIDER === 'resend' && !data.EMAIL_FROM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_FROM'],
      message: 'EMAIL_FROM is required when EMAIL_PROVIDER=resend — Resend requires a verified sender identity.',
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Field names that must never be logged, even at debug level. */
export const SECRET_ENV_KEYS: readonly (keyof ServerEnv)[] = [
  'NANO_BANANA_API_KEY',
  'GOOGLE_FLOW_API_KEY',
  'CHATGPT_IMAGE_API_KEY',
  'GEMINI_API_KEY',
  'VEO_API_KEY',
  'SORA_API_KEY',
  'DATABASE_URL',
  'ASSET_STORE_ACCESS_KEY',
  'ASSET_STORE_SECRET_KEY',
  'ASSET_URL_SIGNING_SECRET',
  'REGISTRATION_SECRET',
  'RESEND_API_KEY',
];

/**
 * Public configuration is a strict allowlist, never a filtered copy of the
 * server env — this is what apps/web is permitted to read. Empty at
 * Bootstrap; BUILD 03 adds fields here explicitly as the UI needs them.
 */
const publicEnvSchema = z.object({});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  // BUILD 32A — see API_PORT's own doc comment above: fold the
  // platform-injected `PORT` in as a fallback source, never overriding an
  // explicitly-set `API_PORT`.
  const normalizedSource = { ...source, API_PORT: source.API_PORT ?? source.PORT };
  const result = serverEnvSchema.safeParse(normalizedSource);
  if (!result.success) {
    throw new Error(`Invalid server environment configuration: ${result.error.message}`);
  }
  return result.data;
}

export function parsePublicEnv(source: NodeJS.ProcessEnv = process.env): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid public environment configuration: ${result.error.message}`);
  }
  return result.data;
}
