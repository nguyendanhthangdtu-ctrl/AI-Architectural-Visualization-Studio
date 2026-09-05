import { useState } from 'react';
import { createDefaultLocks, type ProjectModule } from '@avs/project-core';
import type { ErrorEnvelope, Timestamp, UserId } from '@avs/shared';
import { resolveAutoLanguage } from '@avs/shared';
import { reasoningEngine } from '@avs/ai-core';
import { compilePromptOutput, selectCompleteCopyPastePrompt } from '@avs/prompt-engine';
import { UploadDropzone, type UploadDropzoneStatus } from '../UploadDropzone/UploadDropzone.js';
import { ImagePreview } from '../ImagePreview/ImagePreview.js';
import { ReferencePanel } from '../ReferencePanel/ReferencePanel.js';
import { PromptFromImage } from '../PromptFromImage/PromptFromImage.js';
import { PromptEditor } from '../PromptEditor/PromptEditor.js';
import { LockControlGroup } from '../LockControl/LockControlGroup.js';
import { ScenarioSlots } from '../ScenarioSlots/ScenarioSlots.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { createProject, runAnalysis, uploadAsset } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './ControlPanel.module.css';

export interface ControlPanelProps {
  module: ProjectModule;
}

/**
 * Left control area — docs/02 UX "Control area: analysis, scenario,
 * reference, prompt inspector." Section order is deliberate: source image →
 * Reference → Prompt From Image → Prompt Editor (directly below it, per
 * docs/02 UX rule) → Locks → Scenario, tracing UNDERSTAND → PRESERVE → ENHANCE.
 *
 * BUILD 06: uploading a source image really creates a Project (lazily, on
 * first upload) and really uploads the asset via apps/api — docs/01 MVP
 * steps 1-2. BUILD 07: an "Analyze" action really runs the Vision Analysis
 * Engine (docs/01 MVP step 4) and, on success, materializes the real default
 * Lock set (docs/03 ADR-001) pinned to the real analysisVersion — the first
 * point in the whole build where LockControlGroup shows real, not empty,
 * state. BUILD 10: `ReferencePanel` really uploads a reference image and
 * runs purpose-scoped Reference Intelligence extraction; "Dò prompt từ ảnh"
 * (`PromptFromImage`) reuses the same reference image with purpose 'auto'.
 * Every AI/network action shows status and failure reason (docs/02 UX rule)
 * via ProjectSessionState.status/error.
 */
