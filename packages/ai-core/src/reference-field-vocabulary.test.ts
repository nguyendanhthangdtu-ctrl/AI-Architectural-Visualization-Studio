import { describe, expect, it } from 'vitest';
import {
  fieldKeysForPurpose,
  filterFieldsForPurpose,
  REFERENCE_PURPOSE_FIELD_KEYS,
  REFERENCE_PURPOSES,
} from './reference-field-vocabulary.js';

describe('reference field vocabulary — CLAUDE.md rule 5, enforced not just documented', () => {
  it('names all ten purposes the amendment/docs/08 specify', () => {
    expect([...REFERENCE_PURPOSES].sort()).toEqual(
      [
        'style',
        'material',
        'lighting',
        'composition',
        'camera',
        'environment',
        'furniture',
        'color',
        'overall-look',
        'auto',
      ].sort(),
    );
  });

  it('no purpose is ever allowed to carry an architecture/geometry/floorPlan field', () => {
    const forbidden = ['architecture', 'geometry', 'floorPlan', 'roof', 'stairs', 'proportions', 'openings'];
    for (const purpose of REFERENCE_PURPOSES) {
      const allowed = fieldKeysForPurpose(purpose);
      for (const f of forbidden) {
        expect(allowed).not.toContain(f);
      }
    }
  });

  it("'camera' purpose only carries photographic character, never a position/FOV to override CameraDNA", () => {
    expect(REFERENCE_PURPOSE_FIELD_KEYS.camera).toEqual(['lensCharacteristic', 'framingStyle', 'depthOfFieldLook']);
  });

  it("'auto' and 'overall-look' are supersets of every other purpose's fields", () => {
    const auto = new Set(fieldKeysForPurpose('auto'));
    const overallLook = new Set(fieldKeysForPurpose('overall-look'));
    for (const purpose of REFERENCE_PURPOSES) {
      if (purpose === 'auto' || purpose === 'overall-look') continue;
      for (const key of fieldKeysForPurpose(purpose)) {
        expect(auto.has(key)).toBe(true);
        expect(overallLook.has(key)).toBe(true);
      }
    }
  });

  it("'auto' and 'overall-look' carry the same field vocabulary as each other", () => {
    expect(new Set(fieldKeysForPurpose('auto'))).toEqual(new Set(fieldKeysForPurpose('overall-look')));
  });

  it('filterFieldsForPurpose keeps only allowed keys for a narrow purpose', () => {
    const filtered = filterFieldsForPurpose('style', { style: 'Modern', influences: ['Bauhaus'], material: 'oak' });
    expect(filtered).toEqual({ style: 'Modern', influences: ['Bauhaus'] });
  });

  it('filterFieldsForPurpose strips an architecture-leak even if a model output included one', () => {
    const filtered = filterFieldsForPurpose('style', {
      style: 'Modern',
      architecture: 'boxy massing, flat roof',
      geometry: 'rectangular',
    });
    expect(filtered).toEqual({ style: 'Modern' });
  });

  it('filterFieldsForPurpose returns everything relevant for overall-look', () => {
    const filtered = filterFieldsForPurpose('overall-look', { style: 'Modern', dominantTones: 'warm', architecture: 'boxy' });
    expect(filtered).toEqual({ style: 'Modern', dominantTones: 'warm' });
  });
});
