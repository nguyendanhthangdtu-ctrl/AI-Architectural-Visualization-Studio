import { resolveAutoLanguage } from '@avs/shared';
import { reasoningEngine, type NormalizedRequest } from '@avs/ai-core';
import { compilePromptOutput, type PromptOutput } from '@avs/prompt-engine';
import type { ProjectSessionState } from './state/project-session.js';

/**
 * Shared Reasoning Engine (BUILD 08) → Master Prompt Compiler (BUILD 11)
 * step — extracted so `ControlPanel`'s Compile Prompt action and the AI QC
 * Regenerate flow (BUILD 17) run the exact same real resolution, never two
 * copies of it (CLAUDE.md rule 9). `extraInstructions` lets a caller fold a
 * QC `correctionInstruction` into the resolution without inventing a second
 * compile path — docs/03 §4 "regeneration ... re-enters step 4 with the
 * correction merged into the normalized request."
 */
export async function compileNormalizedPrompt(
  state: Pick<ProjectSessionState, 'structuredIntelligence' | 'locks' | 'scenario' | 'references' | 'language'>,
  extraInstructions: string[] = [],
): Promise<{ normalized: NormalizedRequest; output: PromptOutput }> {
  if (!state.structuredIntelligence || state.locks.length === 0 || !state.scenario) {
    throw new Error('compileNormalizedPrompt requires structuredIntelligence, locks, and a scenario.');
  }

  const normalized = await reasoningEngine.resolve({
    structuredIntelligence: state.structuredIntelligence,
    locks: state.locks,
    scenario: state.scenario,
    references: state.references.map((r) => r.extractedVisualLanguage),
    instructions: extraInstructions,
  });
  const analysisLanguage = resolveAutoLanguage(state.language.aiAnalysisLanguage, state.language.uiLanguage);
  const output = await compilePromptOutput(normalized, {
    analysisLanguage,
    outputLanguage: state.language.promptOutputLanguage,
  });
  return { normalized, output };
}
