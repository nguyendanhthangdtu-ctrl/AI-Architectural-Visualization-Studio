import type { AutoLanguage, BilingualText } from '@avs/shared';
import type { CanonicalMasterPrompt } from './compiler.js';
import type { CanonicalPromptDNA } from './canonical-prompt-dna.js';
import type { PromptIntelligence } from './prompt-intelligence.js';

/**
 * Prompt Output — Architecture Amendment. Ties together the EXISTING
 * `CanonicalMasterPrompt` (docs/09's original 3-level/14-section internal
 * compiler structure, BUILD 11) with the amendment's new bilingual
 * `CanonicalPromptDNA` — one output type, not two competing systems.
 *
 * Deliverables A-D the amendment names explicitly:
 *   A. Structured Prompt Intelligence → `promptIntelligence`
 *   B. Master Prompt — English        → `masterPromptEn`
 *   C. Master Prompt — Vietnamese     → `masterPromptVi`
 *   D. Optional bilingual output      → `bilingualPrompt`
 */
export interface PromptOutput {
  compiled: CanonicalMasterPrompt;
  promptIntelligence: PromptIntelligence;
  canonicalPromptDNA: CanonicalPromptDNA;
  masterPromptEn: string;
  masterPromptVi: string;
  bilingualPrompt?: string;
  outputLanguage: AutoLanguage;
}

/** Selects the copy/paste-ready prompt text for the resolved output language. */
export function selectCompleteCopyPastePrompt(output: PromptOutput, resolvedOutputLanguage: 'vi' | 'en'): string {
  return resolvedOutputLanguage === 'vi' ? output.masterPromptVi : output.masterPromptEn;
}

export function bilingualFromMasterPrompts(masterPromptEn: string, masterPromptVi: string): BilingualText {
  return { en: masterPromptEn, vi: masterPromptVi };
}
