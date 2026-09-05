import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { PromptFromImage } from './PromptFromImage.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderWithState(overrides: Partial<ReturnType<typeof createInitialProjectSessionState>>) {
  const store = new ProjectSessionStore({ ...createInitialProjectSessionState(), ...overrides });
  render(
    <ProjectSessionProvider store={store}>
      <PromptFromImage />
    </ProjectSessionProvider>,
  );
  return store;
}

const PROJECT = {
  id: 'p1',
  name: 'x',
  module: 'architecture',
  createdAt: 't',
  updatedAt: 't',
  status: 'draft',
  currentVersionId: '',
} as unknown as Project;

describe('PromptFromImage — BUILD 10 real wiring', () => {
  it('stays disabled with the empty state until a reference image exists', () => {
    renderWithState({});
    expect(screen.getByRole('button', { name: /detect prompt from image/i })).toBeDisabled();
    expect(screen.getByText('No detected prompt yet')).toBeInTheDocument();
  });

  it('enables detection once a reference image exists', () => {
    renderWithState({ currentProject: PROJECT, referenceImage: { assetId: 'r1', url: '/assets/r1' } });
    expect(screen.getByRole('button', { name: /detect prompt from image/i })).toBeEnabled();
  });

  describe('real detection flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("runs extraction with purpose 'auto' and shows the real extracted fields, not a fabricated prompt", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            referenceId: 'ref1',
            extractedVisualLanguage: { purpose: 'auto', weight: 1, fields: { style: 'Modern', dominantTones: 'warm' } },
          },
          { status: 201 },
        ),
      );
      renderWithState({ currentProject: PROJECT, referenceImage: { assetId: 'r1', url: '/assets/r1' } });

      fireEvent.click(screen.getByRole('button', { name: /detect prompt from image/i }));

      await waitFor(() => expect(screen.getByText(/style: Modern/)).toBeInTheDocument());
      expect(screen.getByText(/dominantTones: warm/)).toBeInTheDocument();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/references');
      expect(JSON.parse(init.body)).toEqual({ assetId: 'r1', purpose: 'auto' });
    });

    it('shows the real error envelope, not a fake result, when detection fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          { code: 'PROVIDER_NOT_CONFIGURED', message: 'GEMINI_API_KEY is not configured.', retryable: false },
          { status: 503 },
        ),
      );
      renderWithState({ currentProject: PROJECT, referenceImage: { assetId: 'r1', url: '/assets/r1' } });

      fireEvent.click(screen.getByRole('button', { name: /detect prompt from image/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GEMINI_API_KEY is not configured.'));
      expect(screen.getByText('No detected prompt yet')).toBeInTheDocument();
    });
  });
});
