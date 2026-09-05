import { useState } from 'react';
import { EDIT_CATEGORIES, type EditCategory } from '@avs/project-core';
import type { ErrorEnvelope } from '@avs/shared';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { runEdit } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './EditPanel.module.css';

/**
 * Advanced Editor — docs/12_EDITOR_SPEC.md (BUILD 14). Edits the most recent
 * generation's output, always through the same provider that produced it
 * (enforced server-side — see routes.ts `handleRunEdit`). Only enabled once
 * a render has actually succeeded (`latestGenerationId`/`latestOutputAssetId`).
 *
 * "Target region" is real, structured input — but text-described, not a
 * drawn pixel mask: no freehand select/mask/brush canvas tool exists yet
 * (docs/12 lists it as a tool, not a requirement of every edit path) — that
 * remains explicit future work, not silently faked here. "Protected
 * regions/locks" (docs/12) is sourced from the REAL current lock state
 * (`state.locks`), never fabricated — whichever locks are enabled right now
 * are what's declared protected.
 */
export function EditPanel() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [category, setCategory] = useState<EditCategory>('other');
  const [targetRegionDescription, setTargetRegionDescription] = useState('');
  const [intendedChange, setIntendedChange] = useState('');
  const [editStatus, setEditStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [editError, setEditError] = useState<ErrorEnvelope | undefined>(undefined);

  const canEdit = Boolean(
    state.currentProject &&
      state.latestGenerationId &&
      state.latestOutputAssetId &&
      state.scenario &&
      targetRegionDescription.trim() &&
      intendedChange.trim(),
  );

  const handleApplyEdit = async () => {
    if (
      !state.currentProject ||
      !state.latestGenerationId ||
      !state.latestOutputAssetId ||
      !state.scenario ||
      !targetRegionDescription.trim() ||
      !intendedChange.trim()
    ) {
      return;
    }

    setEditStatus('loading');
    setEditError(undefined);
    try {
      const protectedLocks = state.locks.filter((l) => l.enabled).map((l) => l.id);
      const result = await runEdit(state.currentProject.id, state.latestGenerationId, {
        sourceAssetId: state.latestOutputAssetId,
        targetRegionDescription,
        intendedChange,
        category,
        protectedLocks,
        aspectRatio: state.scenario.aspectRatio,
        resolution: state.scenario.generationResolution,
      });
      setState({
        latestGenerationOutputUrls: result.outputAssetUrls,
        latestOutputAssetId: result.edit.resultingAssetId,
        // BUILD 30 FIX — same defect class as BUILD 28's Render fix
        // (ModuleWorkspace.tsx): a successful edit produces a new,
        // never-verified output, but this previously left a PASS/FAIL QC
        // result from before the edit displayed against it. QC is
        // per-generation (docs/15) and must be re-run against the edited
        // output before any verdict is shown for it again.
        qcState: null,
      });
      setTargetRegionDescription('');
      setIntendedChange('');
      setEditStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong applying the edit.');
      setEditError(envelope);
      setEditStatus('error');
    }
  };

  if (!state.latestGenerationId) {
    return (
      <section className={styles.root} aria-labelledby="edit-panel-title">
        <h2 id="edit-panel-title" className={styles.title}>
          Edit
        </h2>
        <EmptyState title="No generated image yet" description="Render an image first, then edit the result here." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="edit-panel-title">
      <h2 id="edit-panel-title" className={styles.title}>
        Edit
      </h2>

      <div className={styles.field}>
        <label htmlFor="edit-category">Category</label>
        <select id="edit-category" value={category} onChange={(e) => setCategory(e.target.value as EditCategory)}>
          {EDIT_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-target-region">Target region</label>
        <input
          id="edit-target-region"
          type="text"
          placeholder="e.g. the facade material"
          value={targetRegionDescription}
          onChange={(e) => setTargetRegionDescription(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-intended-change">Intended change</label>
        <textarea
          id="edit-intended-change"
          className={styles.textarea}
          placeholder="e.g. replace with warm wood cladding"
          value={intendedChange}
          onChange={(e) => setIntendedChange(e.target.value)}
        />
      </div>

      <button
        type="button"
        className={styles.applyButton}
        disabled={!canEdit || editStatus === 'loading'}
        onClick={() => void handleApplyEdit()}
      >
        {editStatus === 'loading' ? 'Applying edit…' : 'Apply Edit'}
      </button>

      {editStatus === 'error' && editError ? <ErrorState error={editError} onRetry={() => void handleApplyEdit()} /> : null}
    </section>
  );
}
