import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createConsoleLogger, DomainError, parseServerEnv } from '@avs/shared';
import { sendError } from './error-handling.js';
import { applyCorsHeaders } from './cors.js';
import { createAppContext, type AppContext } from './app-context.js';
import {
  handleCreateProject,
  handleExtractReference,
  handleGetAsset,
  handleGetProject,
  handleGetVideoStatus,
  handleRunAnalysis,
  handleRunEdit,
  handleRunGeneration,
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
const PROJECT_VIEWS_ROUTE = /^\/projects\/([^/]+)\/views$/;
const PROJECT_VIDEO_ID_ROUTE = /^\/projects\/([^/]+)\/videos\/([^/]+)$/;
const ASSET_ID_ROUTE = /^\/assets\/([^/]+)$/;

/**
 * apps/api HTTP server — docs/03 §8. Routes land here as the Build Gate that
 * owns each capability builds it (BUILD 06 adds project creation and asset
 * upload; BUILD 07 adds analysis; everything else is still NOT_IMPLEMENTED
 * contracts elsewhere).
 */
export function createApp(context: AppContext = createAppContext(), logger = createConsoleLogger()) {
  return createServer((req, res) => {
    applyCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://internal');
        const path = url.pathname;

        if (req.method === 'GET' && path === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        if (req.method === 'POST' && path === '/projects') {
          await handleCreateProject(req, res, context);
          return;
        }

        const projectAssetsMatch = path.match(PROJECT_ASSETS_ROUTE);
        if (req.method === 'POST' && projectAssetsMatch) {
          await handleUploadAsset(req, res, context, projectAssetsMatch[1]!);
          return;
        }

        const projectAnalysisMatch = path.match(PROJECT_ANALYSIS_ROUTE);
        if (req.method === 'POST' && projectAnalysisMatch) {
          await handleRunAnalysis(req, res, context, projectAnalysisMatch[1]!);
          return;
        }

        const projectReferencesMatch = path.match(PROJECT_REFERENCES_ROUTE);
        if (req.method === 'POST' && projectReferencesMatch) {
          await handleExtractReference(req, res, context, projectReferencesMatch[1]!);
          return;
        }

        const projectGenerationEditsMatch = path.match(PROJECT_GENERATION_EDITS_ROUTE);
        if (req.method === 'POST' && projectGenerationEditsMatch) {
          await handleRunEdit(req, res, context, projectGenerationEditsMatch[1]!, projectGenerationEditsMatch[2]!);
          return;
        }

        const projectGenerationVideosMatch = path.match(PROJECT_GENERATION_VIDEOS_ROUTE);
        if (req.method === 'POST' && projectGenerationVideosMatch) {
          await handleRunVideo(req, res, context, projectGenerationVideosMatch[1]!, projectGenerationVideosMatch[2]!);
          return;
        }

        const projectVideoIdMatch = path.match(PROJECT_VIDEO_ID_ROUTE);
        if (req.method === 'GET' && projectVideoIdMatch) {
          await handleGetVideoStatus(res, context, projectVideoIdMatch[1]!, projectVideoIdMatch[2]!);
          return;
        }

        const projectGenerationsMatch = path.match(PROJECT_GENERATIONS_ROUTE);
        if (req.method === 'POST' && projectGenerationsMatch) {
          await handleRunGeneration(req, res, context, projectGenerationsMatch[1]!);
          return;
        }

        const projectViewsMatch = path.match(PROJECT_VIEWS_ROUTE);
        if (req.method === 'POST' && projectViewsMatch) {
          await handleRunView(req, res, context, projectViewsMatch[1]!);
          return;
        }

        const projectIdMatch = path.match(PROJECT_ID_ROUTE);
        if (req.method === 'GET' && projectIdMatch) {
          await handleGetProject(res, context, projectIdMatch[1]!);
          return;
        }

        const assetIdMatch = path.match(ASSET_ID_ROUTE);
        if (req.method === 'GET' && assetIdMatch) {
          await handleGetAsset(res, context, assetIdMatch[1]!);
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
  createApp(
    createAppContext({
      geminiApiKey: env.GEMINI_API_KEY,
      nanoBananaApiKey: env.NANO_BANANA_API_KEY,
      chatgptImageApiKey: env.CHATGPT_IMAGE_API_KEY,
      veoApiKey: env.VEO_API_KEY,
    }),
    logger,
  ).listen(env.API_PORT, () => {
    logger.info(`apps/api listening on :${env.API_PORT}`);
  });
}
