import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchitectureFocus } from './ArchitectureFocus.js';

describe('ArchitectureFocus', () => {
  it('renders the real architecture-module vocabulary, not fabricated analysis results', () => {
    render(<ArchitectureFocus />);
    expect(screen.getByText('Architecture Focus')).toBeInTheDocument();
    expect(screen.getByText('Gable')).toBeInTheDocument();
    expect(screen.getByText('Landscaping')).toBeInTheDocument();
    expect(screen.getByText('BUILD 07')).toBeInTheDocument();
  });
});
