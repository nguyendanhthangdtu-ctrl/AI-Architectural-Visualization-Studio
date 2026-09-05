import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { Workspace } from './Workspace.js';

// Panel.tsx keeps its children mounted even while collapsed (only their
// visual display toggles via CSS, see Panel.module.css `[data-open='false']
// .body { display: none }`), so these assertions don't need to expand it.
describe('Workspace', () => {
  it('renders the real Architecture vocabulary in the Inspector for the architecture module', () => {
    render(
      <ProjectSessionProvider>
        <Workspace module="architecture" />
      </ProjectSessionProvider>,
    );
    expect(screen.getByText('Architecture Focus')).toBeInTheDocument();
    expect(screen.getByText('Gable')).toBeInTheDocument();
  });

  it('renders the real Interior vocabulary in the Inspector for the interior module, not Architecture content', () => {
    render(
      <ProjectSessionProvider>
        <Workspace module="interior" />
      </ProjectSessionProvider>,
    );
    expect(screen.queryByText('Architecture Focus')).not.toBeInTheDocument();
    expect(screen.getByText('Interior Focus')).toBeInTheDocument();
    expect(screen.getByText('Hardwood')).toBeInTheDocument();
  });

  it('still renders the Inspector collapsed by default regardless of module', () => {
    render(
      <ProjectSessionProvider>
        <Workspace module="architecture" />
      </ProjectSessionProvider>,
    );
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('data-open', 'false');
  });
});
