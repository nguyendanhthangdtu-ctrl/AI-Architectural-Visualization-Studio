import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RouterProvider, useRouter } from './router.js';

function Probe() {
  const { pathname, route, navigate } = useRouter();
  return (
    <div>
      <span data-testid="pathname">{pathname}</span>
      <span data-testid="route-name">{route?.name ?? 'none'}</span>
      <button type="button" onClick={() => navigate('/interior')}>
        go interior
      </button>
    </div>
  );
}

describe('RouterProvider / useRouter', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/architecture');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('reads the current pathname and resolves it against the BUILD 02 route table', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    expect(screen.getByTestId('pathname')).toHaveTextContent('/architecture');
    expect(screen.getByTestId('route-name')).toHaveTextContent('architecture');
  });

  it('navigates via history.pushState and re-renders subscribers', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'go interior' }));
    });
    expect(screen.getByTestId('pathname')).toHaveTextContent('/interior');
    expect(window.location.pathname).toBe('/interior');
  });

  it('throws a clear error when useRouter is used outside a RouterProvider', () => {
    // Suppress React's expected error-boundary console noise for this one assertion.
    const spy = () => undefined;
    const original = console.error;
    console.error = spy;
    expect(() => render(<Probe />)).toThrow('useRouter must be used within a RouterProvider');
    console.error = original;
  });
});
