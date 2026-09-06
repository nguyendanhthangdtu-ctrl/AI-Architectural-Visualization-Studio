import { useState } from 'react';
import type { ErrorEnvelope } from '@avs/shared';
import { resolveAutoLanguage } from '@avs/shared';
import { resolveView, type ViewMode, type ViewProposal } from '@avs/ai-core';
import { compilePromptOutput, selectCompleteCopyPastePrompt } from '@avs/prompt-engine';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { runView, type RunViewParams } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './MultiViewPanel.module.css';

/**
 * Multi-View — docs/13_MULTIVIEW_SPEC.md (BUILD 15). Requires a compiled
 * prompt (`state.promptOutput`, BUILD 11's Compile Prompt) — a View resolves
 * a MODIFIED variant of that exact `NormalizedRequest` snapshot
 * (`resolveView`, ai-core), recompiles it (BUILD 11's `compilePromptOutput`,
 * pure/no-I/O, same as a normal Render), and submits the result to the same
 * real generation pipeline (BUILD 13).
 *
 * Only camera (both modes) and style (Creative only) proposal fields are
 * exposed here — material/lighting proposals are real end-to-end (the
 * domain function, the schema, the route) but not wired into this UI, the
 * same "real capability, partial UI" pattern already used for the Advanced
 * Editor's mask support (BUILD 14).
 */
export function MultiViewPanel() {
  const state = useProjectSessionState();
  const { setState, getState } = useProjectSessionActions();
  const [mode, setMode] = useState<ViewMode>('sync');
  const [height, setHeight] = useState('');
  const [lens, setLens] = useState('');
  const [perspective, setPerspective] = useState('');
  const [style, setStyle] = useState('');
  const [viewStatus, setViewStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [viewError, setViewError] = useState<ErrorEnvelope | undefined>(undefined);

  const baseRequest = state.promptOutput?.compiled.normalizedRequestSnapshot ?? null;
  const hasCameraProposal = Boolean(height.trim() || lens.trim() || perspective.trim());
  const canGenerateView = Boolean(
    state.currentProject &&
      state.sourceImage &&
      baseRequest &&
      (hasCameraProposal || (mode === 'creative' && style.trim())),
  );

  const handleGenerateView = async () => {
    if (!state.currentProject || !state.sourceImage || !baseRequest) return;

    // BUILD 31 FIX — a real, verified race (same class as EditPanel's own
    // fix): if the user renders, edits, or generates another view before
    // this request resolves, a late response here must not silently
    // overwrite whatever superseded it.
    const generationIdAtRequestTime = state.latestGenerationId;
    const outputAssetIdAtRequestTime = state.latestOutputAssetId;

    setViewStatus('loading');
    setViewError(undefined);
    try {
      const proposal: ViewProposal = {
        ...(hasCameraProposal
          ? {
              camera: {
                ...(height.trim() ? { height: Number(height) } : {}),
                ...(lens.trim() ? { lens } : {}),
                ...(perspective.trim() ? { perspective } : {}),
              },
            }
          : {}),
        ...(mode === 'creative' && style.trim() ? { style } : {}),
      };

      const { request, ignoredProposals } = resolveView({ baseRequest, mode, proposal });
      const analysisLanguage = resolveAutoLanguage(state.language.aiAnalysisLanguage, state.language.uiLanguage);
      const output = await compilePromptOutput(request, { analysisLanguage, outputLanguage: state.language.promptOutputLanguage });
      const outputLanguage = resolveAutoLanguage(state.language.promptOutputLanguage, state.language.uiLanguage);

      const params: RunViewParams = {
        promptText: selectCompleteCopyPastePrompt(output, outputLanguage),
        renderCore: request.scenario.renderCore as RunViewParams['renderCore'],
        aspectRatio: request.scenario.aspectRatio,
        resolution: request.scenario.generationResolution,
        sourceAssetId: state.sourceImage.assetId,
        referenceAssetIds: state.references.map((r) => r.assetId),
        promptVersion: output.compiled.compilerVersion,
        scenarioVersion: request.scenario.normalizedAt,
        mode,
        ...(proposal.camera ? { cameraProposal: proposal.camera } : {}),
        ...(proposal.style !== undefined ? { styleProposal: proposal.style } : {}),
        ignoredProposals,
      };
      const result = await runView(state.currentProject.id, params);
      const current = getState();
      if (current.latestGenerationId === generationIdAtRequestTime && current.latestOutputAssetId === outputAssetIdAtRequestTime) {
        setState({
          currentProject: result.project,
          latestGenerationOutputUrls: result.outputAssetUrls,
          latestGenerationId: result.generationId,
          latestOutputAssetId: result.generation.outputAssets[0] ?? null,
          // BUILD 30 FIX — same defect class as BUILD 28's Render fix
          // (ModuleWorkspace.tsx): a View produces a genuinely new generation
          // (a different `generationId`), but this previously left a
          // PASS/FAIL QC result from the prior generation displayed as if it
          // applied to the new view's output. QC is per-generation (docs/15).
          qcState: null,
          status: 'ready',
        });
      }
      setHeight('');
      setLens('');
      setPerspective('');
      setStyle('');
      setViewStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong generating the view.');
      setViewError(envelope);
      setViewStatus('error');
    }
  };

  if (!baseRequest) {
    return (
      <section className={styles.root} aria-labelledby="multiview-panel-title">
        <h2 id="multiview-panel-title" className={styles.title}>
          Multi-View
        </h2>
        <EmptyState title="No compiled prompt yet" description="Compile a prompt first, then generate alternate views here." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="multiview-panel-title">
      <h2 id="multiview-panel-title" className={styles.title}>
        Multi-View
      </h2>

      <div className={styles.field}>
        <label htmlFor="view-mode">Mode</label>
        <select id="view-mode" value={mode} onChange={(e) => setMode(e.target.value as ViewMode)}>
          <option value="sync">Sync View (preserve Project DNA — camera only)</option>
          <option value="creative">Creative View (preserve Architecture DNA only)</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="view-height">Camera height</label>
        <input id="view-height" type="number" placeholder="e.g. 5" value={height} onChange={(e) => setHeight(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="view-lens">Lens</label>
        <input id="view-lens" type="text" placeholder="e.g. wide-angle" value={lens} onChange={(e) => setLens(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="view-perspective">Perspective</label>
        <input
          id="view-perspective"
          type="text"
          placeholder="e.g. bird's eye"
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
        />
      </div>

      {mode === 'creative' ? (
        <div className={styles.field}>
          <label htmlFor="view-style">Style proposal</label>
          <input id="view-style" type="text" placeholder="e.g. Industrial" value={style} onChange={(e) => setStyle(e.target.value)} />
        </div>
      ) : null}

      <button
        type="button"
        className={styles.applyButton}
        disabled={!canGenerateView || viewStatus === 'loading'}
        onClick={() => void handleGenerateView()}
      >
        {viewStatus === 'loading' ? 'Generating view…' : 'Generate View'}
      </button>

      {viewStatus === 'error' && viewError ? <ErrorState error={viewError} onRetry={() => void handleGenerateView()} /> : null}
    </section>
  );
}
