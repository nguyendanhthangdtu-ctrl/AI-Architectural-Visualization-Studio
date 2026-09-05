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
import type { RateLimiter } from '@avs/shared';
import { createInMemoryRateLimiter } from '@avs/shared';
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
    /** Defaults to `InMemoryEmailSender` — see its own doc comment; a real vendor wires a real `EmailSender` in here once chosen. */
    emailSender?: EmailSender | undefined;
    passwordResetTokenTtlMs?: number | undefined;
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
    emailSender: config.emailSender ?? new InMemoryEmailSender(),
    passwordResetRateLimiter: createInMemoryRateLimiter(PASSWORD_RESET_RATE_LIMIT),
    passwordResetTokenTtlMs: config.passwordResetTokenTtlMs ?? DEFAULT_RESET_TOKEN_TTL_MS,
  };
}
