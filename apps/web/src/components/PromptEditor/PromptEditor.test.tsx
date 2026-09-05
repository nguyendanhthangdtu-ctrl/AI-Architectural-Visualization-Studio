import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PromptEditor } from './PromptEditor.js';

describe('PromptEditor', () => {
  it('renders an empty state and disabled actions with no draft text', () => {
    render(<PromptEditor value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('reports a Draft status and enables actions once there is text', () => {
    render(<PromptEditor value="a modern villa" onChange={() => {}} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('calls onChange as the user types, and Clear resets to empty', () => {
    const onChange = vi.fn();
    render(<PromptEditor value="draft text" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('exposes an accessible label for the textarea', () => {
    render(<PromptEditor value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Prompt editor')).toBeInTheDocument();
  });

  describe('BUILD 11: Compile Prompt action', () => {
    it('omits the Compile Prompt button and shows the BUILD 11 note when onCompile is not provided (pre-BUILD-11 callers)', () => {
      render(<PromptEditor value="" onChange={() => {}} />);
      expect(screen.queryByRole('button', { name: /compile prompt/i })).not.toBeInTheDocument();
      expect(screen.getByText('Structured Master Prompt Compiler — BUILD 11')).toBeInTheDocument();
    });

    it('renders Compile Prompt disabled until canCompile is true', () => {
      const { rerender } = render(<PromptEditor value="" onChange={() => {}} onCompile={() => {}} canCompile={false} />);
      expect(screen.getByRole('button', { name: /compile prompt/i })).toBeDisabled();
      rerender(<PromptEditor value="" onChange={() => {}} onCompile={() => {}} canCompile={true} />);
      expect(screen.getByRole('button', { name: /compile prompt/i })).toBeEnabled();
    });

    it('calls onCompile when clicked', () => {
      const onCompile = vi.fn();
      render(<PromptEditor value="" onChange={() => {}} onCompile={onCompile} canCompile={true} />);
      fireEvent.click(screen.getByRole('button', { name: /compile prompt/i }));
      expect(onCompile).toHaveBeenCalledTimes(1);
    });

    it('shows the real compile error, not a fake result, when compileStatus is error', () => {
      render(
        <PromptEditor
          value=""
          onChange={() => {}}
          onCompile={() => {}}
          canCompile={true}
          compileStatus="error"
          compileError={{ code: 'VALIDATION_ERROR', message: 'Missing scenario.', retryable: false }}
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Missing scenario.');
    });
  });
});
