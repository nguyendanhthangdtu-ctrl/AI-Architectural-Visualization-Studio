import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { ModuleWorkspace } from './ModuleWorkspace.js';

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
      <ModuleWorkspace module="architecture" />
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

const SCENARIO = {
  context: 'Residential',
  lighting: 'Golden Hour',
  sunDirection: 'Front',
  artificialLighting: [],
  environment: 'Clear sky',
  cameraMode: 'Preserve Original',
  aspectRatio: '2:3',
  generationResolution: '2K',
  upscaleResolution: '4K',
  renderCore: 'Nano Banana',
  normalizedAt: '2026-09-04T00:00:00.000Z',
};

describe('ModuleWorkspace — BUILD 13 real Render action', () => {
  it('stays disabled until source image, scenario, and prompt text all exist', () => {
    renderWithState({});
    expect(screen.getByRole('button', { name: 'Render' })).toBeDisabled();
  });

  it('enables Render once everything required exists', () => {
    renderWithState({
      currentProject: PROJECT,
      sourceImage: { assetId: 'a1', url: '/assets/a1' },
      scenario: SCENARIO,
      promptDraft: 'a modern villa at golden hour',
    });
    expect(screen.getByRole('button', { name: 'Render' })).toBeEnabled();
    expect(screen.getByText(/Ready to render with Nano Banana/)).toBeInTheDocument();
  });

  describe('real generation flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('calls the generation endpoint with real provenance and shows the real output in the canvas', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jobId: 'job-1',
            generationId: 'gen-1',
            versionId: 'v1',
            project: { ...PROJECT, currentVersionId: 'v1' },
            generation: { id: 'gen-1', status: 'succeeded', provider: 'nano-banana', outputAssets: ['out-1'] },
            outputAssetUrls: ['/assets/out-1'],
          },
          { status: 201 },
        ),
      );

      renderWithState({
        currentProject: PROJECT,
        sourceImage: { assetId: 'a1', url: '/assets/a1' },
        references: [{ referenceId: 'r1', assetId: 'ref-a1', purpose: 'style', extractedVisualLanguage: { purpose: 'style', weight: 1, fields: {} } }],
        scenario: SCENARIO,
        promptDraft: 'a modern villa at golden hour',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Render' }));

      await waitFor(() => expect(screen.getByRole('img', { name: 'Generated photograph' })).toBeInTheDocument());

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/generations');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        promptText: 'a modern villa at golden hour',
        renderCore: 'Nano Banana',
        aspectRatio: '2:3',
        resolution: '2K',
        sourceAssetId: 'a1',
        referenceAssetIds: ['ref-a1'],
        promptVersion: 'manual-edit', // no promptOutput was compiled — honest fallback (CLAUDE.md rule 14 "when available")
        scenarioVersion: '2026-09-04T00:00:00.000Z',
      });
    });

    it('shows the real error envelope, not a fake image, when generation fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'PROVIDER_NOT_CONFIGURED', message: 'NANO_BANANA_API_KEY is not configured.', retryable: false }, { status: 503 }),
      );

      renderWithState({
        currentProject: PROJECT,
        sourceImage: { assetId: 'a1', url: '/assets/a1' },
        scenario: SCENARIO,
        promptDraft: 'a modern villa at golden hour',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Render' }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('NANO_BANANA_API_KEY is not configured.'));
      expect(screen.queryByRole('img', { name: 'Generated photograph' })).not.toBeInTheDocument();
    });
  });
});
