/**
 * Image → Video vocabulary — docs/14_VIDEO_SPEC.md (BUILD 16), as closed
 * lists (same pattern as scenario-vocabulary.ts / edit-vocabulary.ts).
 *
 * `VIDEO_LOCK_IDS` is deliberately NOT `LockId` (lock.ts) reused — docs/14
 * names a genuinely different five: architecture/camera/materials overlap
 * conceptually with the image Lock model, but "objects" and "temporal
 * consistency" are video-specific concepts with no image-Lock equivalent,
 * and docs/14 never describes these as user-toggleable per-project settings
 * the way docs/03 ADR-001 does for the 5 image Locks — they read as fixed
 * guarantees a video generation always maintains, so this is a plain closed
 * list, not a stateful `Lock` object with history/pinnedRef.
 */
export const VIDEO_MOTION_TYPES = [
  'dolly',
  'pan',
  'orbit',
  'crane',
  'push-in',
  'pull-out',
  'people',
  'trees',
  'curtains',
  'light',
  'atmosphere',
] as const;

export type VideoMotionType = (typeof VIDEO_MOTION_TYPES)[number];

export const VIDEO_LOCK_IDS = ['architecture', 'camera', 'objects', 'materials', 'temporal-consistency'] as const;

export type VideoLockId = (typeof VIDEO_LOCK_IDS)[number];
