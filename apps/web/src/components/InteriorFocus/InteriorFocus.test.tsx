import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InteriorFocus } from './InteriorFocus.js';

describe('InteriorFocus', () => {
  it('renders the real interior-module vocabulary, not fabricated analysis results', () => {
    render(<InteriorFocus />);
    expect(screen.getByText('Interior Focus')).toBeInTheDocument();
    expect(screen.getByText('Hardwood')).toBeInTheDocument();
    expect(screen.getByText('Seating')).toBeInTheDocument();
    expect(screen.getByText('BUILD 07')).toBeInTheDocument();
  });
});
