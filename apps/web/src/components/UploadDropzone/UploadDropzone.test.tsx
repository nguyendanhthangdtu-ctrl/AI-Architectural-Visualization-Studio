import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UploadDropzone } from './UploadDropzone.js';

describe('UploadDropzone', () => {
  it('renders an accessible, keyboard-focusable empty state with no fake preview', () => {
    render(<UploadDropzone onFilesSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /drop a viewport image/i });
    expect(zone).toHaveAttribute('tabIndex', '0');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('is keyboard-activatable via Enter to open the file picker', () => {
    render(<UploadDropzone onFilesSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /drop a viewport image/i });
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(zone, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('renders the shared ErrorState (not a fake success message) when status is error', () => {
    render(
      <UploadDropzone
        status="error"
        error={{ code: 'INVALID_FILE', message: 'File is too large.', retryable: true }}
        onFilesSelected={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('File is too large.');
  });

  it('is disabled and non-focusable when disabled', () => {
    render(<UploadDropzone disabled onFilesSelected={() => {}} />);
    const zone = screen.getByRole('button', { name: /drop a viewport image/i });
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    expect(zone).toHaveAttribute('tabIndex', '-1');
  });
});
