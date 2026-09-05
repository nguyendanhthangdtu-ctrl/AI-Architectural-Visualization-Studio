import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@avs/project-core';
import { createDefaultLocks } from '@avs/project-core';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { QCPanel } from './QCPanel.js';

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
      <QCPanel />
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
  currentVersionId: 'v1',
} as unknown as Project;

const STRUCTURED_INTELLIGENCE = {
  analysisVersion: 'gemini:test:2026-09-04T00:00:00.000Z',
  module: 'architecture' as const,
  layers: {
    subject: { confidence: 0.9, warnings: [], data: { type: 'building' as const, description: 'A modern villa.' } },
    architecture: {
      confidence: 0.8,
      warnings: [],
      data: { geometry: 'boxy', openings: 'glazing', roof: 'flat', facade: 'cladding', floorPlan: 'open', ceiling: 'flat', stairs: 'none', proportions: 'balanced' },
    },
    style: { confidence: 0.7, warnings: [], data: { style: 'Modern Contemporary', influences: [] } },
    camera: {
      confidence: 0.6,
      warnings: [],
      data: { heightMeters: 1.6, lens: 'wide-angle', fieldOfViewDegrees: 60, perspective: 'eye level', eyeLevel: 'standing', projection: 'two-point perspective', verticalCorrection: 'none' },
    },
    composition: { confidence: 0.7, warnings: [], data: { leadingLines: '', ruleOfThirds: '', goldenRatio: '', symmetry: '', balance: '', negativeSpace: '', hierarchy: '' } },
    material: { confidence: 0.6, warnings: [], data: { materials: [{ surface: 'wall', type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' }] } },
    lighting: { confidence: 0.5, warnings: [], data: { direction: 'front', timeOfDay: 'golden hour', intensity: 'medium', softness: 'soft', shadows: 'soft', colorTemperature: 'warm', artificialLighting: [] } },
    environment: { confidence: 0.6, warnings: [], data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' } },
    object: { confidence: 0.5, warnings: [], data: { objects: [] } },
    photography: { confidence: 0.6, warnings: [], data: { cameraSystemLook: '', lensBehavior: '', exposure: '', dynamicRange: '', depth: '', imperfections: '' } },
    realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'Professional architectural photography.' } },
    constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
  },
};

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
  renderCore: 'Auto',
  normalizedAt: '2026-09-04T00:00:00.000Z',
};

const READY_STATE = {
  currentProject: PROJECT,
  sourceImage: { assetId: 'src-1', url: 'http://x/assets/src-1' },
  structuredIntelligence: STRUCTURED_INTELLIGENCE,
  analysisId: 'an1',
  locks: createDefaultLocks({ analysisVersion: STRUCTURED_INTELLIGENCE.analysisVersion, setBy: 'u1' as never, setAt: 't' as never }),
  scenario: SCENARIO,
  latestGenerationId: 'gen-1',
  latestOutputAssetId: 'out-1',
};

const PASS_QC_RESULT = {
  decision: 'pass' as const,
  scores: { architectureScore: 1, cameraScore: 1, materialScore: 1, lightingScore: 1, objectConsistencyScore: 1, photorealismScore: 1 },
  issues: [],
  correctionInstruction: null,
};

const FAIL_QC_RESULT = {
  decision: 'fail' as const,
  scores: { architectureScore: 0.3, cameraScore: 1, materialScore: 1, lightingScore: 1, objectConsistencyScore: 1, photorealismScore: 1 },
  issues: [{ attribute: 'architecture', severity: 'high' as const, description: 'roofline changed' }],
  correctionInstruction: 'Regenerate preserving the original roofline.',
};

describe('QCPanel — BUILD 17 AI QC / Auto-Regeneration', () => {
  it('shows the empty state until a generation exists', () => {
    renderWithState({});
    expect(screen.getByText('No generated image yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run qc/i })).not.toBeInTheDocument();
  });

  describe('against apps/api (no real network)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('runs QC with the real locks/analysisId and shows a PASS result', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ generationId: 'gen-1', qc: PASS_QC_RESULT }));

      renderWithState(READY_STATE);
      fireEvent.click(screen.getByRole('button', { name: /run qc/i }));

      await waitFor(() => expect(screen.getByText('PASS')).toBeInTheDocument());
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/projects/p1/generations/gen-1/qc');
      const body = JSON.parse(init.body);
      expect(body.analysisId).toBe('an1');
      expect(body.locks).toHaveLength(5);
      expect(body.outputAssetId).toBe('out-1');

      expect(screen.getAllByText('100%')).toHaveLength(6);
      expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
    });

    it('shows a FAIL result with issues and a Regenerate action, which resubmits via the VERIFY→CREATE loop', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ generationId: 'gen-1', qc: FAIL_QC_RESULT }));

      const store = renderWithState(READY_STATE);
      fireEvent.click(screen.getByRole('button', { name: /run qc/i }));

      await waitFor(() => expect(screen.getByText('FAIL')).toBeInTheDocument());
      expect(screen.getByText(/roofline changed/)).toBeInTheDocument();

      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jobId: 'j2',
            generationId: 'gen-2',
            versionId: 'v2',
            project: { ...PROJECT, currentVersionId: 'v2' },
            generation: { outputAssets: ['out-2'] },
            outputAssetUrls: ['/assets/out-2'],
          },
          { status: 201 },
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain('/projects/p1/generations/gen-1/regenerate');
      const body = JSON.parse(init.body);
      expect(body.correctionInstruction).toBe('Regenerate preserving the original roofline.');
      expect(body.sourceAssetId).toBe('src-1');
      expect(typeof body.promptText).toBe('string');
      expect(body.promptText.length).toBeGreaterThan(0);

      await waitFor(() => expect(store.getState().latestGenerationId).toBe('gen-2'));
      expect(store.getState().qcState).toBeNull();
    });
  });
});
