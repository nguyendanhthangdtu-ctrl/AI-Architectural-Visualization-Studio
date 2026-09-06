import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createConsoleLogger, createInMemoryMetrics, DomainError, parseServerEnv } from '@avs/shared';
import { sendError } from './error-handling.js';
import { applyCorsHeaders, parseAllowedOrigins } from './cors.js';
import { applySecurityHeaders } from './security-headers.js';
import { handleReadiness } from './readiness.js';
import { enforceRateLimit, resolveClientIp } from './rate-limit-middleware.js';
import { createAppContext, type AppContext } from './app-context.js';
import {
  handleConfirmPasswordReset,
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleRequestPasswordReset,
} from './auth/auth-routes.js';
import { requireAuth } from './auth/session.js';
import {
  handleCreateProject,
  handleDeleteAsset,
  handleExtractReference,
  handleGetAsset,
  handleGetProject,
  handleGetVideoStatus,
  handleRegenerate,
  handleRunAnalysis,
  handleRunEdit,
  handleRunGeneration,
  handleRunQc,
  handleRunVideo,
  handleRunView,
  handleUploadAsset,
} from './routes.js';

const PROJECT_ID_ROUTE = /^\/projects\/([^/]+)$/;
const PROJECT_ASSETS_ROUTE = /^\/projects\/([^/]+)\/assets$/;
const PROJECT_ANALYSIS_ROUTE = /^\/projects\/([^/]+)\/analysis$/;
const PROJECT_REFERENCES_ROUTE = /^\/projects\/([^/]+)\/references$/;
const PROJECT_GENERATIONS_ROUTE = /^\/projects\/([^/]+)\/generations$/;
const PROJECT_GENERATION_EDITS_ROUTE = /^\/projects\/([^/]+)\/generations\/([^/]+)\/edits$/;
const PROJECT_GENERATION_VIDEOS_ROUTE = /^\/projects\/([^/]+)\/generations\/([^/]+)\/videos$/;
const PROJECT_GENERATION_QC_ROUTE = /^\/projects\/([^/]+)\/generations\/([^/]+)\/qc$/;
const PROJECT_GENERATION_REGENERATE_ROUTE = /^\/projects\/([^/]+)\/generations\/([^/]+)\/regenerate$/;
const PROJECT_VIEWS_ROUTE = /^\/projects\/([^/]+)\/views$/;
const PROJECT_VIDEO_ID_ROUTE = /^\/projects\/([^/]+)\/videos\/([^/]+)$/;
const PROJECT_ASSET_ID_ROUTE = /^\/projects\/([^/]+)\/assets\/([^/]+)$/;
const ASSET_ID_ROUTE = /^\/assets\/([^/]+)$/;

/**
 * apps/api HTTP server — docs/03 §8. Routes land here as the Build Gate that
 * owns each capability builds it.
 *
 * `allowedOrigins` (BUILD 18, docs/16) is threaded through explicitly rather
 * than read from `process.env` inside `createApp` — keeps this function pure
 * given its inputs, same reasoning as `context`/`logger` already being
 * parameters, and lets tests exercise a specific allowlist without mutating
 * global environment state.
 */
