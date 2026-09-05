import type { UserVisualPreferenceDNA } from '@avs/project-core';
import type { NormalizedRequest } from './reasoning-engine.js';

/**
 * User Preference Application — Architecture Amendment, pipeline stage
 * "USER PREFERENCE APPLICATION" (between LOCK & CONSTRAINT RESOLUTION and
 * MASTER PROMPT COMPILATION). Applies `UserVisualPreferenceDNA` on top of an
 * ALREADY-RESOLVED `NormalizedRequest` (BUILD 08's reasoning-engine output)
 * — never touches the reasoning engine's own priority resolution, only fills
 * in fields that resolution left free.
 *
 * PRECEDENCE (docs/06 tier 6, "Creative enhancement" — lowest priority):
 * a real, enabled lock ALWAYS wins. UserVisualPreferenceDNA has no
 * architecture field at all (by construction — see its own doc comment),
 * so architecture is categorically never touched here, not even
 * conditionally. Camera/material/lighting preferences apply only when their
 * respective lock is disabled; a suppressed field is always reported, never
 * silently dropped (CLAUDE.md rule 15).
 */
export interface UserPreferenceApplicationResult {
  request: NormalizedRequest;
  appliedFields: string[];
  suppressedFields: { field: string; reason: string }[];
}

export function applyUserVisualPreference(
  request: NormalizedRequest,
  preference: UserVisualPreferenceDNA,
): UserPreferenceApplicationResult {
  const appliedFields: string[] = [];
  const suppressedFields: { field: string; reason: string }[] = [];

  const styleLock = request.locks.find((l) => l.id === 'style');
  const cameraLock = request.locks.find((l) => l.id === 'camera');
  const materialLock = request.locks.find((l) => l.id === 'material');
  const lightingLock = request.locks.find((l) => l.id === 'lighting');

  let resolvedStyle = request.resolvedStyle;
  let projectDNA = request.projectDNA;

  if (preference.style) {
    if (styleLock?.enabled) {
      suppressedFields.push({ field: 'style', reason: 'Style Lock is enabled — user preference cannot override an active lock.' });
    } else {
      resolvedStyle = preference.style;
      appliedFields.push('style');
    }
  }

  if (preference.camera) {
    if (cameraLock?.enabled) {
      suppressedFields.push({
        field: 'camera',
        reason: 'Camera Lock is enabled — user preference cannot override protected camera DNA.',
      });
    } else {
      projectDNA = { ...projectDNA, cameraDNA: { ...projectDNA.cameraDNA, ...preference.camera } };
      appliedFields.push('camera');
    }
  }

  if (preference.material) {
    if (materialLock?.enabled) {
      suppressedFields.push({
        field: 'material',
        reason: 'Material Lock is enabled — user preference cannot override protected material DNA.',
      });
    } else {
      appliedFields.push('material');
    }
  }

  if (preference.lighting) {
    if (lightingLock?.enabled) {
      suppressedFields.push({
        field: 'lighting',
        reason: 'Lighting Lock is enabled — user preference cannot override the pinned lighting values.',
      });
    } else {
      projectDNA = { ...projectDNA, lightingDNA: { ...projectDNA.lightingDNA, ...preference.lighting } };
      appliedFields.push('lighting');
    }
  }

  return {
    request: { ...request, resolvedStyle, projectDNA },
    appliedFields,
    suppressedFields,
  };
}