export function ControlPanel({ module }: ControlPanelProps) {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [uploadStatus, setUploadStatus] = useState<UploadDropzoneStatus>('empty');
  const [uploadError, setUploadError] = useState<ErrorEnvelope | undefined>(undefined);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [analysisError, setAnalysisError] = useState<ErrorEnvelope | undefined>(undefined);
  const [compileStatus, setCompileStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [compileError, setCompileError] = useState<ErrorEnvelope | undefined>(undefined);

  const handleFilesSelected = async (files: FileList) => {
    const file = files[0];
    if (!file) return;

    setUploadStatus('loading');
    setUploadError(undefined);
    setState({ status: 'loading', error: null });

    try {
      const project =
        state.currentProject ??
        (await createProject({ name: `${module} project — ${new Date().toISOString()}`, module }));
      const asset = await uploadAsset(project.id, file);
      setState({
        currentProject: project,
        sourceImage: { assetId: asset.id, url: asset.url },
        status: 'ready',
      });
      setUploadStatus('empty');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong uploading the image.');
      setUploadError(envelope);
      setUploadStatus('error');
      setState({ status: 'error', error: envelope });
    }
  };

  const handleRemove = () => {
    setState({ sourceImage: null, status: 'idle', locks: [], structuredIntelligence: null });
    setUploadStatus('empty');
    setUploadError(undefined);
    setAnalysisStatus('idle');
    setAnalysisError(undefined);
  };

  const handleAnalyze = async () => {
    if (!state.currentProject || !state.sourceImage) return;

    setAnalysisStatus('loading');
    setAnalysisError(undefined);
    setState({ status: 'loading', error: null });

    try {
      const result = await runAnalysis(state.currentProject.id, state.sourceImage.assetId);
      const now = new Date().toISOString() as Timestamp;
      setState({
        currentProject: result.project,
        structuredIntelligence: result.structuredIntelligence,
        locks: createDefaultLocks({
          analysisVersion: result.structuredIntelligence.analysisVersion,
          setBy: 'anonymous' as UserId, // no auth yet (BUILD 02 deferral)
          setAt: now,
        }),
        status: 'ready',
      });
      setAnalysisStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong analyzing the image.');
      setAnalysisError(envelope);
      setAnalysisStatus('error');
      setState({ status: 'error', error: envelope });
    }
  };

  const handleCompile = async () => {
    if (!state.structuredIntelligence || state.locks.length === 0 || !state.scenario) return;

    setCompileStatus('loading');
    setCompileError(undefined);
    try {
      const normalized = await reasoningEngine.resolve({
        structuredIntelligence: state.structuredIntelligence,
        locks: state.locks,
        scenario: state.scenario,
        references: state.references.map((r) => r.extractedVisualLanguage),
        instructions: [],
      });
      const analysisLanguage = resolveAutoLanguage(state.language.aiAnalysisLanguage, state.language.uiLanguage);
      const output = await compilePromptOutput(normalized, {
        analysisLanguage,
        outputLanguage: state.language.promptOutputLanguage,
      });
      const outputLanguage = resolveAutoLanguage(state.language.promptOutputLanguage, state.language.uiLanguage);
      setState({
        prompt: output.compiled,
        promptOutput: output,
        promptDraft: selectCompleteCopyPastePrompt(output, outputLanguage),
        status: 'ready',
      });
      setCompileStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong compiling the prompt.');
      setCompileError(envelope);
      setCompileStatus('error');
      setState({ status: 'error', error: envelope });
    }
  };

  const canAnalyze = Boolean(state.currentProject && state.sourceImage) && state.locks.length === 0;
  const canCompile = Boolean(state.structuredIntelligence && state.locks.length > 0 && state.scenario);

  return (
    <aside className={styles.root} aria-label="Controls">
      <section aria-labelledby="source-image-title">
        <h2 id="source-image-title" className={styles.sectionTitle}>
          Source Image
        </h2>
        {state.sourceImage ? (
          <ImagePreview url={state.sourceImage.url} onRemove={handleRemove} onReplace={handleRemove} />
        ) : (
          <UploadDropzone
            status={uploadStatus}
            {...(uploadError ? { error: uploadError } : {})}
            onFilesSelected={(files) => void handleFilesSelected(files)}
          />
        )}
        {canAnalyze ? (
          <button
            type="button"
            className={styles.analyzeButton}
            disabled={analysisStatus === 'loading'}
            onClick={() => void handleAnalyze()}
          >
            {analysisStatus === 'loading' ? 'Analyzing…' : 'Analyze source image'}
          </button>
        ) : null}
        {analysisStatus === 'error' && analysisError ? (
          <ErrorState error={analysisError} onRetry={() => void handleAnalyze()} />
        ) : null}
      </section>

      <ReferencePanel />

      <PromptFromImage />

      <PromptEditor
        value={state.promptDraft}
        onChange={(promptDraft) => setState({ promptDraft })}
        onCompile={() => void handleCompile()}
        canCompile={canCompile}
        compileStatus={compileStatus}
        {...(compileError ? { compileError } : {})}
      />

      <section aria-labelledby="locks-title">
        <h2 id="locks-title" className={styles.sectionTitle}>
          Locks
        </h2>
        <LockControlGroup locks={state.locks} />
      </section>

      <ScenarioSlots />
    </aside>
  );
}
