import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Panel } from './Panel.js';

describe('Panel', () => {
  it('is collapsed by default so it never behaves as a permanently wide panel', () => {
    render(
      <Panel title="Inspector">
        <p>content</p>
      </Panel>,
    );
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('data-open', 'false');
  });

  it('expands and collapses via a keyboard-accessible, labeled toggle button', () => {
    render(
      <Panel title="Inspector">
        <p>content</p>
      </Panel>,
    );
    const toggle = screen.getByRole('button', { name: 'Expand Inspector' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('button', { name: 'Collapse Inspector' })).toBeInTheDocument();
  });
});
