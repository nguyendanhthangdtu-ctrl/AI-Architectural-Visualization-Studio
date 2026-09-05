import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AnalysisRepository,
  AssetStore,
  AuditLogRepository,
  EditRepository,
  GenerationRepository,
  PasswordResetTokenRepository,
  ProjectRepository,
  ReferenceRepository,
  SessionRepository,
  UserRepository,
  VersionRepository,
  ViewRepository,
  VideoRepository,
} from '@avs/project-core';
import {
  LocalDiskAssetStore,
  SqliteAnalysisRepository,
  SqliteAuditLogRepository,
  SqliteDatabase,
  SqliteEditRepository,
  SqliteGenerationRepository,
  SqlitePasswordResetTokenRepository,
  SqliteProjectRepository,
  SqliteReferenceRepository,
  SqliteSessionRepository,
  SqliteUserRepository,
  SqliteVersionRepository,
  SqliteVideoRepository,
  SqliteViewRepository,
} from '@avs/storage-adapters';
import type { AiQc, ReferenceIntelligence, VisionAnalysisEngine } from '@avs/ai-core';
import { createGeminiQcEngine, createGeminiReferenceIntelligenceEngine, createGeminiVisionAnalysisEngine } from '@avs/ai-core';
import type { Logger, RateLimiter } from '@avs/shared';
import { createConsoleLogger, createInMemoryRateLimiter } from '@avs/shared';
import {
  createChatGPTImageAdapter,
  createNanoBananaAdapter,
  GoogleFlowAdapter,
  ImageGenerationService,
  createVeoAdapter,
  SoraAdapter,
  VideoGenerationService,
} from '@avs/model-adapters';
import { InMemoryJobQueue, type JobQueue } from './job-queue.js';
import { createAssetUrlSigner, type AssetUrlSigner } from './signed-asset-url.js';
import { createLocalIdentityProvider, type IdentityProvider } from './auth/identity-provider.js';
import { InMemoryEmailSender, type EmailSender } from './auth/email-sender.js';
import { createResendEmailSender } from './auth/resend-email-sender.js';
import { DEFAULT_RESET_TOKEN_TTL_MS } from './auth/auth-routes.js';

/** docs/16 "Rate limit expensive AI endpoints" — applied to analysis/reference/generation/edit/view/video/QC/regenerate routes (server.ts). */
export const AI_ROUTE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

/** RELEASE 02 — tighter limit on register/login specifically, to bound credential-guessing/account-creation abuse. */
export const AUTH_ROUTE_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

/** BUILD 19 (Account Recovery) — bounds password-reset-request abuse (both credential-stuffing and email-bombing a real user). */
export const PASSWORD_RESET_RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

/**
 * Repository/engine instances the API routes depend on — docs/03 ADR-003.
 * Routes never construct a concrete repository or provider adapter
 * themselves; they receive one through this context, so swapping the
 * storage engine (docs/03 §13 — still open behind these same interfaces) or
 * reconfiguring a provider touches only this file.
 */
