import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Lock } from '@avs/project-core';
import { LockControl } from './LockControl.js';
import { LockControlGroup } from './LockControlGroup.js';

const now = '2026-09-04T00:00:00.000Z' as never;

function makeLock(overrides: Partial<Lock>): Lock {
  return {
    id: 'architecture',
    tier: 'source-fidelity',
    enabled: true,
    pinnedRef: null,
    setBy: 'u1' as never,
    setAt: now,
    history: [],
    ...overrides,
  };
}

describe('LockControl', () => {
  it('represents an enabled source-fidelity lock with both a switch state and a text state', () => {
    render(<LockControl lock={makeLock({ id: 'architecture', tier: 'source-fidelity', enabled: true })} />);
    expect(screen.getByRole('switch', { name: 'Architecture Lock' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Enabled — preserved')).toBeInTheDocument();
    expect(screen.getByText('Source-fidelity')).toBeInTheDocument();
  });

  it('represents a disabled output-stability lock distinctly from a source-fidelity one', () => {
    render(<LockControl lock={makeLock({ id: 'style', tier: 'output-stability', enabled: false })} />);
    expect(screen.getByRole('switch', { name: 'Style Lock' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Output-stability')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('never silently drops a conflict — it renders as an explicit alert', () => {
    render(
      <LockControl
        lock={makeLock({ id: 'lighting', tier: 'output-stability', enabled: true })}
        conflict="Pinned lighting conflicts with the selected scenario."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Pinned lighting conflicts with the selected scenario.');
  });

  it('calls onToggle with the inverted state when the switch is activated', () => {
    const onToggle = vi.fn();
    render(<LockControl lock={makeLock({ enabled: true })} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Architecture Lock' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});

describe('LockControlGroup', () => {
  it('orders source-fidelity locks before output-stability locks, matching Reasoning Engine priority', () => {
    const locks: Lock[] = [
      makeLock({ id: 'style', tier: 'output-stability', enabled: false }),
      makeLock({ id: 'architecture', tier: 'source-fidelity', enabled: true }),
      makeLock({ id: 'lighting', tier: 'output-stability', enabled: false }),
      makeLock({ id: 'camera', tier: 'source-fidelity', enabled: true }),
      makeLock({ id: 'material', tier: 'source-fidelity', enabled: true }),
    ];
    render(<LockControlGroup locks={locks} />);
    const switches = screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label'));
    expect(switches.slice(0, 3)).toEqual(expect.arrayContaining(['Architecture Lock', 'Camera Lock', 'Material Lock']));
    expect(switches.slice(3)).toEqual(expect.arrayContaining(['Style Lock', 'Lighting Lock']));
  });

  it('shows an honest empty state — not fake default locks — before any analysis exists', () => {
    render(<LockControlGroup locks={[]} />);
    expect(screen.getByText('Locks become available after analysis')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
