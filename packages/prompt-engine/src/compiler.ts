import type { NormalizedRequest } from '@avs/ai-core';
import { deriveStructuralConstraints } from '@avs/ai-core';

/**
 * Prompt Engine contract — docs/09_PROMPT_ENGINE_SPEC.md.
 * Structured Intelligence is the source of truth (CLAUDE.md rule 1); a prompt
 * is a versioned, compiled artifact, never itself persisted as the database.
 */
export interface MasterPromptSections {
  subject: string;
  architecture: string;
  style: string;
  camera: string;
  composition: string;
  material: string;
  lighting: string;
  environment: string;
  furnitureObjects: string;
  photography: string;
  realism: string;
  reference: string;
  constraints: string;
  output: string;
}

export interface CanonicalMasterPrompt {
  compilerVersion: string;
  normalizedRequestSnapshot: NormalizedRequest;
  sections: MasterPromptSections;
}

export interface PromptCompiler {
  compile(request: NormalizedRequest): Promise<CanonicalMasterPrompt>;
}

const COMPILER_VERSION = 'prompt-compiler:v1';

function fieldDescription(field: Record<string, unknown> | undefined): string {
  const value = field?.description;
  return typeof value === 'string' ? value : '';
}

function joinNonEmpty(parts: (string | null | undefined)[], separator = ' '): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(separator);
}

function compileSubject(request: NormalizedRequest): string {
  const { type, description } = request.structuredIntelligence.layers.subject.data;
  return joinNonEmpty([`${type}:`, description]);
}

/**
 * Module-conditional, matching `deriveProjectDNA` (BUILD 08): exactly one of
 * `architectureDNA`/`interiorDNA` is populated per docs/00 module split. This
 * section always carries the real structural facts for whichever module the
 * project is — never a placeholder — since a source image always has one.
 */
function compileArchitecture(request: NormalizedRequest): string {
  const dna = request.projectDNA;
  if (dna.architectureDNA) {
    const a = dna.architectureDNA;
    return joinNonEmpty([
      `Geometry: ${fieldDescription(a.geometry)}.`,
      `Openings: ${fieldDescription(a.openings)}.`,
      `Roof: ${fieldDescription(a.roof)}.`,
      `Facade: ${fieldDescription(a.facade)}.`,
      `Floor plan: ${fieldDescription(a.floorPlan)}.`,
      `Ceiling: ${fieldDescription(a.ceiling)}.`,
      `Stairs: ${fieldDescription(a.stairs)}.`,
      `Proportions: ${fieldDescription(a.proportions)}.`,
    ]);
  }
  if (dna.interiorDNA) {
    const i = dna.interiorDNA;
    return joinNonEmpty([
      `Spatial layout: ${fieldDescription(i.spatialLayout)}.`,
      `Walls: ${fieldDescription(i.walls)}.`,
      `Floor: ${fieldDescription(i.floor)}.`,
      `Ceiling: ${fieldDescription(i.ceiling)}.`,
    ]);
  }
  return '';
}

function compileCamera(request: NormalizedRequest): string {
  const c = request.projectDNA.cameraDNA;
  const cameraLock = request.locks.find((l) => l.id === 'camera');
  const parts = [
    c.height !== null ? `Height: ${c.height}m.` : null,
    c.lens ? `Lens: ${c.lens}.` : null,
    c.fieldOfView !== null ? `Field of view: ${c.fieldOfView}°.` : null,
    c.perspective ? `Perspective: ${c.perspective}.` : null,
    c.eyeLevel ? `Eye level: ${c.eyeLevel}.` : null,
    c.projection ? `Projection: ${c.projection}.` : null,
    c.verticalCorrection && c.verticalCorrection !== 'none' ? `Vertical correction: ${c.verticalCorrection}.` : null,
    cameraLock?.enabled ? 'Camera Lock enabled — preserve the original camera exactly.' : null,
  ];
  return joinNonEmpty(parts);
}

function compileComposition(request: NormalizedRequest): string {
  const c = request.structuredIntelligence.layers.composition.data;
  return joinNonEmpty([
    c.leadingLines ? `Leading lines: ${c.leadingLines}.` : null,
    c.ruleOfThirds ? `Rule of thirds: ${c.ruleOfThirds}.` : null,
    c.goldenRatio ? `Golden ratio: ${c.goldenRatio}.` : null,
    c.symmetry ? `Symmetry: ${c.symmetry}.` : null,
    c.balance ? `Balance: ${c.balance}.` : null,
    c.negativeSpace ? `Negative space: ${c.negativeSpace}.` : null,
    c.hierarchy ? `Hierarchy: ${c.hierarchy}.` : null,
  ]);
}

function compileMaterial(request: NormalizedRequest): string {
  const entries = Object.entries(request.projectDNA.materialDNA.assignments);
  if (entries.length === 0) return 'No materials observed.';
  return entries
    .map(([surface, m]) => `${surface}: ${m.type} (${m.finish} finish, ${m.roughness} roughness, ${m.reflectance} reflectance)`)
    .join('; ');
}