export interface AppContext {
  projectRepository: ProjectRepository;
  assetStore: AssetStore;
  analysisRepository: AnalysisRepository;
  versionRepository: VersionRepository;
  visionAnalysisEngine: VisionAnalysisEngine;
  referenceRepository: ReferenceRepository;
  referenceIntelligenceEngine: ReferenceIntelligence;
  generationRepository: GenerationRepository;
  imageGenerationService: ImageGenerationService;
  jobQueue: JobQueue;
  editRepository: EditRepository;
  viewRepository: ViewRepository;
  videoRepository: VideoRepository;
  videoGenerationService: VideoGenerationService;
  aiQcEngine: AiQc;
  auditLogRepository: AuditLogRepository;
  assetUrlSigner: AssetUrlSigner | null;
  rateLimiter: RateLimiter;
  /** RELEASE 02 — real accounts/sessions. */
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  /** Gates `POST /auth/register` — unset means registration is disabled (deny-by-default). */
  registrationSecret: string | undefined;
  /** Sets the session cookie's `Secure` attribute and gates `Strict-Transport-Security` — see env.ts's `TRUST_HTTPS`. */
  cookieSecure: boolean;
  authRateLimiter: RateLimiter;
  /** BUILD 19 Phase 2 — the swappable "who does this session belong to" boundary; `requireAuth()` never looks up a session row directly. */
  identityProvider: IdentityProvider;
  /** BUILD 19 (Account Recovery). */
  passwordResetTokenRepository: PasswordResetTokenRepository;
  emailSender: EmailSender;
  passwordResetRateLimiter: RateLimiter;
  /** Defaults to `DEFAULT_RESET_TOKEN_TTL_MS` (1 hour, auth-routes.ts); overridable only so tests can exercise real expiry with a real, tiny delay instead of mocking time around a live HTTP server. */
  passwordResetTokenTtlMs: number;
  /**
   * BUILD 21 (Production AI Provider Integration, Phase 6) — whether each AI
   * provider has a real API key configured. Booleans only, never the key
   * itself; read by `GET /ready` to report configuration state without ever
   * conflating "a credential is present" with "this provider has been
   * verified against a live request" (see readiness.ts's own doc comment).
   */
  providerConfiguration: Readonly<{
    gemini: boolean;
    nanoBanana: boolean;
    /** BUILD 27 — Nano Banana Pro (gemini-3-pro-image); shares Nano Banana 2's NANO_BANANA_API_KEY credential, reported as its own model-level boolean. */
    nanoBananaPro: boolean;
    chatgptImage: boolean;
    veo: boolean;
    /** BUILD 22 — true only when a real vendor (`EMAIL_PROVIDER=resend`) AND its credential are both configured; `InMemoryEmailSender` (no real vendor) is always `false`. */
    email: boolean;
  }>;
  /**
   * BUILD 21 Phase 15 (Observability) — used by `routes.ts`'s generation path
   * to emit one structured, secret-free log line per attempt (requestId,
   * provider, model, latency, outcome). Defaults to the same
   * `createConsoleLogger()` `server.ts` itself uses for error logging, so
   * production behavior is unchanged unless a caller overrides it (tests do,
   * to assert on emitted log content without touching real stdout).
   */
  logger: Logger;
}

/**
 * BUILD 18: repositories are real, `node:sqlite`-backed and disk-backed
 * (see @avs/storage-adapters) — no longer the in-memory placeholders every
 * prior gate flagged as "dev/test only, not a production datastore."
 * `dbPath`/`assetsDir` default to `:memory:`/a fresh temp directory so every
 * existing test (and any ad hoc `createAppContext()` call) keeps its exact
 * prior ephemeral-per-context semantics with zero call-site changes — real
 * persistence is opt-in via `server.ts`'s real startup path, which passes
 * `DATABASE_URL`/`ASSET_STORE_URL` from the environment.
 *
 * Each provider key is optional: without it, that provider's `generate()`
 * throws PROVIDER_NOT_CONFIGURED rather than the server failing to start.
 * Adapters are registered `nano-banana` first so `RenderCoreSelection: 'auto'`
 * (ImageGenerationService.resolve, "picks by capability + policy" per docs/03
 * §7) resolves to a real, working adapter rather than the still-NOT_IMPLEMENTED
 * `google-flow` (BUILD 12 finding — no official public API exists for it).
 */
