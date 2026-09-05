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
import type { ReadinessProviders } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { StatusIndicator } from '../StatusIndicator/StatusIndicator.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import styles from './ScenarioSlots.module.css';

type SelectFieldKey = Exclude<keyof ScenarioInput, 'artificialLighting'>;

/**
 * BUILD 25 (Multi-Model Image Engine) — "AI Image Model" only ever lists
 * models the registry (`@avs/ai-core`'s `image-model-registry.ts`) marks
 * `enabled: true` (never the still-`NOT_IMPLEMENTED` Google Flow).
 *
 * BUILD 27 FIX — a real, non-model "Auto" choice (a selection strategy, not
 * a model) was previously appended here too; removed entirely per this
 * fix's own mandate. The selector now offers exactly the three real,
 * enabled models — Nano Banana 2, Nano Banana Pro, ChatGPT Image — nothing
 * else. `renderCore` itself still validates against the unchanged
 * `SCENARIO_RENDER_CORES` vocabulary server-side (`scenario.ts`) — this only
 * narrows what's visibly OFFERED here, never that shared domain vocabulary
 * (also used, unrelated to this selector, by Prompt Engine/Reasoning Engine
 * fixtures — left untouched, out of this fix's scope). The real, hard
 * removal that actually prevents "Auto" from ever reaching a provider is at
 * the API boundary: `renderCoreSchema` (apps/api/src/schemas.ts) and
 * `RenderCoreSelection` (packages/model-adapters/src/service.ts) no longer
 * accept it at all.
 */
const AI_IMAGE_MODEL_OPTIONS = getEnabledImageModels().map((model) => model.renderCore);

/** "Nano Banana" -> "Nano Banana 2 — Google Gemini (gemini-3.1-flash-image)"; any value with no registry entry renders unchanged. */
function renderCoreOptionLabel(renderCore: string): string {
  const model = findImageModelByRenderCore(renderCore);
  return model ? `${model.displayName} — ${model.provider === 'google-gemini' ? 'Google Gemini' : model.provider} (${model.id})` : renderCore;
}

/**
 * BUILD 27 — "Nếu provider chưa có credential thì UI vẫn hiển thị model
 * nhưng trạng thái phải là 'Chưa cấu hình'." Purely informational: the model
 * stays fully selectable either way (never disabled here — that would wrongly
 * conflate "not yet configured" with "not supported," and the user IS allowed
 * to pick it, e.g. to prepare a scenario ahead of a credential being added).
 * `providerConfiguration` is `null` until the one-time `GET /ready` fetch at
 * app bootstrap resolves (or if it fails) — renders no suffix at all then,
 * never a false "not configured".
 */
function configuredSuffix(renderCore: string, providerConfiguration: ReadinessProviders | null): string {
  const model = findImageModelByRenderCore(renderCore);
  if (!model || !providerConfiguration) return '';
  // `model.configKey` can be 'googleFlow' (no field on ReadinessProviders — Google
  // Flow tracks no real credential at all, see app-context.ts) — this never actually
  // reaches that case today since Google Flow is excluded from AI_IMAGE_MODEL_OPTIONS,
  // but the lookup stays defensive rather than assuming every configKey resolves.
  const check = (providerConfiguration as Record<string, { configured: boolean } | undefined>)[model.configKey];
  return check?.configured === false ? ' — Not configured' : '';
}

/**
 * BUILD 26 — "Nếu model không hỗ trợ: disable option và validate. Không gửi
 * request sai." Reads the CURRENTLY selected AI Image Model's own real
 * `capabilities()` (already accurate per-adapter since BUILD 12, joined via
 * the registry) — never a second, invented capability list. `renderCore ===
 * 'Auto'` or an unrecognized value never disables anything here: the server
 * resolves 'Auto' to whichever adapter is actually registered, which this
 * client-side check has no way to predict.
 */
function isOptionUnsupportedByCurrentModel(
  value: string,
  renderCore: string,
  capabilityKey: 'supportedResolutions' | 'supportedAspectRatios',
): boolean {
  const model = findImageModelByRenderCore(renderCore);
  if (!model) return false;
  return !model.capabilities[capabilityKey].includes(value);
}

/** docs/07_SCENARIO_BUILDER_SPEC.md enumerations — the single source of truth is packages/ai-core's scenario-vocabulary.ts. */
const SELECT_FIELDS: {
  key: SelectFieldKey;
  label: string;
  options: readonly string[];
  getOptionLabel?: (value: string) => string;
  isOptionDisabled?: (value: string, draft: ScenarioInput) => boolean;
}[] = [
  { key: 'context', label: 'Context', options: SCENARIO_CONTEXTS },
  { key: 'lighting', label: 'Lighting', options: SCENARIO_LIGHTING_OPTIONS },
  { key: 'sunDirection', label: 'Sun Direction', options: SCENARIO_SUN_DIRECTIONS },
  { key: 'environment', label: 'Environment', options: SCENARIO_ENVIRONMENTS },
  { key: 'cameraMode', label: 'Camera', options: SCENARIO_CAMERA_MODES },
  {
    key: 'aspectRatio',
    label: 'Aspect Ratio',
    options: SCENARIO_ASPECT_RATIOS,
    isOptionDisabled: (value, draft) => isOptionUnsupportedByCurrentModel(value, draft.renderCore, 'supportedAspectRatios'),
  },
  {
    key: 'generationResolution',
    label: 'Generation Resolution',
    options: SCENARIO_RESOLUTIONS,
    isOptionDisabled: (value, draft) => isOptionUnsupportedByCurrentModel(value, draft.renderCore, 'supportedResolutions'),
  },
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

  const allFieldsFilled = SELECT_FIELDS.every((field) => draft[field.key].trim() !== '');
  // BUILD 26 — never let "Apply Scenario" succeed with a combination the
  // currently selected model can't actually render (e.g. switching model
  // after already picking an aspect ratio/resolution only the previous model
  // supported) — this is the client-side half of "không gửi request sai";
  // the server's own adapter validate()/capabilities() remain the real,
  // final authority regardless.
  const incompatibleField = SELECT_FIELDS.find((field) => draft[field.key].trim() !== '' && field.isOptionDisabled?.(draft[field.key], draft));
  const canApply = allFieldsFilled && !incompatibleField;

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
                <option key={option} value={option} disabled={field.isOptionDisabled?.(option, draft) ?? false}>
                  {field.getOptionLabel ? field.getOptionLabel(option) : option}
                  {field.key === 'renderCore' ? configuredSuffix(option, state.providerConfiguration) : ''}
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
      {incompatibleField ? (
        <p role="alert" className={styles.incompatibleWarning}>
          {incompatibleField.label} "{draft[incompatibleField.key]}" is not supported by the selected AI Image
          Model. Choose a different value or a different model.
        </p>
      ) : null}
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
