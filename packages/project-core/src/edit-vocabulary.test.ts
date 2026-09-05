import { describe, expect, it } from 'vitest';
import { EDIT_CATEGORIES } from './edit-vocabulary.js';

describe('Advanced Editor category vocabulary — docs/12', () => {
  it('names every docs/12 edit capability as a closed vocabulary entry', () => {
    expect(EDIT_CATEGORIES).toEqual([
      'inpaint-outpaint',
      'material-replacement',
      'furniture-object-replacement',
      'people-vegetation-vehicles-decor-environment',
      'lighting-atmosphere',
      'other',
    ]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(EDIT_CATEGORIES).size).toBe(EDIT_CATEGORIES.length);
  });
});
