import type { Lock } from '@avs/project-core';
import styles from './LockControl.module.css';

const LOCK_LABELS: Record<Lock['id'], string> = {
  architecture: 'Architecture Lock',
  camera: 'Camera Lock',
  material: 'Material Lock',
  style: 'Style Lock',
  lighting: 'Lighting Lock',
};

const TIER_LABELS: Record<Lock['tier'], string> = {
  'source-fidelity': 'Source-fidelity',
  'output-stability': 'Output-stability',
};

export interface LockControlProps {
  lock: Lock;
  /** Disabled until the mechanism that would actually resolve it exists (docs/03 ADR-001 tiers land in BUILD 07-09). */
  disabled?: boolean;
  /** A conflict must be surfaced explicitly, never silently dropped (docs/06 Reasoning Engine). */
  conflict?: string;
  onToggle?: (next: boolean) => void;
}

/**
 * One Lock as UI state — docs/03_TECHNICAL_ARCHITECTURE.md ADR-001/§7.
 * Source-fidelity locks (Architecture/Camera/Material) and output-stability
 * locks (Style/Lighting) are visually distinguished by tier badge, never by
 * color alone — the badge carries a text label too.
 */
export function LockControl({ lock, disabled = false, conflict, onToggle }: LockControlProps) {
  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <span className={styles.label}>
          {LOCK_LABELS[lock.id]}
          <span className={styles.tierBadge} data-tier={lock.tier}>
            {TIER_LABELS[lock.tier]}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={lock.enabled}
          aria-label={LOCK_LABELS[lock.id]}
          className={styles.switch}
          disabled={disabled}
          onClick={() => onToggle?.(!lock.enabled)}
        >
          <span className={styles.knob} aria-hidden="true" />
        </button>
      </div>
      <span className={styles.state}>{lock.enabled ? 'Enabled — preserved' : 'Disabled'}</span>
      {conflict ? (
        <div className={styles.conflict} role="alert">
          {conflict}
        </div>
      ) : null}
    </div>
  );
}
