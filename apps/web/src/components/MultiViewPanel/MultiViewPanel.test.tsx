import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { createDefaultLocks, type Lock } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { reasoningEngine, type NormalizedRequest, type StructuredIntelligence } from '@avs/ai-core';
import type { PromptOutput } from '@avs/prompt-engine';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { MultiViewPanel } from './MultiViewPanel.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

const now = '2026-09-05T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<Lock['id'], boolean>> = {}): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildStructuredIntelligence(): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module: 'architecture',
    layers: {
      subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'a villa' } },
      architecture: {
        confidence: 0.8,
        warnings: [],
        data: { geometry: 'boxy', openings: 'glazing', roof: 'flat', facade: 'cladding', floorPlan: 'open', ceiling: 'flat', stairs: 'none', proportions: 'balanced' },
      },
      style: { confidence: 0.7, warnings: [], data: { style: 'Modern Contemporary', influences: [] } },
      camera: {
        confidence: 0.6,
        warnings: [],
        data: { heightMeters: 1.6, lens: 'wide', fieldOfViewDegrees: 60, perspective: 'eye level', eyeLevel: 'standing', projection: 'two-point perspective', verticalCorrection: 'none' },
      },
      composition: { confidence: 0.7, warnings: [], data: { leadingLines: '', ruleOfThirds: '', goldenRatio: '', symmetry: '', balance: '', negativeSpace: '', hierarchy: '' } },
      material: { confidence: 0.6, warnings: [], data: { materials: [{ surface: 'wall', type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' }] } },
      lighting: { confidence: 0.5, warnings: [], data: { direction: 'front', timeOfDay: 'midday', intensity: 'high', softness: 'hard', shadows: 'sharp', colorTemperature: 'neutral', artificialLighting: [] } },
      environment: { confidence: 0.6, warnings: [], data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' } },
      object: { confidence: 0.5, warnings: [], data: { objects: [] } },
      photography: { confidence: 0.6, warnings: [], data: { cameraSystemLook: '', lensBehavior: '', exposure: '', dynamicRange: '', depth: '', imperfections: '' } },
      realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'professional' } },
      constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
    },
  };
}

async function buildBaseRequest(): Promise<NormalizedRequest> {
  return reasoningEngine.resolve({
    structuredIntelligence: buildStructuredIntelligence(),
    locks: locksWith(),
    scenario: {
      context: 'Residential',
      lighting: '',
      sunDirection: 'Auto',
      artificialLighting: [],
      environment: 'Clear sky',
      cameraMode: 'Preserve Original',
      aspectRatio: '2:3',
      generationResolution: '2K',
      upscaleResolution: '4K',
      renderCore: 'Nano Banana',
      normalizedAt: now,
    },
    references: [],
    instructions: [],
  });
}

function fakePromptOutput(baseRequest: NormalizedRequest): PromptOutput {
  return {
    compiled: { compilerVersion: 'prompt-compiler:v1', normalizedRequestSnapshot: baseRequest, sections: {} as never },
  } as unknown as PromptOutput;
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

async function renderReady() {
  const baseRequest = await buildBaseRequest();
  const store = new ProjectSessionStore({
    ...createInitialProjectSessionState(),
    currentProject: PROJECT,
    sourceImage: { assetId: 'a1', url: '/assets/a1' },
    promptOutput: fakePromptOutput(baseRequest),
  });
  render(
    <ProjectSessionProvider store={store}>
      <MultiViewPanel />
    </ProjectSessionProvider>,
  );
  return store;
}

describe('MultiViewPanel — BUILD 15 Multi-View / Sync / Creative View', () => {
  it('shows the empty state until a prompt has been compiled', () => {
    const store = new ProjectSessionStore(createInitialProjectSessionState());
    render(
      <ProjectSessionProvider store={store}>
        <MultiViewPanel />
      </ProjectSessionProvider>,
    );
    expect(screen.getByText('No compiled prompt yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate view/i })).not.toBeInTheDocument();
  });

  it('renders the real form once a prompt is compiled, disabled until a camera field (or, in Creative mode, style) is filled', async () => {
    await renderReady();
    const generateButton = screen.getByRole('button', { name: /generate view/i });
    expect(generateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Perspective'), { target: { value: "bird's eye" } });
    expect(generateButton).toBeEnabled();
  });

  it('only shows the style field in Creative mode', async () => {
    await renderReady();
    expect(screen.queryByLabelText('Style proposal')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'creative' } });
    expect(screen.getByLabelText('Style proposal')).toBeInTheDocument();
  });

  describe('real view generation flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('resolves a Sync View, recompiles, and submits real provenance to the view endpoint', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jobId: 'job-1',
            viewId: 'view-1',
            generationId: 'gen-2',
            versionId: 'v2',
            project: PROJECT,
            view: { id: 'view-1', mode: 'sync' },
            generation: { id: 'gen-2', status: 'succeeded', outputAssets: ['out-2'] },
            outputAssetUrls: ['/assets/out-2'],
          },
          { status: 201 },
        ),
      );

      const store = await renderReady();
      fireEvent.change(screen.getByLabelText('Perspective'), { target: { value: "bird's eye" } });
      fireEvent.click(screen.getByRole('button', { name: /generate view/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/views');
      const body = JSON.parse(init.body);
      expect(body.mode).toBe('sync');
      expect(body.cameraProposal).toEqual({ perspective: "bird's eye" });
      expect(body.renderCore).toBe('Nano Banana');
      expect(body.aspectRatio).toBe('2:3');
      expect(typeof body.promptText).toBe('string');
      expect(body.promptText.length).toBeGreaterThan(0);

      await waitFor(() => expect(store.getState().latestGenerationId).toBe('gen-2'));
      expect(store.getState().latestOutputAssetId).toBe('out-2');
      expect(store.getState().latestGenerationOutputUrls).toEqual(['/assets/out-2']);
    });

    it('shows the real error envelope, not a fake result, when the view request fails', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'PROVIDER_NOT_CONFIGURED', message: 'NANO_BANANA_API_KEY is not configured.', retryable: false }, { status: 503 }),
      );

      await renderReady();
      fireEvent.change(screen.getByLabelText('Perspective'), { target: { value: "bird's eye" } });
      fireEvent.click(screen.getByRole('button', { name: /generate view/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('NANO_BANANA_API_KEY is not configured.'));
    });
  });
});
