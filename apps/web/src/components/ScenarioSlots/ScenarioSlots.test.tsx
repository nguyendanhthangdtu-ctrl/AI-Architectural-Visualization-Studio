import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DomainError } from '@avs/shared';
import { scenarioBuilder } from '@avs/ai-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ScenarioSlots } from './ScenarioSlots.js';

function renderScenarioSlots() {
  return render(
    <ProjectSessionProvider>
      <ScenarioSlots />
    </ProjectSessionProvider>,
  );
}

function fillValidScenario() {
  fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'Residential' } });
  fireEvent.change(screen.getByLabelText('Lighting'), { target: { value: 'Golden Hour' } });
  fireEvent.change(screen.getByLabelText('Sun Direction'), { target: { value: 'Front' } });
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'Clear sky' } });
  fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'Preserve Original' } });
  fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '2:3' } });
  fireEvent.change(screen.getByLabelText('Generation Resolution'), { target: { value: '2K' } });
  fireEvent.change(screen.getByLabelText('Upscale Resolution'), { target: { value: '4K' } });
  fireEvent.change(screen.getByLabelText('Render Core'), { target: { value: 'Auto' } });
}

describe('ScenarioSlots', () => {
  it('renders every docs/07 scenario field as a labeled, accessible select, with generation/upscale resolution as two distinct fields', () => {
    renderScenarioSlots();
    for (const label of [
      'Context',
      'Lighting',
      'Sun Direction',
      'Environment',
      'Camera',
      'Aspect Ratio',
      'Generation Resolution',
      'Upscale Resolution',
      'Render Core',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('renders Artificial Lighting as a multi-select checkbox group, not a single select', () => {
    renderScenarioSlots();
    expect(screen.getByRole('checkbox', { name: 'Downlight IES' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Accent' })).toBeInTheDocument();
  });

  it('keeps Apply Scenario disabled until every required field is selected', () => {
    renderScenarioSlots();
    const applyButton = screen.getByRole('button', { name: /apply scenario/i });
    expect(applyButton).toBeDisabled();
    fillValidScenario();
    expect(applyButton).toBeEnabled();
  });

  it('applies a valid scenario, writing the real normalized result into ProjectSessionState — status changes from Draft to Applied', async () => {
    renderScenarioSlots();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    fillValidScenario();
    fireEvent.click(screen.getByRole('button', { name: /apply scenario/i }));
    await waitFor(() => expect(screen.getByText('Applied')).toBeInTheDocument());
  });

  describe('when normalize() rejects', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows the real validation error, not a fake success, and stays in Draft status', async () => {
      // The <select> inputs can only submit valid options (docs/07 vocabulary is structurally enforced
      // by the UI), so a genuinely invalid combination can't be produced through normal interaction —
      // that path is already covered at the domain level in packages/ai-core/src/scenario.test.ts. This
      // spies on the real normalize() to prove the component's error-handling wiring itself works, for
      // whatever real rejection reaches it (a future field, a race, etc.).
      vi.spyOn(scenarioBuilder, 'normalize').mockRejectedValueOnce(
        new DomainError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid scenario: context is required.',
          retryable: false,
        }),
      );
      renderScenarioSlots();
      fillValidScenario();
      fireEvent.click(screen.getByRole('button', { name: /apply scenario/i }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid scenario: context is required.'),
      );
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });
  });
});
