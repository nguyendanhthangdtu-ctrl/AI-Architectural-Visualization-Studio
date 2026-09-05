import { DomainError } from '@avs/shared';

/**
 * JobQueue interface — docs/03_TECHNICAL_ARCHITECTURE.md ADR-004. All
 * long-running work (analysis, generation, video, QC) is submitted through
 * this interface; the concrete engine is a BUILD 02-confirmed, still-open
 * decision (§13) — InMemoryJobQueue below is a dev/bootstrap reference
 * implementation only, not a production queue.
 *
 * `updateStatus` added at BUILD 13 — the Image Generation Pipeline is this
 * interface's first real caller, and docs/11 step 7 "Track status" requires
 * actually being able to move a job past 'queued', which the BUILD 02
 * scaffolding didn't yet support.
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobRecord {
  id: string;
  idempotencyKey: string;
  status: JobStatus;
  createdAt: string;
  /**
   * BUILD 21 (Production AI Provider Integration, cost/duplicate-generation
   * safety) — the cached outcome once this idempotency key has fully
   * completed once. Lets a caller (`routes.ts`'s `submitGeneration`) replay a
   * client-retried request against the exact same result instead of calling
   * a real, possibly-billed provider a second time for a request that
   * already succeeded once.
   */
  result?: unknown;
}

export interface JobQueue {
  enqueue(params: { idempotencyKey: string }): Promise<JobRecord>;
  getStatus(id: string): Promise<JobRecord | null>;
  updateStatus(id: string, status: JobStatus, result?: unknown): Promise<JobRecord>;
}

export class InMemoryJobQueue implements JobQueue {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async enqueue(params: { idempotencyKey: string }): Promise<JobRecord> {
    const existingId = this.byIdempotencyKey.get(params.idempotencyKey);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing) return existing; // idempotent replay, no duplicate job
    }
    const id = `job-${this.jobs.size + 1}`;
    const record: JobRecord = {
      id,
      idempotencyKey: params.idempotencyKey,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, record);
    this.byIdempotencyKey.set(params.idempotencyKey, id);
    return record;
  }

  async getStatus(id: string): Promise<JobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async updateStatus(id: string, status: JobStatus, result?: unknown): Promise<JobRecord> {
    const existing = this.jobs.get(id);
    if (!existing) {
      throw new DomainError({ code: 'JOB_NOT_FOUND', message: `No job with id ${id}`, retryable: false });
    }
    const updated = { ...existing, status, ...(result !== undefined ? { result } : {}) };
    this.jobs.set(id, updated);
    return updated;
  }
}
