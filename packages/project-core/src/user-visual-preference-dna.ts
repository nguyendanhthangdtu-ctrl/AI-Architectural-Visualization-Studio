import type { Timestamp, UserId } from '@avs/shared';
import type { CameraDNA, LightingDNA } from './dna.js';

/**
 * User Visual Preference DNA — Architecture Amendment. Explicit, durable
 * creative preferences a user has actually approved/configured — the lowest
 * priority tier in docs/06's Reasoning Engine order ("6. Creative
 * enhancement"), never a substitute for what analysis observed or a lock
 * protects.
 *
 * HARD RULES (enforced by the applying function in ai-core, not here — this
 * file only defines the shape):
 * - Only an explicit user approval/selection/configuration action may create
 *   or update this record — never inferred from behavior, never guessed.
 * - It must never override Architecture Lock, Camera Lock, Material Lock, or
 *   any other current-project constraint.
 * - No field here may hold sensitive personal information — every field is
 *   a visual/creative preference (style, camera framing, lighting mood,
 *   material, color, contrast, aspect ratio, realism), never identity data.
 */
export interface UserVisualPreferenceDNA {
  userId: UserId;
  style: string | null;
  camera: Partial<CameraDNA> | null;
  lighting: Partial<LightingDNA> | null;
  material: string | null;
  color: string | null;
  contrast: string | null;
  cinematicPreference: boolean | null;
  greenery: string | null;
  peopleObjects: string | null;
  aspectRatio: string | null;
  realism: string | null;
  /** Explicit, user-named extras only — never a place to infer or store anything the user didn't directly set. */
  otherPreferences: Record<string, string>;
  updatedAt: Timestamp;
}

export function createEmptyUserVisualPreferenceDNA(params: { userId: UserId; updatedAt: Timestamp }): UserVisualPreferenceDNA {
  return {
    userId: params.userId,
    style: null,
    camera: null,
    lighting: null,
    material: null,
    color: null,
    contrast: null,
    cinematicPreference: null,
    greenery: null,
    peopleObjects: null,
    aspectRatio: null,
    realism: null,
    otherPreferences: {},
    updatedAt: params.updatedAt,
  };
}
