import { describe, expect, it } from 'vitest';
import {
  buildCanonicalPromptDNA,
  CANONICAL_PROMPT_SECTION_LABELS,
  CANONICAL_PROMPT_SECTION_ORDER,
  assertConciseKeywordStyle,
  type CanonicalPromptSection,
} from './canonical-prompt-dna.js';

function section(key: CanonicalPromptSection['key'], en: string, vi: string): CanonicalPromptSection {
  return { key, label: CANONICAL_PROMPT_SECTION_LABELS[key], content: { en, vi } };
}

describe('canonical prompt DNA — preserving the user-specified structure exactly', () => {
  it('preserves the exact section order the user specified', () => {
    expect(CANONICAL_PROMPT_SECTION_ORDER).toEqual([
      'realLifePhotography',
      'subjectSpace',
      'style',
      'details',
      'context',
      'lighting',
      'cameraAndPhotographySystem',
      'technicalStructuralControl',
    ]);
  });

  it('preserves "Real-life photography / Ảnh chụp thực tế" as the default section label, bilingual', () => {
    expect(CANONICAL_PROMPT_SECTION_LABELS.realLifePhotography).toEqual({
      en: 'Real-life photography',
      vi: 'Ảnh chụp thực tế',
    });
  });

  it('re-orders sections passed out of order back into the canonical order', () => {
    const dna = buildCanonicalPromptDNA(
      [section('style', 'Modern', 'Hiện đại'), section('realLifePhotography', 'Real photo', 'Ảnh thực')],
      { en: 'full prompt', vi: 'toàn bộ prompt' },
    );
    expect(dna.sections.map((s) => s.key)).toEqual(['realLifePhotography', 'style']);
  });

  it('includes the "Complete copy/paste Prompt" as a required bilingual deliverable', () => {
    const dna = buildCanonicalPromptDNA([], { en: 'full prompt', vi: 'toàn bộ prompt' });
    expect(dna.completeCopyPastePrompt).toEqual({ en: 'full prompt', vi: 'toàn bộ prompt' });
  });

  it('accepts a real concise, keyword-oriented section', () => {
    expect(() => assertConciseKeywordStyle(section('style', 'modern, minimal, warm tones', 'hiện đại, tối giản'))).not.toThrow();
  });

  it('rejects a section that is not concise/keyword-oriented — the amendment\'s explicit output-style rule, enforced not just documented', () => {
    const longProse = Array.from({ length: 50 }, () => 'word').join(' ');
    expect(() => assertConciseKeywordStyle(section('details', longProse, 'chi tiết'))).toThrow(/concise and keyword-oriented/);
  });
});
