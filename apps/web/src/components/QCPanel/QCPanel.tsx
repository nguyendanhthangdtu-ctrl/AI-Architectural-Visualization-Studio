import { useState } from 'react';
import { resolveAutoLanguage } from '@avs/shared';
import type { ErrorEnvelope } from '@avs/shared';
import { selectCompleteCopyPastePrompt } from '@avs/prompt-engine';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { runQc, regenerate, type RunGenerationParams } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import { compileNormalizedPrompt } from '../../prompt-compilation.js';
import styles from './QCPanel.module.css';

type QcUiStatus = 'idle' | 'running' | 'error';
type RegenerateUiStatus = 'idle' | 'running' | 'error';

const SCORE_LABELS: Record<string, string> = {
  architectureScore: 'Architecture',
  cameraScore: 'Camera',
  materialScore: 'Material',
  lightingScore: 'Lighting',
  objectConsistencyScore: 'Object consistency',
  photorealismScore: 'Photorealism',
};

/**
 * AI QC / Auto-Regeneration — docs/15_AI_QC_SPEC.md (BUILD 17), the VERIFY
 * stage of docs/03 §4's UNDERSTAND→PRESERVE→ENHANCE→CREATE→VERIFY pipeline.
 * "Run QC" scores the most recent generation's output against its source +
 * the locks/instructions that were actually in force when it was rendered;
 * on a real `decision: 'fail'`, "Regenerate" folds the model's own
 * `correctionInstruction` into a freshly re-resolved/recompiled prompt (the
 * same Reasoning Engine + Master Prompt Compiler `ControlPanel` already uses,
 * via `compileNormalizedPrompt`) and resubmits via the VERIFY→CREATE loop.
 */
export function QCPanel() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [qcStatus, setQcStatus] = useState<QcUiStatus>('idle');
  const [qcError, setQcError] = useState<ErrorEnvelope | undefined>(undefined);
  const [regenerateStatus, setRegenerateStatus] = useState<RegenerateUiStatus>('idle');
  const [regenerateError, setRegenerateError] = useState<ErrorEnvelope | undefined>(undefined);

  const canRunQc = Boolean(state.currentProject && state.latestGenerationId && state.analysisId && state.locks.length === 5);

  const handleRunQc = async () => {
    if (!state.currentProject || !state.latestGenerationId || !state.analysisId || state.locks.length !== 5) return;

    setQcStatus('running');
    setQcError(undefined);
    try {
      const result = await runQc(state.currentProject.id, state.latestGenerationId, {
        analysisId: state.analysisId,
        ...(state.latestOutputAssetId ? { outputAssetId: state.latestOutputAssetId } : {}),
        locks: state.locks.map((lock) => ({ id: lock.id, enabled: lock.enabled })),
        ...(state.normalizedRequest ? { resolvedStyle: state.normalizedRequest.resolvedStyle } : {}),
        instructions: state.normalizedRequest?.instructions ?? [],
      });
      setState({ qcState: result.qc });
      setQcStatus('idle');
    } catch (error) {
      setQcError(toErrorEnvelope(error, 'Something went wrong running QC.'));
      setQcStatus('error');
    }
  };

  const canRegenerate = Boolean(
    state.qcState?.decision === 'fail' &&
      state.qcState.correctionInstruction &&
      state.currentProject &&
      state.latestGenerationId &&
      state.sourceImage &&
      state.scenario &&
      state.structuredIntelligence &&
      state.locks.length > 0,
  );

  const handleRegenerate = async () => {
    const correctionInstruction = state.qcState?.correctionInstruction;
    if (
      !correctionInstruction ||
      !state.currentProject ||
      !state.latestGenerationId ||
      !state.sourceImage ||
      !state.scenario
    ) {
      return;
    }

    setRegenerateStatus('running');
    setRegenerateError(undefined);
    try {
      const { output } = await compileNormalizedPrompt(state, [correctionInstruction]);
      const outputLanguage = resolveAutoLanguage(state.language.promptOutputLanguage, state.language.uiLanguage);
      const result = await regenerate(state.currentProject.id, state.latestGenerationId, {
        promptText: selectCompleteCopyPastePrompt(output, outputLanguage),
        renderCore: state.scenario.renderCore as RunGenerationParams['renderCore'],
        aspectRatio: state.scenario.aspectRatio,
        resolution: state.scenario.generationResolution,
        sourceAssetId: state.sourceImage.assetId,
        referenceAssetIds: state.references.map((r) => r.assetId),
        promptVersion: output.compiled.compilerVersion,
        scenarioVersion: state.scenario.normalizedAt,
        correctionInstruction,
      });
      setState({
        currentProject: result.project,
        latestGenerationOutputUrls: result.outputAssetUrls,
        latestGenerationId: result.generationId,
        latestOutputAssetId: result.generation.outputAssets[0] ?? null,
        qcState: null,
        status: 'ready',
      });
      setRegenerateStatus('idle');
    } catch (error) {
      setRegenerateError(toErrorEnvelope(error, 'Something went wrong regenerating the image.'));
      setRegenerateStatus('error');
    }
  };

  if (!state.latestGenerationId) {
    return (
      <section className={styles.root} aria-labelledby="qc-panel-title">
        <h2 id="qc-panel-title" className={styles.title}>
          AI QC
        </h2>
        <EmptyState title="No generated image yet" description="Render an image first, then verify it here." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="qc-panel-title">
      <h2 id="qc-panel-title" className={styles.title}>
        AI QC
      </h2>

      <button type="button" className={styles.runButton} disabled={!canRunQc || qcStatus === 'running'} onClick={() => void handleRunQc()}>
        {qcStatus === 'running' ? 'Running QC…' : 'Run QC'}
      </button>
      {qcStatus === 'error' && qcError ? <ErrorState error={qcError} onRetry={() => void handleRunQc()} /> : null}

      {state.qcState ? (
        <div className={styles.result} data-decision={state.qcState.decision}>
          <span className={styles.decision}>{state.qcState.decision === 'pass' ? 'PASS' : 'FAIL'}</span>

          <ul className={styles.scores}>
            {Object.entries(state.qcState.scores).map(([key, value]) => (
              <li key={key} className={styles.scoreRow}>
                <span>{SCORE_LABELS[key] ?? key}</span>
                <span>{Math.round(value * 100)}%</span>
              </li>
            ))}
          </ul>

          {state.qcState.issues.length > 0 ? (
            <ul className={styles.issues}>
              {state.qcState.issues.map((issue, index) => (
                <li key={index} className={styles.issue} data-severity={issue.severity}>
                  <strong>{issue.attribute}</strong>
                  {issue.region ? ` (${issue.region})` : ''} — {issue.description}
                </li>
              ))}
            </ul>
          ) : null}

          {state.qcState.decision === 'fail' ? (
            <>
              <button
                type="button"
                className={styles.regenerateButton}
                disabled={!canRegenerate || regenerateStatus === 'running'}
                onClick={() => void handleRegenerate()}
              >
                {regenerateStatus === 'running' ? 'Regenerating…' : 'Regenerate'}
              </button>
              {regenerateStatus === 'error' && regenerateError ? (
                <ErrorState error={regenerateError} onRetry={() => void handleRegenerate()} />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
