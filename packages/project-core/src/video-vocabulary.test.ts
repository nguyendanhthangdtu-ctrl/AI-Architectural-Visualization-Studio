import { describe, expect, it } from 'vitest';
import { VIDEO_LOCK_IDS, VIDEO_MOTION_TYPES } from './video-vocabulary.js';

describe('Image → Video vocabulary — docs/14', () => {
  it('names every docs/14 motion type as a closed vocabulary entry', () => {
    expect(VIDEO_MOTION_TYPES).toEqual([
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
    ]);
  });

  it('names every docs/14 video lock exactly, distinct from the 5 image Lock ids', () => {
    expect(VIDEO_LOCK_IDS).toEqual(['architecture', 'camera', 'objects', 'materials', 'temporal-consistency']);
  });

  it('has no duplicate entries in either vocabulary', () => {
    expect(new Set(VIDEO_MOTION_TYPES).size).toBe(VIDEO_MOTION_TYPES.length);
    expect(new Set(VIDEO_LOCK_IDS).size).toBe(VIDEO_LOCK_IDS.length);
  });
});
