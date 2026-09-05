/**
 * Prompt Intelligence Engine pipeline — Architecture Amendment. The
 * amendment's named stages, mapped to the real component that owns each one
 * and the Build Gate that implements it. This is documentation made
 * type-checked and testable (a stale mapping fails a test, not just a
 * comment nobody re-reads) — "do not implement the complete engine in this
 * amendment" means this file records the shape, not the behavior.
 */
export interface PipelineStage {
  stage: string;
  owner: string;
  buildGate: string;
}

export const PROMPT_INTELLIGENCE_PIPELINE: readonly PipelineStage[] = [
  { stage: 'SOURCE IMAGE', owner: 'apps/api Image Ingestion routes', buildGate: 'BUILD 06' },
  { stage: 'IMAGE VISION', owner: '@avs/ai-core createGeminiVisionAnalysisEngine', buildGate: 'BUILD 07' },
  { stage: 'STRUCTURED INTELLIGENCE', owner: '@avs/ai-core StructuredIntelligence schema', buildGate: 'BUILD 07' },
  {
    stage: 'VISUAL LANGUAGE EXTRACTION',
    owner: '@avs/ai-core createGeminiReferenceIntelligenceEngine().extract',
    buildGate: 'BUILD 10',
  },
  {
    stage: 'SOURCE/REFERENCE SEPARATION',
    owner: '@avs/ai-core source-reference-separation.ts (SourceArchitectureDNA / ReferenceVisualLanguage)',
    buildGate: 'Architecture Amendment',
  },
  { stage: 'LOCK & CONSTRAINT RESOLUTION', owner: '@avs/ai-core reasoningEngine.resolve', buildGate: 'BUILD 08' },
  {
    stage: 'USER PREFERENCE APPLICATION',
    owner: '@avs/ai-core applyUserVisualPreference',
    buildGate: 'Architecture Amendment',
  },
  { stage: 'MASTER PROMPT COMPILATION', owner: '@avs/prompt-engine promptCompiler.compile', buildGate: 'BUILD 11' },
  {
    stage: 'PROMPT INSPECTION',
    owner: '@avs/prompt-engine buildPromptInspectorState / applyPromptInspectorEdit',
    buildGate: 'Architecture Amendment (contract); UI wiring BUILD 11+',
  },
  {
    stage: 'USER APPROVAL/EDIT',
    owner: '@avs/prompt-engine applyPromptInspectorEdit',
    buildGate: 'Architecture Amendment (contract); UI wiring BUILD 11+',
  },
  { stage: 'MODEL ADAPTER', owner: '@avs/model-adapters ImageGenerationService', buildGate: 'BUILD 12' },
];
