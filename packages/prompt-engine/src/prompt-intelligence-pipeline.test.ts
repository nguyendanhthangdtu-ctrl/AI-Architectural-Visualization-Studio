import { describe, expect, it } from 'vitest';
import { PROMPT_INTELLIGENCE_PIPELINE } from './prompt-intelligence-pipeline.js';

describe('Prompt Intelligence Engine pipeline', () => {
  it('names every stage the amendment specifies, in order', () => {
    expect(PROMPT_INTELLIGENCE_PIPELINE.map((s) => s.stage)).toEqual([
      'SOURCE IMAGE',
      'IMAGE VISION',
      'STRUCTURED INTELLIGENCE',
      'VISUAL LANGUAGE EXTRACTION',
      'SOURCE/REFERENCE SEPARATION',
      'LOCK & CONSTRAINT RESOLUTION',
      'USER PREFERENCE APPLICATION',
      'MASTER PROMPT COMPILATION',
      'PROMPT INSPECTION',
      'USER APPROVAL/EDIT',
      'MODEL ADAPTER',
    ]);
  });

  it('assigns every stage a real owning component and Build Gate — no stage left unowned', () => {
    for (const stage of PROMPT_INTELLIGENCE_PIPELINE) {
      expect(stage.owner.length).toBeGreaterThan(0);
      expect(stage.buildGate.length).toBeGreaterThan(0);
    }
  });

  it('does not place Master Prompt Compilation before Lock & Constraint Resolution — precedence order matters', () => {
    const stages = PROMPT_INTELLIGENCE_PIPELINE.map((s) => s.stage);
    expect(stages.indexOf('LOCK & CONSTRAINT RESOLUTION')).toBeLessThan(stages.indexOf('MASTER PROMPT COMPILATION'));
  });
});
