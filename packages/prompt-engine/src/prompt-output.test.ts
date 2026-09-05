import { describe, expect, it } from 'vitest';
import { bilingual, pickLanguage, resolveAutoLanguage } from '@avs/shared';
import { bilingualFromMasterPrompts, selectCompleteCopyPastePrompt, type PromptOutput } from './prompt-output.js';

function output(overrides: Partial<PromptOutput> = {}): PromptOutput {
  return {
    compiled: { compilerVersion: 'test', normalizedRequestSnapshot: {} as never, sections: {} as never },
    promptIntelligence: {} as never,
    canonicalPromptDNA: { sections: [], completeCopyPastePrompt: { en: 'Master prompt EN', vi: 'Master prompt VI' } },
    masterPromptEn: 'Master prompt EN',
    masterPromptVi: 'Master prompt VI',
    outputLanguage: 'auto',
    ...overrides,
  };
}

describe('Prompt Output language selection — amendment requirement #5', () => {
  it('selects the English master prompt when resolved output language is en', () => {
    expect(selectCompleteCopyPastePrompt(output(), 'en')).toBe('Master prompt EN');
  });

  it('selects the Vietnamese master prompt when resolved output language is vi', () => {
    expect(selectCompleteCopyPastePrompt(output(), 'vi')).toBe('Master prompt VI');
  });

  it('resolves "auto" promptOutputLanguage through resolveAutoLanguage before selecting — never a silent guess', () => {
    const promptOutputLanguage = 'auto';
    const uiLanguage = 'vi';
    const resolved = resolveAutoLanguage(promptOutputLanguage, uiLanguage);
    expect(resolved).toBe('vi');
    expect(selectCompleteCopyPastePrompt(output(), resolved)).toBe('Master prompt VI');
  });

  it('bilingualFromMasterPrompts and pickLanguage agree on the same resolved text', () => {
    const combined = bilingualFromMasterPrompts('Master prompt EN', 'Master prompt VI');
    expect(pickLanguage(combined, 'auto', 'en')).toBe('Master prompt EN');
    expect(pickLanguage(bilingual(combined.en, combined.vi), 'vi', 'en')).toBe('Master prompt VI');
  });
});
