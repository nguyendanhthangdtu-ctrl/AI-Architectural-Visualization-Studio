import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProjectSessionProvider, useProjectSessionActions, useProjectSessionState } from './ProjectSessionContext.js';

function Probe() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <button type="button" onClick={() => setState({ status: 'loading' })}>
        start loading
      </button>
    </div>
  );
}

describe('ProjectSessionProvider / useProjectSessionState', () => {
  it('reflects the BUILD 02 ProjectSessionStore initial state — not a second state system', () => {
    render(
      <ProjectSessionProvider>
        <Probe />
      </ProjectSessionProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('re-renders subscribers when the store updates via useSyncExternalStore', () => {
    render(
      <ProjectSessionProvider>
        <Probe />
      </ProjectSessionProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'start loading' }));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('throws a clear error when used outside a ProjectSessionProvider', () => {
    const original = console.error;
    console.error = () => undefined;
    expect(() => render(<Probe />)).toThrow('useProjectSession must be used within a ProjectSessionProvider');
    console.error = original;
  });
});
