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

/**
 * BUILD 21 (Production AI Provider Integration, Phase 6) — `configured`
 * means only "a credential is present in this process's configuration."
 * It is DELIBERATELY not called "ready," "operational," or "verified": this
 * repository has no live-verification tracking (no persisted "last
 * successful real provider call" state), so presence of an API key is never
 * treated here as proof the provider actually works. That evidence can only
 * ever come from an actual successful request — see
 * `live-provider-smoke.test.ts` and docs/BUILD_21_OPERATOR_RUNBOOK.md.
 * Provider configuration deliberately does NOT affect the overall `status`
 * below — a deployment with no AI provider key yet can still be `ready` for
 * auth/asset/DB traffic; only a missing DB/asset-store dependency does.
 */
export interface ProviderConfigurationCheck {
  configured: boolean;
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: {
    database: ReadinessCheck;
    assetStore: ReadinessCheck;
  };
  providers: {
    gemini: ProviderConfigurationCheck;
    nanoBanana: ProviderConfigurationCheck;
    /** BUILD 27 — Nano Banana Pro (gemini-3-pro-image). */
    nanoBananaPro: ProviderConfigurationCheck;
    chatgptImage: ProviderConfigurationCheck;
    veo: ProviderConfigurationCheck;
    /** BUILD 22 — real vendor (Resend) + credential both configured; `InMemoryEmailSender` (no real vendor) always reports `false` here. */
    email: ProviderConfigurationCheck;
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
  return {
    status,
    checks: { database, assetStore },
    providers: {
      gemini: { configured: context.providerConfiguration.gemini },
      nanoBanana: { configured: context.providerConfiguration.nanoBanana },
      nanoBananaPro: { configured: context.providerConfiguration.nanoBananaPro },
      chatgptImage: { configured: context.providerConfiguration.chatgptImage },
      veo: { configured: context.providerConfiguration.veo },
      email: { configured: context.providerConfiguration.email },
    },
  };
}

export async function handleReadiness(res: ServerResponse, context: AppContext): Promise<void> {
  const result = await checkReadiness(context);
  sendJson(res, result.status === 'ready' ? 200 : 503, result);
}
