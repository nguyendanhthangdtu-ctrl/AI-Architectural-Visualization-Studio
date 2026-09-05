import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResultActions } from './ResultActions.js';

describe('ResultActions (BUILD 26 Result View)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a real download link pointing at the real image URL, with no forced/guessed extension', () => {
    render(<ResultActions imageUrl="/assets/output-1?exp=123&sig=abc" />);
    const link = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    expect(link).toHaveAttribute('href', '/assets/output-1?exp=123&sig=abc');
    expect(link).toHaveAttribute('download', '');
  });

  it('copies the real, absolute image URL to the clipboard — never a fabricated one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ResultActions imageUrl="/assets/output-1?exp=123&sig=abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Image URL' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/assets/output-1?exp=123&sig=abc`));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument());
  });

  it('shows a real failure state, not a fake success, when the clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ResultActions imageUrl="/assets/output-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Image URL' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument());
  });
});
