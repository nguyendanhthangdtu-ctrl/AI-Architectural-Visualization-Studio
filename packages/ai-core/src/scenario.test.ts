import { describe, expect, it } from 'vitest';
import { scenarioBuilder, type ScenarioInput } from './scenario.js';

function validInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    context: 'Residential',
    lighting: 'Golden Hour',
    sunDirection: 'Front',
    artificialLighting: ['Downlight IES'],
    environment: 'Clear sky',
    cameraMode: 'Preserve Original',
    aspectRatio: '2:3',
    generationResolution: '2K',
    upscaleResolution: '4K',
    renderCore: 'Auto',
    ...overrides,
  };
}

describe('scenarioBuilder.normalize', () => {
  it('accepts a fully valid scenario and stamps normalizedAt', async () => {
    const result = await scenarioBuilder.normalize(validInput());
    expect(result.context).toBe('Residential');
    expect(result.generationResolution).toBe('2K');
    expect(result.upscaleResolution).toBe('4K');
    expect(new Date(result.normalizedAt).toString()).not.toBe('Invalid Date');
  });

  it('is case- and whitespace-insensitive, canonicalizing to the docs/07 casing', async () => {
    const result = await scenarioBuilder.normalize(
      validInput({ context: '  residential  ', renderCore: 'auto', aspectRatio: '2:3' }),
    );
    expect(result.context).toBe('Residential');
    expect(result.renderCore).toBe('Auto');
  });

  it('rejects a value outside the closed docs/07 vocabulary, naming the field and allowed values', async () => {
    await expect(scenarioBuilder.normalize(validInput({ context: 'Spaceship' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('context "Spaceship" is not one of'),
    });
  });

  it('rejects a missing (empty) required field', async () => {
    await expect(scenarioBuilder.normalize(validInput({ lighting: '' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('lighting is required'),
    });
  });

  it('reports every invalid field at once, not just the first', async () => {
    await expect(
      scenarioBuilder.normalize(validInput({ context: 'Spaceship', renderCore: 'Nope' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringMatching(/context.*renderCore|renderCore.*context/s),
    });
  });

  it('keeps generationResolution and upscaleResolution as two independently validated fields', async () => {
    const result = await scenarioBuilder.normalize(
      validInput({ generationResolution: 'Preview', upscaleResolution: '8K/Ultra' }),
    );
    expect(result.generationResolution).toBe('Preview');
    expect(result.upscaleResolution).toBe('8K/Ultra');
  });

  it('accepts an empty artificialLighting array — it is optional, unlike the other fields', async () => {
    const result = await scenarioBuilder.normalize(validInput({ artificialLighting: [] }));
    expect(result.artificialLighting).toEqual([]);
  });

  it('validates, canonicalizes, and dedupes multi-select artificialLighting entries', async () => {
    const result = await scenarioBuilder.normalize(
      validInput({ artificialLighting: ['downlight ies', 'Accent', 'Downlight IES'] }),
    );
    expect(result.artificialLighting).toEqual(['Downlight IES', 'Accent']);
  });

  it('rejects an artificialLighting entry outside its vocabulary', async () => {
    await expect(scenarioBuilder.normalize(validInput({ artificialLighting: ['Neon sign'] }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('artificialLighting "Neon sign" is not one of'),
    });
  });

  it('accepts "Custom" for the fields docs/07 explicitly lists it on', async () => {
    const result = await scenarioBuilder.normalize(
      validInput({ context: 'Custom', lighting: 'Custom', aspectRatio: 'Custom' }),
    );
    expect(result.context).toBe('Custom');
    expect(result.lighting).toBe('Custom');
    expect(result.aspectRatio).toBe('Custom');
  });

  it('is deterministic in its field resolution — same input yields the same normalized fields', async () => {
    const input = validInput();
    const [a, b] = await Promise.all([scenarioBuilder.normalize(input), scenarioBuilder.normalize(input)]);
    const stripTimestamp = ({ normalizedAt: _normalizedAt, ...fields }: typeof a) => fields;
    expect(stripTimestamp(a)).toEqual(stripTimestamp(b));
  });
});
