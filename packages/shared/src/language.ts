/**
 * Bilingual architecture — Architecture Amendment (inserted before BUILD 09).
 * Three INDEPENDENT language settings, per the amendment's explicit
 * requirement: UI chrome, AI analysis output, and Master Prompt output do
 * not have to match. Lives in packages/shared because apps/web (UI),
 * ai-core (analysis/reasoning), and prompt-engine (compilation) all need it,
 * and none of those may depend on each other for this.
 *
 * HARD RULE: domain/business data stays language-neutral. `LockId`,
 * `ReferencePurpose`, `LayerName`, scenario vocabulary values, etc. are and
 * remain stable English identifiers regardless of `uiLanguage` — only
 * *display text* (labels, generated prose) is ever translated. Never derive
 * a semantic decision from the current language; never localize an
 * identifier. This is what makes the domain layer safe to extend to a third
 * language later without touching stored data.
 */
export type Language = 'vi' | 'en';

/** 'auto' means "follow the resolved default for this context" — never a silent guess with no traceable rule. */
export type AutoLanguage = Language | 'auto';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['vi', 'en'];

export interface LanguageConfig {
  /** apps/web chrome language. Independent of the other two. */
  uiLanguage: Language;
  /** Vision Analysis Engine (BUILD 07) output language. 'auto' resolves via resolveAutoLanguage(). */
  aiAnalysisLanguage: AutoLanguage;
  /** Master Prompt Compiler (BUILD 11) output language. 'auto' resolves via resolveAutoLanguage(). */
  promptOutputLanguage: AutoLanguage;
}

export const DEFAULT_LANGUAGE_CONFIG: LanguageConfig = {
  uiLanguage: 'en',
  aiAnalysisLanguage: 'auto',
  promptOutputLanguage: 'auto',
};

/** Resolves 'auto' to a concrete Language using `fallback` (typically the current uiLanguage) — the one explicit, traceable rule for what 'auto' means. */
export function resolveAutoLanguage(value: AutoLanguage, fallback: Language): Language {
  return value === 'auto' ? fallback : value;
}

/** A value carried in both supported languages at once — the shape every bilingual prompt field uses (never a single string with an implied language). */
export interface BilingualText {
  en: string;
  vi: string;
}

export function bilingual(en: string, vi: string): BilingualText {
  return { en, vi };
}

/** Selects the requested language from a BilingualText, resolving 'auto' via `fallback`. */
export function pickLanguage(text: BilingualText, language: AutoLanguage, fallback: Language): string {
  return text[resolveAutoLanguage(language, fallback)];
}
