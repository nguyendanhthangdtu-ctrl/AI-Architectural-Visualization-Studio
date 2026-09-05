import type { Lock } from '@avs/project-core';
import { EmptyState } from '../EmptyState/EmptyState.js';
import { LockControl } from './LockControl.js';

export interface LockControlGroupProps {
  locks: readonly Lock[];
  disabled?: boolean;
  onToggle?: (id: Lock['id'], next: boolean) => void;
}

/**
 * Renders source-fidelity locks before output-stability locks — the
 * ordering itself communicates the BUILD 01 priority (Architecture/Camera/
 * Material outrank Style/Lighting; docs/06 Reasoning Engine priority §2).
 */
export function LockControlGroup({ locks, disabled = false, onToggle }: LockControlGroupProps) {
  if (locks.length === 0) {
    return (
      <EmptyState
        title="Locks become available after analysis"
        description="Architecture, Camera, and Material Lock activate automatically once a source image is analyzed (BUILD 07)."
      />
    );
  }

  const ordered = [...locks].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'source-fidelity' ? -1 : 1));

  return (
    <div role="group" aria-label="Locks">
      {ordered.map((lock) => (
        <LockControl key={lock.id} lock={lock} disabled={disabled} onToggle={(next) => onToggle?.(lock.id, next)} />
      ))}
    </div>
  );
}
