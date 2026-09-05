import { SCENARIO_RESOLUTIONS } from './scenario-vocabulary.js';

/**
 * BUILD 25 (Multi-Model Image Engine / Nano Banana 2) — the first real model
 * registry for image generation. Before this, a "model" was only ever a bare
 * `renderCore` string (`scenario-vocabulary.ts`'s `SCENARIO_RENDER_CORES`,
 * BUILD 09) with no attached metadata; each adapter's own `capabilities()`
 * (`packages/model-adapters`) described what IT supports, but nothing
 * described the model to a human or to the UI. This registry is presentation
 * metadata ONLY — no API key, no fetch, no adapter factory — safe to import
 * from `apps/web` (which already depends on `@avs/ai-core`, never on
 * `@avs/model-adapters`, per CLAUDE.md rule 6 "server-side provider calls").
 *
 * `renderCore` is the join key back to the existing, unchanged
 * `SCENARIO_RENDER_CORES`/`renderCoreSchema`/`RENDER_CORE_SELECTION` values
 * (`apps/api/src/routes.ts`) — this registry describes them, it does not
 * replace or duplicate the selection mechanism itself.
 */
export interface ImageModelDefinition {
  /** The real provider model id sent on the wire, e.g. `gemini-3.1-flash-image`. */
  id: string;
  /** Joins to `SCENARIO_RENDER_CORES`/`renderCoreSchema` — the value actually sent as `renderCore`. */
  renderCore: string;
  provider: string;
  displayName: string;
  type: 'image-generation';
  capabilities: {
    defaultResolution: string;
    supportedResolutions: readonly string[];
    supportedAspectRatios: readonly string[];
    supportsReferenceImages: boolean;
    supportsImageEditing: boolean;
  };
  /** False for a render core that exists in the schema but has no real, callable implementation yet (docs/03 §7 — e.g. Google Flow). Never offered as a user-facing choice while false. */
  enabled: boolean;
}

/**
 * One entry per real `renderCore` value. `id`/`capabilities` mirror each
 * adapter's own real config/`capabilities()` (`packages/model-adapters`) —
 * kept in sync by hand today (both sides are small and rarely change;
 * `ai-core` does not depend on `model-adapters`, so there is no automated
 * cross-package check — each adapter's own test file separately asserts its
 * real default model id/resolution mapping matches this registry's values).
 */
export const IMAGE_MODEL_REGISTRY: readonly ImageModelDefinition[] = [
  {
    id: 'gemini-3.1-flash-image',
    renderCore: 'Nano Banana',
    provider: 'google-gemini',
    displayName: 'Nano Banana 2',
    type: 'image-generation',
    capabilities: {
      // BUILD 26 fix — expressed in the app's own SCENARIO_RESOLUTIONS
      // vocabulary, like every other entry here (this was previously listed
      // in Nano Banana 2's own provider-side image_size values —
      // '0.5K'/'1K'/'2K'/'4K' — a real, inconsistent unit mismatch against
      // every other entry, which meant a UI reading this field would have
      // wrongly disabled 'Preview'/'6K'/'8K/Ultra' as "unsupported" even
      // though `mapResolutionToImageSize()` (nano-banana-adapter.ts)
      // already accepts and correctly translates any of them — capped at
      // Nano Banana 2's real 4K ceiling, never rejected.
      defaultResolution: 'Preview', // maps to Nano Banana 2's real '1K' baseline via mapResolutionToImageSize()
      supportedResolutions: [...SCENARIO_RESOLUTIONS],
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportsReferenceImages: true,
      supportsImageEditing: true,
    },
    enabled: true,
  },
  {
    id: 'gpt-image-1',
    renderCore: 'ChatGPT Image',
    provider: 'openai',
    displayName: 'ChatGPT Image',
    type: 'image-generation',
    capabilities: {
      // Expressed in the app's own SCENARIO_RESOLUTIONS vocabulary (like
      // every other entry here) — chatgpt-image-adapter.ts's own
      // `mapResolutionToQuality()` is what translates '2K' to gpt-image-1's
      // real `quality: "medium"` API value; this registry never repeats
      // that provider-specific mapping, only the app-level vocabulary.
      defaultResolution: '2K',
      supportedResolutions: [...SCENARIO_RESOLUTIONS],
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
      supportsReferenceImages: true,
      supportsImageEditing: true,
    },
    enabled: true,
  },
  {
    id: 'google-flow',
    renderCore: 'Google Flow',
    provider: 'google',
    displayName: 'Google Flow',
    type: 'image-generation',
    capabilities: {
      defaultResolution: 'Preview',
      supportedResolutions: [...SCENARIO_RESOLUTIONS],
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportsReferenceImages: false,
      supportsImageEditing: false,
    },
    // BUILD 12 finding, unchanged: no official public API exists for Google
    // Flow itself. Kept in the registry (it's still a real, resolvable
    // render-core server-side, docs/03 §7) but never offered as a visible
    // choice — see getEnabledImageModels().
    enabled: false,
  },
] as const;

/** The default selection this build's spec requires: Nano Banana 2. */
export const DEFAULT_IMAGE_MODEL_RENDER_CORE = 'Nano Banana';

/** Only real, callable models — never Google Flow's still-NOT_IMPLEMENTED entry. */
export function getEnabledImageModels(): ImageModelDefinition[] {
  return IMAGE_MODEL_REGISTRY.filter((model) => model.enabled);
}

export function findImageModelByRenderCore(renderCore: string): ImageModelDefinition | undefined {
  return IMAGE_MODEL_REGISTRY.find((model) => model.renderCore === renderCore);
}
