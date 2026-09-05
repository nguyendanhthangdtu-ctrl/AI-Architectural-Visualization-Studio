import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider } from '../../state/router.js';
import { Navigation } from './Navigation.js';

describe('Navigation', () => {
  it('renders Architecture and Interior as accessible, keyboard-reachable links', () => {
    render(
      <RouterProvider>
        <Navigation />
      </RouterProvider>,
    );
    const architecture = screen.getByRole('link', { name: 'Architecture' });
    const interior = screen.getByRole('link', { name: 'Interior' });
    expect(architecture).toHaveAttribute('href', '/architecture');
    expect(interior).toHaveAttribute('href', '/interior');
  });

  it('does not render the parameterized project route as a top-level nav item', () => {
    render(
      <RouterProvider>
        <Navigation />
      </RouterProvider>,
    );
    expect(screen.queryByRole('link', { name: 'Project / Workspace' })).not.toBeInTheDocument();
  });
});
