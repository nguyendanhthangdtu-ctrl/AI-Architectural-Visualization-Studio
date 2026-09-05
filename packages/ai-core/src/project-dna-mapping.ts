import type {
  ArchitectureDNA,
  CameraDNA,
  EnvironmentDNA,
  InteriorDNA,
  LightingDNA,
  MaterialDNA,
  ProjectDNA,
} from '@avs/project-core';
import type { StructuredIntelligence } from './vision-analysis.js';

/**
 * Derives Project DNA from real Vision Analysis Engine output — docs/06
 * Reasoning Engine responsibility "Propagate Project DNA to views and
 * generations." Pure mapping, no I/O, no inference beyond what the analysis
 * already observed — this is the "facts observed" half of docs/06's
 * "separate facts observed from inferred assumptions," not a place to guess.
 *
 * `referenceDNA` is deliberately always null here: Reference Intelligence
 * (BUILD 10) doesn't exist yet, and its output type (`ExtractedVisualLanguage`)
 * carries no asset id to populate `ReferenceDNA.referenceAssetIds` from —
 * populating it is that gate's job, not this one's.
 */
export function deriveProjectDNA(structuredIntelligence: StructuredIntelligence): ProjectDNA {
  const { module, layers } = structuredIntelligence;
  const architecture = layers.architecture.data;

  const architectureDNA: ArchitectureDNA | null =
    module === 'architecture'
      ? {
          geometry: { description: architecture.geometry },
          openings: { description: architecture.openings },
          roof: { description: architecture.roof },
          facade: { description: architecture.facade },
          floorPlan: { description: architecture.floorPlan },
          ceiling: { description: architecture.ceiling },
          stairs: { description: architecture.stairs },
          proportions: { description: architecture.proportions },
        }
      : null;

  const interiorDNA: InteriorDNA | null =
    module === 'interior'
      ? {
          spatialLayout: { description: architecture.geometry },
          walls: { description: architecture.facade },
          floor: { description: architecture.floorPlan },
          ceiling: { description: architecture.ceiling },
          furnitureLayout: { objects: layers.object.data.objects },
        }
      : null;

  const cameraDNA: CameraDNA = {
    height: layers.camera.data.heightMeters,
    lens: layers.camera.data.lens,
    fieldOfView: layers.camera.data.fieldOfViewDegrees,
    perspective: layers.camera.data.perspective,
    eyeLevel: layers.camera.data.eyeLevel,
    projection: layers.camera.data.projection,
    verticalCorrection: layers.camera.data.verticalCorrection,
  };

  const materialDNA: MaterialDNA = {
    assignments: Object.fromEntries(
      layers.material.data.materials.map((material, index) => [
        material.surface || `material-${index}`,
        {
          type: material.type,
          finish: material.finish,
          roughness: material.roughness,
          reflectance: material.reflectance,
        },
      ]),
    ),
  };

  const lightingDNA: LightingDNA = {
    direction: layers.lighting.data.direction,
    timeOfDay: layers.lighting.data.timeOfDay,
    intensity: layers.lighting.data.intensity,
    softness: layers.lighting.data.softness,
    colorTemperature: layers.lighting.data.colorTemperature,
    artificialLighting: layers.lighting.data.artificialLighting,
  };

  const environmentDNA: EnvironmentDNA = {
    setting: layers.environment.data.setting,
    sky: layers.environment.data.sky,
    weather: layers.environment.data.weather,
    context: layers.environment.data.context,
  };

  return {
    architectureDNA,
    interiorDNA,
    cameraDNA,
    materialDNA,
    lightingDNA,
    environmentDNA,
    referenceDNA: null,
  };
}
