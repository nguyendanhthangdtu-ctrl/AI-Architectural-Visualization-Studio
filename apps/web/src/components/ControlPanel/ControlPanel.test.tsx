import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ControlPanel } from './ControlPanel.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function uploadFile(name = 'viewport.png', type = 'image/png') {
  return new File(['fake-bytes'], name, { type });
}

describe('ControlPanel', () => {
  it('places the Prompt Editor immediately below Prompt From Image in document order (docs/02 UX rule)', () => {
    render(
      <ProjectSessionProvider>
        <ControlPanel module="architecture" />
      </ProjectSessionProvider>,
    );
    const promptFromImage = screen.getByText('Dò prompt từ ảnh').closest('section')!;
    const promptEditor = screen.getByLabelText('Prompt editor').closest('section')!;
    // DOCUMENT_POSITION_FOLLOWING (4) means promptEditor comes after promptFromImage.
    expect(promptFromImage.compareDocumentPosition(promptEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the upload dropzone before any source image exists, with no fake preview image', () => {
    render(
      <ProjectSessionProvider>
        <ControlPanel module="architecture" />
      </ProjectSessionProvider>,
    );
    expect(screen.getByRole('button', { name: /drop a viewport image/i })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the Locks section using the real LockControlGroup empty state, not fabricated lock data', () => {
    render(
      <ProjectSessionProvider>
        <ControlPanel module="architecture" />
      </ProjectSessionProvider>,
    );
    expect(screen.getByText('Locks become available after analysis')).toBeInTheDocument();
  });

  describe('BUILD 06: real upload flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('creates a project then uploads the asset, showing the real returned image on success', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            id: 'p1',
            name: 'x',
            module: 'architecture',
            createdAt: 't',
            updatedAt: 't',
            status: 'draft',
            currentVersionId: '',
          },
          { status: 201 },
        ),
      );
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'a1', url: '/assets/a1', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );

      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });

      await waitFor(() => expect(screen.getByRole('img', { name: /source image/i })).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/projects');
      expect(fetchMock.mock.calls[1]?.[0]).toContain('/projects/p1/assets');
    });

    it('shows the real error envelope, not a fake success state, when the API rejects the upload', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            id: 'p1',
            name: 'x',
            module: 'architecture',
            createdAt: 't',
            updatedAt: 't',
            status: 'draft',
            currentVersionId: '',
          },
          { status: 201 },
        ),
      );
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.', retryable: false },
          { status: 415 },
        ),
      );

      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unsupported content type.'));
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('reuses the existing project on a second upload rather than creating a duplicate', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            id: 'p1',
            name: 'x',
            module: 'architecture',
            createdAt: 't',
            updatedAt: 't',
            status: 'draft',
            currentVersionId: '',
          },
          { status: 201 },
        ),
      );
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'a1', url: '/assets/a1', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );

      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });
      await waitFor(() => expect(screen.getByRole('img', { name: /source image/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'a2', url: '/assets/a2', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );
      const secondInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(secondInput, { target: { files: [uploadFile('second.png')] } });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)); // create + upload + upload (no second create)
      expect(fetchMock.mock.calls[2]?.[0]).toContain('/projects/p1/assets');
    });
  });

  describe('BUILD 07: real analysis flow against apps/api', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function uploadOnce() {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            id: 'p1',
            name: 'x',
            module: 'architecture',
            createdAt: 't',
            updatedAt: 't',
            status: 'draft',
            currentVersionId: '',
          },
          { status: 201 },
        ),
      );
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'a1', url: '/assets/a1', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );
      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });
      await waitFor(() => expect(screen.getByRole('img', { name: /source image/i })).toBeInTheDocument());
      return fetchMock;
    }

    it('shows the Analyze action once an image exists, and not before', async () => {
      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );
      expect(screen.queryByRole('button', { name: /analyze source image/i })).not.toBeInTheDocument();

      await uploadOnce();
      expect(screen.getByRole('button', { name: /analyze source image/i })).toBeInTheDocument();
    });

    it('running analysis populates the real Lock set — LockControlGroup shows real, not empty, state', async () => {
      const fetchMock = await uploadOnce();
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            analysisId: 'an1',
            versionId: 'v1',
            project: {
              id: 'p1',
              name: 'x',
              module: 'architecture',
              createdAt: 't',
              updatedAt: 't2',
              status: 'draft',
              currentVersionId: 'v1',
            },
            structuredIntelligence: {
              analysisVersion: 'gemini:test:2026-09-04T00:00:00.000Z',
              module: 'architecture',
              layers: {},
            },
          },
          { status: 201 },
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: /analyze source image/i }));

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Architecture Lock' })).toBeInTheDocument());
      expect(screen.getByRole('switch', { name: 'Architecture Lock' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: 'Style Lock' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByText('Locks become available after analysis')).not.toBeInTheDocument();
      // Analysis complete — the trigger is gone since locks.length > 0 now.
      expect(screen.queryByRole('button', { name: /analyze source image/i })).not.toBeInTheDocument();
    });

    it('shows the real error envelope, not fake locks, when analysis fails', async () => {
      const fetchMock = await uploadOnce();
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          { code: 'PROVIDER_NOT_CONFIGURED', message: 'GEMINI_API_KEY is not configured.', retryable: false },
          { status: 503 },
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: /analyze source image/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GEMINI_API_KEY is not configured.'));
      expect(screen.getByText('Locks become available after analysis')).toBeInTheDocument();
    });
  });

  describe('BUILD 11: real Compile Prompt flow (Reasoning Engine + Master Prompt Compiler, no network call)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function fillValidScenario() {
      fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'Residential' } });
      fireEvent.change(screen.getByLabelText('Lighting'), { target: { value: 'Golden Hour' } });
      fireEvent.change(screen.getByLabelText('Sun Direction'), { target: { value: 'Front' } });
      fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'Clear sky' } });
      fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'Preserve Original' } });
      fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '2:3' } });
      fireEvent.change(screen.getByLabelText('Generation Resolution'), { target: { value: '2K' } });
      fireEvent.change(screen.getByLabelText('Upscale Resolution'), { target: { value: '4K' } });
      // BUILD 27 FIX — 'Auto' no longer exists as a choice; ChatGPT Image supports '2:3'.
      fireEvent.change(screen.getByLabelText('AI Image Model'), { target: { value: 'ChatGPT Image' } });
    }

    it('stays disabled until analysis and scenario are both real, then compiles a real bilingual prompt into the draft', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          { id: 'p1', name: 'x', module: 'architecture', createdAt: 't', updatedAt: 't', status: 'draft', currentVersionId: '' },
          { status: 201 },
        ),
      );
      fetchMock.mockImplementationOnce(async () =>
        jsonResponse({ id: 'a1', url: '/assets/a1', contentType: 'image/png', sizeBytes: 10 }, { status: 201 }),
      );
      render(
        <ProjectSessionProvider>
          <ControlPanel module="architecture" />
        </ProjectSessionProvider>,
      );
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [uploadFile()] } });
      await waitFor(() => expect(screen.getByRole('img', { name: /source image/i })).toBeInTheDocument());

      expect(screen.getByRole('button', { name: /compile prompt/i })).toBeDisabled();

      fetchMock.mockImplementationOnce(async () =>
        jsonResponse(
          {
            analysisId: 'an1',
            versionId: 'v1',
            project: { id: 'p1', name: 'x', module: 'architecture', createdAt: 't', updatedAt: 't2', status: 'draft', currentVersionId: 'v1' },
            structuredIntelligence: {
              analysisVersion: 'gemini:test:2026-09-04T00:00:00.000Z',
              module: 'architecture',
              layers: {
                subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'A modern villa.' } },
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
            },
          },
          { status: 201 },
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: /analyze source image/i }));
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Architecture Lock' })).toBeInTheDocument());

      expect(screen.getByRole('button', { name: /compile prompt/i })).toBeDisabled();
      fillValidScenario();
      fireEvent.click(screen.getByRole('button', { name: /apply scenario/i }));
      await waitFor(() => expect(screen.getByText('Applied')).toBeInTheDocument());

      expect(screen.getByRole('button', { name: /compile prompt/i })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: /compile prompt/i }));

      await waitFor(() => expect((screen.getByLabelText('Prompt editor') as HTMLTextAreaElement).value.length).toBeGreaterThan(0));
      // No extra network calls — Reasoning Engine + Master Prompt Compiler are pure domain logic (docs/09), same as scenarioBuilder.normalize().
      expect(fetchMock).toHaveBeenCalledTimes(3); // create project + upload + analysis only
      expect((screen.getByLabelText('Prompt editor') as HTMLTextAreaElement).value).toContain('villa');
    });
  });
});
