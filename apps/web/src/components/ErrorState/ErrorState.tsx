import type { ErrorEnvelope } from '@avs/shared';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  error: ErrorEnvelope;
  onRetry?: () => void;
}

/** Reusable error-state foundation — renders the shared ErrorEnvelope (docs/03 §8), never a raw stack trace. */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.root} role="alert">
      <p className={styles.message}>{error.message}</p>
      <span className={styles.code}>{error.code}</span>
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {error.retryable ? 'Retry' : 'Dismiss'}
        </button>
      ) : null}
    </div>
  );
}
