import { describe, expect, it } from 'vitest';
import type { Timestamp, UserId } from '@avs/shared';
import { applyLockChange, createDefaultLocks, LOCK_TIER } from './lock.js';

const userId = 'user-1' as UserId;
const now = '2026-09-04T00:00:00.000Z' as Timestamp;

describe('createDefaultLocks', () => {
  const locks = createDefaultLocks({ analysisVersion: 'v1', setBy: userId, setAt: now });

  it('enables the three source-fidelity locks by default', () => {
    for (const id of ['architecture', 'camera', 'material'] as const) {
      const lock = locks.find((l) => l.id === id);
      expect(lock?.tier).toBe('source-fidelity');
      expect(lock?.enabled).toBe(true);
      expect(lock?.pinnedRef).toEqual({ kind: 'analysis-version', analysisVersion: 'v1' });
    }
  });

  it('disables the two output-stability locks by default and leaves them unpinned', () => {
    for (const id of ['style', 'lighting'] as const) {
      const lock = locks.find((l) => l.id === id);
      expect(lock?.tier).toBe('output-stability');
      expect(lock?.enabled).toBe(false);
      expect(lock?.pinnedRef).toBeNull();
    }
  });

  it('matches the fixed tier assignment for every lock id', () => {
    for (const lock of locks) {
      expect(lock.tier).toBe(LOCK_TIER[lock.id]);
    }
  });
});

describe('applyLockChange', () => {
  it('never outranks source-fidelity vs output-stability tiering when toggled', () => {
    const locks = createDefaultLocks({ analysisVersion: 'v1', setBy: userId, setAt: now });
    const styleLock = locks.find((l) => l.id === 'style')!;

    const accepted = applyLockChange(styleLock, {
      enabled: true,
      setBy: userId,
      setAt: now,
      reason: 'user-accepted-generation',
      pinnedRef: { kind: 'generation-version', generationVersionId: 'gv-1' },
    });

    expect(accepted.tier).toBe('output-stability');
    expect(accepted.enabled).toBe(true);
    expect(accepted.pinnedRef).toEqual({ kind: 'generation-version', generationVersionId: 'gv-1' });
    expect(accepted.history).toHaveLength(2);
    expect(styleLock.enabled).toBe(false); // original is untouched — no in-place mutation
  });
});
