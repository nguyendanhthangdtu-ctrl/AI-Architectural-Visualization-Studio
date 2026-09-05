/**
 * Closed vocabularies — docs/07_SCENARIO_BUILDER_SPEC.md, exactly as
 * specified there. `scenario.ts`'s `normalize()` validates every field
 * against these; nothing outside these lists is accepted, "Custom" included
 * only where docs/07 explicitly lists it as an option.
 */
export const SCENARIO_CONTEXTS = [
  'Residential',
  'Luxury Villa',
  'Urban',
  'Resort',
  'Tropical',
  'Coastal',
  'Forest',
  'Mountain',
  'Commercial',
  'Custom',
] as const;

export const SCENARIO_LIGHTING_OPTIONS = [
  'Morning',
  'Midday',
  'Afternoon',
  'Golden Hour',
  'Sunset',
  'Blue Hour',
  'Night',
  'Overcast',
  'Studio',
  'Custom',
] as const;

export const SCENARIO_SUN_DIRECTIONS = ['Front', 'Back', 'Left', 'Right', 'Side', 'Top', 'Auto'] as const;

export const SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS = [
  'Downlight IES',
  'Accent',
  'LED strip',
  'Cove',
  'Pendant',
  'Wall light',
] as const;

export const SCENARIO_ENVIRONMENTS = [
  'Clear sky',
  'Cloudy',
  'Tropical',
  'Urban',
  'Garden',
  'Forest',
  'Coastal',
  'Mountain',
  'Minimal',
  'Cinematic',
] as const;

export const SCENARIO_CAMERA_MODES = [
  'Preserve Original',
  'Wide',
  'Standard',
  'Telephoto',
  'Architectural',
  'Eye Level',
  'Low',
  'High',
] as const;

export const SCENARIO_ASPECT_RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16', '2:3', '21:9', 'Custom'] as const;

/** Used for both generationResolution and upscaleResolution — docs/07 "Keep generation and upscale resolution distinct" (two fields, one shared vocabulary). */
export const SCENARIO_RESOLUTIONS = ['Preview', '2K', '4K', '6K', '8K/Ultra'] as const;

/** BUILD 27 (Multi-Model Image Engine: Nano Banana 2 + Nano Banana Pro + ChatGPT Image) — added 'Nano Banana Pro', a real, distinct, callable model (gemini-3-pro-image), never a renamed/aliased Nano Banana 2. */
export const SCENARIO_RENDER_CORES = ['Nano Banana', 'Nano Banana Pro', 'Google Flow', 'ChatGPT Image', 'Auto'] as const;
