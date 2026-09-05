import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { VideoPanel } from './VideoPanel.js';

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
      <VideoPanel />
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
  aspectRatio: '16:9',
  generationResolution: '1080p',
  upscaleResolution: '4K',
  renderCore: 'Nano Banana',
  normalizedAt: '2026-09-04T00:00:00.000Z',
};

const READY_STATE = {
  currentProject: PROJECT,
  scenario: SCENARIO,
  latestGenerationId: 'gen-1',
  latestOutputAssetId: 'out-1',
};

describe('VideoPanel — BUILD 16 Image → Video', () => {
  it('shows the empty state until a generation exists', () => {
    renderWithState({});
    expect(screen.getByText('No generated image yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate video/i })).not.toBeInTheDocument();
  });

  it('renders the real form once a generation exists, disabled until a motion description is filled', () => {
    renderWithState(READY_STATE);
    const generateButton = screen.getByRole('button', { name: /generate video/i });
    expect(generateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motion description'), { target: { value: 'camera dollies toward the entrance' } });
    expect(generateButton).toBeEnabled();
  });

  describe('real, genuinely asynchronous video flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('submits the real declared fields, then polls until the provider reports succeeded, then shows a real playable output video', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              videoId: 'video-1',
              versionId: 'v1',
              project: PROJECT,
              video: { id: 'video-1', status: 'running', providerOperationName: 'operations/op-1' },
            },
            { status: 202 },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ video: { id: 'video-1', status: 'running' }, outputAssetUrl: null }))
        .mockResolvedValueOnce(
          jsonResponse({ video: { id: 'video-1', status: 'succeeded', resultingAssetId: 'asset-9' }, outputAssetUrl: '/assets/asset-9' }),
        );

      renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Motion'), { target: { value: 'push-in' } });
      fireEvent.change(screen.getByLabelText('Motion description'), { target: { value: 'camera dollies toward the entrance' } });
      fireEvent.change(screen.getByLabelText('Duration (seconds)'), { target: { value: '8' } });
      fireEvent.click(screen.getByRole('button', { name: /generate video/i }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/generations/gen-1/videos');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        sourceAssetId: 'out-1',
        motionType: 'push-in',
        motionDescription: 'camera dollies toward the entrance',
        durationSeconds: 8,
        aspectRatio: '16:9',
        resolution: '1080p',
        renderCore: 'Veo',
      });

      await vi.waitFor(() => expect(screen.getByText('Video generation in progress')).toBeInTheDocument());

      // First poll — provider still running.
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]![0]).toContain('/projects/p1/videos/video-1');

      // Second poll — provider reports succeeded; real output asset URL rendered as a playable <video>.
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(document.querySelector('video')).not.toBeNull());
      expect(document.querySelector('video')?.getAttribute('src')).toBe('/assets/asset-9');
    });

    it('shows a failed state when the provider operation errors', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            { videoId: 'video-1', versionId: 'v1', project: PROJECT, video: { id: 'video-1', status: 'running', providerOperationName: 'op-1' } },
            { status: 202 },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ video: { id: 'video-1', status: 'failed' }, outputAssetUrl: null }));

      renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Motion description'), { target: { value: 'camera dollies toward the entrance' } });
      fireEvent.click(screen.getByRole('button', { name: /generate video/i }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The video provider reported a failure.'));
    });

    it('shows the real error envelope, not a fake result, when submission fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'PROVIDER_NOT_CONFIGURED', message: 'VEO_API_KEY is not configured.', retryable: false }, { status: 503 }),
      );

      renderWithState(READY_STATE);
      fireEvent.change(screen.getByLabelText('Motion description'), { target: { value: 'camera dollies toward the entrance' } });
      fireEvent.click(screen.getByRole('button', { name: /generate video/i }));

      await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('VEO_API_KEY is not configured.'));
    });
  });
});
