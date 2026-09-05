import type { ServerResponse } from 'node:http';

/** Shared by every route handler (routes.ts, auth/auth-routes.ts) — one place to change the response-writing convention, never duplicated. */
export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}
