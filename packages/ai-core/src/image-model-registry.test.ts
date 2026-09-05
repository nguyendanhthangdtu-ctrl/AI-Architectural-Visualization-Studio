import { describe, expect, it } from 'vitest';
import { SCENARIO_RENDER_CORES, SCENARIO_RESOLUTIONS } from './scenario-vocabulary.js';
import {
  DEFAULT_IMAGE_MODEL_RENDER_CORE,
  findImageModelByRenderCore,
  getEnabledImageModels,
  IMAGE_MODEL_REGISTRY,
} from './image-model-registry.js';

describe('IMAGE_MODEL_REGISTRY (BUILD 25 Multi-Model Image Engine)', () => {
  it('every entry joins to a real SCENARIO_RENDER_CORES value — never an invented render core', () => {
    for (const model of IMAGE_MODEL_REGISTRY) {
      expect(SCENARIO_RENDER_CORES as readonly string[]).toContain(model.renderCore);
    }
  });

  it('has no duplicate ids or renderCore values', () => {
    const ids = IMAGE_MODEL_REGISTRY.map((m) => m.id);
    const renderCores = IMAGE_MODEL_REGISTRY.map((m) => m.renderCore);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(renderCores).size).toBe(renderCores.length);
  });

  it('every defaultResolution is itself one of that model\'s own supportedResolutions', () => {
    for (const model of IMAGE_MODEL_REGISTRY) {
      expect(model.capabilities.supportedResolutions).toContain(model.capabilities.defaultResolution);
    }
  });

  it('contains Nano Banana 2 with the exact required id/provider/displayName', () => {
    const nanoBanana2 = findImageModelByRenderCore('Nano Banana');
    expect(nanoBanana2).toMatchObject({
      id: 'gemini-3.1-flash-image',
      provider: 'google-gemini',
      displayName: 'Nano Banana 2',
      type: 'image-generation',
      enabled: true,
    });
    // BUILD 26 — expressed in the app's own SCENARIO_RESOLUTIONS vocabulary,
    // like every other registry entry (see image-model-registry.ts's own
    // doc comment for why this was a real unit-mismatch bug, now fixed).
    expect(nanoBanana2?.capabilities.supportedResolutions).toEqual([...SCENARIO_RESOLUTIONS]);
    expect(nanoBanana2?.capabilities.defaultResolution).toBe('Preview');
  });

  it('sets Nano Banana 2 as the default image model render core', () => {
    expect(DEFAULT_IMAGE_MODEL_RENDER_CORE).toBe('Nano Banana');
    expect(findImageModelByRenderCore(DEFAULT_IMAGE_MODEL_RENDER_CORE)?.id).toBe('gemini-3.1-flash-image');
  });

  it('excludes Google Flow from enabled models — no public API exists for it (BUILD 12 finding, unchanged)', () => {
    const enabled = getEnabledImageModels();
    expect(enabled.some((m) => m.renderCore === 'Google Flow')).toBe(false);
    expect(IMAGE_MODEL_REGISTRY.find((m) => m.renderCore === 'Google Flow')?.enabled).toBe(false);
  });

  it('includes ChatGPT Image as an enabled, non-default model', () => {
    const enabled = getEnabledImageModels();
    expect(enabled.some((m) => m.renderCore === 'ChatGPT Image' && m.id === 'gpt-image-1')).toBe(true);
  });

  it('findImageModelByRenderCore returns undefined for an unknown render core', () => {
    expect(findImageModelByRenderCore('Does Not Exist')).toBeUndefined();
  });
});