export function createApp(
  context: AppContext = createAppContext(),
  logger = createConsoleLogger(),
  allowedOrigins: readonly string[] = parseAllowedOrigins(undefined),
  metrics = createInMemoryMetrics(),
) {
  return createServer((req, res) => {
    applyCorsHeaders(req, res, allowedOrigins);
    applySecurityHeaders(res, { trustHttps: context.cookieSecure });

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.on('finish', () => {
      metrics.increment('http_requests_total', { method: req.method ?? 'UNKNOWN', status: String(res.statusCode) });
    });

    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://internal');
        const path = url.pathname;

        if (req.method === 'GET' && path === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        if (req.method === 'GET' && path === '/metrics') {
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          res.end(metrics.render());
          return;
        }

        if (req.method === 'GET' && path === '/ready') {
          await handleReadiness(res, context);
          return;
        }

        if (req.method === 'POST' && path === '/auth/register') {
          enforceRateLimit(context.authRateLimiter, resolveClientIp(req, context.trustProxy));
          await handleRegister(req, res, context);
          return;
        }

        if (req.method === 'POST' && path === '/auth/login') {
          enforceRateLimit(context.authRateLimiter, resolveClientIp(req, context.trustProxy));
          await handleLogin(req, res, context);
          return;
        }

        // BUILD 19 (Account Recovery) — public: a caller requesting/confirming
        // a reset is, by definition, not necessarily holding a valid session.
        if (req.method === 'POST' && path === '/auth/password-reset/request') {
          enforceRateLimit(context.passwordResetRateLimiter, resolveClientIp(req, context.trustProxy));
          await handleRequestPasswordReset(req, res, context);
          return;
        }

        if (req.method === 'POST' && path === '/auth/password-reset/confirm') {
          enforceRateLimit(context.passwordResetRateLimiter, resolveClientIp(req, context.trustProxy));
          await handleConfirmPasswordReset(req, res, context);
          return;
        }

        // RELEASE 02 (docs/16 "explicitly allowlist public endpoints") — every
        // route below this line requires a real, valid session; /health,
        // /metrics, /auth/register, and /auth/login (the only public routes)
        // already returned above and never reach this check.
        const user = await requireAuth(context, req);

        if (req.method === 'POST' && path === '/auth/logout') {
          await handleLogout(req, res, context);
          return;
        }

        if (req.method === 'GET' && path === '/auth/me') {
          handleMe(res, user);
          return;
        }

        if (req.method === 'POST' && path === '/projects') {
          await handleCreateProject(req, res, context, user);
          return;
        }

        const projectAssetsMatch = path.match(PROJECT_ASSETS_ROUTE);
        if (req.method === 'POST' && projectAssetsMatch) {
          await handleUploadAsset(req, res, context, user, projectAssetsMatch[1]!);
          return;
        }

        const projectAnalysisMatch = path.match(PROJECT_ANALYSIS_ROUTE);
        if (req.method === 'POST' && projectAnalysisMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunAnalysis(req, res, context, user, projectAnalysisMatch[1]!);
          return;
        }

        const projectReferencesMatch = path.match(PROJECT_REFERENCES_ROUTE);
        if (req.method === 'POST' && projectReferencesMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleExtractReference(req, res, context, user, projectReferencesMatch[1]!);
          return;
        }

        const projectGenerationEditsMatch = path.match(PROJECT_GENERATION_EDITS_ROUTE);
        if (req.method === 'POST' && projectGenerationEditsMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunEdit(req, res, context, user, projectGenerationEditsMatch[1]!, projectGenerationEditsMatch[2]!);
          return;
        }

        const projectGenerationVideosMatch = path.match(PROJECT_GENERATION_VIDEOS_ROUTE);
        if (req.method === 'POST' && projectGenerationVideosMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunVideo(req, res, context, user, projectGenerationVideosMatch[1]!, projectGenerationVideosMatch[2]!);
          return;
        }

        const projectVideoIdMatch = path.match(PROJECT_VIDEO_ID_ROUTE);
        if (req.method === 'GET' && projectVideoIdMatch) {
          await handleGetVideoStatus(res, context, user, projectVideoIdMatch[1]!, projectVideoIdMatch[2]!);
          return;
        }

        const projectGenerationQcMatch = path.match(PROJECT_GENERATION_QC_ROUTE);
        if (req.method === 'POST' && projectGenerationQcMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunQc(req, res, context, user, projectGenerationQcMatch[1]!, projectGenerationQcMatch[2]!);
          return;
        }

        const projectGenerationRegenerateMatch = path.match(PROJECT_GENERATION_REGENERATE_ROUTE);
        if (req.method === 'POST' && projectGenerationRegenerateMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRegenerate(req, res, context, user, projectGenerationRegenerateMatch[1]!, projectGenerationRegenerateMatch[2]!);
          return;
        }

        const projectGenerationsMatch = path.match(PROJECT_GENERATIONS_ROUTE);
        if (req.method === 'POST' && projectGenerationsMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunGeneration(req, res, context, user, projectGenerationsMatch[1]!);
          return;
        }

        const projectViewsMatch = path.match(PROJECT_VIEWS_ROUTE);
        if (req.method === 'POST' && projectViewsMatch) {
          enforceRateLimit(context.rateLimiter, user.id);
          await handleRunView(req, res, context, user, projectViewsMatch[1]!);
          return;
        }

        const projectAssetIdMatch = path.match(PROJECT_ASSET_ID_ROUTE);
        if (req.method === 'DELETE' && projectAssetIdMatch) {
          await handleDeleteAsset(res, context, user, projectAssetIdMatch[1]!, projectAssetIdMatch[2]!);
          return;
        }

        const projectIdMatch = path.match(PROJECT_ID_ROUTE);
        if (req.method === 'GET' && projectIdMatch) {
          await handleGetProject(res, context, user, projectIdMatch[1]!);
          return;
        }

        const assetIdMatch = path.match(ASSET_ID_ROUTE);
        if (req.method === 'GET' && assetIdMatch) {
          await handleGetAsset(req, res, context, user, assetIdMatch[1]!);
          return;
        }

        throw new DomainError({ code: 'NOT_FOUND', message: `No route for ${req.method} ${path}`, retryable: false });
      } catch (error) {
        sendError(res, error, logger);
      }
    })();
  });
}

