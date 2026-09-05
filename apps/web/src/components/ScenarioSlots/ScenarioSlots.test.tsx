import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DomainError } from '@avs/shared';
import { scenarioBuilder } from '@avs/ai-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
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
  fireEvent.change(screen.getByLabelText('AI Image Model'), { target: { value: 'Auto' } });
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
      'AI Image Model',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('BUILD 25: defaults AI Image Model to Nano Banana 2, shown with its provider and real model id', () => {
    renderScenarioSlots();
    const select = screen.getByLabelText('AI Image Model') as HTMLSelectElement;
    expect(select.value).toBe('Nano Banana');
    expect(screen.getByRole('option', { name: 'Nano Banana 2 — Google Gemini (gemini-3.1-flash-image)' })).toBeInTheDocument();
  });

  it('BUILD 26: disables an Aspect Ratio option the currently selected model does not support', () => {
    renderScenarioSlots();
    // Default model is Nano Banana 2, whose real capabilities().supportedAspectRatios is ['1:1','16:9','9:16'] — '4:3' is not in it.
    const disabledOption = screen.getByRole('option', { name: '4:3' }) as HTMLOptionElement;
    expect(disabledOption.disabled).toBe(true);
    const enabledOption = screen.getByRole('option', { name: '16:9' }) as HTMLOptionElement;
    expect(enabledOption.disabled).toBe(false);
  });

  it('BUILD 26: warns and keeps Apply Scenario disabled when the selected Aspect Ratio is incompatible with the selected model', () => {
    renderScenarioSlots();
    fillValidScenario(); // ends with renderCore: 'Auto', aspectRatio: '2:3' — both currently valid together
    // Switch back to Nano Banana 2, which does NOT support '2:3'.
    fireEvent.change(screen.getByLabelText('AI Image Model'), { target: { value: 'Nano Banana' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/Aspect Ratio "2:3" is not supported by the selected AI Image Model/);
    expect(screen.getByRole('button', { name: /apply scenario/i })).toBeDisabled();
  });

  it('BUILD 25: never offers Google Flow as a visible AI Image Model choice — its adapter is NOT_IMPLEMENTED', () => {
    renderScenarioSlots();
    expect(screen.queryByRole('option', { name: /Google Flow/i })).not.toBeInTheDocument();
  });

  it('BUILD 27: offers Nano Banana Pro as the second AI Image Model choice, after Nano Banana 2 and before ChatGPT Image', () => {
    renderScenarioSlots();
    const select = screen.getByLabelText('AI Image Model') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual([
      '—',
      'Nano Banana 2 — Google Gemini (gemini-3.1-flash-image)',
      'Nano Banana Pro — Google Gemini (gemini-3-pro-image)',
      'ChatGPT Image — openai (gpt-image-1)',
      'Auto',
    ]);
  });

  it('BUILD 27: shows "Not configured" next to a model whose credential GET /ready reported as absent, without disabling it', () => {
    const store = new ProjectSessionStore({
      ...createInitialProjectSessionState(),
      providerConfiguration: {
        gemini: { configured: true },
        nanoBanana: { configured: true },
        nanoBananaPro: { configured: true },
        chatgptImage: { configured: false },
        veo: { configured: false },
        email: { configured: false },
      },
    });
    render(
      <ProjectSessionProvider store={store}>
        <ScenarioSlots />
      </ProjectSessionProvider>,
    );
    const option = screen.getByRole('option', { name: 'ChatGPT Image — openai (gpt-image-1) — Not configured' }) as HTMLOptionElement;
    expect(option.disabled).toBe(false); // still selectable — never crashes, never turns a missing key into an uncontrolled UI failure
    expect(screen.getByRole('option', { name: 'Nano Banana 2 — Google Gemini (gemini-3.1-flash-image)' })).toBeInTheDocument(); // configured model unaffected
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
