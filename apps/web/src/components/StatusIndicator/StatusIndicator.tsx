import type { AppStatus } from '../../state/project-session.js';
import styles from './StatusIndicator.module.css';

const LABELS: Record<AppStatus, string> = {
  idle: 'Idle',
  loading: 'Working…',
  ready: 'Ready',
  error: 'Error',
};

export interface StatusIndicatorProps {
  status: AppStatus;
  label?: string;
}

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  return (
    <span className={`${styles.root} ${styles[status]}`} role="status">
      <span className={styles.dot} aria-hidden="true" />
      {label ?? LABELS[status]}
    </span>
  );
}
