import type { AutoLanguage, BilingualText, Language } from '@avs/shared';
import type { NormalizedRequest } from '@avs/ai-core';
import { promptCompiler } from './compiler.js';
import { mapNormalizedRequestToPromptIntelligence, type UserPreferenceContribution } from './prompt-intelligence.js';
import { buildCanonicalPromptDNA, type CanonicalPromptSection } from './canonical-prompt-dna.js';
import { bilingualFromMasterPrompts, type PromptOutput } from './prompt-output.js';
import { translateOrMirror } from './vi-glossary.js';

/**
 * Master Prompt Compiler orchestration — BUILD 11. Ties together the real
 * `PromptCompiler.compile()` (docs/09's original 14-section internal form),
 * the Architecture Amendment's `PromptIntelligence` mapping, and the
 * amendment's `CanonicalPromptDNA` (the user's pre-existing 8-section
 * bilingual deliverable) into one `PromptOutput` — never three competing
 * systems (docs/03 §22, §24).
 *
 * Bilingual text here uses REAL, bounded vocabulary translation
 * (`vi-glossary.ts`) for the app's own closed vocabularies (scenario terms,
 * lighting mood tags, camera classification, structural-constraint phrases)
 * — never a general-purpose translation call (CLAUDE.md rule 7 "never fake a
 * production integration"). Freeform text (a Vision Analysis description
 * sentence) is mirrored with an explicit warning at the `PromptIntelligence`
 * layer (`mirrorAsPromptFieldValue`, prompt-intelligence.ts) — real full-text
 * translation is a distinct, later capability, not invented here.
 */

const REAL_LIFE_PHOTOGRAPHY_DEFAULT: BilingualText = {
  en: 'Real-life photography, professional architectural photography, photorealistic, 8K resolution',
  vi: 'ảnh chụp thực tế, nhiếp ảnh kiến trúc chuyên nghiệp, chân thực như ảnh chụp, độ phân giải 8K',
};

/** Kept deliberately short (concise/keyword-oriented, not grammatical clauses) — Vietnamese needs more words per concept than English, and these feed a 40-word-per-section budget alongside several other phrases. */
const CONSTRAINT_PHRASES: Readonly<Record<string, BilingualText>> = {
  strictlyAdhereToReferenceSketch: { en: 'strict adherence to reference sketch', vi: 'bám sát phác thảo' },
  preserveStructuralIntegrity: { en: 'preserve structural integrity', vi: 'giữ toàn vẹn cấu trúc' },
  preserveExactGeometry: { en: 'exact geometry', vi: 'hình học chính xác' },
  noHallucinatedDetails: { en: 'no hallucinated details', vi: 'không bịa đặt chi tiết' },
  exactLineArtTranslation: { en: 'exact line-art translation', vi: 'đúng nét vẽ gốc' },
  photorealistic: { en: 'photorealistic', vi: 'chân thực như ảnh' },
};

function joinBilingual(parts: BilingualText[], separator = ', '): BilingualText {
  return {
    en: parts.map((p) => p.en).filter(Boolean).join(separator),
    vi: parts.map((p) => p.vi).filter(Boolean).join(separator),
  };
}

function mirrorTerm(value: string): BilingualText {
  return { en: value, vi: translateOrMirror(value) };
}

function buildSubjectSpaceSection(request: NormalizedRequest): CanonicalPromptSection {
  const { type, description } = request.structuredIntelligence.layers.subject.data;
  return {
    key: 'subjectSpace',
    label: { en: 'Subject / Space', vi: 'Chủ thể / Không gian' },
    content: joinBilingual([mirrorTerm(type), mirrorTerm(description)]),
  };
}

function buildStyleSection(request: NormalizedRequest): CanonicalPromptSection {
  return {
    key: 'style',
    label: { en: 'Style', vi: 'Phong cách' },
    content: mirrorTerm(request.resolvedStyle),
  };
}

function buildDetailsSection(request: NormalizedRequest): CanonicalPromptSection {
  const materials = Object.values(request.projectDNA.materialDNA.assignments).map((m) => mirrorTerm(m.type));
  const objects = request.structuredIntelligence.layers.object.data.objects.map((o) => mirrorTerm(o.label));
  const parts = [...materials, ...objects];
  return {
    key: 'details',
    label: { en: 'Details', vi: 'Chi tiết' },
    content: parts.length > 0 ? joinBilingual(parts) : { en: 'no notable details observed', vi: 'không có chi tiết đáng chú ý' },
  };
}

function buildContextSection(request: NormalizedRequest): CanonicalPromptSection {
  const e = request.projectDNA.environmentDNA;
  const parts = [e.setting, e.sky, e.weather].filter((v): v is string => Boolean(v)).map(mirrorTerm);
  return {
    key: 'context',
    label: { en: 'Context', vi: 'Bối cảnh' },
    content: parts.length > 0 ? joinBilingual(parts) : { en: 'context not observed', vi: 'chưa quan sát được bối cảnh' },
  };
}

function buildLightingSection(request: NormalizedRequest): CanonicalPromptSection {
  const l = request.projectDNA.lightingDNA;
  const parts = [l.timeOfDay, l.direction ? `${l.direction} light` : null, l.colorTemperature]
    .filter((v): v is string => Boolean(v))
    .map(mirrorTerm);
  return {
    key: 'lighting',
    label: { en: 'Lighting', vi: 'Ánh sáng' },
    content: parts.length > 0 ? joinBilingual(parts) : { en: 'lighting not observed', vi: 'chưa quan sát được ánh sáng' },
  };
}

