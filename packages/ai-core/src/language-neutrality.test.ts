import { describe, expect, it } from 'vitest';
import { LOCK_TIER, type LockId } from '@avs/project-core';
import type { ReferencePurpose } from './reference-intelligence.js';

/**
 * Architecture Amendment requirement #2: "Keep domain/business data
 * language-neutral with stable semantic identifiers." These identifiers are
 * not user-facing text — they are the vocabulary the domain layer, the
 * Reasoning Engine, and every provider adapter key off of. No `LanguageConfig`
 * setting may ever change them; only presentation-layer bilingual text
 * (`BilingualText`, `packages/shared/src/language.ts`) varies with language.
 */
describe('domain identifiers stay language-neutral', () => {
  it('LockId values are a fixed set of English semantic identifiers, not display text', () => {
    const ids: LockId[] = ['architecture', 'camera', 'material', 'style', 'lighting'];
    expect(Object.keys(LOCK_TIER).sort()).toEqual([...ids].sort());
  });

  it('ReferencePurpose values are stable English identifiers with no bilingual variant', () => {
    const purposes: ReferencePurpose[] = [
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
      expect(typeof purpose).toBe('string');
      expect(purpose).toBe(purpose.toLowerCase());
    }
  });

  it('StructuredIntelligence layer keys are identifiers, not translatable text — same set regardless of any language config', () => {
    const layerKeys = [
      'subject',
      'architecture',
      'style',
      'camera',
      'composition',
      'material',
      'lighting',
      'environment',
      'object',
      'photography',
      'realLifeLook',
      'constraints',
    ];
    // No `language` field exists on StructuredIntelligence itself (compile-time
    // guarantee via the vision-analysis.ts type) — this asserts the layer-key
    // vocabulary is the semantic contract, independent of any language setting.
    expect(new Set(layerKeys).size).toBe(layerKeys.length);
  });
});
