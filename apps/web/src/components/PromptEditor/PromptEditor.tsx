import { useState } from 'react';
import type { ErrorEnvelope } from '@avs/shared';
import { StatusIndicator } from '../StatusIndicator/StatusIndicator.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import styles from './PromptEditor.module.css';

export interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** BUILD 11: real Master Prompt Compiler action. Omit entirely to render the pre-BUILD-11 editor-only view (used by existing tests/callers). */
  onCompile?: () => void;
  canCompile?: boolean;
  compileStatus?: 'idle' | 'loading' | 'error';
  compileError?: ErrorEnvelope;
}

/**
 * Prompt editor — docs/02 UX rule "Prompt editor is below Prompt From
 * Image" (enforced by DOM order in ControlPanel, not by this component).
 * Edits the draft text (ProjectSessionState.promptDraft); "Compile Prompt"
 * (BUILD 11) real-fills it from the Reasoning Engine + Master Prompt
 * Compiler — the user may still hand-edit afterward, same textarea.
 */
export function PromptEditor({ value, onChange, onCompile, canCompile = false, compileStatus = 'idle', compileError }: PromptEditorProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — fail silently into the disabled-looking state below.
    }
  };

  return (
    <section className={styles.root} aria-labelledby="prompt-editor-title">
      <div className={styles.header}>
        <h2 id="prompt-editor-title" className={styles.title}>
          Prompt
        </h2>
        <StatusIndicator status={value.trim() ? 'ready' : 'idle'} label={value.trim() ? 'Draft' : 'Empty'} />
      </div>
      <textarea
        className={styles.textarea}
        aria-label="Prompt editor"
        placeholder="Describe the shot, or use Dò prompt từ ảnh above to draft one from a reference image."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className={styles.footer}>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => onChange('')} disabled={!value}>
            Clear
          </button>
          <button type="button" className={styles.action} onClick={handleCopy} disabled={!value}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onCompile ? (
            <button type="button" className={styles.action} onClick={onCompile} disabled={!canCompile || compileStatus === 'loading'}>
              {compileStatus === 'loading' ? 'Compiling…' : 'Compile Prompt'}
            </button>
          ) : null}
        </div>
        {!onCompile ? <span className={styles.note}>Structured Master Prompt Compiler — BUILD 11</span> : null}
      </div>
      {compileStatus === 'error' && compileError ? (
        <ErrorState error={compileError} {...(onCompile ? { onRetry: onCompile } : {})} />
      ) : null}
    </section>
  );
}