function buildCameraSection(request: NormalizedRequest, cameraLensCharacteristic: string | null, perspectiveType: string | null): CanonicalPromptSection {
  const cameraLock = request.locks.find((l) => l.id === 'camera');
  const parts = [
    cameraLensCharacteristic ? mirrorTerm(cameraLensCharacteristic) : null,
    perspectiveType ? mirrorTerm(perspectiveType) : null,
    cameraLock?.enabled ? { en: 'preserve original camera', vi: 'giữ nguyên góc máy gốc' } : null,
  ].filter((p): p is BilingualText => p !== null);
  return {
    key: 'cameraAndPhotographySystem',
    label: { en: 'Camera & Photography System', vi: 'Máy ảnh & Hệ thống nhiếp ảnh' },
    content: parts.length > 0 ? joinBilingual(parts) : { en: 'camera not observed', vi: 'chưa quan sát được máy ảnh' },
  };
}

function buildTechnicalConstraintsSection(constraints: Record<string, boolean>): CanonicalPromptSection {
  const parts = Object.entries(CONSTRAINT_PHRASES)
    .filter(([key]) => constraints[key])
    .map(([, phrase]) => phrase);
  return {
    key: 'technicalStructuralControl',
    label: { en: 'Technical / Structural Control', vi: 'Kiểm soát kỹ thuật / Cấu trúc' },
    content: joinBilingual(parts),
  };
}

export interface CompilePromptOutputOptions {
  analysisLanguage: Language;
  outputLanguage: AutoLanguage;
  userPreferenceContribution?: UserPreferenceContribution;
}

/**
 * Compiles a full `PromptOutput` (deliverables A-D of the amendment) from an
 * already-resolved `NormalizedRequest`. Pure/deterministic — no provider
 * call — matching `promptCompiler.compile()` and `scenarioBuilder.normalize()`.
 */
export async function compilePromptOutput(
  request: NormalizedRequest,
  options: CompilePromptOutputOptions,
): Promise<PromptOutput> {
  const compiled = await promptCompiler.compile(request);
  const promptIntelligence = mapNormalizedRequestToPromptIntelligence(request, {
    analysisLanguage: options.analysisLanguage,
    outputLanguage: options.outputLanguage,
    ...(options.userPreferenceContribution ? { userPreferenceContribution: options.userPreferenceContribution } : {}),
  });

  const technicalConstraints = promptIntelligence.technicalConstraints;
  const constraintFlags: Record<string, boolean> = {
    strictlyAdhereToReferenceSketch: technicalConstraints.strictlyAdhereToReferenceSketch,
    preserveStructuralIntegrity: technicalConstraints.preserveStructuralIntegrity,
    preserveExactGeometry: technicalConstraints.preserveExactGeometry,
    noHallucinatedDetails: technicalConstraints.noHallucinatedDetails,
    exactLineArtTranslation: technicalConstraints.exactLineArtTranslation,
    photorealistic: technicalConstraints.photorealistic,
  };

  const sections: CanonicalPromptSection[] = [
    { key: 'realLifePhotography', label: { en: 'Real-life photography', vi: 'Ảnh chụp thực tế' }, content: REAL_LIFE_PHOTOGRAPHY_DEFAULT },
    buildSubjectSpaceSection(request),
    buildStyleSection(request),
    buildDetailsSection(request),
    buildContextSection(request),
    buildLightingSection(request),
    buildCameraSection(request, promptIntelligence.camera.lensCharacteristic, promptIntelligence.camera.perspectiveType),
    buildTechnicalConstraintsSection(constraintFlags),
  ];
  // Append target resolution as a plain keyword, kept out of the phrase-map above (not a boolean flag).
  const technicalSection = sections.find((s) => s.key === 'technicalStructuralControl')!;
  technicalSection.content = {
    en: [technicalSection.content.en, `target resolution ${technicalConstraints.targetResolution}`].filter(Boolean).join(', '),
    vi: [technicalSection.content.vi, `độ phân giải mục tiêu ${translateOrMirror(technicalConstraints.targetResolution)}`]
      .filter(Boolean)
      .join(', '),
  };

  const completeCopyPastePrompt: BilingualText = joinBilingual(
    sections.map((s) => s.content),
    '. ',
  );
  const canonicalPromptDNA = buildCanonicalPromptDNA(sections, completeCopyPastePrompt);

  // Master Prompt EN/VI (deliverables B/C) are the same canonical content as the
  // "Complete copy/paste Prompt" above, one per language — the full, verbose
  // docs/09 14-section breakdown stays available via `compiled` for callers that
  // need per-field detail (e.g. a future Model Adapter), not duplicated here.
  const masterPromptEn = completeCopyPastePrompt.en;
  const masterPromptVi = completeCopyPastePrompt.vi;

  const bilingual = bilingualFromMasterPrompts(masterPromptEn, masterPromptVi);

  return {
    compiled,
    promptIntelligence,
    canonicalPromptDNA,
    masterPromptEn,
    masterPromptVi,
    // Deliverable D "Optional bilingual output" — both languages together, not a single-language pick
    // (selectCompleteCopyPastePrompt, prompt-output.ts, is the accessor for a single resolved language).
    bilingualPrompt: `EN: ${bilingual.en}\n\nVI: ${bilingual.vi}`,
    outputLanguage: options.outputLanguage,
  };
}
