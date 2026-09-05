import { describe, expect, it } from 'vitest';
import type { ExtractedVisualLanguage } from './reference-intelligence.js';
import { referenceCanInfluenceArchitecture, selectReferencesForPurpose } from './source-reference-separation.js';

function ref(purpose: ExtractedVisualLanguage['purpose']): ExtractedVisualLanguage {
  return { purpose, weight: 1, fields: {} };
}

describe('source/reference separation', () => {
  it('no reference purpose may ever influence architecture — enforced structurally, verified at runtime', () => {
    const purposes: ExtractedVisualLanguage['purpose'][] = [
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
    ];
    for (const purpose of purposes) {
      expect(referenceCanInfluenceArchitecture(purpose)).toBe(false);
    }
  });

  it('selects references matching the requested purpose', () => {
    const references = [ref('material'), ref('style'), ref('camera')];
    expect(selectReferencesForPurpose(references, 'style')).toEqual([ref('style')]);
  });

  it('treats "auto" and "overall-look" references as relevant to every purpose', () => {
    const references = [ref('auto'), ref('overall-look'), ref('material')];
    const forCamera = selectReferencesForPurpose(references, 'camera');
    expect(forCamera).toHaveLength(2);
    expect(forCamera.map((r) => r.purpose)).toEqual(['auto', 'overall-look']);
  });

  it('excludes references for unrelated specific purposes', () => {
    const references = [ref('material')];
    expect(selectReferencesForPurpose(references, 'camera')).toHaveLength(0);
  });
});
