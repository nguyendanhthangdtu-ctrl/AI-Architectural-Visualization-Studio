import type { ArchitectureDNA } from '@avs/project-core';
import type { ExtractedVisualLanguage, ReferencePurpose } from './reference-intelligence.js';

/**
 * Source vs Reference separation — Architecture Amendment, formalizing
 * CLAUDE.md rule 5 ("Reference images transmit visual language according to
 * purpose; never silently replace source architecture") and docs/06's
 * conflict example under a name the amendment specifically asks for.
 *
 * `SourceArchitectureDNA` is an explicit alias for `ArchitectureDNA`
 * (project-core/dna.ts) — same shape, not duplicated, but named to make the
 * "this came from the user's actual source image, Architecture Lock highest
 * priority" fact visible at every call site that matters, not just implied
 * by which variable happens to hold it.
 */
export type SourceArchitectureDNA = ArchitectureDNA;

/**
 * `ReferenceVisualLanguage` is an explicit alias for `ExtractedVisualLanguage`
 * (reference-intelligence.ts) — same reasoning as above.
 */
export type ReferenceVisualLanguage = ExtractedVisualLanguage;

/**
 * There is no runtime "authorize architecture override" flag here, and
 * deliberately so: `ReferencePurpose` structurally has no `'architecture'`
 * value (reference-intelligence.ts), so a reference literally cannot claim
 * to carry architecture — CLAUDE.md rule 5 is enforced by the type system,
 * not a runtime check that could be bypassed. "Explicit authorization" to
 * let a reference influence architecture would be a deliberately separate,
 * new mechanism (e.g. Creative View, Post-MVP per docs/01) — not a field
 * bolted onto this type. This function documents that guarantee and gives
 * calling code one place to assert it, rather than five ad hoc checks.
 */
const PURPOSES_THAT_MAY_INFLUENCE_ARCHITECTURE: readonly ReferencePurpose[] = [];

export function referenceCanInfluenceArchitecture(purpose: ReferencePurpose): boolean {
  return (PURPOSES_THAT_MAY_INFLUENCE_ARCHITECTURE as readonly string[]).includes(purpose);
}

/**
 * Splits a list of references into those relevant to a given purpose and
 * the rest — the mechanical half of "reference transmits visual language
 * according to purpose." `'auto'`/`'overall-look'` references are treated
 * as relevant to every purpose (they didn't declare a specific scope).
 */
export function selectReferencesForPurpose(
  references: readonly ReferenceVisualLanguage[],
  purpose: ReferencePurpose,
): ReferenceVisualLanguage[] {
  return references.filter((ref) => ref.purpose === purpose || ref.purpose === 'auto' || ref.purpose === 'overall-look');
}
