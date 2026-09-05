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

  // Storage credentials (docs/03 ADR-005; vendor TBD)
  DATABASE_URL: z.string().optional(),
  ASSET_STORE_URL: z.string().optional(),
  ASSET_STORE_ACCESS_KEY: z.string().optional(),
  ASSET_STORE_SECRET_KEY: z.string().optional(),
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