export function createAppContext(
  config: {
    geminiApiKey?: string | undefined;
    nanoBananaApiKey?: string | undefined;
    chatgptImageApiKey?: string | undefined;
    veoApiKey?: string | undefined;
    dbPath?: string | undefined;
    assetsDir?: string | undefined;
    assetUrlSigningSecret?: string | undefined;
    registrationSecret?: string | undefined;
    cookieSecure?: boolean | undefined;
    /** Defaults to a real vendor when `emailProvider`+its credential are set, else `InMemoryEmailSender`. Supplying this directly always wins (tests do, to inject a spy/fake). */
    emailSender?: EmailSender | undefined;
    passwordResetTokenTtlMs?: number | undefined;
    /** BUILD 21 — defaults to `createConsoleLogger()`; tests override this to assert on emitted log content. */
    logger?: Logger | undefined;
    /** BUILD 22 — real email vendor selection; see `env.ts`'s `EMAIL_PROVIDER`/`EMAIL_FROM`/`EMAIL_REPLY_TO`/`RESEND_API_KEY`. */
    emailProvider?: 'resend' | undefined;
    emailFrom?: string | undefined;
    emailReplyTo?: string | undefined;
    resendApiKey?: string | undefined;
  } = {},
): AppContext {
  const db = new SqliteDatabase(config.dbPath ?? ':memory:');
  const assetsDir = config.assetsDir ?? mkdtempSync(join(tmpdir(), 'avs-assets-'));
  const userRepository = new SqliteUserRepository(db);
  const sessionRepository = new SqliteSessionRepository(db);

  return {
    projectRepository: new SqliteProjectRepository(db),
    assetStore: new LocalDiskAssetStore(assetsDir),
    analysisRepository: new SqliteAnalysisRepository(db),
    versionRepository: new SqliteVersionRepository(db),
    visionAnalysisEngine: createGeminiVisionAnalysisEngine({ apiKey: config.geminiApiKey }),
    referenceRepository: new SqliteReferenceRepository(db),
    referenceIntelligenceEngine: createGeminiReferenceIntelligenceEngine({ apiKey: config.geminiApiKey }),
    generationRepository: new SqliteGenerationRepository(db),
    imageGenerationService: new ImageGenerationService({
      'nano-banana': createNanoBananaAdapter({ apiKey: config.nanoBananaApiKey }),
      // BUILD 27 — Nano Banana Pro reuses this SAME adapter factory (real,
      // validated Interactions API contract shared with Nano Banana 2, see
      // nano-banana-adapter.ts's own doc comment), only the model id,
      // adapter id, and real capability ceiling differ. Same
      // NANO_BANANA_API_KEY credential — this is one Google Gemini account,
      // two of its models, not two separate integrations.
      'nano-banana-pro': createNanoBananaAdapter({
        apiKey: config.nanoBananaApiKey,
        model: 'gemini-3-pro-image',
        id: 'nano-banana-pro',
        capabilities: { maxResolution: '4K', supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '16:9', '9:16', '21:9'] },
      }),
      'chatgpt-image': createChatGPTImageAdapter({ apiKey: config.chatgptImageApiKey }),
      'google-flow': new GoogleFlowAdapter(),
    }),
    jobQueue: new InMemoryJobQueue(),
    editRepository: new SqliteEditRepository(db),
    viewRepository: new SqliteViewRepository(db),
    videoRepository: new SqliteVideoRepository(db),
    videoGenerationService: new VideoGenerationService({
      veo: createVeoAdapter({ apiKey: config.veoApiKey }),
      sora: new SoraAdapter(),
    }),
    aiQcEngine: createGeminiQcEngine({ apiKey: config.geminiApiKey }),
    auditLogRepository: new SqliteAuditLogRepository(db),
    assetUrlSigner: createAssetUrlSigner(config.assetUrlSigningSecret),
    rateLimiter: createInMemoryRateLimiter(AI_ROUTE_RATE_LIMIT),
    userRepository,
    sessionRepository,
    registrationSecret: config.registrationSecret,
    cookieSecure: config.cookieSecure ?? false,
    authRateLimiter: createInMemoryRateLimiter(AUTH_ROUTE_RATE_LIMIT),
    identityProvider: createLocalIdentityProvider({ userRepository, sessionRepository }),
    passwordResetTokenRepository: new SqlitePasswordResetTokenRepository(db),
    emailSender:
      config.emailSender ??
      (config.emailProvider === 'resend'
        ? createResendEmailSender({
            apiKey: config.resendApiKey,
            from: config.emailFrom ?? '',
            ...(config.emailReplyTo ? { replyTo: config.emailReplyTo } : {}),
          })
        : new InMemoryEmailSender()),
    passwordResetRateLimiter: createInMemoryRateLimiter(PASSWORD_RESET_RATE_LIMIT),
    passwordResetTokenTtlMs: config.passwordResetTokenTtlMs ?? DEFAULT_RESET_TOKEN_TTL_MS,
    providerConfiguration: {
      gemini: Boolean(config.geminiApiKey),
      nanoBanana: Boolean(config.nanoBananaApiKey),
      // BUILD 27 — Nano Banana Pro shares Nano Banana 2's real credential
      // (both read NANO_BANANA_API_KEY, per this build's own instruction to
      // keep env vars unchanged), so its own configuration boolean is
      // identical in value — reported as its own field regardless, since
      // GET /ready describes each MODEL, not each underlying secret.
      nanoBananaPro: Boolean(config.nanoBananaApiKey),
      chatgptImage: Boolean(config.chatgptImageApiKey),
      veo: Boolean(config.veoApiKey),
      email: config.emailProvider === 'resend' && Boolean(config.resendApiKey),
    },
    logger: config.logger ?? createConsoleLogger(),
  };
}
