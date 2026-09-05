import { useState } from 'react';
import {
  scenarioBuilder,
  DEFAULT_IMAGE_MODEL_RENDER_CORE,
  findImageModelByRenderCore,
  getEnabledImageModels,
  SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS,
  SCENARIO_ASPECT_RATIOS,
  SCENARIO_CAMERA_MODES,
  SCENARIO_CONTEXTS,
  SCENARIO_ENVIRONMENTS,
  SCENARIO_LIGHTING_OPTIONS,
  SCENARIO_RESOLUTIONS,
  SCENARIO_SUN_DIRECTIONS,
  type ScenarioInput,
} from '@avs/ai-core';
import type { ErrorEnvelope } from '@avs/shared';
import { toErrorEnvelope } from '../../api/errors.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { StatusIndicator } from '../StatusIndicator/StatusIndicator.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import styles from './ScenarioSlots.module.css';

type SelectFieldKey = Exclude<keyof ScenarioInput, 'artificialLighting'>;

/**
 * BUILD 25 (Multi-Model Image Engine) — "AI Image Model" only ever lists
 * models the registry (`@avs/ai-core`'s `image-model-registry.ts`) marks
 * `enabled: true` (never the still-`NOT_IMPLEMENTED` Google Flow), plus
 * `Auto` — a selection strategy, not a model, always offered. `renderCore`
 * itself still validates against the full, unchanged
 * `SCENARIO_RENDER_CORES` vocabulary server-side (`scenario.ts`) — this only
 * narrows what's visibly OFFERED here, never the underlying schema.
 */
const AI_IMAGE_MODEL_OPTIONS = [...getEnabledImageModels().map((model) => model.renderCore), 'Auto'];

/** "Nano Banana" -> "Nano Banana 2 — Google Gemini (gemini-3.1-flash-image)"; any value with no registry entry (e.g. "Auto") renders unchanged. */
function renderCoreOptionLabel(renderCore: string): string {
  const model = findImageModelByRenderCore(renderCore);
  return model ? `${model.displayName} — ${model.provider === 'google-gemini' ? 'Google Gemini' : model.provider} (${model.id})` : renderCore;
}

/** docs/07_SCENARIO_BUILDER_SPEC.md enumerations — the single source of truth is packages/ai-core's scenario-vocabulary.ts. */
const SELECT_FIELDS: { key: SelectFieldKey; label: string; options: readonly string[]; getOptionLabel?: (value: string) => string }[] = [
  { key: 'context', label: 'Context', options: SCENARIO_CONTEXTS },
  { key: 'lighting', label: 'Lighting', options: SCENARIO_LIGHTING_OPTIONS },
  { key: 'sunDirection', label: 'Sun Direction', options: SCENARIO_SUN_DIRECTIONS },
  { key: 'environment', label: 'Environment', options: SCENARIO_ENVIRONMENTS },
  { key: 'cameraMode', label: 'Camera', options: SCENARIO_CAMERA_MODES },
  { key: 'aspectRatio', label: 'Aspect Ratio', options: SCENARIO_ASPECT_RATIOS },
  { key: 'generationResolution', label: 'Generation Resolution', options: SCENARIO_RESOLUTIONS },
  { key: 'upscaleResolution', label: 'Upscale Resolution', options: SCENARIO_RESOLUTIONS },
  { key: 'renderCore', label: 'AI Image Model', options: AI_IMAGE_MODEL_OPTIONS, getOptionLabel: renderCoreOptionLabel },
];

const EMPTY_DRAFT: ScenarioInput = {
  context: '',
  lighting: '',
  sunDirection: '',
  artificialLighting: [],
  environment: '',
  cameraMode: '',
  aspectRatio: '',
  generationResolution: '',
  upscaleResolution: '',
  // BUILD 25 — Nano Banana 2 is the default AI image model, pre-selected
  // rather than requiring the user to pick one; every other slot still
  // starts blank.
  renderCore: DEFAULT_IMAGE_MODEL_RENDER_CORE,
};

/**
 * Scenario control slots — docs/07_SCENARIO_BUILDER_SPEC.md. Real, keyboard-
 * accessible controls; local draft state until "Apply Scenario" calls the
 * real `scenarioBuilder.normalize()` (BUILD 09, packages/ai-core — pure
 * domain logic, no network call needed) and writes the result into
 * `ProjectSessionState.scenario` — previously always null.
 */
export function ScenarioSlots() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [draft, setDraft] = useState<ScenarioInput>(EMPTY_DRAFT);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [applyError, setApplyError] = useState<ErrorEnvelope | undefined>(undefined);

  const canApply = SELECT_FIELDS.every((field) => draft[field.key].trim() !== '');

  const toggleArtificialLighting = (option: string) => {
    setDraft((prev) => ({
      ...prev,
      artificialLighting: prev.artificialLighting.includes(option)
        ? prev.artificialLighting.filter((o) => o !== option)
        : [...prev.artificialLighting, option],
    }));
  };

  const handleApply = async () => {
    setApplyStatus('loading');
    setApplyError(undefined);
    try {
      const normalized = await scenarioBuilder.normalize(draft);
      setState({ scenario: normalized });
      setApplyStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong applying the scenario.');
      setApplyError(envelope);
      setApplyStatus('error');
    }
  };

  return (
    <section className={styles.root} aria-labelledby="scenario-slots-title">
      <div className={styles.header}>
        <h2 id="scenario-slots-title" className={styles.title}>
          Scenario
        </h2>
        <StatusIndicator status={state.scenario ? 'ready' : 'idle'} label={state.scenario ? 'Applied' : 'Draft'} />
      </div>
      <div className={styles.grid}>
        {SELECT_FIELDS.map((field) => (
          <div className={styles.field} key={field.key}>
            <label htmlFor={`scenario-${field.key}`}>{field.label}</label>
            <select
              id={`scenario-${field.key}`}
              value={draft[field.key]}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
            >
              <option value="">—</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {field.getOptionLabel ? field.getOptionLabel(option) : option}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <fieldset className={styles.fieldset}>
        <legend>Artificial Lighting (optional, select any)</legend>
        <div className={styles.checkboxGroup}>
          {SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS.map((option) => (
            <label key={option} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={draft.artificialLighting.includes(option)}
                onChange={() => toggleArtificialLighting(option)}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className={styles.applyButton}
        disabled={!canApply || applyStatus === 'loading'}
        onClick={() => void handleApply()}
      >
        {applyStatus === 'loading' ? 'Applying…' : 'Apply Scenario'}
      </button>
      {applyStatus === 'error' && applyError ? (
        <ErrorState error={applyError} onRetry={() => void handleApply()} />
      ) : null}
    </section>
  );
}
