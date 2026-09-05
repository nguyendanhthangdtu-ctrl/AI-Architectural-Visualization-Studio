import { describe, expect, it } from 'vitest';
import { translateKnownTerm, translateOrMirror } from './vi-glossary.js';

describe('vi-glossary — real, bounded vocabulary translation (never a general translator)', () => {
  it('translates a known scenario vocabulary term for real', () => {
    expect(translateKnownTerm('Golden Hour')).toBe('giờ vàng');
    expect(translateKnownTerm('Preserve Original')).toBe('giữ nguyên góc máy gốc');
  });

  it('is case/whitespace-insensitive, matching the closed-vocabulary matching style used elsewhere (scenario.ts)', () => {
    expect(translateKnownTerm('  golden hour  ')).toBe('giờ vàng');
    expect(translateKnownTerm('GOLDEN HOUR')).toBe('giờ vàng');
  });

  it('translates known lighting mood tags and camera classification terms', () => {
    expect(translateKnownTerm('cinematic-lighting')).toBe('ánh sáng điện ảnh');
    expect(translateKnownTerm('two-point')).toBe('phối cảnh hai điểm tụ');
  });

  it('returns null (never a fabricated guess) for a term outside the closed vocabulary', () => {
    expect(translateKnownTerm('a completely freeform sentence from vision analysis')).toBeNull();
  });

  it('translateOrMirror falls back to the original text for an unknown term, never blank', () => {
    expect(translateOrMirror('some freeform description')).toBe('some freeform description');
    expect(translateOrMirror('Golden Hour')).toBe('giờ vàng');
  });
});
