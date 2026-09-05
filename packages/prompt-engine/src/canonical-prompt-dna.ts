import type { BilingualText } from '@avs/shared';

/**
 * Canonical Prompt DNA — Architecture Amendment. This is the user's
 * PRE-EXISTING structure, preserved verbatim as the source of truth for
 * what a compiled prompt must contain. CLAUDE.md rule 8 / the amendment's
 * own instruction: do not silently remove, weaken, or reorder these
 * sections, and do not rewrite this into a different conceptual system.
 *
 * This is NOT a replacement for `MasterPromptSections` (compiler.ts,
 * docs/09's original 14-field internal breakdown) — that remains the Master
 * Prompt Compiler's (BUILD 11) internal structured form. `CanonicalPromptDNA`
 * is the higher-level, user-facing, bilingual deliverable BUILD 11 must
 * ultimately produce FROM that internal form. See `PromptOutput`
 * (prompt-output.ts) for how the two relate.
 */
export type CanonicalPromptSectionKey =
  | 'realLifePhotography' // "Real-life photography / Ảnh chụp thực tế"
  | 'subjectSpace' // "Subject / Space"
  | 'style'
  | 'details'
  | 'context'
  | 'lighting'
  | 'cameraAndPhotographySystem'
  | 'technicalStructuralControl';

/** Order matters — this is the canonical section order, preserved exactly as given. */
export const CANONICAL_PROMPT_SECTION_ORDER: readonly CanonicalPromptSectionKey[] = [
  'realLifePhotography',
  'subjectSpace',
  'style',
  'details',
  'context',
  'lighting',
  'cameraAndPhotographySystem',
  'technicalStructuralControl',
];

export const CANONICAL_PROMPT_SECTION_LABELS: Readonly<Record<CanonicalPromptSectionKey, BilingualText>> = {
  realLifePhotography: { en: 'Real-life photography', vi: 'Ảnh chụp thực tế' },
  subjectSpace: { en: 'Subject / Space', vi: 'Chủ thể / Không gian' },
  style: { en: 'Style', vi: 'Phong cách' },
  details: { en: 'Details', vi: 'Chi tiết' },
  context: { en: 'Context', vi: 'Bối cảnh' },
  lighting: { en: 'Lighting', vi: 'Ánh sáng' },
  cameraAndPhotographySystem: { en: 'Camera & Photography System', vi: 'Máy ảnh & Hệ thống nhiếp ảnh' },
  technicalStructuralControl: { en: 'Technical / Structural Control', vi: 'Kiểm soát kỹ thuật / Cấu trúc' },
};

/**
 * One canonical section's content. `content` must stay concise and
 * keyword-oriented (the amendment's explicit output-style rule) — enforced
 * by `assertConciseKeywordStyle` below, not just documented.
 */
export interface CanonicalPromptSection {
  key: CanonicalPromptSectionKey;
  label: BilingualText;
  content: BilingualText;
}

/**
 * The complete canonical structure — the eight ordered sections plus the
 * "Complete copy/paste Prompt" (English + Vietnamese) the amendment
 * explicitly names as a required deliverable, not just an implied summary.
 */
export interface CanonicalPromptDNA {
  sections: CanonicalPromptSection[];
  completeCopyPastePrompt: BilingualText;
}

/** Maximum words per section before it's no longer "concise, keyword-oriented" — a deliberately generous ceiling, not a hard prose limit. */
const MAX_CONCISE_WORDS = 40;

export function assertConciseKeywordStyle(section: CanonicalPromptSection): void {
  for (const language of ['en', 'vi'] as const) {
    const wordCount = section.content[language].trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_CONCISE_WORDS) {
      throw new Error(
        `Canonical prompt section "${section.key}" (${language}) has ${wordCount} words — must stay concise and keyword-oriented (max ${MAX_CONCISE_WORDS}).`,
      );
    }
  }
}

export function buildCanonicalPromptDNA(
  sections: readonly CanonicalPromptSection[],
  completeCopyPastePrompt: BilingualText,
): CanonicalPromptDNA {
  const ordered = [...sections].sort(
    (a, b) => CANONICAL_PROMPT_SECTION_ORDER.indexOf(a.key) - CANONICAL_PROMPT_SECTION_ORDER.indexOf(b.key),
  );
  for (const section of ordered) {
    assertConciseKeywordStyle(section);
  }
  return { sections: ordered, completeCopyPastePrompt };
}
