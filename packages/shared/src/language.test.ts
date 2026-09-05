import { describe, expect, it } from 'vitest';
import { bilingual, DEFAULT_LANGUAGE_CONFIG, pickLanguage, resolveAutoLanguage, SUPPORTED_LANGUAGES } from './language.js';

describe('bilingual language architecture', () => {
  it('supports exactly vi and en today, designed to add more later without breaking the type', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['vi', 'en']);
  });

  it('defaults to independent settings — uiLanguage fixed, analysis/output following auto', () => {
    expect(DEFAULT_LANGUAGE_CONFIG).toEqual({
      uiLanguage: 'en',
      aiAnalysisLanguage: 'auto',
      promptOutputLanguage: 'auto',
    });
  });

  it('resolveAutoLanguage passes a concrete language through unchanged', () => {
    expect(resolveAutoLanguage('vi', 'en')).toBe('vi');
    expect(resolveAutoLanguage('en', 'vi')).toBe('en');
  });

  it('resolveAutoLanguage resolves "auto" via the explicit fallback — never a silent guess', () => {
    expect(resolveAutoLanguage('auto', 'vi')).toBe('vi');
    expect(resolveAutoLanguage('auto', 'en')).toBe('en');
  });

  it('pickLanguage reads the requested side of a BilingualText', () => {
    const text = bilingual('Modern villa', 'Biệt thự hiện đại');
    expect(pickLanguage(text, 'en', 'vi')).toBe('Modern villa');
    expect(pickLanguage(text, 'vi', 'en')).toBe('Biệt thự hiện đại');
  });

  it('pickLanguage resolves "auto" the same way resolveAutoLanguage does', () => {
    const text = bilingual('Modern villa', 'Biệt thự hiện đại');
    expect(pickLanguage(text, 'auto', 'vi')).toBe('Biệt thự hiện đại');
  });
});
