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
];

/**
 * Public configuration is a strict allowlist, never a filtered copy of the
 * server env — this is what apps/web is permitted to read. Empty at
 * Bootstrap; BUILD 03 adds fields here explicitly as the UI needs them.
 */
const publicEnvSchema = z.object({});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
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
