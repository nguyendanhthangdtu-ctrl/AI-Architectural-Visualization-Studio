import { describe, expect, it } from 'vitest';
import type { Timestamp, UserId } from '@avs/shared';
import { createEmptyUserVisualPreferenceDNA } from './user-visual-preference-dna.js';

describe('createEmptyUserVisualPreferenceDNA', () => {
  it('starts with every preference field null/empty — nothing is ever pre-populated or inferred', () => {
    const dna = createEmptyUserVisualPreferenceDNA({ userId: 'u1' as UserId, updatedAt: 't' as Timestamp });
    expect(dna.style).toBeNull();
    expect(dna.camera).toBeNull();
    expect(dna.lighting).toBeNull();
    expect(dna.material).toBeNull();
    expect(dna.color).toBeNull();
    expect(dna.contrast).toBeNull();
    expect(dna.cinematicPreference).toBeNull();
    expect(dna.greenery).toBeNull();
    expect(dna.peopleObjects).toBeNull();
    expect(dna.aspectRatio).toBeNull();
    expect(dna.realism).toBeNull();
    expect(dna.otherPreferences).toEqual({});
  });

  it('carries the attributed userId and timestamp — every preference record is traceable to an explicit user', () => {
    const dna = createEmptyUserVisualPreferenceDNA({ userId: 'u1' as UserId, updatedAt: 't' as Timestamp });
    expect(dna.userId).toBe('u1');
    expect(dna.updatedAt).toBe('t');
  });
});