// Cross-platform "is this the entry script" check — a plain `file://` string
// join breaks on Windows (import.meta.url is file:///C:/... with three
// slashes, not two), which silently prevented `.listen()` from ever being
// called. pathToFileURL normalizes both sides through the same encoder.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const logger = createConsoleLogger();
  const env = parseServerEnv(); // throws — and never starts — on invalid config; no secret required to succeed
  const context = createAppContext({
    geminiApiKey: env.GEMINI_API_KEY,
    nanoBananaApiKey: env.NANO_BANANA_API_KEY,
    chatgptImageApiKey: env.CHATGPT_IMAGE_API_KEY,
    veoApiKey: env.VEO_API_KEY,
    dbPath: env.DATABASE_URL,
    assetsDir: env.ASSET_STORE_URL,
    assetUrlSigningSecret: env.ASSET_URL_SIGNING_SECRET,
    registrationSecret: env.REGISTRATION_SECRET,
    cookieSecure: env.TRUST_HTTPS,
    trustProxy: env.TRUST_PROXY,
    emailProvider: env.EMAIL_PROVIDER,
    emailFrom: env.EMAIL_FROM,
    emailReplyTo: env.EMAIL_REPLY_TO,
    resendApiKey: env.RESEND_API_KEY,
  });

  // BUILD 32 (Production Deployment) — an operator who forgets to set
  // DATABASE_URL/ASSET_STORE_URL gets a server that starts fine and reports
  // /ready as healthy (ephemeral storage is a legitimate choice — see
  // AppContext.persistence's doc comment), but every project/generation/
  // user would be silently wiped on the next restart. One clear, secret-free
  // startup log line (never the real path — that's still a secret) so this
  // is visible immediately rather than discovered the hard way.
  if (!context.persistence.database || !context.persistence.assetStore) {
    logger.warn('Running with ephemeral storage — data will not survive a restart. Set DATABASE_URL/ASSET_STORE_URL for a real deployment.', {
      databasePersistent: context.persistence.database,
      assetStorePersistent: context.persistence.assetStore,
    });
  }

  const httpServer = createApp(context, logger, parseAllowedOrigins(env.ALLOWED_ORIGINS)).listen(env.API_PORT, () => {
    logger.info(`apps/api listening on :${env.API_PORT}`);
  });

  // BUILD 32 (Production Deployment) — graceful shutdown: stop accepting new
  // connections, let in-flight requests finish, then release the DB handle.
  // A bounded force-exit is the safety net against a connection that never
  // closes (e.g. a client that never reads the response) hanging shutdown
  // forever — the exact failure mode a container orchestrator's SIGTERM
  // grace period exists to catch.
  const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;
  let shuttingDown = false;
  function shutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully…`);
    const forceExit = setTimeout(() => {
      logger.warn('Graceful shutdown timed out — forcing exit.');
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    httpServer.close((error) => {
      if (error) logger.error('Error while closing the HTTP server', { code: 'SHUTDOWN_ERROR' });
      context.shutdown();
      clearTimeout(forceExit);
      process.exit(error ? 1 : 0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
