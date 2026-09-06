import { useState } from 'react';
import type { ProjectModule } from '@avs/project-core';
import type { ErrorEnvelope } from '@avs/shared';
import { Workspace } from '../Workspace/Workspace.js';
import { PrimaryAction } from '../PrimaryAction/PrimaryAction.js';
import { EditPanel } from '../EditPanel/EditPanel.js';
import { MultiViewPanel } from '../MultiViewPanel/MultiViewPanel.js';
import { QCPanel } from '../QCPanel/QCPanel.js';
import { VideoPanel } from '../VideoPanel/VideoPanel.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { ResultActions } from '../ResultActions/ResultActions.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { runGeneration, type RunGenerationParams } from '../../api/client.js';
import { friendlyRenderErrorMessage, toErrorEnvelope } from '../../api/errors.js';
import styles from './ModuleWorkspace.module.css';

export interface ModuleWorkspaceProps {
  module: ProjectModule;
}

/**
 * Shared Architecture/Interior workspace — explicit module boundary ready
 * for BUILD 04/05 to diverge on, without duplicating the shell. The
 * Render/Generate PrimaryAction sits last in DOM order, at the bottom of
 * the main workflow (docs/02 UX rule).
 *
 * BUILD 13: Render really calls the Image Generation Pipeline
 * (`POST /projects/:id/generations`) — enabled once a source image, an
 * applied scenario (for aspect ratio/resolution/render core), and non-empty
 * prompt text (from BUILD 11's Compile Prompt, or hand-edited) all exist.
 * `promptVersion` falls back to `'manual-edit'` when the prompt was never
 * compiled (CLAUDE.md rule 14 "when available" — a hand-typed prompt has no
 * real compiler version to report).
 */
export function ModuleWorkspace({ module }: ModuleWorkspaceProps) {
  const state = useProjectSessionState();
  const { setState, getState } = useProjectSessionActions();
  const [renderStatus, setRenderStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [renderError, setRenderError] = useState<ErrorEnvelope | undefined>(undefined);

  const canRender = Boolean(state.currentProject && state.sourceImage && state.scenario && state.promptDraft.trim());

  const handleRender = async () => {
    if (!state.currentProject || !state.sourceImage || !state.scenario || !state.promptDraft.trim()) return;

    // BUILD 31 FIX — a real, verified race (same class as EditPanel's and
    // MultiViewPanel's own fixes): if an Edit or a View completes while this
    // Render is still in flight, this Render's now-stale response must not
    // silently overwrite that newer result.
    const generationIdAtRequestTime = state.latestGenerationId;
    const outputAssetIdAtRequestTime = state.latestOutputAssetId;

    setRenderStatus('loading');
    setRenderError(undefined);
    setState({ status: 'loading', error: null });
    try {
      const params: RunGenerationParams = {
        promptText: state.promptDraft,
        renderCore: state.scenario.renderCore as RunGenerationParams['renderCore'],
        aspectRatio: state.scenario.aspectRatio,
        resolution: state.scenario.generationResolution,
        sourceAssetId: state.sourceImage.assetId,
        referenceAssetIds: state.references.map((r) => r.assetId),
        promptVersion: state.promptOutput?.compiled.compilerVersion ?? 'manual-edit',
        scenarioVersion: state.scenario.normalizedAt,
      };
      const result = await runGeneration(state.currentProject.id, params);
      const current = getState();
      if (current.latestGenerationId === generationIdAtRequestTime && current.latestOutputAssetId === outputAssetIdAtRequestTime) {
        setState({
          currentProject: result.project,
          latestGenerationOutputUrls: result.outputAssetUrls,
          latestGenerationId: result.generationId,
          latestOutputAssetId: result.generation.outputAssets[0] ?? null,
          // BUILD 28 FIX — a real defect found via live browser QA: a fresh,
          // never-verified render kept displaying the PREVIOUS generation's QC
          // result (decision/scores), falsely implying the new output had
          // already passed/failed QC. QC is per-generation (docs/15) — a new
          // generation always starts with no QC verdict until Run QC is
          // explicitly run against it again.
          qcState: null,
          status: 'ready',
        });
      }
      setRenderStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong generating the image.');
      // BUILD 26 (Error UX) — a real, user-friendly message for the specific
      // provider-failure categories this build's spec names (quota/billing,
      // invalid credentials, unavailable model, etc.); the technical
      // category (`error.code`) still renders alongside it in ErrorState,
      // never hidden — this only replaces the message text, not the code.
      const friendlyEnvelope = { ...envelope, message: friendlyRenderErrorMessage(envelope) };
      setRenderError(friendlyEnvelope);
      setRenderStatus('error');
      setState({ status: 'error', error: friendlyEnvelope });
    }
  };

  return (
    <div className={styles.root} data-module={module} aria-label={`${module} workspace`}>
      <Workspace module={module} />
      <PrimaryAction
        label={renderStatus === 'loading' ? 'Rendering…' : 'RENDER — PHOTOREALISTIC ARCHITECTURE'}
        disabled={!canRender || renderStatus === 'loading'}
        {...(canRender && state.scenario ? { hint: `Ready to render with ${state.scenario.renderCore}.` } : {})}
        onActivate={() => void handleRender()}
      />
      {renderStatus === 'error' && renderError ? <ErrorState error={renderError} onRetry={() => void handleRender()} /> : null}
      {/* BUILD 26 Result View — Download/Copy Image URL for the latest real output; "Render again"/"Change model"/"Change prompt" need no new UI, they're already the Render button and the existing Scenario/Prompt controls above. */}
      {renderStatus !== 'loading' && state.latestGenerationOutputUrls[0] ? (
        <ResultActions imageUrl={state.latestGenerationOutputUrls[0]} />
      ) : null}
      <QCPanel />
      <MultiViewPanel />
      <EditPanel />
      <VideoPanel />
    </div>
  );
}
