import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { ProjectId } from '@avs/shared';
import type { AppContext } from './app-context.js';
import { sendJson } from './http-utils.js';

/**
 * BUILD 19 Phase 6 (DB/Storage/Queue/Observability Readiness) — `/health`
 * (server.ts) only ever answers "is this process alive," unconditionally;
 * it says nothing about whether the app can actually serve a real request.
 * `/ready` checks the two dependencies a request genuinely can't succeed
 * without: the database and the asset store, each with one trivial real
 * operation (a lookup on a random, guaranteed-absent id — never a table
 * scan, never real user data touched). Never returns a stack trace, a file
 * path, or any secret — only `ok`/`error` per check.
 */
export interface ReadinessCheck {
  status: 'ok' | 'error';
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: {
    database: ReadinessCheck;
    assetStore: ReadinessCheck;
  };
}

export async function checkReadiness(context: AppContext): Promise<ReadinessResult> {
  const probeId = randomUUID();

  const database: ReadinessCheck = await context.projectRepository
    .getById(probeId as ProjectId)
    .then(() => ({ status: 'ok' as const }))
    .catch(() => ({ status: 'error' as const }));

  const assetStore: ReadinessCheck = await context.assetStore
    .get(probeId as never)
    .then(() => ({ status: 'ok' as const }))
    .catch(() => ({ status: 'error' as const }));

  const status: ReadinessResult['status'] = database.status === 'ok' && assetStore.status === 'ok' ? 'ready' : 'not_ready';
  return { status, checks: { database, assetStore } };
}

export async function handleReadiness(res: ServerResponse, context: AppContext): Promise<void> {
  const result = await checkReadiness(context);
  sendJson(res, result.status === 'ready' ? 200 : 503, result);
}
