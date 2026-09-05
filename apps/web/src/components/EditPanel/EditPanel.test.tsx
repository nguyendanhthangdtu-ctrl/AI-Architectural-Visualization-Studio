import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Lock, Project } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { EditPanel } from './EditPanel.js';

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
      <EditPanel />
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

function lock(id: Lock['id'], enabled: boolean): Lock {
  return { id, tier: 'source-fidelity', enabled, pinnedRef: null, setBy: 'u1' as never, setAt: 't' as never, history: [] };
}

const READY_STATE = {
  currentProject: PROJECT,
  scenario: SCENARIO,
  latestGenerationId: 'gen-1',
  latestOutputAssetId: 'out-1',
  locks: [lock('architecture', true), lock('camera', true), lock('material', false), lock('style', false), lock('lighting', false)],
};

describe('EditPanel — BUILD 14 Advanced Editor', () => {
  it('shows the empty state until a generation exists', () => {
    renderWithState({});
    expect(screen.getByText('No generated image yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply edit/i })).not.toBeInTheDocument();
  });

  it('renders the real form once a generation exists, disabled until target region and intended change are filled', () => {
    renderWithState(READY_STATE);
    const applyButton = screen.getByRole('button', { name: /apply edit/i });
    expect(applyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Target region'), { target: { value: 'the facade material' } });
    expect(applyButton).toBeDisabled(); // intended change still empty
    fireEvent.change(screen.getByLabelText('Intended change'), { target: { value: 'replace with warm wood cladding' } });
    expect(applyButton).toBeEnabled();
  });

  describe('real edit flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('submits the real declared fields — target region, intended change, category, and protected locks derived from real lock state', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jobId: 'job-1',
            editId: 'edit-1',
            versionId: 'v1',
            project: PROJECT,
            edit: { id: 'edit-1', status: 'succeeded', resultingAssetId: 'out-2' },
            outputAssetUrls: ['/assets/out-2'],
          },
          { status: 201 },
        ),
      );

      renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'material-replacement' } });
      fireEvent.change(screen.getByLabelText('Target region'), { target: { value: 'the facade material' } });
      fireEvent.change(screen.getByLabelText('Intended change'), { target: { value: 'replace with warm wood cladding' } });
      fireEvent.click(screen.getByRole('button', { name: /apply edit/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/generations/gen-1/edits');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        sourceAssetId: 'out-1',
        targetRegionDescription: 'the facade material',
        intendedChange: 'replace with warm wood cladding',
        category: 'material-replacement',
        protectedLocks: ['architecture', 'camera'], // real — only the currently-enabled locks, never fabricated
        aspectRatio: '2:3',
        resolution: '2K',
      });
    });

    it('updates the canvas output and tracked asset id on success, clearing the form for the next edit', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jobId: 'job-1',
            editId: 'edit-1',
            versionId: 'v1',
            project: PROJECT,
            edit: { id: 'edit-1', status: 'succeeded', resultingAssetId: 'out-2' },
            outputAssetUrls: ['/assets/out-2'],
          },
          { status: 201 },
        ),
      );

      const store = renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Target region'), { target: { value: 'the facade material' } });
      fireEvent.change(screen.getByLabelText('Intended change'), { target: { value: 'replace with warm wood cladding' } });
      fireEvent.click(screen.getByRole('button', { name: /apply edit/i }));

      await waitFor(() => expect(store.getState().latestOutputAssetId).toBe('out-2'));
      expect(store.getState().latestGenerationOutputUrls).toEqual(['http://localhost:8080/assets/out-2']);
      expect((screen.getByLabelText('Target region') as HTMLInputElement).value).toBe('');
    });

    it('shows the real error envelope, not a fake result, when the edit fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'EDIT_NOT_SUPPORTED', message: 'Adapter does not support editing.', retryable: false }, { status: 501 }),
      );

      renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Target region'), { target: { value: 'the facade material' } });
      fireEvent.change(screen.getByLabelText('Intended change'), { target: { value: 'replace with warm wood cladding' } });
      fireEvent.click(screen.getByRole('button', { name: /apply edit/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Adapter does not support editing.'));
    });
  });
});