function compileLighting(request: NormalizedRequest): string {
  const l = request.projectDNA.lightingDNA;
  const parts = [
    l.timeOfDay ? `Time of day: ${l.timeOfDay}.` : null,
    l.direction ? `Direction: ${l.direction}.` : null,
    l.intensity ? `Intensity: ${l.intensity}.` : null,
    l.softness ? `Softness: ${l.softness}.` : null,
    l.colorTemperature ? `Color temperature: ${l.colorTemperature}.` : null,
    l.artificialLighting.length > 0 ? `Artificial lighting: ${l.artificialLighting.join(', ')}.` : null,
    'Medium exposure baseline, controlled highlights, detailed shadows, clean blacks, medium-to-high contrast, clear spatial layering.',
  ];
  return joinNonEmpty(parts);
}

function compileEnvironment(request: NormalizedRequest): string {
  const e = request.projectDNA.environmentDNA;
  return joinNonEmpty([
    e.setting ? `Setting: ${e.setting}.` : null,
    e.sky ? `Sky: ${e.sky}.` : null,
    e.weather ? `Weather: ${e.weather}.` : null,
    e.context ? `Context: ${e.context}.` : null,
  ]);
}

function compileFurnitureObjects(request: NormalizedRequest): string {
  const objects = request.structuredIntelligence.layers.object.data.objects;
  if (objects.length === 0) return 'No notable objects observed.';
  return objects.map((o) => `${o.label} (${o.category}): ${o.suggestedAction}`).join('; ');
}

function compilePhotography(request: NormalizedRequest): string {
  const p = request.structuredIntelligence.layers.photography.data;
  return joinNonEmpty([
    p.cameraSystemLook ? `Camera system look: ${p.cameraSystemLook}.` : null,
    p.lensBehavior ? `Lens behavior: ${p.lensBehavior}.` : null,
    p.exposure ? `Exposure: ${p.exposure}.` : null,
    p.dynamicRange ? `Dynamic range: ${p.dynamicRange}.` : null,
    p.depth ? `Depth of field: ${p.depth}.` : null,
    p.imperfections ? `Imperfections: ${p.imperfections}.` : null,
  ]);
}

function compileRealism(request: NormalizedRequest): string {
  const description = request.structuredIntelligence.layers.realLifeLook.data.description;
  return joinNonEmpty([description || 'Professional architectural photography.', 'Photorealistic.']);
}

function compileReference(request: NormalizedRequest): string {
  if (request.references.length === 0) return 'No reference images supplied.';
  return request.references
    .map((r) => `${r.purpose}: ${Object.entries(r.fields).map(([k, v]) => `${k}=${String(v)}`).join(', ') || '(no fields)'}`)
    .join('; ');
}

function compileConstraints(request: NormalizedRequest): string {
  const architectureLock = request.locks.find((l) => l.id === 'architecture');
  const constraints = deriveStructuralConstraints({ architectureLockEnabled: architectureLock?.enabled ?? false });
  const phrases = [
    constraints.strictlyAdhereToReferenceSketch ? 'Strictly adhere to the reference sketch.' : null,
    constraints.preserveStructuralIntegrity ? 'Preserve structural integrity.' : null,
    constraints.preserveExactGeometry ? 'Exact geometry — no deviation.' : null,
    constraints.noHallucinatedDetails ? 'No hallucinated details.' : null,
    constraints.exactLineArtTranslation ? 'Exact line-art translation.' : null,
    constraints.photorealistic ? 'Photorealistic.' : null,
    `Target resolution: ${constraints.targetResolution}.`,
  ];
  const uncertainties = request.structuredIntelligence.layers.constraints.data.notedUncertainties;
  return joinNonEmpty([...phrases, uncertainties.length > 0 ? `Noted uncertainties: ${uncertainties.join('; ')}.` : null]);
}

function compileOutput(request: NormalizedRequest): string {
  const s = request.scenario;
  const parts = [
    `Deliver as ${request.structuredIntelligence.module} photography.`,
    `Aspect ratio ${s.aspectRatio}.`,
    `Generation resolution ${s.generationResolution}, upscale to ${s.upscaleResolution}.`,
    `Render core: ${s.renderCore}.`,
    request.instructions.length > 0 ? `Additional instructions: ${request.instructions.join('; ')}.` : null,
  ];
  return joinNonEmpty(parts);
}

/**
 * Real, deterministic composition from an already-resolved `NormalizedRequest`
 * (BUILD 08's Reasoning Engine output) — no provider call, since every input
 * is already real structured data (Structured Intelligence is the source of
 * truth, CLAUDE.md rule 1; this only formats it, never invents content).
 */
export const promptCompiler: PromptCompiler = {
  async compile(request: NormalizedRequest): Promise<CanonicalMasterPrompt> {
    return {
      compilerVersion: COMPILER_VERSION,
      normalizedRequestSnapshot: request,
      sections: {
        subject: compileSubject(request),
        architecture: compileArchitecture(request),
        style: request.resolvedStyle,
        camera: compileCamera(request),
        composition: compileComposition(request),
        material: compileMaterial(request),
        lighting: compileLighting(request),
        environment: compileEnvironment(request),
        furnitureObjects: compileFurnitureObjects(request),
        photography: compilePhotography(request),
        realism: compileRealism(request),
        reference: compileReference(request),
        constraints: compileConstraints(request),
        output: compileOutput(request),
      },
    };
  },
};

/** Alias matching BUILD 02 service-boundary naming; same contract as PromptCompiler. */
export type PromptCompilerService = PromptCompiler;
