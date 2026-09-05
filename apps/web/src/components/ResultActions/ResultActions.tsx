import { useState } from 'react';
import styles from './ResultActions.module.css';

export interface ResultActionsProps {
  /** The real, already-signed (when signing is configured) asset URL — same URL the canvas's own `<img src>` already renders, never a new exposure. */
  imageUrl: string;
}

/**
 * BUILD 26 (Production UX & Render Workflow Hardening) — Result View
 * actions this build's spec explicitly requires that had no prior
 * implementation: Download and Copy Image URL. "Render again"/"Change
 * model"/"Change prompt" need no new component — they're already real,
 * existing interactions (re-clicking Render, re-selecting a model in
 * `ScenarioSlots`, re-editing `PromptEditor`), so nothing was added for
 * those beyond what BUILD 13/25 already provide.
 *
 * Download uses a real `<a download>` — this is the production app, not a
 * sandboxed artifact preview; a real browser download is exactly correct
 * here. No filename is forced (`download` alone, no value) so the browser
 * uses the server's real `Content-Type` to pick the correct extension
 * rather than this component guessing PNG vs JPEG per provider.
 *
 * Copy Image URL never exposes anything the page doesn't already: `imageUrl`
 * is the identical URL the canvas's own `<img src>` attribute already
 * renders into the DOM (docs/03 §9's signed-URL model already accepts that
 * tradeoff — this button doesn't change what's already visible).
 */
export function ResultActions({ imageUrl }: ResultActionsProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = async () => {
    try {
      const absoluteUrl = new URL(imageUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absoluteUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  };

  return (
    <div className={styles.root}>
      <a className={styles.action} href={imageUrl} download>
        Download
      </a>
      <button type="button" className={styles.action} onClick={() => void handleCopy()}>
        {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Copy failed' : 'Copy Image URL'}
      </button>
    </div>
  );
}
