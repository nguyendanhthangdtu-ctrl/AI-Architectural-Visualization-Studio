import { useState } from 'react';
import { REFERENCE_PURPOSES, type ReferencePurpose } from '@avs/ai-core';
import type { ErrorEnvelope } from '@avs/shared';
import { UploadDropzone, type UploadDropzoneStatus } from '../UploadDropzone/UploadDropzone.js';
import { ImagePreview } from '../ImagePreview/ImagePreview.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { extractReferenceVisualLanguage, uploadAsset } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './ReferencePanel.module.css';

/**
 * Reference image + purpose — docs/02 UX required control "Reference image
 * and reference purpose", docs/08 Reference Intelligence (BUILD 10). A
 * reference belongs to a project, so upload is only enabled once a project
 * already exists (created by the Source Image step above this one).
 *
 * Extraction is purpose-scoped visual language only — CLAUDE.md rule 5 "never
 * silently replace source architecture" — enforced structurally server-side
 * (packages/ai-core reference-field-vocabulary.ts), not just by this UI.
 * Combining extractions with source architecture + scenario + locks into one
 * normalized visual specification ("Reference Mixer", docs/08) is out of
 * scope for this gate.
 */
export function ReferencePanel() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [uploadStatus, setUploadStatus] = useState<UploadDropzoneStatus>('empty');
  const [uploadError, setUploadError] = useState<ErrorEnvelope | undefined>(undefined);
  const [purpose, setPurpose] = useState<ReferencePurpose>('auto');
  const [extractStatus, setExtractStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [extractError, setExtractError] = useState<ErrorEnvelope | undefined>(undefined);

  const canUpload = Boolean(state.currentProject);

  const handleFilesSelected = async (files: FileList) => {
    const file = files[0];
    if (!file || !state.currentProject) return;

    setUploadStatus('loading');
    setUploadError(undefined);
    try {
      const asset = await uploadAsset(state.currentProject.id, file);
      setState({ referenceImage: { assetId: asset.id, url: asset.url } });
      setUploadStatus('empty');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong uploading the reference image.');
      setUploadError(envelope);
      setUploadStatus('error');
    }
  };

  const handleRemove = () => {
    setState({ referenceImage: null });
    setUploadStatus('empty');
    setUploadError(undefined);
  };

  const handleExtract = async () => {
    if (!state.currentProject || !state.referenceImage) return;

    setExtractStatus('loading');
    setExtractError(undefined);
    try {
      const result = await extractReferenceVisualLanguage(state.currentProject.id, state.referenceImage.assetId, purpose);
      setState({
        references: [
          ...state.references,
          {
            referenceId: result.referenceId,
            assetId: state.referenceImage.assetId,
            purpose,
            extractedVisualLanguage: result.extractedVisualLanguage,
          },
        ],
      });
      setExtractStatus('idle');
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'Something went wrong extracting visual language from the reference.');
      setExtractError(envelope);
      setExtractStatus('error');
    }
  };

  const extractionsForCurrentReference = state.references.filter((r) => r.assetId === state.referenceImage?.assetId);

  return (
    <section className={styles.root} aria-labelledby="reference-panel-title">
      <div className={styles.header}>
        <h2 id="reference-panel-title" className={styles.title}>
          Reference
        </h2>
      </div>

      {state.referenceImage ? (
        <ImagePreview url={state.referenceImage.url} onRemove={handleRemove} onReplace={handleRemove} />
      ) : (
        <UploadDropzone
          status={uploadStatus}
          disabled={!canUpload}
          label="Drop a reference image, or click to browse"
          loadingLabel="Loading reference image…"
          hint="Style/material/lighting/etc. reference — PNG or JPG."
          {...(uploadError ? { error: uploadError } : {})}
          onFilesSelected={(files) => void handleFilesSelected(files)}
        />
      )}
      {!canUpload ? <p className={styles.hint}>Upload a source image first — a reference belongs to a project.</p> : null}

      {state.referenceImage ? (
        <div className={styles.extractRow}>
          <label htmlFor="reference-purpose">Purpose</label>
          <select
            id="reference-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as ReferencePurpose)}
          >
            {REFERENCE_PURPOSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.extractButton}
            disabled={extractStatus === 'loading'}
            onClick={() => void handleExtract()}
          >
            {extractStatus === 'loading' ? 'Extracting…' : 'Extract visual language'}
          </button>
        </div>
      ) : null}
      {extractStatus === 'error' && extractError ? (
        <ErrorState error={extractError} onRetry={() => void handleExtract()} />
      ) : null}

      {state.referenceImage ? (
        extractionsForCurrentReference.length > 0 ? (
          <ul className={styles.results}>
            {extractionsForCurrentReference.map((extraction) => (
              <li key={extraction.referenceId} className={styles.resultItem}>
                <span className={styles.resultPurpose}>{extraction.purpose}</span>
                <span className={styles.resultFields}>
                  {Object.entries(extraction.extractedVisualLanguage.fields)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(' · ') || 'no fields returned'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No extraction yet" description="Select a purpose and extract visual language." />
        )
      ) : null}
    </section>
  );
}
