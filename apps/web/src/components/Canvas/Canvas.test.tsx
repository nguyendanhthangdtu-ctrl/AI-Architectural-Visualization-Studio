import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Canvas } from './Canvas.js';

describe('Canvas', () => {
  it('defaults to a portrait (2:3) aspect ratio', () => {
    render(<Canvas />);
    expect(screen.getByLabelText('Canvas')).toHaveAttribute('data-aspect-ratio', '2:3');
  });

  it('shows a clean empty state with no image element when there is no source image', () => {
    render(<Canvas />);
    expect(screen.getByText('No source image yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('accepts a different aspect ratio without any other prop', () => {
    render(<Canvas aspectRatio="16:9" />);
    expect(screen.getByLabelText('Canvas')).toHaveAttribute('data-aspect-ratio', '16:9');
  });

  it('renders the real source image, never a bundled sample, once one exists', () => {
    render(<Canvas sourceImageUrl="blob:local-preview" />);
    expect(screen.getByRole('img', { name: 'Source viewport' })).toHaveAttribute('src', 'blob:local-preview');
  });

  it('BUILD 13: shows the generated output in place of the source viewport once one exists', () => {
    render(<Canvas sourceImageUrl="blob:local-preview" outputImageUrl="http://localhost:8080/assets/out-1" />);
    expect(screen.getByRole('img', { name: 'Generated photograph' })).toHaveAttribute(
      'src',
      'http://localhost:8080/assets/out-1',
    );
    expect(screen.queryByRole('img', { name: 'Source viewport' })).not.toBeInTheDocument();
  });
});
