import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { applyPromptInspectorEdit, buildPromptInspectorState, PROMPT_INSPECTOR_SECTION_KEYS } from './prompt-inspector.js';
import type { PromptOutput } from './prompt-output.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locks(overrides: Partial<Record<Lock['id'], boolean>> = {}): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function promptOutput(): PromptOutput {
  return {
    compiled: {
      compilerVersion: 'test',
      normalizedRequestSnapshot: {} as never,
      sections: {
        subject: 'a villa',
        architecture: 'boxy',
        style: 'modern',
        camera: 'eye level',
        composition: 'centered',
        material: 'concrete',
        lighting: 'golden hour',
        environment: 'urban',
        furnitureObjects: 'none',
        photography: 'clean',
        realism: 'photoreal',
        reference: '',
        constraints: 'preserve geometry',
        output: 'final',
      },
    },
    promptIntelligence: {
      language: { analysisLanguage: 'en', outputLanguage: 'auto' },
      subject: { en: 'a villa', vi: 'một biệt thự' },
      sourceArchitecture: null,
      style: { en: 'modern', vi: 'hiện đại' },
      details: { en: 'concrete', vi: 'bê tông' },
      context: { en: 'urban', vi: 'đô thị' },
      lighting: { dna: { direction: null, timeOfDay: null, intensity: null, softness: null, colorTemperature: null, artificialLighting: [] }, moodTags: [], exposure: { exposureBaseline: 'medium', highlightControl: 'controlled', shadowDetail: 'detailed', blackLevel: 'clean', contrast: 'medium-high', spatialLayering: 'clear' } },
      camera: { dna: { height: null, lens: null, fieldOfView: null, perspective: null, eyeLevel: null, projection: null, verticalCorrection: null }, lensCharacteristic: null, perspectiveType: null, illustrativeCameraSystem: null, preserveOriginalCamera: true },
      technicalConstraints: { strictlyAdhereToReferenceSketch: true, preserveStructuralIntegrity: true, preserveExactGeometry: true, noHallucinatedDetails: true, exactLineArtTranslation: true, photorealistic: true, targetResolution: '8K/Ultra' },
      referenceVisualLanguage: [],
      userPreferenceContribution: { appliedFields: [], suppressedFields: [] },
    },
    canonicalPromptDNA: { sections: [], completeCopyPastePrompt: { en: '', vi: '' } },
    masterPromptEn: 'final',
    masterPromptVi: 'cuối cùng',
    outputLanguage: 'auto',
  };
}

describe('Prompt Inspector — buildPromptInspectorState', () => {
  it('exposes every section the amendment names', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    expect(state.sections.map((s) => s.key)).toEqual(PROMPT_INSPECTOR_SECTION_KEYS);
  });

  it('marks Tier A/B-locked sections as not editable, naming which lock', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    const architecture = state.sections.find((s) => s.key === 'architecture')!;
    expect(architecture.editable).toBe(false);
    expect(architecture.lockedBy).toBe('architecture');
  });

  it('marks unlocked sections (Style Lock disabled by default) as editable', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    const style = state.sections.find((s) => s.key === 'style')!;
    expect(style.editable).toBe(true);
    expect(style.lockedBy).toBeNull();
  });

  it('marks sections with no lock at all (e.g. subject) as always editable', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    const subject = state.sections.find((s) => s.key === 'subject')!;
    expect(subject.editable).toBe(true);
    expect(subject.lockedBy).toBeNull();
  });
});

describe('Prompt Inspector — applyPromptInspectorEdit', () => {
  it('applies a real edit to an unlocked section, marking it edited', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    const next = applyPromptInspectorEdit(state, { section: 'style', newValue: 'Japandi', editedAt: now, editedBy: userId });
    const style = next.sections.find((s) => s.key === 'style')!;
    expect(style.value).toBe('Japandi');
    expect(style.edited).toBe(true);
  });

  it('rejects an edit to a locked section outright — never silently ignored, never silently accepted', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    expect(() => applyPromptInspectorEdit(state, { section: 'architecture', newValue: 'different', editedAt: now, editedBy: userId })).toThrow(
      expect.objectContaining({ code: 'LOCK_PROTECTED_FIELD' }),
    );
  });

  it('allows the edit once the corresponding lock is disabled (explicit user action)', () => {
    const state = buildPromptInspectorState(promptOutput(), locks({ material: false }));
    const next = applyPromptInspectorEdit(state, { section: 'material', newValue: 'marble', editedAt: now, editedBy: userId });
    expect(next.sections.find((s) => s.key === 'material')?.value).toBe('marble');
  });

  it('does not mutate the original state — pure, returns a new state', () => {
    const state = buildPromptInspectorState(promptOutput(), locks());
    const next = applyPromptInspectorEdit(state, { section: 'subject', newValue: 'a house', editedAt: now, editedBy: userId });
    expect(state.sections.find((s) => s.key === 'subject')?.edited).toBe(false);
    expect(next.sections.find((s) => s.key === 'subject')?.edited).toBe(true);
  });
});
