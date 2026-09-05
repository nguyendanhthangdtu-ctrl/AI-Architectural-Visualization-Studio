import type { LockId, Lock } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { DomainError } from '@avs/shared';
import type { PromptOutput } from './prompt-output.js';

/**
 * Prompt Inspector — Architecture Amendment (docs/02 UX "Prompt Inspector"
 * required control, previously undefined as a data contract). Exposes every
 * section the amendment names, each editable except where an enabled lock
 * protects it — an edit attempt on a locked section is REJECTED with a
 * clear error, never silently ignored and never silently accepted
 * (CLAUDE.md rule 15, docs/06 "never override explicit locks").
 *
 * "User edits must update structured intelligence/master prompt": this
 * module updates the Inspector's own local state (`edited`/`value`) for
 * real; propagating an edit back into a re-compiled `PromptOutput` is
 * BUILD 11's job (the Master Prompt Compiler doesn't exist yet) — not
 * invented here.
 */
export type PromptInspectorSectionKey =
  | 'subject'
  | 'architecture'
  | 'style'
  | 'camera'
  | 'composition'
  | 'material'
  | 'lighting'
  | 'environment'
  | 'furnitureObjects'
  | 'photography'
  | 'realism'
  | 'constraints'
  | 'referenceVisualLanguage'
  | 'userPreferenceContribution';

export const PROMPT_INSPECTOR_SECTION_KEYS: readonly PromptInspectorSectionKey[] = [
  'subject',
  'architecture',
  'style',
  'camera',
  'composition',
  'material',
  'lighting',
  'environment',
  'furnitureObjects',
  'photography',
  'realism',
  'constraints',
  'referenceVisualLanguage',
  'userPreferenceContribution',
];

/** Which Lock (if any) protects each section — docs/03 ADR-001. Sections not listed here have no lock. */
export const SECTION_LOCK: Partial<Record<PromptInspectorSectionKey, LockId>> = {
  architecture: 'architecture',
  camera: 'camera',
  material: 'material',
  style: 'style',
  lighting: 'lighting',
};

export interface PromptInspectorSectionState {
  key: PromptInspectorSectionKey;
  value: unknown;
  editable: boolean;
  edited: boolean;
  lockedBy: LockId | null;
}

export interface PromptInspectorState {
  sections: PromptInspectorSectionState[];
}

/** Reads each PromptOutput field into its Inspector section, resolving `editable`/`lockedBy` from the real current lock set. */
export function buildPromptInspectorState(promptOutput: PromptOutput, locks: readonly Lock[]): PromptInspectorState {
  const values: Record<PromptInspectorSectionKey, unknown> = {
    subject: promptOutput.promptIntelligence.subject,
    architecture: promptOutput.promptIntelligence.sourceArchitecture,
    style: promptOutput.promptIntelligence.style,
    camera: promptOutput.promptIntelligence.camera,
    composition: promptOutput.compiled.sections.composition,
    material: promptOutput.compiled.sections.material,
    lighting: promptOutput.promptIntelligence.lighting,
    environment: promptOutput.promptIntelligence.context,
    furnitureObjects: promptOutput.compiled.sections.furnitureObjects,
    photography: promptOutput.compiled.sections.photography,
    realism: promptOutput.compiled.sections.realism,
    constraints: promptOutput.promptIntelligence.technicalConstraints,
    referenceVisualLanguage: promptOutput.promptIntelligence.referenceVisualLanguage,
    userPreferenceContribution: promptOutput.promptIntelligence.userPreferenceContribution,
  };

  const sections = PROMPT_INSPECTOR_SECTION_KEYS.map((key): PromptInspectorSectionState => {
    const lockId = SECTION_LOCK[key];
    const lock = lockId ? locks.find((l) => l.id === lockId) : undefined;
    const lockedBy = lock?.enabled ? lockId! : null;
    return { key, value: values[key], editable: lockedBy === null, edited: false, lockedBy };
  });

  return { sections };
}

export interface PromptInspectorEdit {
  section: PromptInspectorSectionKey;
  newValue: unknown;
  editedAt: Timestamp;
  editedBy: UserId;
}

/**
 * Applies a real edit to the Inspector state. Throws (never silently
 * ignores or silently accepts) when the target section is currently
 * protected by an enabled lock.
 */
export function applyPromptInspectorEdit(state: PromptInspectorState, edit: PromptInspectorEdit): PromptInspectorState {
  const target = state.sections.find((s) => s.key === edit.section);
  if (!target) {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: `Unknown Prompt Inspector section "${edit.section}".`, retryable: false });
  }
  if (target.lockedBy) {
    throw new DomainError({
      code: 'LOCK_PROTECTED_FIELD',
      message: `Cannot edit "${edit.section}" — protected by the enabled ${target.lockedBy} Lock. Disable the lock first (explicit user action).`,
      retryable: false,
    });
  }
  return {
    sections: state.sections.map((s) => (s.key === edit.section ? { ...s, value: edit.newValue, edited: true } : s)),
  };
}
