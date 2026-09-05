import { useState } from 'react';
import type { ErrorEnvelope } from '@avs/shared';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import { extractReferenceVisualLanguage } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import styles from './PromptFromImage.module.css';

/**
 * "Dò prompt từ ảnh" (Prompt From Image) — docs/02 UX "Required controls",
 * docs/08 Reference Intelligence. BUILD 10: real, purpose='auto' extraction
 * against the uploaded reference image (`ReferencePanel`, above). This is a
 * quick-detect entry point into Reference Intelligence, not a compiled
 * Master Prompt — that compilation step is BUILD 11's job (docs/09), so
 * results here are shown as extracted keywords, honestly labeled.
 */
export function PromptFromImage() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<ErrorEnvelope | undefined>(undefined);

  const canDetect = Boolean(state.currentProject && state.referenceImage);

  const handleDetect = async () => {
    if (!state.currentProject || !state.referenceImage) return;

    setStatus('loading');
    setError(undefined);
    try {
      const result = await extractReferenceVisualLanguage(state.currentProject.id, state.referenceImage.assetId, 'auto');
      setState({
        references: [
          ...state.references,
          {
            referenceId: result.referenceId,
            assetId: state.referenceImage.assetId,
            purpose: 'auto',
            extractedVisualLanguage: result.extractedVisualLanguage,
          },
        ],
      });
      setStatus('idle');
    } catch (err) {
      const envelope = toErrorEnvelope(err, 'Something went wrong detecting a prompt from the reference image.');
      setError(envelope);
      setStatus('error');
    }
  };

  const latestAutoDetection = [...state.references].reverse().find((r) => r.assetId === state.referenceImage?.assetId && r.purpose === 'auto');

  return (
    <section className={styles.root} aria-labelledby="prompt-from-image-title">
      <div className={styles.header}>
        <h2 id="prompt-from-image-title" className={styles.title}>
          Dò prompt từ ảnh
        </h2>
      </div>
      <button
        type="button"
        className={styles.button}
        disabled={!canDetect || status === 'loading'}
        title={canDetect ? undefined : 'Upload a reference image first'}
        onClick={() => void handleDetect()}
      >
        {status === 'loading' ? 'Detecting…' : 'Detect prompt from image'}
      </button>
      {status === 'error' && error ? <ErrorState error={error} onRetry={() => void handleDetect()} /> : null}
      <div className={styles.result}>
        {latestAutoDetection ? (
          <p className={styles.detected}>{Object.entries(latestAutoDetection.extractedVisualLanguage.fields).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p>
        ) : (
          <EmptyState
            title="No detected prompt yet"
            description="Provide a reference image and run detection to populate this area."
          />
        )}
      </div>
    </section>
  );
}
