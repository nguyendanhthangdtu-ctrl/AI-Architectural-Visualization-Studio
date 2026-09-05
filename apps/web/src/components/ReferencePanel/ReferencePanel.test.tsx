import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { ReferencePanel } from './ReferencePanel.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function uploadFile(name = 'ref.png', type = 'image/png') {
  return new File(['fake-bytes'], name, { type });
}

function renderWithState(overrides: Partial<ReturnType<typeof createInitialProjectSessionState>>) {
  const store = new ProjectSessionStore({ ...createInitialProjectSessionState(), ...overrides });
  render(
    <ProjectSessionProvider store={store}>
      <ReferencePanel />
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

describe('ReferencePanel', () => {
  it('disables the reference upload until a project exists', () => {
    renderWithState({});
    expect(screen.getByRole('button', { name: /drop a reference image/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/upload a source image first/i)).toBeInTheDocument();
  });

  it('enables upload once a project exists, with no fake preview image', () => {
    renderWithState({ currentProject: PROJECT });
    expect(screen.getByRole('button', { name: /drop a reference image/i })).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  describe('BUILD 10: real upload + extraction flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uploads the reference image and shows the real returned image on success', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'r1', url: '/assets/r1', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );
      renderWithState({ currentProject: PROJECT });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });

      await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/projects/p1/assets');
    });

    it('runs a purpose-scoped extraction and lists the result, never showing an architecture field', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({
          referenceId: 'ref1',
          extractedVisualLanguage: { purpose: 'style', weight: 1, fields: { style: 'Modern Minimal' } },
        }, { status: 201 }),
      );
      renderWithState({ currentProject: PROJECT, referenceImage: { assetId: 'r1', url: '/assets/r1' } });

      fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'style' } });
      fireEvent.click(screen.getByRole('button', { name: /extract visual language/i }));

      await waitFor(() => expect(screen.getByText('style')).toBeInTheDocument());
      expect(screen.getByText(/style: Modern Minimal/)).toBeInTheDocument();
      expect(screen.queryByText(/architecture/i)).not.toBeInTheDocument();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/references');
      expect(JSON.parse(init.body).purpose).toBe('style');
    });

    it('shows the real error envelope, not a fake result, when extraction fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          { code: 'PROVIDER_NOT_CONFIGURED', message: 'GEMINI_API_KEY is not configured.', retryable: false },
          { status: 503 },
        ),
      );
      renderWithState({ currentProject: PROJECT, referenceImage: { assetId: 'r1', url: '/assets/r1' } });

      fireEvent.click(screen.getByRole('button', { name: /extract visual language/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GEMINI_API_KEY is not configured.'));
      expect(screen.getByText('No extraction yet')).toBeInTheDocument();
    });
  });
});
